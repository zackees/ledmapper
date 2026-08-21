#!/usr/bin/env python3
"""Surrogate-loss screener for HDR bloom strategy renders (issue #493).

Computes the gates (G1-G3) and score terms (S1-S3) defined in the #493
iteration-strategy plan for one candidate render against a minimal-bloom
reference render (and optionally the current-default baseline render). All
renders must come from the deterministic producer with identical source, map,
geometry, and fps -- only bloom parameters may differ.

The reference is a *minimal-bloom* render (autoBloom=0&bloomStrength=0.3):
the production contract floors bloomStrength at 0.3, so a true zero-bloom
render does not exist. Gates therefore measure deltas, not absolutes.

These metrics prune and shortlist candidates. They never declare a winner;
the pairwise A/B splice review remains the verdict.

Usage:
  python scripts/bloom_metrics.py CANDIDATE.mp4 --reference MINIMAL.mp4 \
      [--baseline BASELINE.mp4] [--json out.json]
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

try:  # pragma: no cover - optional, mirrors produce_mapped_video.py
    import static_ffmpeg  # type: ignore

    static_ffmpeg.add_paths()
except ImportError:
    pass

# Probe timestamps measured for E:\video\short\fluid_eyes3.mp4 (see the
# protocol comment on #493). Override per clip with --probes.
DEFAULT_PROBES = {
    "T0": 0.0,   # black start / priming
    "T1": 0.8,   # fade-in attack
    "T2": 2.4,   # white-highlight peak (G1 gate)
    "T3": 4.6,   # bright + saturated (S1/S2)
    "T4": 7.5,   # stable midtones (S3)
    "T5": 11.0,  # dim + saturated (G2)
    "T6": 15.4,  # saturation peak (S1/S2)
    "T7": 17.3,  # dimming tail
}
STEADY_WINDOW = (6.2, 8.6)  # G3 temporal-stability window (seconds)


def video_geometry(path: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate",
            "-of", "csv=p=0", str(path),
        ],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    num, den = out[2].split("/")
    return int(out[0]), int(out[1]), float(num) / float(den)


def decode_frames(path: Path, start: float, count: int, width: int, height: int) -> np.ndarray:
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", str(path),
            "-frames:v", str(count), "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        capture_output=True, check=True,
    ).stdout
    frames = len(raw) // (width * height * 3)
    if frames == 0:
        raise RuntimeError(f"no frames decoded from {path} at t={start}")
    return (
        np.frombuffer(raw[: frames * width * height * 3], dtype=np.uint8)
        .reshape(frames, height, width, 3)
        .astype(np.float64)
    )


def frame_at(path: Path, t: float, width: int, height: int) -> np.ndarray:
    return decode_frames(path, t, 1, width, height)[0]


def luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def saturation_avg(rgb: np.ndarray, lit_floor: float = 8.0) -> float:
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    lit = mx > lit_floor
    if not lit.any():
        return 0.0
    return float(((mx[lit] - mn[lit]) / np.maximum(mx[lit], 1e-9)).mean())


def hue_angle(rgb: np.ndarray) -> np.ndarray:
    """Opponent-axis hue angle in radians; meaningful only where chroma > 0."""
    alpha = rgb[..., 0] - 0.5 * rgb[..., 1] - 0.5 * rgb[..., 2]
    beta = (math.sqrt(3) / 2) * (rgb[..., 1] - rgb[..., 2])
    return np.arctan2(beta, alpha)


def chroma_mag(rgb: np.ndarray) -> np.ndarray:
    alpha = rgb[..., 0] - 0.5 * rgb[..., 1] - 0.5 * rgb[..., 2]
    beta = (math.sqrt(3) / 2) * (rgb[..., 1] - rgb[..., 2])
    return np.hypot(alpha, beta)


def box_blur(img: np.ndarray, radius: int) -> np.ndarray:
    """Separable box blur via cumulative sums (no scipy dependency)."""
    out = img
    for axis in (0, 1):
        c = np.cumsum(out, axis=axis)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
        n = out.shape[axis]
        hi = np.minimum(np.arange(n) + radius + 1, n)
        lo = np.maximum(np.arange(n) - radius, 0)
        out = (np.take(c, hi, axis=axis) - np.take(c, lo, axis=axis)) / (
            (hi - lo).reshape([-1 if a == axis else 1 for a in (0, 1)] + [1] * (out.ndim - 2))
        )
    return out


def hue_fidelity(candidate: np.ndarray, reference: np.ndarray, blur_radius: int = 24) -> float:
    """S1: does the ADDED bloom energy carry the hue of the local source LEDs?

    Source-hue field = box-blurred reference (energy-weighted). Compared with
    the hue of (candidate - reference) wherever both the added energy and the
    local source chroma are significant. Returns 1 - meanAngularError/pi;
    1.0 = perfectly hue-matched halos, ~0 = white/opposite-hue halos.
    Returns nan when the frame has no chromatic source to judge against.
    """
    added = np.clip(candidate - reference, 0, None)
    field = box_blur(reference, blur_radius)
    mask = (added.max(axis=-1) > 6) & (chroma_mag(field) > 4)
    if mask.sum() < 100:
        return float("nan")
    # Purity weights the angular agreement: a pure-white halo over a colored
    # LED has ~zero added chroma, and must score ~0 (the #493 failure), not
    # be excluded from the mean.
    purity = chroma_mag(added)[mask] / np.maximum(added.max(axis=-1)[mask], 1e-9)
    diff = np.abs(hue_angle(added)[mask] - hue_angle(field)[mask])
    diff = np.minimum(diff, 2 * math.pi - diff)
    return float((purity * (1.0 - diff / math.pi)).mean())


def core_similarity(candidate: np.ndarray, reference: np.ndarray) -> float:
    """S3: correlation of luma on lit LED cores (bloom = added light, not
    replaced detail)."""
    ref_y = luma(reference)
    cand_y = luma(candidate)
    cores = ref_y > 40
    if cores.sum() < 100:
        return float("nan")
    a, b = cand_y[cores], ref_y[cores]
    denom = a.std() * b.std()
    return float(((a - a.mean()) * (b - b.mean())).mean() / denom) if denom > 1e-9 else float("nan")


def black_floor(rgb: np.ndarray) -> float:
    return float((luma(rgb) < 16).mean())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--reference", type=Path, required=True,
                        help="minimal-bloom render (autoBloom=0&bloomStrength=0.3)")
    parser.add_argument("--baseline", type=Path, default=None,
                        help="current-default strategy render for G2 comparison")
    parser.add_argument("--probes", default=None,
                        help="comma-separated seconds overriding the fluid_eyes3 probe times")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    probes = dict(DEFAULT_PROBES)
    if args.probes:
        times = [float(x) for x in args.probes.split(",")]
        probes = {f"T{i}": t for i, t in enumerate(times)}

    width, height, fps = video_geometry(args.candidate)
    ref_geo = video_geometry(args.reference)
    if (width, height) != ref_geo[:2]:
        raise SystemExit("candidate and reference geometry differ — renders are not comparable")

    result: dict[str, object] = {"candidate": str(args.candidate)}

    # G1: white-bloom aliveness at T2
    t2 = probes["T2"]
    g1 = float(luma(frame_at(args.candidate, t2, width, height)).mean()
               - luma(frame_at(args.reference, t2, width, height)).mean())
    result["G1_white_bloom_aliveness_T2"] = round(g1, 3)
    result["G1_pass"] = g1 > 1.0

    # G2: black floor at T0/T5 (vs baseline when given, else vs reference)
    compare = args.baseline or args.reference
    g2: dict[str, object] = {}
    g2_pass = True
    for key in ("T0", "T5"):
        cand = black_floor(frame_at(args.candidate, probes[key], width, height))
        base = black_floor(frame_at(compare, probes[key], width, height))
        g2[key] = {"candidate": round(cand, 4), "compare": round(base, 4)}
        if cand < base - 0.03:  # candidate lit up pixels that should stay black
            g2_pass = False
    result["G2_black_floor"] = g2
    result["G2_pass"] = g2_pass

    # G3: temporal stability in the steady window + frame-0 settledness
    start, end = STEADY_WINDOW
    steady = decode_frames(args.candidate, start, max(int((end - start) * fps), 2), width, height)
    yavg = luma(steady).mean(axis=(1, 2))
    g3_flicker = float(np.diff(yavg).std())
    head = decode_frames(args.candidate, 0.0, 6, width, height)
    hy = luma(head).mean(axis=(1, 2))
    g3_settle = float(abs(hy[0] - hy[min(5, len(hy) - 1)]))
    result["G3_steady_flicker_std"] = round(g3_flicker, 3)
    result["G3_frame0_settle_delta"] = round(g3_settle, 3)
    result["G3_pass"] = g3_flicker < 2.0 and g3_settle < 8.0

    # S1/S2 at T3 and T6
    for key in ("T3", "T6"):
        cand = frame_at(args.candidate, probes[key], width, height)
        ref = frame_at(args.reference, probes[key], width, height)
        result[f"S1_hue_fidelity_{key}"] = round(hue_fidelity(cand, ref), 4)
        result[f"S2_satavg_{key}"] = round(saturation_avg(cand), 4)

    # S3 at T4
    cand = frame_at(args.candidate, probes["T4"], width, height)
    ref = frame_at(args.reference, probes["T4"], width, height)
    result["S3_core_similarity_T4"] = round(core_similarity(cand, ref), 4)

    result["gates_pass"] = bool(result["G1_pass"] and result["G2_pass"] and result["G3_pass"])

    print(json.dumps(result, indent=2))
    if args.json:
        args.json.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return 0 if result["gates_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
