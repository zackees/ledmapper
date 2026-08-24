#!/usr/bin/env python3
"""Bright-region merge gate for mapped LED renders (issue #493).

Detects the degenerate behavior where a fully driven region renders as
discrete bright dots over dark gaps. Through frosted acrylic — and in the
naive clamping bloom — such a region blooms out to a continuous near-(1,1,1)
pane: the black between pixels is luma-bloomed to near nothing. A composite
that keeps the gaps dark inside a region of near-full-drive LEDs has lost the
white-out and fails this gate.

Reference case: the lit forehead (upper right) in the first frame of the
Snapinsta portrait test video, caught by user review 2026-08-23.

Method, per analyzed frame:
  - grid scan (default 64x64): each cell's core = brightest pixel luma, and
    gap = median luma in the mid-gap band (0.35..0.50 pitch from the core);
  - qualifying dots: core >= 200 whose neighbors are also bright
    (>= 5 of 8 neighbor cores >= 180) — the interior of a driven region;
  - merge ratio = gap / core per qualifying dot. The frame FAILS when at
    least --min-dots qualify and their mean merge ratio is below
    --min-merge (dots visibly separated where the pane should be).

Usage:
  uv run python scripts/whiteout_gate.py RENDER.mp4 -t 0.05 [-t 3.0 ...]
      [--grid 64] [--min-merge 0.55] [--min-dots 12] [--json out.json]

Exit code 1 when any analyzed frame fails.
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


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def analyze_frame(rgb: np.ndarray, grid: int,
                  core_min: float = 200.0, neighbor_min: float = 180.0) -> dict:
    y = luma(rgb)
    h, w = y.shape
    pitch = w / grid
    yy, xx = np.mgrid[0:h, 0:w]

    cores = np.zeros((grid, grid))
    centers: dict[tuple[int, int], tuple[int, int]] = {}
    for gy in range(grid):
        for gx in range(grid):
            y0, y1 = int(gy * pitch), int((gy + 1) * pitch)
            x0, x1 = int(gx * pitch), int((gx + 1) * pitch)
            cell = y[y0:y1, x0:x1]
            cy, cx = np.unravel_index(np.argmax(cell), cell.shape)
            cores[gy, gx] = cell[cy, cx]
            centers[(gy, gx)] = (y0 + int(cy), x0 + int(cx))

    ratios: list[float] = []
    flagged: list[tuple[int, int, float]] = []
    r_in, r_out = pitch * 0.35, pitch * 0.50
    for gy in range(1, grid - 1):
        for gx in range(1, grid - 1):
            core = cores[gy, gx]
            if core < core_min:
                continue
            neighbors = cores[gy - 1:gy + 2, gx - 1:gx + 2]
            if (neighbors >= neighbor_min).sum() - 1 < 5:
                continue
            cya, cxa = centers[(gy, gx)]
            r0, r1 = int(cya - r_out - 1), int(cya + r_out + 2)
            c0, c1 = int(cxa - r_out - 1), int(cxa + r_out + 2)
            if r0 < 0 or c0 < 0 or r1 > h or c1 > w:
                continue
            rr = np.hypot(yy[r0:r1, c0:c1] - cya, xx[r0:r1, c0:c1] - cxa)
            band = (rr >= r_in) & (rr <= r_out)
            if not band.any():
                continue
            gap = float(np.median(y[r0:r1, c0:c1][band]))
            ratio = gap / core
            ratios.append(ratio)
            if ratio < 0.55:
                flagged.append((cxa, cya, round(ratio, 3)))

    if not ratios:
        return {"qualifying_dots": 0, "mean_merge": None, "p10_merge": None}
    arr = np.array(ratios)
    return {
        "qualifying_dots": len(ratios),
        "mean_merge": round(float(arr.mean()), 4),
        "p10_merge": round(float(np.percentile(arr, 10)), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("render", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument("--grid", type=int, default=64)
    parser.add_argument("--min-merge", type=float, default=0.55,
                        help="fail when qualifying dots' mean gap/core falls below this")
    parser.add_argument("--min-dots", type=int, default=12,
                        help="a frame with fewer qualifying dots is not judged")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    results = {}
    failed = False
    for t in args.time:
        stats = analyze_frame(frame_at(args.render, t), args.grid)
        judged = (stats["qualifying_dots"] or 0) >= args.min_dots
        frame_fail = bool(judged and stats["mean_merge"] is not None
                          and stats["mean_merge"] < args.min_merge)
        stats["judged"] = judged
        stats["pass"] = not frame_fail
        results[f"t={t:g}"] = stats
        failed = failed or frame_fail

    print(json.dumps(results, indent=2))
    if args.json:
        args.json.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
