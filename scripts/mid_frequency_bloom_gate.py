#!/usr/bin/env python3
"""Gate local acrylic fill between coherent neighbouring LEDs.

The face-heavy AQNFgVV... clip exposed the opposite failure from the broad
color-wash regression: restricting acrylic bloom to two mip bands preserves
color, but leaves midtone surfaces as isolated dots separated by black gaps.

This evaluator works on the 64x64 LED lattice and measures that deficit:

* source cells select coherent midtone neighbour pairs (horizontal, vertical,
  and diagonal) that represent one continuous surface;
* a minimal-bloom render supplies the non-bloom control;
* the candidate is sampled at each LED core and at the midpoint between the
  pair, in linear-light luminance;
* ``fill_ratio`` is midpoint light divided by the pair's mean core light;
* the lower quartile is the signal: it describes the visibly black gaps rather
  than letting already-filled highlights dominate the median;
* ``fill_gain`` compares the candidate and control lower quartiles.

The spatial chroma-leak and ordinary veil gates remain the upper bound. This
gate is deliberately the lower bound: it fails when local diffusion is too
weak to bridge coherent neighbouring LEDs. The default ratchet was calibrated
from AQNFgVV... at t=2,7,12,17,22,27. Restrained third-mip candidates passed
the earlier floor but remained barely perceptible in side-by-side review. The
current floor records the corrected model: mips 0-2 stay strong
(2.85/4.00/1.50), while only coarse mips 3-4 are removed. It rejects the
overcorrected/de-biased local response. Thresholds use the exact production
point-extent camera fit (`ledDiameter=null`): across the six AQNF probes the
approved candidate's weakest lower-quartile fill is 0.0617 versus at most
0.0188 for the de-biased candidate.

Usage:
  uv run python scripts/mid_frequency_bloom_gate.py SOURCE_CROP.mp4 CONTROL.mp4 \
      CANDIDATE.mp4 -t 2 -t 7 -t 12
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from chroma_retention_gate import cell_means, frame_at
from evaluator_geometry import production_led_positions

GRID = 64
MIN_VALUE = 0.08
MAX_VALUE = 0.85
MIN_VALUE_SIMILARITY = 0.45
MAX_CHROMATICITY_DISTANCE = 0.10
OFFSETS = ((0, 1), (1, 0), (1, 1), (1, -1))


def linear_luma(rgb: np.ndarray) -> np.ndarray:
    """Rec.709 relative luminance after one sRGB-to-linear conversion."""
    srgb = rgb.astype(np.float64) / 255.0
    linear = np.where(
        srgb <= 0.04045,
        srgb / 12.92,
        ((srgb + 0.055) / 1.055) ** 2.4,
    )
    return (
        0.2126 * linear[..., 0]
        + 0.7152 * linear[..., 1]
        + 0.0722 * linear[..., 2]
    )


def chromaticity(rgb: np.ndarray) -> np.ndarray:
    total = rgb.sum(axis=-1, keepdims=True)
    return np.divide(rgb, np.maximum(total, 1e-9))


def patch_mean_luma(luma: np.ndarray, x: float, y: float, radius: int = 2) -> float:
    row, col = int(round(y)), int(round(x))
    patch = luma[
        max(0, row - radius):row + radius + 1,
        max(0, col - radius):col + radius + 1,
    ]
    return float(patch.mean())


def coherent_pairs(ideal: np.ndarray) -> list[tuple[int, int, int, int, bool]]:
    """Return spatially coherent midtone pairs and whether each is diagonal."""
    value = ideal.max(axis=-1) / 255.0
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
                va, vb = value[y, x], value[ny, nx]
                if min(va, vb) < MIN_VALUE or max(va, vb) > MAX_VALUE:
                    continue
                if min(va, vb) / max(va, vb) < MIN_VALUE_SIMILARITY:
                    continue
                if np.linalg.norm(chroma[y, x] - chroma[ny, nx]) > MAX_CHROMATICITY_DISTANCE:
                    continue
                pairs.append((y, x, ny, nx, dx != 0 and dy != 0))
    return pairs


def percentile(values: np.ndarray, q: float) -> float:
    return round(float(np.percentile(values, q)), 4)


def analyze_frame(
    source_rgb: np.ndarray,
    control_rgb: np.ndarray,
    candidate_rgb: np.ndarray,
) -> dict[str, object]:
    ideal = cell_means(source_rgb)
    pairs = coherent_pairs(ideal)
    if len(pairs) < 100:
        raise RuntimeError(
            f"only {len(pairs)} coherent midtone pairs; frame does not exercise "
            "the mid-frequency fill probe"
        )

    control_luma = linear_luma(control_rgb)
    candidate_luma = linear_luma(candidate_rgb)
    positions = production_led_positions(candidate_rgb.shape[0], GRID)
    control_ratios: list[float] = []
    candidate_ratios: list[float] = []
    diagonal_ratios: list[float] = []
    axial_ratios: list[float] = []

    for y, x, ny, nx, diagonal in pairs:
        x0, y0 = positions[x], positions[y]
        x1, y1 = positions[nx], positions[ny]
        mid_x, mid_y = (x0 + x1) / 2, (y0 + y1) / 2

        control_core = 0.5 * (
            patch_mean_luma(control_luma, x0, y0)
            + patch_mean_luma(control_luma, x1, y1)
        )
        candidate_core = 0.5 * (
            patch_mean_luma(candidate_luma, x0, y0)
            + patch_mean_luma(candidate_luma, x1, y1)
        )
        control_ratio = patch_mean_luma(control_luma, mid_x, mid_y) / max(control_core, 1e-6)
        candidate_ratio = patch_mean_luma(candidate_luma, mid_x, mid_y) / max(candidate_core, 1e-6)
        control_ratios.append(control_ratio)
        candidate_ratios.append(candidate_ratio)
        (diagonal_ratios if diagonal else axial_ratios).append(candidate_ratio)

    control_arr = np.asarray(control_ratios)
    candidate_arr = np.asarray(candidate_ratios)
    control_p25 = percentile(control_arr, 25)
    control_p50 = percentile(control_arr, 50)
    candidate_p25 = percentile(candidate_arr, 25)
    candidate_p50 = percentile(candidate_arr, 50)
    return {
        "coherent_pairs": len(pairs),
        "control_fill_ratio_p25": control_p25,
        "control_fill_ratio_p50": control_p50,
        "fill_ratio_p25": candidate_p25,
        "fill_ratio_p50": candidate_p50,
        "fill_ratio_p75": percentile(candidate_arr, 75),
        "fill_gain_p25": round(candidate_p25 - control_p25, 4),
        "fill_gain_p50": round(candidate_p50 - control_p50, 4),
        "axial_fill_ratio_p25": percentile(np.asarray(axial_ratios), 25),
        "axial_fill_ratio_p50": percentile(np.asarray(axial_ratios), 50),
        "diagonal_fill_ratio_p25": percentile(np.asarray(diagonal_ratios), 25),
        "diagonal_fill_ratio_p50": percentile(np.asarray(diagonal_ratios), 50),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("control", type=Path, help="minimal-bloom render")
    parser.add_argument("candidate", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument("--min-fill-ratio-p25", type=float, default=0.05)
    parser.add_argument("--min-fill-gain-p25", type=float, default=0.045)
    parser.add_argument("--min-diagonal-fill-ratio-p25", type=float, default=0.03)
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
        checks = {
            "fill_ratio_p25": args.min_fill_ratio_p25,
            "fill_gain_p25": args.min_fill_gain_p25,
            "diagonal_fill_ratio_p25": args.min_diagonal_fill_ratio_p25,
        }
        deficits = {
            metric: round(floor - float(stats[metric]), 4)
            for metric, floor in checks.items()
            if float(stats[metric]) < floor
        }
        frame_fail = bool(deficits)
        stats["deficits"] = deficits
        stats["pass"] = not frame_fail
        report[f"t={time:g}"] = stats
        failed = failed or frame_fail

    report["thresholds"] = {
        "min_fill_ratio_p25": args.min_fill_ratio_p25,
        "min_fill_gain_p25": args.min_fill_gain_p25,
        "min_diagonal_fill_ratio_p25": args.min_diagonal_fill_ratio_p25,
    }
    report["ALL_GATES_PASS"] = not failed
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.write_text(rendered, encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
