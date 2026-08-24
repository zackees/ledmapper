#!/usr/bin/env python3
"""One-command mapped-LED video production.

Wraps the unattended producer (`scripts/produce_video_mapping.py`) with the
boilerplate that every production request otherwise repeats by hand: starting
or reusing the dev server, packaging the input ZIP, serving it locally,
extracting the emitted MP4 under a descriptive name, and optionally building
the source-left / mapped-right comparison splice.

Example:

    python scripts/produce_mapped_video.py E:\\video\\short\\fluid_swirls.mp4

See docs/production-cli.md for the underlying job-URL parameters.
"""

from __future__ import annotations

import argparse
import atexit
import functools
import http.server
import json
import math
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import psutil

REPO_ROOT = Path(__file__).resolve().parent.parent
PRODUCER = REPO_ROOT / "scripts" / "produce_video_mapping.py"
DEFAULT_MAP = REPO_ROOT / "public" / "screenmaps" / "64x64_quad_serpentine.json"
DEFAULT_OUTPUT_DIR = Path(r"E:\video\short_out")
READY_PREFIX = "DEV-SERVER-READY "
STRATEGIES_TS = REPO_ROOT / "src" / "moviemaker" / "hdr-bloom-strategies.ts"


def _load_strategy_names() -> tuple[list[str], str]:
    """Read the strategy registry from TypeScript so the CLI cannot drift.

    Duplicating the list here would let `--strategy` accept a name the renderer
    rejects (or miss one it supports) the moment either side changes.
    """
    source = STRATEGIES_TS.read_text(encoding="utf-8")
    block = re.search(
        r"HDR_BLOOM_STRATEGY_NAMES\s*=\s*\[(.*?)\]\s*as const", source, re.DOTALL
    )
    default = re.search(
        r"DEFAULT_HDR_BLOOM_STRATEGY:\s*HdrBloomStrategyName\s*=\s*'([^']+)'", source
    )
    if not block or not default:
        raise ProduceError(f"could not read the strategy registry from {STRATEGIES_TS}")
    return re.findall(r"'([^']+)'", block.group(1)), default.group(1)


class ProduceError(RuntimeError):
    """A failure with a message that is useful on its own."""


STRATEGY_NAMES: list[str]
DEFAULT_STRATEGY: str


# ---------------------------------------------------------------- ffmpeg


@functools.lru_cache(maxsize=1)
def ffmpeg_tools() -> tuple[str, str]:
    """Return (ffmpeg, ffprobe) paths, preferring static-ffmpeg."""
    try:
        import static_ffmpeg  # noqa: PLC0415 - optional, only needed for stitching

        static_ffmpeg.add_paths()
    except ImportError:
        pass
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ProduceError(
            "ffmpeg/ffprobe not found. Install the static binaries with "
            "`python -m pip install static-ffmpeg`, or put ffmpeg on PATH, "
            "or rerun with --no-stitch."
        )
    return ffmpeg, ffprobe


def probe_duration(path: Path) -> float:
    _, ffprobe = ffmpeg_tools()
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def probe_fps(path: Path) -> float:
    _, ffprobe = ffmpeg_tools()
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    numerator, _, denominator = result.stdout.strip().partition("/")
    divisor = float(denominator or 1)
    return float(numerator) / divisor if divisor else 30.0


def probe_display_dimensions(path: Path) -> tuple[int, int]:
    """Return (width, height) in DISPLAY orientation.

    ffmpeg's filters run after auto-rotation, and the renderer sizes itself
    from the display dimensions too, so a ±90° rotation side-data entry swaps
    the coded width/height.
    """
    _, ffprobe = ffmpeg_tools()
    # -show_streams rather than a side-data -show_entries selector: the
    # static-ffmpeg ffprobe rejects the 'stream_side_data' section name.
    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    rotation = 0
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            rotation = int(float(side["rotation"]))
    if abs(rotation) % 180 == 90:
        width, height = height, width
    return width, height


# ----------------------------------------------------- source crop geometry
#
# Replicates the renderer's sampling placement so the source can be cropped to
# exactly the region the LED panel samples. Mirrors, and MUST stay in sync
# with: scaleToMaxDimension + transformToCenter (src/moviemaker/transforms.ts),
# computeCenterFitScale / isCompleteRegularGrid (src/common.ts), and the
# gather transform p = R(rot)·pt·zoom + center (src/moviemaker/shaders.ts,
# fed rotation + panelRotation by src/production/production-renderer.ts).


