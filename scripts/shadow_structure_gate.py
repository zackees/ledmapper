#!/usr/bin/env python3
"""Protect source-aligned dark structure from bloom fill.

The motivating fixture is AQNFgVV at t=14: blue-black hair contains shaded
strands in the source and minimal-bloom render, but an over-broad local bloom
can flatten those dark/light relationships into one filled region. Whole-frame
black level and face-fill metrics miss this because the surrounding background
is legitimately black and the face legitimately benefits from diffusion.

This gate selects colored shadow cells on the aligned 64x64 source grid and
their brighter axial/diagonal neighbours. It measures edge polarity, local
shadow-depth retention, source/render luma rank, and the light deposited in
the inter-LED negative space. The last metric catches the motivating defect:
the LED cores can keep the correct ordering while bloom fills every black gap
and turns layered hair into a solid silhouette. With a minimal-bloom reference
the gate also limits both erased shadow depth and added gap fill.

Usage:
  uv run python scripts/shadow_structure_gate.py SOURCE-CROP.mp4 MAPPED.mp4 \
      --reference MINIMAL.mp4 -t 14 --roi 0 0 0.58 0.92
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from chroma_retention_gate import (
    cell_means,
    frame_at,
    hsv,
    led_cores,
    production_led_positions,
)
from frequency_profile import OFFSETS, linear_rgb

GRID = 64


def luma(rgb: np.ndarray) -> np.ndarray:
    return linear_rgb(rgb) @ np.array([0.2126, 0.7152, 0.0722])


def correlation(first: np.ndarray, second: np.ndarray) -> float:
    if first.size < 2 or first.std() < 1e-9 or second.std() < 1e-9:
        return 0.0
    return float(np.corrcoef(first, second)[0, 1])


def roi_mask(bounds: list[float]) -> np.ndarray:
    x0, y0, x1, y1 = bounds
    xs = np.arange(GRID)[None, :] / GRID
    ys = np.arange(GRID)[:, None] / GRID
    return (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)


def shadow_edges(
    ideal: np.ndarray, bounds: list[float]
) -> list[tuple[int, int, int, int]]:
    source_luma = luma(ideal)
    _, saturation, value = hsv(ideal)
    eligible = (
        roi_mask(bounds)
        & (source_luma >= 0.002)
        & (source_luma <= 0.16)
        & (saturation >= 0.18)
        & (value >= 0.04)
    )
    edges: list[tuple[int, int, int, int]] = []
    for y in range(GRID):
        for x in range(GRID):
            if not eligible[y, x]:
                continue
            for dy, dx in OFFSETS:
                ny, nx = y + dy, x + dx
                if not (0 <= ny < GRID and 0 <= nx < GRID):
                    continue
                dark = source_luma[y, x]
                light = source_luma[ny, nx]
                contrast = (light - dark) / max(light + dark + 0.02, 0.02)
                if contrast >= 0.12:
                    edges.append((y, x, ny, nx))
    return edges


def patch_mean(values: np.ndarray, x: float, y: float, radius: int = 2) -> float:
    row, column = round(y), round(x)
    return float(
        values[
            max(0, row - radius) : row + radius + 1,
            max(0, column - radius) : column + radius + 1,
        ].mean()
    )


def analyze(
    ideal: np.ndarray, rendered: np.ndarray, bounds: list[float]
) -> dict[str, float | int]:
    source_luma = luma(ideal)
    render_luma = luma(led_cores(rendered))
    render_pixels_luma = luma(rendered)
    positions = production_led_positions(rendered.shape[0], GRID)
    edges = shadow_edges(ideal, bounds)
    if len(edges) < 40:
        raise RuntimeError(f"only {len(edges)} colored-shadow edges in ROI")

    source_dark: list[float] = []
    render_dark: list[float] = []
    depth_retention: list[float] = []
    render_depth: list[float] = []
    polarity: list[bool] = []
    shadow_fill: list[float] = []
    for y, x, ny, nx in edges:
        source_a = float(source_luma[y, x])
        source_b = float(source_luma[ny, nx])
        render_a = float(render_luma[y, x])
        render_b = float(render_luma[ny, nx])
        source_contrast = (source_b - source_a) / max(source_b + source_a + 0.02, 0.02)
        candidate_contrast = (render_b - render_a) / max(
            render_b + render_a + 0.02, 0.02
        )
        source_dark.append(source_a)
        render_dark.append(render_a)
        render_depth.append(candidate_contrast)
        depth_retention.append(
            max(candidate_contrast, 0.0) / max(source_contrast, 1e-9)
        )
        polarity.append(render_b > render_a)

    # Unlike coherent face fill, inter-LED light in a shaded hair region has an
    # upper bound. Excess fill turns several dark source levels into one solid
    # silhouette even while the sampled LED cores retain the right ordering.
    _, saturation, value = hsv(ideal)
    eligible = (
        roi_mask(bounds)
        & (source_luma >= 0.002)
        & (source_luma <= 0.16)
        & (saturation >= 0.18)
        & (value >= 0.04)
    )
    for y in range(GRID):
        for x in range(GRID):
            if not eligible[y, x]:
                continue
            for dy, dx in OFFSETS:
                ny, nx = y + dy, x + dx
                if not (0 <= ny < GRID and 0 <= nx < GRID and eligible[ny, nx]):
                    continue
                core = 0.5 * (
                    patch_mean(render_pixels_luma, positions[x], positions[y])
                    + patch_mean(render_pixels_luma, positions[nx], positions[ny])
                )
                midpoint = patch_mean(
                    render_pixels_luma,
                    (positions[x] + positions[nx]) / 2,
                    (positions[y] + positions[ny]) / 2,
                )
                shadow_fill.append(midpoint / max(core, 1e-6))
    if len(shadow_fill) < 40:
        raise RuntimeError(
            f"only {len(shadow_fill)} colored-shadow neighbour pairs in ROI"
        )

    retention = np.asarray(depth_retention)
    depths = np.asarray(render_depth)
    return {
        "shadow_edges": len(edges),
        "edge_polarity": round(float(np.mean(polarity)), 6),
        "shadow_depth_p25": round(float(np.percentile(depths, 25)), 6),
        "shadow_depth_p50": round(float(np.percentile(depths, 50)), 6),
        "depth_retention_p25": round(float(np.percentile(retention, 25)), 6),
        "depth_retention_p50": round(float(np.percentile(retention, 50)), 6),
        "shadow_luma_correlation": round(
            correlation(np.asarray(source_dark), np.asarray(render_dark)),
            6,
        ),
        "shadow_fill_p50": round(float(np.percentile(shadow_fill, 50)), 6),
        "shadow_fill_p75": round(float(np.percentile(shadow_fill, 75)), 6),
        "shadow_fill_p90": round(float(np.percentile(shadow_fill, 90)), 6),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("mapped", type=Path)
    parser.add_argument("--reference", type=Path, default=None)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument(
        "--roi",
        type=float,
        nargs=4,
        metavar=("X0", "Y0", "X1", "Y1"),
        default=[0.0, 0.0, 1.0, 1.0],
        help="normalized source ROI; use a fixture-specific region for a ratchet",
    )
    parser.add_argument("--min-edge-polarity", type=float, default=0.86)
    parser.add_argument("--min-depth-retention-p25", type=float, default=0.18)
    parser.add_argument("--min-luma-correlation", type=float, default=0.55)
    parser.add_argument("--min-reference-depth-ratio", type=float, default=0.45)
    parser.add_argument("--max-shadow-fill-p75", type=float, default=0.15)
    parser.add_argument("--max-shadow-fill-p90", type=float, default=0.32)
    parser.add_argument(
        "--max-reference-fill-gain-p75",
        type=float,
        default=0.12,
        help="maximum p75 inter-LED fill added above the minimal reference",
    )
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()
    x0, y0, x1, y1 = args.roi
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        parser.error("--roi must satisfy 0 <= X0 < X1 <= 1 and 0 <= Y0 < Y1 <= 1")

    report: dict[str, object] = {}
    failed = False
    for time in args.time:
        ideal = cell_means(frame_at(args.source_crop, time))
        candidate = analyze(ideal, frame_at(args.mapped, time), args.roi)
        reference = (
            analyze(ideal, frame_at(args.reference, time), args.roi)
            if args.reference
            else None
        )
        reference_ratio = (
            float(candidate["shadow_depth_p25"])
            / max(float(reference["shadow_depth_p25"]), 1e-9)
            if reference
            else None
        )
        deficits = {
            "edge_polarity": max(
                args.min_edge_polarity - float(candidate["edge_polarity"]), 0
            ),
            "depth_retention_p25": max(
                args.min_depth_retention_p25 - float(candidate["depth_retention_p25"]),
                0,
            ),
            "shadow_luma_correlation": max(
                args.min_luma_correlation - float(candidate["shadow_luma_correlation"]),
                0,
            ),
            "shadow_fill_p75": max(
                float(candidate["shadow_fill_p75"]) - args.max_shadow_fill_p75,
                0,
            ),
            "shadow_fill_p90": max(
                float(candidate["shadow_fill_p90"]) - args.max_shadow_fill_p90,
                0,
            ),
        }
        if reference_ratio is not None:
            deficits["reference_depth_ratio"] = max(
                args.min_reference_depth_ratio - reference_ratio,
                0,
            )
            deficits["reference_fill_gain_p75"] = max(
                float(candidate["shadow_fill_p75"])
                - float(reference["shadow_fill_p75"])
                - args.max_reference_fill_gain_p75,
                0,
            )
        deficits = {
            key: round(value, 6) for key, value in deficits.items() if value > 0
        }
        frame_report: dict[str, object] = {
            "candidate": candidate,
            "deficits": deficits,
            "pass": not deficits,
        }
        if reference:
            frame_report["reference"] = reference
            frame_report["reference_depth_ratio"] = round(float(reference_ratio), 6)
        report[f"t={time:g}"] = frame_report
        failed = failed or bool(deficits)

    report["thresholds"] = {
        "min_edge_polarity": args.min_edge_polarity,
        "min_depth_retention_p25": args.min_depth_retention_p25,
        "min_luma_correlation": args.min_luma_correlation,
        "min_reference_depth_ratio": args.min_reference_depth_ratio,
        "max_shadow_fill_p75": args.max_shadow_fill_p75,
        "max_shadow_fill_p90": args.max_shadow_fill_p90,
        "max_reference_fill_gain_p75": args.max_reference_fill_gain_p75,
    }
    report["ALL_GATES_PASS"] = not failed
    output = json.dumps(report, indent=2)
    print(output)
    if args.json:
        args.json.write_text(output, encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
