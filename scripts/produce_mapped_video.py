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
import os
import re
import shutil
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

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
    """Terminate a spawned process AND its descendants.

    The dev server is an npm shim that spawns node, which spawns Vite, which
    spawns esbuild. On Windows, terminating the parent orphans that whole tree
    and leaves it burning CPU forever (the failure this session demonstrated),
    so the tree must be killed explicitly.
    """
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(process.pid)],
            capture_output=True,
            check=False,
        )
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


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
        start_new_session=sys.platform != "win32",
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
        # CLAUDE.md requires the producer package to land beside the MP4.
        shutil.copyfile(package, output_dir / f"{mapped.stem}-ledmapper-v1.zip")
    return mapped


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
    if args.stitch or wants_compare:
        ffmpeg_tools()  # Fail fast, before spending minutes on renders.
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