def _js_round(value: float) -> int:
    """JS Math.round: floor(x + 0.5), unlike Python's banker's rounding."""
    return math.floor(value + 0.5)


def _scale_to_max_dimension(native_w: int, native_h: int, max_dim: int) -> tuple[int, int]:
    if max_dim <= 0 or max(native_w, native_h) <= max_dim:
        return native_w, native_h
    scale = max_dim / max(native_w, native_h)
    return max(1, _js_round(native_w * scale)), max(1, _js_round(native_h * scale))


def _screenmap_points(screenmap: Path) -> list[tuple[float, float]]:
    data = json.loads(screenmap.read_text(encoding="utf-8"))
    points: list[tuple[float, float]] = []
    strips = list(data.get("map", {}).values()) + list(data.get("segments", []))
    for strip in strips:
        points.extend(zip(strip.get("x", []), strip.get("y", [])))
    if not points:
        raise ProduceError(f"screenmap has no points: {screenmap}")
    return points


def _is_complete_regular_grid(points: list[tuple[float, float]]) -> bool:
    if len(points) < 4:
        return False
    xs = sorted({x for x, _ in points})
    ys = sorted({y for _, y in points})
    if len(xs) < 2 or len(ys) < 2 or len(xs) * len(ys) != len(points):
        return False

    def uniform(values: list[float]) -> bool:
        pitch = values[1] - values[0]
        return (pitch > sys.float_info.epsilon
                and abs(pitch - round(pitch)) <= 1e-9
                and all(abs(values[i] - values[i - 1] - pitch) <= 1e-9
                        for i in range(2, len(values))))

    return uniform(xs) and uniform(ys) and len(set(points)) == len(points)


def _center_fit_scale(points: list[tuple[float, float]], width: int, height: int,
                      margin: float = 20, pixel_align: bool = True) -> float:
    span_x = max(x for x, _ in points) - min(x for x, _ in points)
    span_y = max(y for _, y in points) - min(y for _, y in points)
    avail_w = margin * width if margin <= 1 else width - 2 * margin
    avail_h = margin * height if margin <= 1 else height - 2 * margin
    scale_x = avail_w / span_x if span_x > 0 else avail_w
    scale_y = avail_h / span_y if span_y > 0 else avail_h
    continuous = min(scale_x, scale_y)
    if not pixel_align or not _is_complete_regular_grid(points) or continuous < 1:
        return continuous
    lower = max(1, math.floor(continuous))
    upper = math.ceil(continuous)
    span = max(span_x, span_y)
    if (upper - continuous <= continuous - lower
            and (upper - continuous) * span <= 1 + sys.float_info.epsilon):
        return upper
    return lower


def compute_source_crop(video: Path, screenmap: Path, rotate_deg: float,
                        zoom: float = 1.0, max_resolution: int = 480,
                        ) -> tuple[int, int, int, int]:
    """The (x, y, w, h) native-pixel region the mapped render samples.

    The bounding box of the transformed LED sample positions, extended by half
    an LED pitch so each LED's full cell is covered, mapped back from decoded
    to native display coordinates.
    """
    native_w, native_h = probe_display_dimensions(video)
    decoded_w, decoded_h = _scale_to_max_dimension(native_w, native_h, max_resolution)
    points = _screenmap_points(screenmap)
    scale = _center_fit_scale(points, decoded_w, decoded_h)

    center_x = (min(x for x, _ in points) + max(x for x, _ in points)) / 2
    center_y = (min(y for _, y in points) + max(y for _, y in points)) / 2
    radians = math.radians(rotate_deg)
    cos_r, sin_r = math.cos(radians), math.sin(radians)
    transformed = []
    for x, y in points:
        px = (x - center_x) * scale
        py = (y - center_y) * scale
        transformed.append((
            (px * cos_r - py * sin_r) * zoom,
            (px * sin_r + py * cos_r) * zoom,
        ))

    xs_sorted = sorted({x for x, _ in points})
    pitch_units = xs_sorted[1] - xs_sorted[0] if _is_complete_regular_grid(points) else 0.0
    extend = 0.5 * pitch_units * scale * zoom

    min_x = min(x for x, _ in transformed) - extend
    max_x = max(x for x, _ in transformed) + extend
    min_y = min(y for _, y in transformed) - extend
    max_y = max(y for _, y in transformed) + extend

    factor_x = native_w / decoded_w
    factor_y = native_h / decoded_h
    x0 = max(0, math.floor((decoded_w / 2 + min_x) * factor_x))
    y0 = max(0, math.floor((decoded_h / 2 + min_y) * factor_y))
    x1 = min(native_w, math.ceil((decoded_w / 2 + max_x) * factor_x))
    y1 = min(native_h, math.ceil((decoded_h / 2 + max_y) * factor_y))
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise ProduceError(f"degenerate source crop {x0},{y0}..{x1},{y1} for {video.name}")
    return x0, y0, x1 - x0, y1 - y0


