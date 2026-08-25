#!/usr/bin/env python3
"""Gate dark/chromatic LED cores inside brighter disagreeing halos.

The locked fixture is ``instagram - DYNLe_xz_qX`` with a 45-degree panel.  It
contains two versions of the same discontinuity:

* frame 0: gray-background energy raises a blue LED's neutral halo but not its
  core; and
* t=1: a yellow contour raises the local ambient/halo around a dark-blue LED,
  making the blue core visibly darker than its immediate surroundings.

The second case is important: a frame-level or neighbourhood-average metric
reports *more* energy because of the yellow outline and therefore hides the
blue deficit.  This evaluator measures each core and its own sub-pitch annulus
separately.

This evaluator samples every production LED center and an annulus inside its
nearest-neighbour pitch.  It selects visible, non-clipped blue cores from an
approved reference render, then judges those exact coordinates in the
candidate. Candidate pixels can never escape by brightening, desaturating, or
changing hue.

``halo-over-core luma * max(saturation loss, cross-hue chroma mismatch)``

The luma term must be positive. Hue-consistent blue Gaussian diffusion has no
cross-hue term, while a saturated opponent-yellow halo remains measurable even
when it is more saturated than the core. Neutral haze remains fully weighted
through saturation loss because neutral hue is undefined. Halo hue and the
core/halo luma ratio are reported so neutral-field and opponent-yellow failures
remain distinguishable. Disk and annulus means make the maximum-cell ratchet
robust to H.264 noise and subpixel placement. Panel rotation must match both
renders so the evaluator follows the actual diamond lattice.

Usage:
  uv run python scripts/core_halo_consistency_gate.py MAPPED.mp4 \
      --reference APPROVED_BASELINE.mp4 \
      -t 0 -t 1 --panel-rotation 45

Exit code 1 when the worst eligible core exceeds ``--max-score``.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from evaluator_geometry import production_led_centers

try:  # pragma: no cover - optional, consistent with the other video gates
    import static_ffmpeg  # type: ignore

    static_ffmpeg.add_paths()
except ImportError:
    pass

GRID = 64
BLUE_HUE_MIN = 205.0
BLUE_HUE_MAX = 265.0
MIN_CORE_SATURATION = 0.55
MIN_CORE_VALUE = 0.10
MAX_CORE_VALUE = 0.80
DEFAULT_CENTER_RADIUS = 0.22
DEFAULT_MAX_SCORE = 0.050
DEFAULT_MAX_CORE_HUE_DRIFT = 15.0
DEFAULT_MAX_CORE_SATURATION_LOSS = 0.09
DEFAULT_MAX_CORE_VALUE_GAIN = 0.08
DEFAULT_MAX_CORE_LUMA_GAIN = 0.04
DEFAULT_MAX_CORE_VALUE_LOSS = 0.08
DEFAULT_MAX_CORE_LUMA_LOSS = 0.04


def hue_distance(first: float, second: float) -> float:
    """Shortest circular hue distance in degrees."""
    return abs((first - second + 180) % 360 - 180)


def ambient_class(
    core_hue: float,
    halo_hue: float,
    halo_saturation: float,
) -> str:
    """Name the halo field without changing the score or selection."""
    if halo_saturation < 0.15:
        return "near-neutral"
    difference = hue_distance(core_hue, halo_hue)
    if 25 <= halo_hue <= 85 and difference >= 100:
        return "opponent-warm"
    if difference <= 35:
        return "hue-consistent"
    return "cross-hue"


def disagreement_weight(hue_delta: float, halo_saturation: float) -> float:
    """Keep neutral haze measurable; ignore same-hue Gaussian diffusion."""
    if halo_saturation < 0.15:
        return 1.0
    position = min(max((hue_delta - 35.0) / (100.0 - 35.0), 0.0), 1.0)
    return position * position * (3.0 - 2.0 * position)


def frame_at(path: Path, timestamp: float) -> np.ndarray:
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip().split(",")
    width, height = int(probe[0]), int(probe[1])
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", f"{timestamp:.3f}", "-i", str(path),
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        capture_output=True,
        check=True,
    ).stdout
    expected = width * height * 3
    if len(raw) < expected:
        raise RuntimeError(f"could not decode frame at t={timestamp:g} from {path}")
    return np.frombuffer(raw[:expected], dtype=np.uint8).reshape(height, width, 3).astype(np.float64)


def hsv(rgb: np.ndarray) -> tuple[float, float, float]:
    maximum = float(rgb.max())
    minimum = float(rgb.min())
    spread = maximum - minimum
    saturation = spread / max(maximum, 1e-9)
    red, green, blue = rgb
    hue = 0.0
    if spread > 1e-9:
        if maximum == red:
            hue = (60 * (green - blue) / spread) % 360
        elif maximum == green:
            hue = 60 * (blue - red) / spread + 120
        else:
            hue = 60 * (red - green) / spread + 240
    return hue, saturation, maximum / 255


def radial_means(
    frame: np.ndarray,
    center_x: float,
    center_y: float,
    pitch: float,
) -> tuple[np.ndarray, np.ndarray]:
    core_radius = pitch * 0.20
    halo_inner = pitch * 0.39
    halo_outer = pitch * 0.57
    radius = math.ceil(halo_outer)
    x0 = max(0, math.floor(center_x - radius))
    x1 = min(frame.shape[1], math.ceil(center_x + radius) + 1)
    y0 = max(0, math.floor(center_y - radius))
    y1 = min(frame.shape[0], math.ceil(center_y + radius) + 1)
    patch = frame[y0:y1, x0:x1]
    yy, xx = np.ogrid[y0:y1, x0:x1]
    distance = np.hypot(xx - center_x, yy - center_y)
    core = patch[distance <= core_radius]
    halo = patch[(distance >= halo_inner) & (distance <= halo_outer)]
    if core.size == 0 or halo.size == 0:
        raise RuntimeError("production LED probe produced an empty radial sample")
    return core.mean(axis=0), halo.mean(axis=0)


def luma(rgb: np.ndarray) -> float:
    """Display-space Rec.709 luma, matching the visible encoded anomaly."""
    return float(np.dot(rgb / 255, [0.2126, 0.7152, 0.0722]))


def analyze_frame(
    frame: np.ndarray,
    reference_frame: np.ndarray,
    panel_rotation: float,
    center_radius: float,
) -> dict[str, object]:
    if frame.shape[0] != frame.shape[1]:
        raise RuntimeError(f"mapped render must be square, got {frame.shape[1]}x{frame.shape[0]}")
    size = frame.shape[0]
    centers, pitch = production_led_centers(size, GRID, panel_rotation)
    selected: list[dict[str, object]] = []
    for grid_y in range(GRID):
        for grid_x in range(GRID):
            center_x, center_y = centers[grid_y, grid_x]
            normalized_radius = math.hypot(center_x - size / 2, center_y - size / 2) / size
            if normalized_radius > center_radius:
                continue
            reference_core_rgb, _ = radial_means(reference_frame, center_x, center_y, pitch)
            reference_hue, reference_saturation, reference_value = hsv(reference_core_rgb)
            if not (
                BLUE_HUE_MIN <= reference_hue <= BLUE_HUE_MAX
                and reference_saturation >= MIN_CORE_SATURATION
                and MIN_CORE_VALUE <= reference_value <= MAX_CORE_VALUE
            ):
                continue
            core_rgb, halo_rgb = radial_means(frame, center_x, center_y, pitch)
            core_hue, core_saturation, core_value = hsv(core_rgb)
            halo_hue, halo_saturation, halo_value = hsv(halo_rgb)
            reference_core_luma = luma(reference_core_rgb)
            core_luma = luma(core_rgb)
            halo_luma = luma(halo_rgb)
            saturation_loss = max(reference_saturation - halo_saturation, 0.0)
            luma_inversion = max(halo_luma - reference_core_luma, 0.0)
            hue_delta = hue_distance(reference_hue, halo_hue)
            disagreement = disagreement_weight(hue_delta, halo_saturation)
            saturation_defect = saturation_loss * disagreement
            cross_hue_mismatch = disagreement * min(reference_saturation, halo_saturation)
            chroma_defect = max(saturation_defect, cross_hue_mismatch)
            score = chroma_defect * luma_inversion
            luma_ratio = core_luma / max(halo_luma, 1e-9)
            core_hue_drift = (
                hue_distance(reference_hue, core_hue)
                if core_saturation >= 0.15
                else 180.0
            )
            core_saturation_loss = max(reference_saturation - core_saturation, 0.0)
            core_value_gain = max(core_value - reference_value, 0.0)
            core_luma_gain = max(core_luma - reference_core_luma, 0.0)
            core_value_loss = max(reference_value - core_value, 0.0)
            core_luma_loss = max(reference_core_luma - core_luma, 0.0)
            selected.append(
                {
                    "grid": [grid_x, grid_y],
                    "pixel": [round(float(center_x), 1), round(float(center_y), 1)],
                    "reference_core_rgb": [
                        round(float(channel), 1) for channel in reference_core_rgb
                    ],
                    "reference_core_hsv": [
                        round(reference_hue, 3),
                        round(reference_saturation, 4),
                        round(reference_value, 4),
                    ],
                    "core_rgb": [round(float(channel), 1) for channel in core_rgb],
                    "halo_rgb": [round(float(channel), 1) for channel in halo_rgb],
                    "core_hsv": [round(core_hue, 3), round(core_saturation, 4), round(core_value, 4)],
                    "halo_hsv": [round(halo_hue, 3), round(halo_saturation, 4), round(halo_value, 4)],
                    "core_luma": round(core_luma, 4),
                    "reference_core_luma": round(reference_core_luma, 4),
                    "halo_luma": round(halo_luma, 4),
                    "core_halo_luma_ratio": round(luma_ratio, 4),
                    "halo_core_hue_delta": round(hue_delta, 3),
                    "ambient_class": ambient_class(
                        core_hue,
                        halo_hue,
                        halo_saturation,
                    ),
                    "disagreement_weight": round(disagreement, 4),
                    "saturation_loss": round(saturation_loss, 4),
                    "saturation_defect": round(saturation_defect, 4),
                    "cross_hue_mismatch": round(cross_hue_mismatch, 4),
                    "chroma_defect": round(chroma_defect, 4),
                    "luma_inversion": round(luma_inversion, 4),
                    "core_hue_drift": round(core_hue_drift, 3),
                    "core_saturation_loss": round(core_saturation_loss, 4),
                    "core_value_gain": round(core_value_gain, 4),
                    "core_luma_gain": round(core_luma_gain, 4),
                    "core_value_loss": round(core_value_loss, 4),
                    "core_luma_loss": round(core_luma_loss, 4),
                    "score": round(score, 5),
                }
            )
    if not selected:
        raise RuntimeError("frame has no eligible central blue LED cores")
    selected.sort(key=lambda item: float(item["score"]), reverse=True)
    scores = np.array([float(item["score"]) for item in selected])
    fidelity_keys = (
        "core_hue_drift",
        "core_saturation_loss",
        "core_value_gain",
        "core_luma_gain",
        "core_value_loss",
        "core_luma_loss",
    )
    worst_fidelity = {
        key: max(selected, key=lambda item, metric=key: float(item[metric]))
        for key in fidelity_keys
    }
    worst_by_ambient: dict[str, dict[str, object]] = {}
    for item in selected:
        classification = str(item["ambient_class"])
        if classification not in worst_by_ambient:
            worst_by_ambient[classification] = item
    return {
        "eligible_cells": len(selected),
        "worst": selected[0],
        "worst_by_ambient": worst_by_ambient,
        "worst_fidelity": worst_fidelity,
        "score_p90": round(float(np.percentile(scores, 90)), 5),
        "score_p50": round(float(np.percentile(scores, 50)), 5),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mapped", type=Path)
    parser.add_argument(
        "--reference",
        type=Path,
        required=True,
        help="approved aligned mapped render used only to select the fixed blue-core population",
    )
    parser.add_argument("-t", "--time", type=float, action="append", default=None)
    parser.add_argument("--panel-rotation", type=float, default=0)
    parser.add_argument("--center-radius", type=float, default=DEFAULT_CENTER_RADIUS)
    parser.add_argument("--max-score", type=float, default=DEFAULT_MAX_SCORE)
    parser.add_argument("--max-core-hue-drift", type=float, default=DEFAULT_MAX_CORE_HUE_DRIFT)
    parser.add_argument(
        "--max-core-saturation-loss",
        type=float,
        default=DEFAULT_MAX_CORE_SATURATION_LOSS,
    )
    parser.add_argument("--max-core-value-gain", type=float, default=DEFAULT_MAX_CORE_VALUE_GAIN)
    parser.add_argument("--max-core-luma-gain", type=float, default=DEFAULT_MAX_CORE_LUMA_GAIN)
    parser.add_argument("--max-core-value-loss", type=float, default=DEFAULT_MAX_CORE_VALUE_LOSS)
    parser.add_argument("--max-core-luma-loss", type=float, default=DEFAULT_MAX_CORE_LUMA_LOSS)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    if not 0 < args.center_radius <= 0.5:
        parser.error("--center-radius must be in (0, 0.5]")
    if args.max_score <= 0:
        parser.error("--max-score must be positive")

    frames: dict[str, object] = {}
    passed = True
    # Both DYNLe defects are part of the default ratchet. Frame 0 is the
    # gray/blue case; t=1 is the yellow-outline/blue case that a global energy
    # metric misses. Callers may still provide explicit timestamps for other
    # fixtures.
    for timestamp in args.time or [0.0, 1.0]:
        result = analyze_frame(
            frame_at(args.mapped, timestamp),
            frame_at(args.reference, timestamp),
            args.panel_rotation,
            args.center_radius,
        )
        worst_fidelity = result["worst_fidelity"]  # type: ignore[assignment]
        frame_passed = (
            float(result["worst"]["score"]) <= args.max_score  # type: ignore[index]
            and float(worst_fidelity["core_hue_drift"]["core_hue_drift"])
            <= args.max_core_hue_drift
            and float(worst_fidelity["core_saturation_loss"]["core_saturation_loss"])
            <= args.max_core_saturation_loss
            and float(worst_fidelity["core_value_gain"]["core_value_gain"])
            <= args.max_core_value_gain
            and float(worst_fidelity["core_luma_gain"]["core_luma_gain"])
            <= args.max_core_luma_gain
            and float(worst_fidelity["core_value_loss"]["core_value_loss"])
            <= args.max_core_value_loss
            and float(worst_fidelity["core_luma_loss"]["core_luma_loss"])
            <= args.max_core_luma_loss
        )
        result["pass"] = frame_passed
        frames[f"t={timestamp:g}"] = result
        passed = passed and frame_passed

    report = {
        "video": str(args.mapped),
        "reference": str(args.reference),
        "panel_rotation": args.panel_rotation,
        "max_score": args.max_score,
        "core_fidelity_limits": {
            "max_hue_drift": args.max_core_hue_drift,
            "max_saturation_loss": args.max_core_saturation_loss,
            "max_value_gain": args.max_core_value_gain,
            "max_luma_gain": args.max_core_luma_gain,
            "max_value_loss": args.max_core_value_loss,
            "max_luma_loss": args.max_core_luma_loss,
        },
        "frames": frames,
        "PASS": passed,
    }
    output = json.dumps(report, indent=2)
    print(output)
    if args.json:
        args.json.write_text(output + "\n", encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
