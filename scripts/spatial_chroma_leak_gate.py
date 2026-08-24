#!/usr/bin/env python3
"""Gate damaging cross-hue bloom using a source, control, and candidate.

This catches the defect visible in the AQOQHb... kaleidoscope clip at t=11:
red/reddish-brown petal interiors are pulled toward the blue/cyan field several
LED pitches away. A whole-frame saturation score can miss that spatial cause.

The gate works on the 64x64 LED lattice:

* Source cells select coherent red/orange targets whose immediate 8-connected
  neighbourhood (cardinal AND diagonal neighbours) still belongs to the petal.
* A Chebyshev-radius 3..8 annulus supplies the contrasting surround colour.
* The minimal-bloom render is the control, removing sampling, tone-map, and
  codec differences that are not caused by the candidate bloom.
* RGB is converted to sum-normalized chromaticity. The candidate-control delta
  is projected toward the surround colour. That projection remains a useful
  diagnostic, but it is NOT a default rejection threshold: after coarse mips
  3-4 were removed, mips 0-2 intentionally carry colour across this local/mid
  radius. Treating the old 0.12 projection as a hard ceiling overcorrected the
  fix and suppressed desired face/surface fill.
* The default damage bounds are direct blue-share gain and saturation loss at
  the protected red cells. Scene-wide/low-frequency veil remains covered by
  bloom_metrics G2/G6, while the strategy unit test locks coarse mips 3-4 off.

The regular bloom gates remain responsible for halo aliveness and white-pane
merge. This gate is deliberately one-sided: reducing bloom cannot be called a
spatial-chroma win unless those existing gates also pass.

Usage:
  python scripts/spatial_chroma_leak_gate.py SOURCE_CROP.mp4 CONTROL.mp4 \
      CANDIDATE.mp4 -t 11
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from chroma_retention_gate import cell_means, frame_at, hsv, led_cores

GRID = 64
TARGET_SATURATION = 0.32
TARGET_VALUE = 0.08
MIN_FAR_DISTANCE = 0.08
MIN_BLUE_DELTA = 0.035


def chromaticity(rgb: np.ndarray) -> np.ndarray:
    total = rgb.sum(axis=-1, keepdims=True)
    return np.divide(rgb, np.maximum(total, 1e-9))


def annulus_means(rgb: np.ndarray, inner: int, outer: int) -> np.ndarray:
    """Mean RGB in a square/Chebyshev annulus around every grid cell."""
    out = np.zeros_like(rgb, dtype=np.float64)
    for y in range(GRID):
        y0, y1 = max(0, y - outer), min(GRID, y + outer + 1)
        for x in range(GRID):
            x0, x1 = max(0, x - outer), min(GRID, x + outer + 1)
            patch = rgb[y0:y1, x0:x1]
            yy, xx = np.ogrid[y0:y1, x0:x1]
            distance = np.maximum(np.abs(yy - y), np.abs(xx - x))
            mask = (distance >= inner) & (distance <= outer)
            out[y, x] = patch[mask].mean(axis=0)
    return out


def percentile(values: np.ndarray, q: float) -> float:
    return round(float(np.percentile(values, q)), 4)


def analyze_frame(
    source_rgb: np.ndarray,
    control_rgb: np.ndarray,
    candidate_rgb: np.ndarray,
) -> dict[str, object]:
    ideal = cell_means(source_rgb)
    control = led_cores(control_rgb)
    candidate = led_cores(candidate_rgb)

    hue, saturation, value = hsv(ideal)
    red_or_brown = (
        ((hue <= 45) | (hue >= 330))
        & (saturation >= TARGET_SATURATION)
        & (value >= TARGET_VALUE)
    )

    # Radius 1 is the complete nearest-neighbour set: four cardinal plus four
    # diagonal cells. Radius 3..8 is a contrasting surround. It overlaps the
    # intentional support of retained mip 2 and therefore cannot, by itself,
    # distinguish useful local diffusion from the removed coarse-pyramid veil.
    near = annulus_means(ideal, 1, 1)
    far = annulus_means(ideal, 3, 8)
    ideal_c = chromaticity(ideal)
    near_c = chromaticity(near)
    far_c = chromaticity(far)
    far_vector = far_c - ideal_c
    far_distance = np.linalg.norm(far_vector, axis=-1)
    near_distance = np.linalg.norm(near_c - ideal_c, axis=-1)

    # Keep petal interiors: immediate axial/diagonal neighbours agree with the
    # target, while the farther annulus is both different and more blue/cyan.
    selected = (
        red_or_brown
        & (far_distance >= MIN_FAR_DISTANCE)
        & (near_distance <= far_distance * 0.45)
        & ((far_c[..., 2] - ideal_c[..., 2]) >= MIN_BLUE_DELTA)
    )
    target_count = int(selected.sum())
    if target_count < 12:
        raise RuntimeError(
            f"only {target_count} protected red targets; frame does not exercise "
            "the blue-surround leakage probe"
        )

    control_c = chromaticity(control)
    candidate_c = chromaticity(candidate)
    delta = candidate_c - control_c
    distance_sq = np.maximum(np.sum(far_vector * far_vector, axis=-1), 1e-9)
    far_pull_fraction = np.sum(delta * far_vector, axis=-1) / distance_sq
    far_unit = far_vector / np.maximum(far_distance[..., None], 1e-9)
    far_pull = np.sum(delta * far_unit, axis=-1)
    far_pull = np.maximum(far_pull[selected], 0.0)
    far_pull_fraction = np.maximum(far_pull_fraction[selected], 0.0)
    blue_share_delta = np.maximum(
        candidate_c[..., 2] - control_c[..., 2], 0.0,
    )[selected]

    _, control_s, _ = hsv(control)
    _, candidate_s, _ = hsv(candidate)
    saturation_retention = np.divide(
        candidate_s[selected], np.maximum(control_s[selected], 1e-9),
    )

    return {
        "target_cells": target_count,
        "far_pull_mean": round(float(far_pull.mean()), 4),
        "far_pull_p50": percentile(far_pull, 50),
        "far_pull_p90": percentile(far_pull, 90),
        "far_pull_p95": percentile(far_pull, 95),
        "far_pull_fraction_p50": percentile(far_pull_fraction, 50),
        "far_pull_fraction_p90": percentile(far_pull_fraction, 90),
        "blue_share_delta_p90": percentile(blue_share_delta, 90),
        "saturation_retention_p10": percentile(saturation_retention, 10),
        "saturation_retention_p50": percentile(saturation_retention, 50),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("control", type=Path,
                        help="minimal-bloom render with identical geometry")
    parser.add_argument("candidate", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument(
        "--max-far-pull-p90", type=float, default=None,
        help=("optional legacy diagnostic ceiling; omitted by default because "
              "radius 3..8 includes intentional mip-2 influence"),
    )
    parser.add_argument("--max-blue-share-p90", type=float, default=0.055)
    parser.add_argument("--min-saturation-retention-p10", type=float, default=0.55)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    report: dict[str, object] = {}
    failed = False
    for time in args.time:
        stats = analyze_frame(
            frame_at(args.source_crop, time),
            frame_at(args.control, time),
            frame_at(args.candidate, time),
        )
        deficits: dict[str, float] = {}
        upper_bounds = {"blue_share_delta_p90": args.max_blue_share_p90}
        if args.max_far_pull_p90 is not None:
            upper_bounds["far_pull_p90"] = args.max_far_pull_p90
        for metric, ceiling in upper_bounds.items():
            if stats[metric] > ceiling:
                deficits[metric] = round(float(stats[metric]) - ceiling, 4)
        if stats["saturation_retention_p10"] < args.min_saturation_retention_p10:
            deficits["saturation_retention_p10"] = round(
                args.min_saturation_retention_p10
                - float(stats["saturation_retention_p10"]),
                4,
            )
        frame_fail = bool(deficits)
        stats["deficits"] = deficits
        stats["pass"] = not frame_fail
        report[f"t={time:g}"] = stats
        failed = failed or frame_fail

    report["thresholds"] = {
        "max_far_pull_p90": args.max_far_pull_p90,
        "max_blue_share_p90": args.max_blue_share_p90,
        "min_saturation_retention_p10": args.min_saturation_retention_p10,
    }
    report["ALL_GATES_PASS"] = not failed
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.write_text(rendered, encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