COLOR_TAGS = [
    # Explicit color tags: an untagged re-encode makes players guess (often
    # bt601) and decode desaturated with shifted hues — the user-caught
    # dual-render defect. The producer's own MP4 is tagged tv/bt709; every
    # ffmpeg composition must match it.
    "-colorspace", "bt709", "-color_primaries", "bt709",
    "-color_trc", "bt709", "-color_range", "tv",
]


def apply_saturation_boost(source: Path, destination: Path, factor: float) -> None:
    """Re-encode `source` with HSV saturation scaled by `factor`.

    Hue and value (the max channel) are preserved exactly: each pixel's
    channels are rescaled about its max so only the spread changes, clamped
    at full saturation. This is deliberately NOT ffmpeg's eq/vibrance —
    those work on YUV chroma and can shift hue at the gamut edge, which the
    hue-locked pipeline forbids.
    """
    import numpy as np  # noqa: PLC0415 - only needed when boosting

    ffmpeg, ffprobe = ffmpeg_tools()
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,avg_frame_rate",
         "-of", "csv=p=0", str(source)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    width, height, fps = int(probe[0]), int(probe[1]), probe[2]

    decoder = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(source),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    encoder = subprocess.Popen(
        [ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{width}x{height}", "-r", fps, "-i", "-",
         "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
         *COLOR_TAGS, str(destination)],
        stdin=subprocess.PIPE,
    )
    assert decoder.stdout is not None and encoder.stdin is not None
    frame_bytes = width * height * 3
    while True:
        raw = decoder.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        rgb = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
        arr = rgb.astype(np.float32)
        mx = arr.max(axis=-1)
        spread = mx - arr.min(axis=-1)
        lit = (mx > 0) & (spread > 0)
        saturation = np.zeros_like(mx)
        saturation[lit] = spread[lit] / mx[lit]
        boosted = np.minimum(saturation * factor, 1.0)
        scale = np.ones_like(mx)
        scale[lit] = (boosted[lit] * mx[lit]) / spread[lit]
        out = mx[..., None] - (mx[..., None] - arr) * scale[..., None]
        encoder.stdin.write(
            np.clip(out + 0.5, 0, 255).astype(np.uint8).tobytes()
        )
    encoder.stdin.close()
    decoder.wait()
    if encoder.wait() != 0:
        raise ProduceError(f"saturation-boost encode failed for {source.name}")


