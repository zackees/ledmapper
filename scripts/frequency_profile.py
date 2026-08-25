#!/usr/bin/env python3
"""Shared raw-LED spatial-frequency profiler for bloom evaluator ratchets.

The runtime controller in ``src/bloom-frequency.ts`` uses the same thresholds
and formula. Keep both implementations synchronized: Python provides precise
offline reporting while TypeScript makes the per-frame production decision.
"""

from __future__ import annotations

import numpy as np

GRID = 64
OFFSETS = ((0, 1), (1, 0), (1, 1), (1, -1))
LUMA_DISAGREEMENT = 0.18
CHROMA_DISAGREEMENT = 0.10
COHERENT_LUMA = 0.12
COHERENT_CHROMA = 0.08
LOW_EDGE = 0.32
HIGH_EDGE = 0.65
ATTACK_TAU = 0.14
DECAY_TAU = 0.85
MAX_DT = 0.25


def linear_rgb(rgb: np.ndarray) -> np.ndarray:
    srgb = rgb.astype(np.float64) / 255.0
    return np.where(
        srgb <= 0.04045,
        srgb / 12.92,
        ((srgb + 0.055) / 1.055) ** 2.4,
    )


def chromaticity(rgb: np.ndarray) -> np.ndarray:
    values = rgb.astype(np.float64)
    return np.divide(values, np.maximum(values.sum(axis=-1, keepdims=True), 1e-9))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    t = min(max((value - edge0) / max(edge1 - edge0, 1e-9), 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def step_frequency_blend(current: float, target: float, dt_seconds: float) -> float:
    """Runtime-equivalent media-time attack/decay step."""
    start = min(max(current, 0.0), 1.0)
    end = min(max(target, 0.0), 1.0)
    dt = min(max(dt_seconds, 0.0), MAX_DT)
    if dt == 0.0 or start == end:
        return start
    tau = ATTACK_TAU if end > start else DECAY_TAU
    return min(max(end + (start - end) * np.exp(-dt / tau), 0.0), 1.0)


def frequency_features(ideal_rgb: np.ndarray) -> dict[str, float]:
    """Return the runtime-equivalent score for one 64x64 source-cell grid."""
    if ideal_rgb.shape[:2] != (GRID, GRID):
        raise ValueError(f"expected {GRID}x{GRID} LED grid, got {ideal_rgb.shape[:2]}")
    rgb = ideal_rgb.astype(np.float64)
    linear = linear_rgb(rgb)
    luma = linear @ np.array([0.2126, 0.7152, 0.0722])
    chroma = chromaticity(rgb)
    luma_diffs: list[np.ndarray] = []
    chroma_diffs: list[np.ndarray] = []
    lit_masks: list[np.ndarray] = []
    for dy, dx in OFFSETS:
        first = (
            slice(max(0, dy), GRID + min(0, dy)),
            slice(max(0, dx), GRID + min(0, dx)),
        )
        second = (
            slice(max(0, -dy), GRID - max(0, dy)),
            slice(max(0, -dx), GRID - max(0, dx)),
        )
        ya, yb = luma[first], luma[second]
        luma_diffs.append(np.abs(ya - yb) / np.maximum(ya + yb + 0.02, 0.02))
        chroma_diffs.append(np.linalg.norm(chroma[first] - chroma[second], axis=-1))
        lit_masks.append(
            np.maximum(rgb[first].max(axis=-1), rgb[second].max(axis=-1)) >= 20
        )
    luma_delta = np.concatenate([value.ravel() for value in luma_diffs])
    chroma_delta = np.concatenate([value.ravel() for value in chroma_diffs])
    lit = np.concatenate([value.ravel() for value in lit_masks])
    if not lit.any():
        return {
            "luma_disagreement": 0.0,
            "chroma_disagreement": 0.0,
            "coherent_coverage": 1.0,
            "score": 0.0,
            "target": 0.0,
        }
    luma_disagreement = float((luma_delta[lit] > LUMA_DISAGREEMENT).mean())
    chroma_disagreement = float((chroma_delta[lit] > CHROMA_DISAGREEMENT).mean())
    coherent_coverage = float(
        (
            (luma_delta[lit] < COHERENT_LUMA) & (chroma_delta[lit] < COHERENT_CHROMA)
        ).mean()
    )
    disagreement = max(luma_disagreement, chroma_disagreement)
    non_coherent = max(1.0 - coherent_coverage, 1e-9)
    score = min(
        max(
            0.75 * disagreement + 0.25 * min(disagreement / non_coherent, 1.0) - 0.10,
            0.0,
        ),
        1.0,
    )
    return {
        "luma_disagreement": round(luma_disagreement, 6),
        "chroma_disagreement": round(chroma_disagreement, 6),
        "coherent_coverage": round(coherent_coverage, 6),
        "score": round(score, 6),
        "target": round(smoothstep(LOW_EDGE, HIGH_EDGE, score), 6),
    }
