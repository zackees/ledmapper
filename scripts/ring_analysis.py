#!/usr/bin/env python3
"""Black-ring detector for mapped LED renders (issue #493).

The ring artifact is a dark annulus between an LED core and the glow in the
surrounding gap: along a radial profile from the dot center, luma falls to a
minimum and then RISES again before the next dot. A clean render is monotone
(or flat) from core to gap. This script finds the LED grid, profiles every
dot, and reports the ring depth so the artifact is caught by analysis instead
of by the user's eyes.

Usage:
  python scripts/ring_analysis.py RENDER.mp4 -t 3.0 -t 9.0 [--grid 64]
      [--annotate out.png]

Exit code 1 when any analyzed frame's ring score exceeds the threshold.
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


def analyze_frame(rgb: np.ndarray, grid: int) -> dict:
    """Ring statistics for one frame.

    For each grid cell, the dot center is the cell's brightest pixel. The
    radial profile (median luma per integer radius) must not dip and recover:
    ring depth = max over radii r_in < r_out of
    profile[r_out] - min(profile[r_in..r_out]).
    """
    y = luma(rgb)
    h, w = y.shape
    pitch = w / grid
    half = pitch / 2
    yy, xx = np.mgrid[0:h, 0:w]

    depths: list[float] = []
    flagged: list[tuple[int, int, float]] = []
    for gy in range(1, grid - 1):
        for gx in range(1, grid - 1):
            y0, y1 = int(gy * pitch), int((gy + 1) * pitch)
            x0, x1 = int(gx * pitch), int((gx + 1) * pitch)
            cell = y[y0:y1, x0:x1]
            cy, cx = np.unravel_index(np.argmax(cell), cell.shape)
            core = float(cell[cy, cx])
            # Only mid-range dots: dark dots have no glow to ring against and
            # blown regions are supposed to merge.
            if core < 40 or core > 235:
                continue
            cya, cxa = y0 + cy, x0 + cx
            r0, r1 = int(cya - half - 2), int(cya + half + 3)
            c0, c1 = int(cxa - half - 2), int(cxa + half + 3)
            if r0 < 0 or c0 < 0 or r1 > h or c1 > w:
                continue
            patch = y[r0:r1, c0:c1]
            rr = np.hypot(yy[r0:r1, c0:c1] - cya, xx[r0:r1, c0:c1] - cxa)
            # Cap the profile BEFORE neighboring dots can contribute: with
            # pitch p, neighbors sit at r >= p, mid-gap at p/2. Sampling past
            # ~p/2 makes normal inter-dot field structure read as "recovery"
            # and floods the detector with false positives (measured: 49%
            # flagged on a pure smooth blur field). A genuine rim moat lives
            # inside r < p/2.
            radii = np.arange(2, int(half))
            profile = np.array([
                float(np.median(patch[(rr >= r - 0.5) & (rr < r + 0.5)]))
                if ((rr >= r - 0.5) & (rr < r + 0.5)).any() else np.nan
                for r in radii
            ])
            valid = ~np.isnan(profile)
            if valid.sum() < 4:
                continue
            profile = profile[valid]
            # Ring depth: how far the profile recovers above its running
            # minimum (a monotone-decreasing profile scores 0).
            running_min = np.minimum.accumulate(profile)
            depth = float(np.max(profile - running_min))
            depths.append(depth)
            if depth > 8:
                flagged.append((cxa, cya, depth))

    if not depths:
        return {"dots": 0, "mean_depth": 0.0, "p95_depth": 0.0,
                "ringed_fraction": 0.0, "flagged": []}
    arr = np.array(depths)
    return {
        "dots": len(depths),
        "mean_depth": round(float(arr.mean()), 2),
        "p95_depth": round(float(np.percentile(arr, 95)), 2),
        "ringed_fraction": round(float((arr > 8).mean()), 4),
        "flagged": flagged,
    }


def annotate(rgb: np.ndarray, flagged: list[tuple[int, int, float]], path: Path) -> None:
    """Write a PNG with red boxes around ringed dots (stdlib PNG writer)."""
    import struct
    import zlib

    img = rgb.astype(np.uint8).copy()
    for cx, cy, _depth in flagged:
        x0, x1 = max(cx - 8, 0), min(cx + 8, img.shape[1] - 1)
        y0, y1 = max(cy - 8, 0), min(cy + 8, img.shape[0] - 1)
        img[y0, x0:x1] = (255, 0, 0)
        img[y1, x0:x1] = (255, 0, 0)
        img[y0:y1, x0] = (255, 0, 0)
        img[y0:y1, x1] = (255, 0, 0)
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[i].tobytes() for i in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("render", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True,
                        help="timestamp(s) to analyze (repeatable)")
    parser.add_argument("--grid", type=int, default=64, help="LED grid size per axis")
    parser.add_argument("--annotate", type=Path, default=None,
                        help="write an annotated PNG for the worst frame")
    parser.add_argument("--fail-fraction", type=float, default=0.05,
                        help="fail when ringed_fraction exceeds this at any frame")
    args = parser.parse_args()

    worst = None
    results = {}
    for t in args.time:
        rgb = frame_at(args.render, t)
        stats = analyze_frame(rgb, args.grid)
        results[f"t={t:g}"] = {k: v for k, v in stats.items() if k != "flagged"}
        if worst is None or stats["ringed_fraction"] > worst[1]["ringed_fraction"]:
            worst = (t, stats, rgb)

    print(json.dumps(results, indent=2))
    if args.annotate and worst is not None:
        annotate(worst[2], worst[1]["flagged"], args.annotate)
        print(f"annotated worst frame (t={worst[0]:g}) -> {args.annotate}", file=sys.stderr)
    failed = any(r["ringed_fraction"] > args.fail_fraction for r in results.values())
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
