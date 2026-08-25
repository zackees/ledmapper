#!/usr/bin/env python3
"""Rendered temporal gate for the adaptive acrylic bloom controller (#507).

The fixture is a stable-low -> stable-high -> one-frame-low -> stable-high ->
stable-low source sequence. This gate decodes the actual mapped render, rebuilds
the runtime frequency trace from the aligned source crop, and rejects state
non-monotonicity or visible luma/chroma pumping outside the stable endpoint
corridor. It complements the pure TypeScript state tests: smooth weights alone
are insufficient if exchanging neighbouring mip bands causes nonlinear output.

The observed blend is solved per frame from pinned-low and pinned-high renders:
``adaptive ~= low + blend * (high - low)`` in linear RGB.  This prevents a
source-only reconstruction from approving a renderer that resets its state,
jumps directly between endpoints, or ignores the controller.

Usage:
  uv run python scripts/frequency_temporal_bloom_gate.py SOURCE-CROP.mp4 \
      PINNED-LOW.mp4 PINNED-HIGH.mp4 ADAPTIVE.mp4 \
      --fps 30 --high-start 1 --low-impulse 3 --low-return 4
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from frequency_profile import frequency_features, linear_rgb, step_frequency_blend
from produce_mapped_video import ffmpeg_tools


def decode_grid(path: Path, fps: float) -> list[np.ndarray]:
    ffmpeg, _ = ffmpeg_tools()
    process = subprocess.Popen(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(path),
            "-vf",
            f"fps={fps:g},scale=64:64:flags=area",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
    )
    assert process.stdout is not None
    frame_bytes = 64 * 64 * 3
    frames: list[np.ndarray] = []
    while True:
        raw = process.stdout.read(frame_bytes)
        if not raw:
            break
        if len(raw) != frame_bytes:
            raise RuntimeError(f"partial decoded frame from {path}")
        frames.append(np.frombuffer(raw, dtype=np.uint8).reshape(64, 64, 3).copy())
    if process.wait() != 0:
        raise RuntimeError(f"ffmpeg decode failed for {path}")
    return frames


def mean_luma(rgb: np.ndarray) -> float:
    return float((linear_rgb(rgb) @ np.array([0.2126, 0.7152, 0.0722])).mean())


def mean_saturation(rgb: np.ndarray) -> float:
    values = rgb.astype(np.float64) / 255.0
    maximum = values.max(axis=-1)
    spread = maximum - values.min(axis=-1)
    lit = maximum >= 0.04
    saturation = np.divide(spread, np.maximum(maximum, 1e-9))
    return float(saturation[lit].mean()) if lit.any() else 0.0


def median_between(values: np.ndarray, start: int, stop: int) -> float:
    selected = values[max(start, 0) : min(stop, len(values))]
    if selected.size == 0:
        raise ValueError("temporal fixture phase has no sampled frames")
    return float(np.median(selected))


def first_crossing(
    blends: np.ndarray,
    start_frame: int,
    stop_frame: int,
    threshold: float,
    rising: bool,
    fps: float,
) -> float | None:
    segment = blends[start_frame:stop_frame]
    selected = np.flatnonzero(segment >= threshold if rising else segment <= threshold)
    return float(selected[0] / fps) if selected.size else None


def observed_blend_trace(
    low_frames: list[np.ndarray],
    high_frames: list[np.ndarray],
    adaptive_frames: list[np.ndarray],
) -> tuple[np.ndarray, np.ndarray]:
    """Fit the encoded adaptive frame between same-frame endpoint renders."""
    blends: list[float] = []
    separations: list[float] = []
    for low_rgb, high_rgb, adaptive_rgb in zip(
        low_frames, high_frames, adaptive_frames, strict=True
    ):
        low = linear_rgb(low_rgb).reshape(-1)
        high = linear_rgb(high_rgb).reshape(-1)
        adaptive = linear_rgb(adaptive_rgb).reshape(-1)
        axis = high - low
        energy = float(np.dot(axis, axis))
        separations.append(float(np.sqrt(energy / axis.size)))
        if energy <= 1e-12:
            blends.append(float("nan"))
            continue
        fitted = float(np.dot(adaptive - low, axis) / energy)
        blends.append(float(np.clip(fitted, 0.0, 1.0)))
    return np.asarray(blends), np.asarray(separations)


def correlation(first: np.ndarray, second: np.ndarray) -> float:
    valid = np.isfinite(first) & np.isfinite(second)
    if valid.sum() < 3 or first[valid].std() < 1e-9 or second[valid].std() < 1e-9:
        return 0.0
    return float(np.corrcoef(first[valid], second[valid])[0, 1])


def crossing_error(observed: float | None, expected: float | None) -> float:
    if observed is None or expected is None:
        return float("inf")
    return abs(observed - expected)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("low_render", type=Path)
    parser.add_argument("high_render", type=Path)
    parser.add_argument("rendered", type=Path)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--high-start", type=float, default=1.0)
    parser.add_argument("--low-impulse", type=float, default=3.0)
    parser.add_argument("--low-return", type=float, default=4.0)
    parser.add_argument("--max-output-overshoot", type=float, default=0.12)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    source = decode_grid(args.source_crop, args.fps)
    low_render = decode_grid(args.low_render, args.fps)
    high_render = decode_grid(args.high_render, args.fps)
    rendered = decode_grid(args.rendered, args.fps)
    count = min(len(source), len(low_render), len(high_render), len(rendered))
    if count < round((args.low_return + 1.0) * args.fps):
        parser.error("fixture is too short for the requested phases")
    source = source[:count]
    low_render = low_render[:count]
    high_render = high_render[:count]
    rendered = rendered[:count]

    targets = np.array([float(frequency_features(frame)["target"]) for frame in source])
    blends = np.empty(count)
    blends[0] = targets[0]
    for index in range(1, count):
        blends[index] = step_frequency_blend(
            blends[index - 1], targets[index], 1 / args.fps
        )
    observed_blends, endpoint_separation = observed_blend_trace(
        low_render, high_render, rendered
    )

    source_luma = np.array([mean_luma(frame) for frame in source])
    render_luma = np.array([mean_luma(frame) for frame in rendered])
    source_sat = np.array([mean_saturation(frame) for frame in source])
    render_sat = np.array([mean_saturation(frame) for frame in rendered])
    luma_ratio = render_luma / np.maximum(source_luma, 1e-6)
    saturation_ratio = render_sat / np.maximum(source_sat, 1e-6)

    high_start = round(args.high_start * args.fps)
    impulse = round(args.low_impulse * args.fps)
    low_return = round(args.low_return * args.fps)
    settle = max(round(0.6 * args.fps), 1)
    guard = max(round(0.2 * args.fps), 1)

    monotonic_attack = bool(np.all(np.diff(blends[high_start:impulse]) >= -1e-9))
    post_impulse_attack = bool(
        np.all(np.diff(blends[impulse + 1 : low_return]) >= -1e-9)
    )
    monotonic_decay = bool(np.all(np.diff(blends[low_return:]) <= 1e-9))
    impulse_drop = float(blends[impulse - 1] - blends[impulse])

    stable_slices = [
        (guard, max(high_start - guard, guard + 1)),
        (high_start + settle, max(impulse - guard, high_start + settle + 1)),
        (low_return + settle, count - guard),
    ]
    stable_luma = [
        median_between(luma_ratio, start, stop) for start, stop in stable_slices
    ]
    stable_sat = [
        median_between(saturation_ratio, start, stop) for start, stop in stable_slices
    ]
    corridor_start = high_start
    corridor_luma = luma_ratio[corridor_start:]
    corridor_sat = saturation_ratio[corridor_start:]

    def corridor_ok(values: np.ndarray, endpoints: list[float]) -> tuple[bool, float]:
        lower = min(endpoints) * (1.0 - args.max_output_overshoot)
        upper = max(endpoints) * (1.0 + args.max_output_overshoot)
        violation = max(float(values.max() - upper), float(lower - values.min()), 0.0)
        return bool(values.min() >= lower and values.max() <= upper), violation

    luma_ok, luma_violation = corridor_ok(corridor_luma, stable_luma)
    saturation_ok, saturation_violation = corridor_ok(corridor_sat, stable_sat)
    expected_response = {
        "attack_50_seconds": first_crossing(
            blends, high_start, impulse, 0.5, True, args.fps
        ),
        "attack_90_seconds": first_crossing(
            blends, high_start, impulse, 0.9, True, args.fps
        ),
        "decay_50_seconds": first_crossing(
            blends, low_return, count, 0.5, False, args.fps
        ),
        "decay_90_seconds": first_crossing(
            blends, low_return, count, 0.1, False, args.fps
        ),
    }
    observed_response = {
        "attack_50_seconds": first_crossing(
            observed_blends, high_start, impulse, 0.5, True, args.fps
        ),
        "attack_90_seconds": first_crossing(
            observed_blends, high_start, impulse, 0.9, True, args.fps
        ),
        "decay_50_seconds": first_crossing(
            observed_blends, low_return, count, 0.5, False, args.fps
        ),
        "decay_90_seconds": first_crossing(
            observed_blends, low_return, count, 0.1, False, args.fps
        ),
    }
    trace_valid = np.isfinite(observed_blends)
    trace_rmse = float(np.sqrt(np.mean((observed_blends[trace_valid] - blends[trace_valid]) ** 2)))
    trace_correlation = correlation(observed_blends, blends)
    observed_impulse_drop = float(observed_blends[impulse - 1] - observed_blends[impulse])
    observed_low = median_between(observed_blends, guard, high_start - guard)
    observed_high = median_between(
        observed_blends, high_start + settle, impulse - guard
    )
    crossing_errors = {
        key: crossing_error(observed_response[key], expected_response[key])
        for key in expected_response
    }
    verdicts = {
        "classifier_low_phase": bool(np.median(targets[:high_start]) <= 0.1),
        "classifier_high_phase": bool(np.median(targets[high_start:impulse]) >= 0.9),
        "monotonic_attack": monotonic_attack and post_impulse_attack,
        "monotonic_decay": monotonic_decay,
        "one_frame_impulse_resisted": impulse_drop <= 0.05,
        "endpoint_renders_distinguishable": bool(np.nanmedian(endpoint_separation) >= 0.001),
        "encoded_low_endpoint_reached": observed_low <= 0.25,
        "encoded_high_endpoint_reached": observed_high >= 0.75,
        "encoded_trace_correlates": trace_correlation >= 0.85,
        "encoded_trace_matches": trace_rmse <= 0.18,
        "encoded_attack_matches": (
            crossing_errors["attack_50_seconds"] <= 0.20
            and crossing_errors["attack_90_seconds"] <= 0.20
        ),
        "encoded_decay_matches": (
            crossing_errors["decay_50_seconds"] <= 0.40
            and crossing_errors["decay_90_seconds"] <= 0.40
        ),
        "encoded_impulse_resisted": (
            observed_impulse_drop <= 0.12
            and abs(observed_impulse_drop - impulse_drop) <= 0.10
        ),
        "rendered_luma_no_pump": luma_ok,
        "rendered_chroma_no_pump": saturation_ok,
    }
    report = {
        "frames": count,
        "fps": args.fps,
        "expected_response": expected_response,
        "observed_response": observed_response,
        "crossing_error_seconds": {
            key: round(value, 6) for key, value in crossing_errors.items()
        },
        "one_frame_impulse_drop": round(impulse_drop, 6),
        "observed_one_frame_impulse_drop": round(observed_impulse_drop, 6),
        "observed_low_phase_median": round(observed_low, 6),
        "observed_high_phase_median": round(observed_high, 6),
        "observed_trace_correlation": round(trace_correlation, 6),
        "observed_trace_rmse": round(trace_rmse, 6),
        "endpoint_separation_median": round(float(np.nanmedian(endpoint_separation)), 6),
        "stable_luma_ratios": [round(value, 6) for value in stable_luma],
        "stable_saturation_ratios": [round(value, 6) for value in stable_sat],
        "maximum_luma_corridor_violation": round(luma_violation, 6),
        "maximum_saturation_corridor_violation": round(saturation_violation, 6),
        "verdicts": verdicts,
        "ALL_GATES_PASS": all(verdicts.values()),
    }
    output = json.dumps(report, indent=2)
    print(output)
    if args.json:
        args.json.write_text(output, encoding="utf-8")
    return 0 if report["ALL_GATES_PASS"] else 1


if __name__ == "__main__":
    sys.exit(main())
