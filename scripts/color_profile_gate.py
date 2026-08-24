#!/usr/bin/env python3
"""Color-profile gate for produced MP4s (#493/#496 gate family).

Rule (user-caught defect, 2026-08-24): every MP4 the pipeline emits must
carry EXPLICIT, consistent color metadata — color_range=tv and
color_space/transfer/primaries=bt709 — because an untagged stream makes
players guess (commonly bt601), which decodes visibly desaturated with
shifted hues. The defect entered through an ffmpeg re-encode (the dual
side-by-side mix) that omitted the tags while the producer's own MP4 was
tagged correctly.

Additionally, when a --pair of (mapped, dual) is given, the dual's right
half must decode pixel-equivalent to the mapped render (mean |RGB| delta
and mean saturation delta within tolerance) — the mix may compose, never
regrade.

Usage:
  uv run python scripts/color_profile_gate.py FILE [FILE ...]
      [--pair MAPPED DUAL] [--json out.json]

Exit code 1 when any file lacks the required tags or a pair diverges.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

try:  # pragma: no cover - optional, mirrors bloom_metrics.py
    import static_ffmpeg  # type: ignore

    static_ffmpeg.add_paths()
except ImportError:
    pass

EXPECTED = {
    "color_range": "tv",
    "color_space": "bt709",
    "color_transfer": "bt709",
    "color_primaries": "bt709",
}


def probe_color(path: Path) -> dict[str, str]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries",
         "stream=color_range,color_space,color_transfer,color_primaries",
         "-of", "default=noprint_wrappers=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    fields = dict(line.split("=", 1) for line in out.strip().splitlines())
    return fields


def frame_at(path: Path, t: float) -> np.ndarray:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    width, height = int(probe[0]), int(probe[1])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path),
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    return (
        np.frombuffer(raw[: width * height * 3], dtype=np.uint8)
        .reshape(height, width, 3).astype(np.float64)
    )


def saturation_mean(rgb: np.ndarray) -> float:
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    lit = mx > 8
    if not lit.any():
        return 0.0
    return float(((mx[lit] - mn[lit]) / np.maximum(mx[lit], 1e-9)).mean())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="*")
    parser.add_argument("--pair", type=Path, nargs=2, metavar=("MAPPED", "DUAL"))
    parser.add_argument("-t", "--time", type=float, default=2.0,
                        help="probe time for the --pair pixel check")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    report: dict[str, object] = {}
    failed = False

    check_files = list(args.files)
    if args.pair:
        check_files += [f for f in args.pair if f not in check_files]
    for path in check_files:
        fields = probe_color(path)
        bad = {k: fields.get(k, "missing") for k, v in EXPECTED.items()
               if fields.get(k) != v}
        report[path.name] = {"tags_ok": not bad, "violations": bad}
        failed = failed or bool(bad)

    if args.pair:
        mapped, dual = args.pair
        m = frame_at(mapped, args.time)
        d = frame_at(dual, args.time)
        side = m.shape[0]
        right = d[:, d.shape[1] - side:]
        if right.shape != m.shape:
            report["pair"] = {"error": "geometry mismatch", "ok": False}
            failed = True
        else:
            rgb_delta = float(np.abs(right - m).mean())
            sat_delta = abs(saturation_mean(right) - saturation_mean(m))
            ok = rgb_delta <= 4.0 and sat_delta <= 0.02
            report["pair"] = {"rgb_delta": round(rgb_delta, 2),
                              "sat_delta": round(sat_delta, 4), "ok": ok}
            failed = failed or not ok

    print(json.dumps(report, indent=2))
    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