def _font_argument() -> str:
    """An ffmpeg-escaped fontfile= argument, or '' to use drawtext's default."""
    for candidate in (
        Path(r"C:\Windows\Fonts\consola.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
        Path("/System/Library/Fonts/Menlo.ttc"),
    ):
        if candidate.is_file():
            # drawtext parses ':' as an option separator and '\' as an escape,
            # so a Windows path must be given as C\:/Windows/...
            escaped = str(candidate).replace("\\", "/").replace(":", r"\:")
            return f"fontfile='{escaped}':"
    return ""


def _label_filter(text: str) -> str:
    """A drawtext filter drawing `text` in a box at the tile's top-left."""
    safe = text.replace("\\", "").replace(":", "-").replace("'", "")
    return (
        f"drawtext={_font_argument()}text='{safe}':x=18:y=16:fontsize=34:"
        "fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10"
    )


def compare_grid(tiles: list[tuple[str, Path]], destination: Path) -> Path:
    """Compose labelled tiles into one comparison video.

    Two tiles stack horizontally; three or four form a 2x2 grid, which is much
    easier to scan for chromatic differences than a wide strip. The source tile
    is always first (top-left) so the reference sits in the same place in every
    comparison. Every tile is normalized to identical geometry and fps first —
    otherwise the stack filters fail or silently misalign.
    """
    if len(tiles) < 2:
        raise ProduceError("a comparison needs at least two tiles")
    if len(tiles) > 4:
        raise ProduceError(f"a comparison grid holds at most 4 tiles, got {len(tiles)}")
    ffmpeg, _ = ffmpeg_tools()
    paths = [path for _, path in tiles]
    duration = min(probe_duration(path) for path in paths)
    fps = max(probe_fps(path) for path in paths)
    cell = 720

    chains = []
    for index, (label, _path) in enumerate(tiles):
        # Fit inside the cell rather than cropping: a mapped 1:1 panel and a 9:16
        # source must stay directly comparable, so letterbox instead of zooming.
        chains.append(
            f"[{index}:v]scale={cell}:{cell}:force_original_aspect_ratio=decrease,"
            f"pad={cell}:{cell}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"fps={fps},setsar=1,{_label_filter(label)}[t{index}]"
        )
    if len(tiles) == 2:
        stack = "[t0][t1]hstack=inputs=2[v]"
    else:
        inputs = "".join(f"[t{index}]" for index in range(len(tiles)))
        cells = ["0_0", "w0_0", "0_h0", "w0_h0"][: len(tiles)]
        stack = (
            f"{inputs}xstack=inputs={len(tiles)}:layout={'|'.join(cells)}:fill=black[v]"
        )
    filtergraph = ";".join([*chains, stack])

    command = [ffmpeg, "-y", "-v", "error"]
    for path in paths:
        command += ["-t", f"{duration:.3f}", "-i", str(path)]
    command += [
        "-filter_complex", filtergraph,
        "-map", "[v]", "-an",
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-color_range", "tv",
        str(destination),
    ]
    subprocess.run(command, check=True)
    return destination


def stitch(source: Path, mapped: Path, destination: Path) -> Path:
    """Build a visual-only splice: source left, mapped right.

    The two inputs differ in geometry and cadence, so the source is scaled to
    the mapped clip's height and both are forced to a common fps. Both are
    trimmed to the shorter duration rather than letting ffmpeg freeze a final
    frame.
    """
    ffmpeg, _ = ffmpeg_tools()
    duration = min(probe_duration(source), probe_duration(mapped))
    # Match the faster input so a 60fps render's cadence survives into the
    # splice — that splice is what gets reviewed for temporal artifacts.
    fps = max(probe_fps(source), probe_fps(mapped))
    filtergraph = (
        f"[0:v]scale=-2:1024:flags=lanczos,fps={fps},setsar=1[left];"
        f"[1:v]scale=-2:1024:flags=lanczos,fps={fps},setsar=1[right];"
        "[left][right]hstack=inputs=2[v]"
    )
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source),
            "-t",
            f"{duration:.3f}",
            "-i",
            str(mapped),
            "-filter_complex",
            filtergraph,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            str(destination),
        ],
        check=True,
    )
    return destination


# ------------------------------------------------------------ dev server


def probe_dev_server(port: int) -> str | None:
    """Return the URL of a dev server already answering on `port`, else None.

    Never trust process lists for this — only an actual HTTP response proves a
    usable server, and only a probe made BEFORE we spawn anything tells us
    whether the server is ours to tear down afterwards.
    """
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    for scheme in ("https", "http"):
        url = f"{scheme}://localhost:{port}"
        try:
            with urllib.request.urlopen(  # noqa: S310 - fixed loopback URL
                url, timeout=1.5, context=context if scheme == "https" else None
            ) as response:
                response.read(64)
            return url
        except OSError:
            continue
    return None


