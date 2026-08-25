#!/usr/bin/env python3
"""Ratchet local Gaussian-style acrylic overlap on globally dark scenes.

AQPoUmw exposed a gap between the existing evaluators: its mapped scene is
globally dark, yet coherent dim neighbours should still overlap instead of
reading as isolated dots.  The bright-surface fill gate deliberately excludes
this luminance range, while the shadow gate protects detailed dark structure in
bright scenes.  This gate owns the remaining quadrant: globally dark frames
with locally coherent, similarly coloured LED pairs.

The source selects the population.  We compare the linear-light midpoint/core
fill ratio against a baseline and require positive lower-quartile gain across
the requested timestamps, including diagonal neighbours.  A small per-frame
regression allowance covers the brightest transition in AQPoUmw without
letting one easy frame hide a generally weaker splat.

Usage:
  uv run python scripts/low_light_splat_gate.py SOURCE_CROP BASELINE CANDIDATE \
      -t .5 -t 1.5 -t 2.5 -t 3.5 -t 4.5 -t 5.5 -t 6.5 -t 7.5
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from chroma_retention_gate import cell_means, frame_at
from evaluator_geometry import production_led_positions
from mid_frequency_bloom_gate import (
    GRID,
    OFFSETS,
    chromaticity,
    linear_luma,
    patch_mean_luma,
)

MAX_GLOBAL_LINEAR_LUMA = 0.16
MIN_LOCAL_LINEAR_LUMA = 0.015
MAX_LOCAL_LINEAR_LUMA = 0.18
MIN_LUMA_SIMILARITY = 0.45
MAX_CHROMATICITY_DISTANCE = 0.10
MIN_PAIRS = 100


def coherent_dark_pairs(ideal: np.ndarray) -> list[tuple[int, int, int, int, bool]]:
    luma = linear_luma(ideal)
    chroma = chromaticity(ideal)
    pairs: list[tuple[int, int, int, int, bool]] = []
    for dy, dx in OFFSETS:
        for y in range(GRID):
            ny = y + dy
            if not 0 <= ny < GRID:
                continue
            for x in range(GRID):
                nx = x + dx
                if not 0 <= nx < GRID:
                    continue
                first, second = luma[y, x], luma[ny, nx]
                if min(first, second) < MIN_LOCAL_LINEAR_LUMA:
                    continue
                if max(first, second) > MAX_LOCAL_LINEAR_LUMA:
                    continue
                if min(first, second) / max(first, second) < MIN_LUMA_SIMILARITY:
                    continue
                if np.linalg.norm(chroma[y, x] - chroma[ny, nx]) > MAX_CHROMATICITY_DISTANCE:
                    continue
                pairs.append((y, x, ny, nx, dx != 0 and dy != 0))
    return pairs


def fill_ratios(
    rendered: np.ndarray,
    pairs: list[tuple[int, int, int, int, bool]],
) -> tuple[np.ndarray, np.ndarray]:
    luma = linear_luma(rendered)
    positions = production_led_positions(rendered.shape[0], GRID)
    all_ratios: list[float] = []
    diagonal_ratios: list[float] = []
    for y, x, ny, nx, diagonal in pairs:
        x0, y0 = positions[x], positions[y]
        x1, y1 = positions[nx], positions[ny]
        core = 0.5 * (
            patch_mean_luma(luma, x0, y0)
            + patch_mean_luma(luma, x1, y1)
        )
        ratio = patch_mean_luma(
            luma,
            (x0 + x1) / 2,
            (y0 + y1) / 2,
        ) / max(core, 1e-6)
        all_ratios.append(ratio)
        if diagonal:
            diagonal_ratios.append(ratio)
    return np.asarray(all_ratios), np.asarray(diagonal_ratios)


def percentile(values: np.ndarray, q: float) -> float:
    return float(np.percentile(values, q))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument("--min-fill-gain-p25", type=float, default=0.003)
    parser.add_argument("--min-diagonal-gain-p25", type=float, default=0.001)
    parser.add_argument("--max-frame-regression", type=float, default=0.01)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    frames: dict[str, object] = {}
    fill_gains: list[float] = []
    diagonal_gains: list[float] = []
    for time in args.time:
        ideal = cell_means(frame_at(args.source_crop, time))
        global_luma = float(linear_luma(ideal).mean())
        if global_luma > MAX_GLOBAL_LINEAR_LUMA:
            raise RuntimeError(
                f"t={time:g} global linear luma {global_luma:.4f} exceeds "
                f"dark-scene ceiling {MAX_GLOBAL_LINEAR_LUMA:.2f}"
            )
        pairs = coherent_dark_pairs(ideal)
        if len(pairs) < MIN_PAIRS:
            raise RuntimeError(
                f"t={time:g} has only {len(pairs)} coherent dark pairs; "
                "frame does not exercise the low-light splat probe"
            )
        baseline, baseline_diagonal = fill_ratios(frame_at(args.baseline, time), pairs)
        candidate, candidate_diagonal = fill_ratios(frame_at(args.candidate, time), pairs)
        baseline_p25 = percentile(baseline, 25)
        candidate_p25 = percentile(candidate, 25)
        baseline_diagonal_p25 = percentile(baseline_diagonal, 25)
        candidate_diagonal_p25 = percentile(candidate_diagonal, 25)
        fill_gain = candidate_p25 - baseline_p25
        diagonal_gain = candidate_diagonal_p25 - baseline_diagonal_p25
        fill_gains.append(fill_gain)
        diagonal_gains.append(diagonal_gain)
        frames[f"t={time:g}"] = {
            "global_linear_luma": round(global_luma, 6),
            "coherent_dark_pairs": len(pairs),
            "baseline_fill_ratio_p25": round(baseline_p25, 6),
            "candidate_fill_ratio_p25": round(candidate_p25, 6),
            "fill_gain_p25": round(fill_gain, 6),
            "baseline_diagonal_fill_ratio_p25": round(baseline_diagonal_p25, 6),
            "candidate_diagonal_fill_ratio_p25": round(candidate_diagonal_p25, 6),
            "diagonal_gain_p25": round(diagonal_gain, 6),
        }

    aggregate_fill_gain = percentile(np.asarray(fill_gains), 25)
    aggregate_diagonal_gain = percentile(np.asarray(diagonal_gains), 25)
    worst_regression = min(min(fill_gains), min(diagonal_gains))
    passed = (
        aggregate_fill_gain >= args.min_fill_gain_p25
        and aggregate_diagonal_gain >= args.min_diagonal_gain_p25
        and worst_regression >= -args.max_frame_regression
    )
    report = {
        "frames": frames,
        "summary": {
            "aggregation": "per-frame gain p25",
            "fill_gain_p25": round(aggregate_fill_gain, 6),
            "diagonal_gain_p25": round(aggregate_diagonal_gain, 6),
            "worst_frame_regression": round(worst_regression, 6),
        },
        "thresholds": {
            "max_global_linear_luma": MAX_GLOBAL_LINEAR_LUMA,
            "min_fill_gain_p25": args.min_fill_gain_p25,
            "min_diagonal_gain_p25": args.min_diagonal_gain_p25,
            "max_frame_regression": args.max_frame_regression,
        },
        "ALL_GATES_PASS": passed,
    }
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.write_text(rendered, encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
