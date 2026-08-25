#!/usr/bin/env python3
"""Ratchet spatially adaptive bloom for coherent low/mid LED surfaces.

AQNFgVV at t~=9 exposes a deficit hidden by whole-frame face-fill metrics: the
blue neck piece and its upper boundaries remain a grid of bright points with
under-filled gaps.  A global mip increase is not acceptable because AQNF t=14
hair and AQP red/blue neighbours are the opposing contamination cases.

This gate therefore compares a candidate to the current production baseline
inside a fixture ROI. It selects source-neighbour pairs that are:

* visible but below ordinary midtone luminance (blue has low Rec.709 luma),
* similar in luma and chromaticity, so they describe one local surface, and
* axial or diagonal, so a one-axis-only solution cannot pass.

It requires a positive lower-quartile midpoint-fill gain and bounds changes at
bright source cells. Run the independent ``shadow_structure_gate.py`` at t=14
and the AQP chroma gate as upper ceilings; this evaluator is only the localized
low/mid fill floor.

Usage:
  uv run python scripts/local_midtone_bias_gate.py SOURCE-CROP.mp4 \
      BASELINE.mp4 CANDIDATE.mp4 -t 9 --roi .22 .68 .75 1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from chroma_retention_gate import cell_means, frame_at, led_cores
from evaluator_geometry import production_led_positions
from mid_frequency_bloom_gate import chromaticity, linear_luma, patch_mean_luma

GRID = 64
OFFSETS = ((0, 1), (1, 0), (1, 1), (1, -1))


def selected_pairs(
    ideal: np.ndarray,
    bounds: list[float],
) -> list[tuple[int, int, int, int, bool]]:
    """Return coherent low/mid pairs in a normalized source-grid ROI."""
    x0, y0, x1, y1 = bounds
    luma = linear_luma(ideal)
    chroma = chromaticity(ideal)
    pairs: list[tuple[int, int, int, int, bool]] = []
    for dy, dx in OFFSETS:
        for y in range(max(0, int(y0 * GRID)), min(GRID, int(np.ceil(y1 * GRID)))):
            ny = y + dy
            if not 0 <= ny < GRID or not y0 <= (ny + 0.5) / GRID <= y1:
                continue
            for x in range(max(0, int(x0 * GRID)), min(GRID, int(np.ceil(x1 * GRID)))):
                nx = x + dx
                if not 0 <= nx < GRID or not x0 <= (nx + 0.5) / GRID <= x1:
                    continue
                first, second = float(luma[y, x]), float(luma[ny, nx])
                if min(first, second) < 0.012 or max(first, second) > 0.18:
                    continue
                if min(first, second) / max(first, second, 1e-9) < 0.48:
                    continue
                if np.linalg.norm(chroma[y, x] - chroma[ny, nx]) > 0.11:
                    continue
                pairs.append((y, x, ny, nx, dx != 0 and dy != 0))
    return pairs


def pair_fill(rendered: np.ndarray, pairs: list[tuple[int, int, int, int, bool]]) -> np.ndarray:
    """Return normalized midpoint fill for every selected neighbour pair."""
    luma = linear_luma(rendered)
    positions = production_led_positions(rendered.shape[0], GRID)
    values: list[tuple[float, float]] = []
    for y, x, ny, nx, diagonal in pairs:
        x0, y0 = positions[x], positions[y]
        x1, y1 = positions[nx], positions[ny]
        core = 0.5 * (
            patch_mean_luma(luma, x0, y0)
            + patch_mean_luma(luma, x1, y1)
        )
        midpoint = patch_mean_luma(luma, (x0 + x1) / 2, (y0 + y1) / 2)
        values.append((midpoint / max(core, 1e-6), float(diagonal)))
    return np.asarray(values)


def analyze(
    source_rgb: np.ndarray,
    baseline_rgb: np.ndarray,
    candidate_rgb: np.ndarray,
    bounds: list[float],
) -> dict[str, float | int]:
    ideal = cell_means(source_rgb)
    pairs = selected_pairs(ideal, bounds)
    if len(pairs) < 40:
        raise RuntimeError(f"only {len(pairs)} coherent low/mid pairs in ROI")
    baseline = pair_fill(baseline_rgb, pairs)
    candidate = pair_fill(candidate_rgb, pairs)
    base_values, candidate_values = baseline[:, 0], candidate[:, 0]
    diagonal = candidate[:, 1] > 0.5
    delta = candidate_values - base_values

    source_luma = linear_luma(ideal)
    source_drive = ideal.max(axis=-1) / 255.0
    # Saturated blue/red can be fully driven while their Rec.709 luminance is
    # below 0.25. Protect either kind of highlight so a blurred control field
    # cannot hide primary-colour contamination from this ratchet.
    bright = (source_luma >= 0.25) | (source_drive >= 0.70)
    base_cores = linear_luma(led_cores(baseline_rgb))
    candidate_cores = linear_luma(led_cores(candidate_rgb))
    bright_delta = np.abs(candidate_cores[bright] - base_cores[bright])

    return {
        "coherent_low_mid_pairs": len(pairs),
        "baseline_fill_p25": round(float(np.percentile(base_values, 25)), 6),
        "candidate_fill_p25": round(float(np.percentile(candidate_values, 25)), 6),
        "fill_gain_p25": round(
            float(np.percentile(candidate_values, 25) - np.percentile(base_values, 25)),
            6,
        ),
        "fill_gain_p50": round(
            float(np.percentile(candidate_values, 50) - np.percentile(base_values, 50)),
            6,
        ),
        "diagonal_fill_gain_p25": round(
            float(
                np.percentile(candidate_values[diagonal], 25)
                - np.percentile(base_values[diagonal], 25)
            ),
            6,
        ),
        "improved_pair_fraction": round(float(np.mean(delta > 0.002)), 6),
        "baseline_underfilled_fraction": round(float(np.mean(base_values < 0.50)), 6),
        "bright_core_abs_delta_mean": round(float(bright_delta.mean()), 6),
        "bright_core_abs_delta_p95": round(float(np.percentile(bright_delta, 95)), 6),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument(
        "--roi",
        type=float,
        nargs=4,
        default=[0.22, 0.68, 0.75, 1.0],
        metavar=("X0", "Y0", "X1", "Y1"),
    )
    # Candidate v5 establishes a real (not codec-noise) floor over the former
    # zero-delta baseline: +0.009 lower quartile and +0.018 diagonal. Keep a
    # small margin for platform encode variance while rejecting no-op changes.
    parser.add_argument("--min-fill-gain-p25", type=float, default=0.008)
    parser.add_argument("--min-diagonal-gain-p25", type=float, default=0.015)
    parser.add_argument("--min-improved-fraction", type=float, default=0.60)
    # Core patches include a little adjacent Gaussian energy plus x264 noise;
    # these ceilings bound that complete production-path delta rather than
    # pretending the exact center pixel is the visible LED core.
    parser.add_argument("--max-bright-core-delta-mean", type=float, default=0.015)
    parser.add_argument("--max-bright-core-delta-p95", type=float, default=0.040)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    report: dict[str, object] = {}
    failed = False
    for time in args.time:
        stats = analyze(
            frame_at(args.source_crop, time),
            frame_at(args.baseline, time),
            frame_at(args.candidate, time),
            args.roi,
        )
        floors = {
            "fill_gain_p25": args.min_fill_gain_p25,
            "diagonal_fill_gain_p25": args.min_diagonal_gain_p25,
            "improved_pair_fraction": args.min_improved_fraction,
        }
        ceilings = {
            "bright_core_abs_delta_mean": args.max_bright_core_delta_mean,
            "bright_core_abs_delta_p95": args.max_bright_core_delta_p95,
        }
        deficits = {
            metric: round(floor - float(stats[metric]), 6)
            for metric, floor in floors.items()
            if float(stats[metric]) < floor
        }
        excesses = {
            metric: round(float(stats[metric]) - ceiling, 6)
            for metric, ceiling in ceilings.items()
            if float(stats[metric]) > ceiling
        }
        stats["deficits"] = deficits
        stats["excesses"] = excesses
        stats["pass"] = not deficits and not excesses
        report[f"t={time:g}"] = stats
        failed = failed or not bool(stats["pass"])

    report["roi"] = args.roi
    report["ALL_GATES_PASS"] = not failed
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.write_text(rendered, encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