def kill_process_tree(process: subprocess.Popen) -> None:
    """Terminate a spawned process AND its descendants, via psutil.

    The dev server is an npm shim that spawns node, which spawns Vite, which
    spawns esbuild. Terminating only the parent orphans that whole tree and
    leaves it burning CPU forever (a failure this repo has hit on Windows), so
    every descendant is enumerated and killed through the psutil process API —
    one code path on every OS, no taskkill/killpg shell divergence.

    Children are listed BEFORE the parent dies (a dead parent can no longer be
    asked for them), then everything gets terminate() → wait → kill() for the
    stragglers. Races where a process exits mid-walk are expected and ignored.
    """
    if process.poll() is not None:
        return
    try:
        root = psutil.Process(process.pid)
        targets = [*root.children(recursive=True), root]
    except psutil.NoSuchProcess:
        return
    for target in targets:
        try:
            target.terminate()
        except psutil.NoSuchProcess:
            pass
    _gone, alive = psutil.wait_procs(targets, timeout=10)
    for target in alive:
        try:
            target.kill()
        except psutil.NoSuchProcess:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def start_dev_server(port: int) -> tuple[str, subprocess.Popen | None]:
    """Start or reuse the dev server, returning (url, owned process | None).

    A server that already answers on `port` is reused and NOT owned — we never
    tear down what we did not start. Otherwise one is spawned and returned as
    owned; run() kills its whole tree on exit unless --keep-server asks for it
    to stay warm for a batch of invocations.
    """
    existing = probe_dev_server(port)
    if existing is not None:
        return existing, None

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise ProduceError("npm not found on PATH.")
    process = subprocess.Popen(
        [npm, "run", "dev:agent", "--", "--port", str(port)],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    # Whatever happens after this point — success, exception, Ctrl-C — the
    # interpreter must not exit with the tree still running.
    atexit.register(kill_process_tree, process)
    stdout = process.stdout
    assert stdout is not None
    for raw in stdout:
        line = raw.strip()
        if line.startswith(READY_PREFIX):
            url = line[len(READY_PREFIX) :].strip()
            # Drain remaining output so the pipe never fills and blocks Vite.
            threading.Thread(target=lambda: [None for _ in stdout], daemon=True).start()
            return url, process
    process.wait()
    raise ProduceError("dev server exited before reporting DEV-SERVER-READY.")


# ------------------------------------------------------------- job setup


def build_input_zip(video: Path, screenmap: Path, destination: Path) -> Path:
    """Package exactly the source MP4 and the map as `screenmap.json`."""
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        archive.write(video, video.name)
        archive.write(screenmap, "screenmap.json")
    return destination


def serve_directory(directory: Path) -> tuple[http.server.ThreadingHTTPServer, int]:
    """Serve `directory` over loopback on an OS-assigned port."""
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args, **kwargs) -> None:  # noqa: A003 - stdlib hook
            pass

    handler = functools.partial(QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def build_job_url(dev_url: str, input_url: str, options: dict[str, str]) -> str:
    query = {"v": "1", "input": input_url, "output": "mp4", **options}
    return f"{dev_url.rstrip('/')}/produce/?" + urllib.parse.urlencode(
        query, quote_via=urllib.parse.quote
    )


def output_name(video: Path, args: argparse.Namespace, grid: str, strategy: str) -> str:
    parts = [video.stem, "mapped", grid, args.video_mode]
    if args.panel_rotation:
        parts.append(f"panel{args.panel_rotation}")
    if args.output_fps:
        parts.append(f"{args.output_fps}fps")
    if args.saturation_boost != 1:
        parts.append(f"sat{args.saturation_boost:g}")
    # The strategy is part of the render's identity: two files that differ only
    # by bloom algorithm must not collide.
    parts.append(strategy)
    parts.append(args.version)
    return "-".join(str(part) for part in parts) + ".mp4"


def grid_label(screenmap: Path) -> str:
    """Derive a short grid label from the map filename or its LED count."""
    stem = screenmap.stem
    for token in stem.split("_"):
        if "x" in token and token.replace("x", "").isdigit():
            return token
    try:
        data = json.loads(screenmap.read_text(encoding="utf-8"))
        # v1 keeps strips under "map"; v2 keeps them in a "segments" list.
        count = sum(len(strip.get("x", [])) for strip in data.get("map", {}).values())
        count += sum(len(segment.get("x", [])) for segment in data.get("segments", []))
        return f"{count}led"
    except (OSError, ValueError, AttributeError):
        return stem


# ------------------------------------------------------------------ main


def produce_one(
    args: argparse.Namespace,
    video: Path,
    screenmap: Path,
    output_dir: Path,
    dev_url: str,
    strategy: str,
) -> Path:
    """Render one mapped MP4 with one bloom strategy and return its path."""
    options: dict[str, str] = {
        "videoMode": args.video_mode,
        "rotation": str(args.rotation),
        "panelRotation": str(args.panel_rotation),
    }
    if args.output_fps:
        options["outputFps"] = str(args.output_fps)
    if not args.auto_bloom:
        options["autoBloom"] = "0"
    if args.bloom_strength is not None:
        options["bloomStrength"] = f"{args.bloom_strength:g}"
    if args.blur_radius is not None:
        options["blurRadius"] = f"{args.blur_radius:g}"
    if args.blur_sigma is not None:
        options["blurSigma"] = f"{args.blur_sigma:g}"
    if strategy != DEFAULT_STRATEGY:
        options["bloomStrategy"] = strategy

    with tempfile.TemporaryDirectory(prefix="ledmapper-job-") as tmp:
        tmp_path = Path(tmp)
        serve_root = tmp_path / "serve"
        serve_root.mkdir()
        # The producer refuses to overwrite an existing package, so render into
        # a scratch directory and replace the destination copy ourselves.
        render_dir = tmp_path / "render"
        render_dir.mkdir()
        build_input_zip(video, screenmap, serve_root / "job.zip")
        server, port = serve_directory(serve_root)
        try:
            input_url = f"http://127.0.0.1:{port}/job.zip"
            job_url = build_job_url(dev_url, input_url, options)
            print(f"job url: {job_url}", file=sys.stderr)
            subprocess.run(
                [
                    sys.executable,
                    str(PRODUCER),
                    job_url,
                    "--output-dir",
                    str(render_dir),
                    "--allow-private-network",
                    "--timeout",
                    str(args.timeout),
                ],
                check=True,
            )
        finally:
            server.shutdown()
            server.server_close()

        packages = list(render_dir.glob("*-ledmapper-v1.zip"))
        if len(packages) != 1:
            raise ProduceError(f"expected one producer package, found {packages}")
        package = packages[0]
        mapped = output_dir / output_name(video, args, grid_label(screenmap), strategy)
        with zipfile.ZipFile(package) as archive:
            names = [name for name in archive.namelist() if name.endswith(".mp4")]
            if len(names) != 1:
                raise ProduceError(f"expected exactly one MP4 in {package}, found {names}")
            with archive.open(names[0]) as src, mapped.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        if args.saturation_boost != 1:
            # Boost before the duals are built so every artifact inherits it.
            print(f"saturation boost: x{args.saturation_boost:g}", file=sys.stderr)
            boosted = mapped.with_name(f"{mapped.stem}-satboost-tmp.mp4")
            apply_saturation_boost(mapped, boosted, args.saturation_boost)
            boosted.replace(mapped)
        if args.final_artifact:
            # Final-render mode: the ZIP is a working file and stays in temp.
            # The destination receives the mapped MP4 plus the dual render —
            # source in the left third (512x1024), mapped square (1024x1024)
            # on the right.
            ffmpeg, _ = ffmpeg_tools()
            dual = output_dir / f"{mapped.stem}-dual.mp4"
            subprocess.run(
                [ffmpeg, "-y", "-v", "error",
                 "-i", str(video), "-i", str(mapped),
                 "-filter_complex",
                 "[0:v]scale=512:1024:force_original_aspect_ratio=decrease,"
                 "pad=512:1024:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[s];"
                 "[1:v]setsar=1[m];[s][m]hstack=inputs=2[v]",
                 "-map", "[v]", "-an", "-shortest",
                 "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
                 *COLOR_TAGS,
                 str(dual)],
                check=True,
            )
            print(dual)
        else:
            # CLAUDE.md requires the producer package to land beside the MP4.
            shutil.copyfile(package, output_dir / f"{mapped.stem}-ledmapper-v1.zip")
        if args.crop_source:
            emit_cropped_artifacts(args, video, screenmap, output_dir, mapped)
    return mapped


def emit_cropped_artifacts(
    args: argparse.Namespace,
    video: Path,
    screenmap: Path,
    output_dir: Path,
    mapped: Path,
) -> tuple[Path, Path]:
    """Emit the bound-box-cropped source and the wide crop dual.

    The cropped source is the region of the source the panel actually samples
    (LED bounding box + half a pitch), scaled to the mapped render's geometry.
    The crop dual hstacks it against the mapped render, so both halves share
    identical dimensions (~2048x1024 for the standard square panel).
    """
    ffmpeg, _ = ffmpeg_tools()
    crop_x, crop_y, crop_w, crop_h = compute_source_crop(
        video, screenmap, args.rotation + args.panel_rotation,
    )
    mapped_w, mapped_h = probe_display_dimensions(mapped)
    print(
        f"source crop: {crop_w}x{crop_h}+{crop_x}+{crop_y} -> {mapped_w}x{mapped_h}",
        file=sys.stderr,
    )
    cropped = output_dir / f"{mapped.stem}-source-crop.mp4"
    subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-i", str(video),
         "-vf",
         f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
         f"scale={mapped_w}:{mapped_h}:flags=lanczos,setsar=1",
         "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
         *COLOR_TAGS,
         str(cropped)],
        check=True,
    )
    print(cropped)
    dual_crop = output_dir / f"{mapped.stem}-dual-crop.mp4"
    subprocess.run(
        [ffmpeg, "-y", "-v", "error",
         "-i", str(cropped), "-i", str(mapped),
         "-filter_complex", "[0:v]setsar=1[s];[1:v]setsar=1[m];[s][m]hstack=inputs=2[v]",
         "-map", "[v]", "-an", "-shortest",
         "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
         *COLOR_TAGS,
         str(dual_crop)],
        check=True,
    )
    print(dual_crop)
    return cropped, dual_crop


