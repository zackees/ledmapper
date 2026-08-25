#!/usr/bin/env python3
"""Rank adaptive bloom against a fixed-mip baseline by source-frequency regime.

High-frequency frames are rewarded for retaining signed luma edges, chromatic
edge direction, core saturation, and source chromaticity. Low-frequency frames
are rewarded for coherent axial/diagonal gap fill while retaining core
structure and chroma. Scores are computed independently per frame and then at
the low percentile, so one easy region cannot hide a failing regime.

Usage:
  uv run python scripts/frequency_adaptive_bloom_gate.py SOURCE_CROP.mp4 \
      BASELINE.mp4 CANDIDATE.mp4 --regime high -t 4
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from chroma_retention_gate import cell_means, frame_at, hsv, led_cores
from frequency_profile import (
    GRID,
    OFFSETS,
    chromaticity,
    frequency_features,
    linear_rgb,
)
from mid_frequency_bloom_gate import analyze_frame as analyze_fill


def clamp01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def corr(first: np.ndarray, second: np.ndarray) -> float:
    if first.size < 2 or first.std() < 1e-9 or second.std() < 1e-9:
        return 0.0
    return clamp01(float(np.corrcoef(first.ravel(), second.ravel())[0, 1]))


def edge_quality(ideal: np.ndarray, rendered: np.ndarray) -> dict[str, float]:
    ideal_linear = linear_rgb(ideal)
    rendered_linear = linear_rgb(rendered)
    weights = np.array([0.2126, 0.7152, 0.0722])
    ideal_luma = ideal_linear @ weights
    rendered_luma = rendered_linear @ weights
    ideal_chroma = chromaticity(ideal)
    rendered_chroma = chromaticity(rendered)

    source_luma_edges: list[np.ndarray] = []
    render_luma_edges: list[np.ndarray] = []
    chroma_cosines: list[np.ndarray] = []
    for dy, dx in OFFSETS:
        first = (slice(0, GRID - dy), slice(max(0, -dx), GRID - max(0, dx)))
        second = (slice(dy, GRID), slice(max(0, dx), GRID + min(0, dx)))
        source_delta = ideal_luma[first] - ideal_luma[second]
        render_delta = rendered_luma[first] - rendered_luma[second]
        normalized = np.abs(source_delta) / np.maximum(
            ideal_luma[first] + ideal_luma[second] + 0.02,
            0.02,
        )
        selected_luma = normalized > 0.18
        source_luma_edges.append(source_delta[selected_luma])
        render_luma_edges.append(render_delta[selected_luma])

        source_vector = ideal_chroma[first] - ideal_chroma[second]
        render_vector = rendered_chroma[first] - rendered_chroma[second]
        source_norm = np.linalg.norm(source_vector, axis=-1)
        render_norm = np.linalg.norm(render_vector, axis=-1)
        selected_chroma = source_norm > 0.10
        # Select edges from the source only. A renderer that erases an edge
        # must receive zero alignment instead of making that hard case vanish
        # from the evaluator population. Cosine -1 maps to alignment 0 below.
        cosine = np.full_like(source_norm, -1.0)
        visible = selected_chroma & (render_norm > 1e-6)
        cosine[visible] = np.sum(
            source_vector[visible] * render_vector[visible], axis=-1
        ) / np.maximum(source_norm[visible] * render_norm[visible], 1e-9)
        chroma_cosines.append(cosine[selected_chroma])

    source_edges = np.concatenate(source_luma_edges)
    render_edges = np.concatenate(render_luma_edges)
    cosines = np.concatenate(chroma_cosines)
    luma_correlation = corr(source_edges, render_edges) if source_edges.size else 0.0
    polarity = (
        float((np.sign(source_edges) == np.sign(render_edges)).mean())
        if source_edges.size else 0.0
    )
    chroma_alignment = (
        float(np.percentile((cosines + 1.0) * 0.5, 25))
        if cosines.size else 0.0
    )
    _, ideal_saturation, ideal_value = hsv(ideal)
    _, rendered_saturation, _ = hsv(rendered)
    saturated = (ideal_saturation >= 0.35) & (ideal_value >= 0.08)
    saturation_retention = (
        float(
            np.percentile(
                rendered_saturation[saturated]
                / np.maximum(ideal_saturation[saturated], 1e-9),
                25,
            )
        )
        if np.any(saturated) else 0.0
    )
    chroma_error = np.linalg.norm(rendered_chroma - ideal_chroma, axis=-1)
    active = ideal_value >= 0.08
    chroma_accuracy = (
        1.0 - float(np.percentile(chroma_error[active], 75)) / 0.45
        if np.any(active) else 0.0
    )
    # Synthetic and real high-frequency scenes do not always contain every
    # edge family (grayscale checkerboards have no chroma edge; isoluminant
    # color checks have no luma edge). Score the populations that the source
    # actually exercises and renormalize their declared weights. Only an
    # entirely dark/flat frame is unusable for this evaluator.
    components: list[tuple[str, float, float]] = []
    if source_edges.size:
        components.extend((
            ("luma_edge_correlation", 0.28, luma_correlation),
            ("edge_polarity", 0.22, polarity),
        ))
    if cosines.size:
        components.append(("chroma_edge_alignment_p25", 0.22, clamp01(chroma_alignment)))
    if np.any(saturated):
        components.append(("saturation_retention_p25", 0.16, clamp01(saturation_retention)))
    if np.any(active):
        components.append(("chroma_accuracy_p75", 0.12, clamp01(chroma_accuracy)))
    if not components:
        raise RuntimeError("frequency evaluator found no usable source signal")
    applicable_weight = sum(weight for _name, weight, _value in components)
    quality = 100.0 * sum(
        weight * value for _name, weight, value in components
    ) / applicable_weight
    return {
        "luma_edge_correlation": round(luma_correlation, 6),
        "edge_polarity": round(polarity, 6),
        "chroma_edge_alignment_p25": round(chroma_alignment, 6),
        "saturation_retention_p25": round(saturation_retention, 6),
        "chroma_accuracy_p75": round(clamp01(chroma_accuracy), 6),
        "applicable_weight": round(applicable_weight, 6),
        "quality_score": round(quality, 4),
    }


def low_frequency_quality(
    source_frame: np.ndarray,
    rendered_frame: np.ndarray,
) -> dict[str, float]:
    fill = analyze_fill(source_frame, rendered_frame, rendered_frame)
    ideal = cell_means(source_frame)
    rendered = led_cores(rendered_frame)
    edges = edge_quality(ideal, rendered)
    fill_p25 = float(fill["fill_ratio_p25"])
    diagonal_p25 = float(fill["diagonal_fill_ratio_p25"])
    quality = 100.0 * (
        # Targets are calibrated on the bright-surface population selected by
        # linear Rec.709 luma. The former 0.16/0.11 targets saturated every
        # score after fixing that shadow/fill partition and hid overlap gains.
        0.36 * clamp01(fill_p25 / 0.70)
        + 0.24 * clamp01(diagonal_p25 / 0.65)
        + 0.20 * float(edges["luma_edge_correlation"])
        + 0.12 * float(edges["chroma_accuracy_p75"])
        + 0.08 * clamp01(float(edges["saturation_retention_p25"]))
    )
    return {
        "fill_ratio_p25": fill_p25,
        "diagonal_fill_ratio_p25": diagonal_p25,
        "luma_edge_correlation": float(edges["luma_edge_correlation"]),
        "chroma_accuracy_p75": float(edges["chroma_accuracy_p75"]),
        "saturation_retention_p25": float(edges["saturation_retention_p25"]),
        "quality_score": round(quality, 4),
    }


def analyze(
    source_frame: np.ndarray,
    rendered_frame: np.ndarray,
    forced_regime: str,
) -> dict[str, object]:
    ideal = cell_means(source_frame)
    frequency = frequency_features(ideal)
    regime = forced_regime
    if regime == "auto":
        regime = "high" if frequency["target"] >= 0.5 else "low"
    quality = (
        edge_quality(ideal, led_cores(rendered_frame))
        if regime == "high"
        else low_frequency_quality(source_frame, rendered_frame)
    )
    return {"frequency": frequency, "regime": regime, **quality}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument("--regime", choices=("auto", "low", "high"), default="auto")
    parser.add_argument("--min-score-gain", type=float, default=0.10)
    parser.add_argument(
        "--max-frame-regression",
        type=float,
        default=0.50,
        help=(
            "maximum tolerated single-frame score loss; the default allows "
            "sub-point codec/temporal noise while the low-percentile aggregate "
            "must still improve"
        ),
    )
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    frames: dict[str, object] = {}
    baseline_scores: list[float] = []
    candidate_scores: list[float] = []
    regressions: list[float] = []
    for time in args.time:
        source = frame_at(args.source_crop, time)
        baseline = analyze(source, frame_at(args.baseline, time), args.regime)
        candidate = analyze(source, frame_at(args.candidate, time), args.regime)
        baseline_score = float(baseline["quality_score"])
        candidate_score = float(candidate["quality_score"])
        gain = candidate_score - baseline_score
        baseline_scores.append(baseline_score)
        candidate_scores.append(candidate_score)
        regressions.append(gain)
        frames[f"t={time:g}"] = {
            "frequency": candidate["frequency"],
            "regime": candidate["regime"],
            "baseline": {
                key: value
                for key, value in baseline.items()
                if key not in ("frequency", "regime")
            },
            "candidate": {
                key: value
                for key, value in candidate.items()
                if key not in ("frequency", "regime")
            },
            "score_gain": round(gain, 4),
        }

    baseline_score = float(np.percentile(baseline_scores, 25))
    candidate_score = float(np.percentile(candidate_scores, 25))
    score_gain = candidate_score - baseline_score
    worst_frame_gain = min(regressions)
    passed = (
        score_gain >= args.min_score_gain
        and worst_frame_gain >= -args.max_frame_regression
    )
    report = {
        "frames": frames,
        "summary": {
            "aggregation": "frame quality p25",
            "baseline_score": round(baseline_score, 4),
            "candidate_score": round(candidate_score, 4),
            "score_gain": round(score_gain, 4),
            "worst_frame_gain": round(worst_frame_gain, 4),
        },
        "thresholds": {
            "min_score_gain": args.min_score_gain,
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