def run(args: argparse.Namespace) -> int:
    video = args.input.resolve()
    screenmap = args.map.resolve()
    if not video.is_file():
        raise ProduceError(f"input video not found: {video}")
    if not screenmap.is_file():
        raise ProduceError(f"screenmap not found: {screenmap}")

    strategies: list[str] = list(dict.fromkeys(args.strategy or [DEFAULT_STRATEGY]))
    for strategy in strategies:
        if strategy not in STRATEGY_NAMES:
            raise ProduceError(
                f"unknown bloom strategy '{strategy}'. Known: {', '.join(STRATEGY_NAMES)}"
            )
    wants_compare = args.compare or len(strategies) > 1
    if not 0 < args.saturation_boost <= 3:
        raise ProduceError(
            f"--saturation-boost {args.saturation_boost:g} is out of range (0, 3]"
        )
    if args.crop_source and args.video_mode != "mapped-led":
        raise ProduceError(
            "--crop-source pairs the cropped source with the mapped render; "
            "it requires --video-mode mapped-led"
        )
    if args.stitch or wants_compare or args.crop_source:
        ffmpeg_tools()  # Fail fast, before spending minutes on renders.
    if args.crop_source:
        # Fail fast on degenerate geometry too, for the same reason.
        compute_source_crop(video, screenmap, args.rotation + args.panel_rotation)
    if wants_compare and len(strategies) > 3:
        raise ProduceError(
            "comparison grids hold the source plus at most 3 strategies; "
            "run separate comparisons for more."
        )

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    dev_url, owned_server = start_dev_server(args.dev_port)
    print(
        f"dev server: {dev_url}"
        + (" (spawned)" if owned_server else " (reusing existing)"),
        file=sys.stderr,
    )

    try:
        renders: list[tuple[str, Path]] = []
        for strategy in strategies:
            print(f"--- rendering strategy: {strategy}", file=sys.stderr)
            renders.append((strategy, produce_one(
                args, video, screenmap, output_dir, dev_url, strategy,
            )))
    finally:
        # Well-behaved by default: a server this invocation spawned dies with
        # it, tree and all. --keep-server opts a batch workflow into reuse;
        # a reused (not owned) server is always left untouched.
        if owned_server is not None:
            if args.keep_server:
                # Deliberate opt-in to a warm server: release the atexit
                # safety net registered at spawn time.
                atexit.unregister(kill_process_tree)
            else:
                kill_process_tree(owned_server)

    artifacts = [path for _, path in renders]
    for path in artifacts:
        print(path)

    if wants_compare:
        tiles = [("source", video), *renders]
        stem = artifacts[0].stem
        grid = output_dir / f"{stem}-compare-{len(tiles)}up.mp4"
        compare_grid(tiles, grid)
        print(grid)
        artifacts.append(grid)
    elif args.stitch:
        splice = output_dir / f"{artifacts[0].stem}-source-left-vs-mapped-right.mp4"
        stitch(video, artifacts[0], splice)
        print(splice)
        artifacts.append(splice)

    if args.open:
        target = artifacts[-1]
        if hasattr(os, "startfile"):
            os.startfile(target)  # type: ignore[attr-defined] # noqa: S606 - Windows viewer
        else:
            opener = "open" if sys.platform == "darwin" else "xdg-open"
            subprocess.Popen([opener, str(target)])
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Produce a mapped-LED MP4 from a source video in one command."
    )
    parser.add_argument("input", type=Path, help="source .mp4")
    parser.add_argument(
        "--map",
        type=Path,
        default=DEFAULT_MAP,
        help=f"screenmap JSON (default: {DEFAULT_MAP.name})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="destination directory"
    )
    parser.add_argument(
        "--video-mode",
        choices=("mapped-led", "side-by-side"),
        default="mapped-led",
        help="mapped-led fills the frame; side-by-side keeps the source on the left",
    )
    parser.add_argument(
        "--panel-rotation",
        type=int,
        default=-45,
        help="rotate only the LED panel shape; -45 is the diamond panel (default: -45)",
    )
    parser.add_argument(
        "--rotation", type=int, default=0, help="additional source-image rotation"
    )
    parser.add_argument(
        "--output-fps",
        type=int,
        choices=(30, 60),
        help="force MP4 cadence; omit to preserve source timing",
    )
    parser.add_argument(
        "--no-auto-bloom",
        dest="auto_bloom",
        action="store_false",
        help="disable the default HDR auto bloom",
    )
    parser.add_argument(
        "--bloom-strength",
        type=float,
        default=None,
        help=(
            "manual bloom strength (0.3-9). Combine with --no-auto-bloom and 0.3 "
            "to render the minimal-bloom reference used by bloom_metrics.py"
        ),
    )
    parser.add_argument(
        "--blur-radius",
        type=float,
        default=None,
        help="source pre-sample blur radius (producer default 3; 1 = minimum above off; 0 = off)",
    )
    parser.add_argument(
        "--blur-sigma",
        type=float,
        default=None,
        help="source pre-sample blur sigma (producer default 3)",
    )
    parser.add_argument(
        "--strategy",
        action="append",
        metavar="NAME",
        help=(
            "HDR bloom strategy; repeat to render several and compare them. "
            f"Known: {', '.join(STRATEGY_NAMES)} (default: {DEFAULT_STRATEGY})"
        ),
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="build a labelled comparison grid (source first). Implied by two "
             "or more --strategy values.",
    )
    parser.add_argument(
        "--no-stitch",
        dest="stitch",
        action="store_false",
        help="skip the source-left / mapped-right comparison splice",
    )
    parser.add_argument(
        "--no-open", dest="open", action="store_false", help="do not open the result"
    )
    parser.add_argument("--version", default="v1", help="version tag in the output name")
    parser.add_argument(
        "--timeout", type=int, default=900, help="producer deadline in seconds"
    )
    parser.add_argument(
        "--dev-port",
        type=int,
        default=5199,
        help="fixed dev-server port so repeated runs reuse one server",
    )
    parser.add_argument(
        "--final-artifact",
        action="store_true",
        help=(
            "final-render mode: the producer ZIP stays in the temp directory "
            "(never copied to the destination); the destination receives the "
            "plain mapped MP4 plus a dual side-by-side MP4 (source in the "
            "left third at 512x1024, mapped square 1024x1024 on the right)"
        ),
    )
    parser.add_argument(
        "--saturation-boost",
        type=float,
        default=1.0,
        help=(
            "HSV saturation multiplier applied to the mapped render before "
            "any dual is built (1.0 = off, e.g. 1.1 = +10%%). Hue and "
            "brightness are preserved exactly; saturation clamps at 1. The "
            "factor is recorded in the output filename (sat<f>)"
        ),
    )
    parser.add_argument(
        "--crop-source",
        action="store_true",
        help=(
            "additionally emit the source video cropped to the region the "
            "panel samples (the LED bounding box + half a pitch), scaled to "
            "the mapped render's geometry, plus a -dual-crop.mp4 hstack of "
            "cropped source | mapped render (~2048x1024). Requires "
            "--video-mode mapped-led"
        ),
    )
    parser.add_argument(
        "--keep-server",
        action="store_true",
        help=(
            "leave a dev server THIS run spawned alive for the next invocation "
            "(batch workflows). Default is to kill its whole process tree on "
            "exit; a server that was already running is always left untouched"
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    global STRATEGY_NAMES, DEFAULT_STRATEGY  # noqa: PLW0603 - read once from the TS registry
    try:
        STRATEGY_NAMES, DEFAULT_STRATEGY = _load_strategy_names()
        return run(parse_args(argv))
    except ProduceError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        print(f"error: {error.cmd[0]} failed with exit code {error.returncode}", file=sys.stderr)
        return error.returncode or 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
