#!/usr/bin/env python3
"""Chroma-retention gate: LED output vs the ideal panel (#493 gate family).

Rule (user-caught defect, 2026-08-24, kaleidoscope clip AQPahgl9 t=4s): on
chromatically busy content the low-frequency bloom lobes average many
differently-hued neighbors into near-neutral light and veil every LED core —
deep reds render pink, the whole panel goes milky. The energy delta this gate
measures: how much per-hue-family saturation survives from the IDEAL panel
(the source crop averaged over each LED cell — which already includes every
legitimate desaturation from sub-LED detail averaging) to the ACTUAL rendered
LED cores.

Method, per probe frame:
  - ideal panel A: source-crop frame, mean RGB per LED cell (grid 64);
  - LED output B: mapped render sampled at the true LED positions — the
    production preview insets the lattice by the aesthetic camera margin
    (preview.ts fitCamera: half-extent = extent/2 * 1.05 because production
    passes ledDiameter=null);
  - per 60-degree hue family with enough strongly saturated ideal cells
    (S >= 0.5, V > 0.06): same-cell chroma-energy retention is measured
    continuously as min(actual S*V, ideal S*V) while requiring the actual hue
    to remain within 35 degrees. Unrelated cells cannot replace a lost target.
    The old binary count at exactly S=0.5 remains diagnostic only: it made
    healthy borderline cells flip the gate when stronger local diffusion moved
    them from S=0.501 to S=0.499.
  - whole-frame chroma mass (sum of S*V over lit cells) ratio B/A.

FAILS when a populated family's continuous chroma-energy retention or frame chroma
ratio falls below the thresholds. The pre-fix render measured red retention
0.16 and chroma ratio ~0.45; localized mip support must hold the gate green
without relying on a post-composite saturation boost. Thresholds only ratchet
up.

Usage:
  python scripts/chroma_retention_gate.py SOURCE_CROP.mp4 MAPPED.mp4
      -t 4.0 [-t ...] [--min-retention 0.55] [--min-chroma-ratio 0.62]
      [--json out.json]

Exit code 1 when any probe frame fails.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from evaluator_geometry import production_led_positions

try:  # pragma: no cover - optional, mirrors bloom_metrics.py
    import static_ffmpeg  # type: ignore

    static_ffmpeg.add_paths()
except ImportError:
    pass

GRID = 64

STRONG_S = 0.5
LIT_V = 0.06
HUE_TOLERANCE_DEG = 35
FAMILIES = {
    "red": (330, 390),
    "yellow": (30, 90),
    "green": (90, 150),
    "cyan": (150, 210),
    "blue": (210, 270),
    "magenta": (270, 330),
}


def frame_at(path: Path, t: float) -> np.ndarray:
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip().split(",")
    width, height = int(probe[0]), int(probe[1])
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path),
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True,
    ).stdout
    return (
        np.frombuffer(raw[: width * height * 3], dtype=np.uint8)
        .reshape(height, width, 3).astype(np.float64)
    )


def cell_means(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    ch, cw = h // GRID, w // GRID
    return rgb[: ch * GRID, : cw * GRID].reshape(GRID, ch, GRID, cw, 3).mean(axis=(1, 3))


def led_cores(rgb: np.ndarray) -> np.ndarray:
    size = rgb.shape[0]
    positions = production_led_positions(size, GRID)
    out = np.zeros((GRID, GRID, 3))
    for gy, py in enumerate(positions):
        for gx, px in enumerate(positions):
            r, c = int(round(py)), int(round(px))
            out[gy, gx] = rgb[max(0, r - 2):r + 3, max(0, c - 2):c + 3].mean(axis=(0, 1))
    return out


def hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    spread = mx - mn
    s = np.where(mx > 1, spread / np.maximum(mx, 1e-9), 0.0)
    v = mx / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.zeros_like(mx)
    m = spread > 0
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    hue[rm] = (60 * (g[rm] - b[rm]) / spread[rm]) % 360
    hue[gm] = 60 * (b[gm] - r[gm]) / spread[gm] + 120
    hue[bm] = 60 * (r[bm] - g[bm]) / spread[bm] + 240
    return hue, s, v


def analyze_frame(ideal: np.ndarray, led: np.ndarray, min_family_cells: int) -> dict:
    hue_a, s_a, v_a = hsv(ideal)
    hue_b, s_b, v_b = hsv(led)
    lit_a = v_a > LIT_V
    lit_b = v_b > LIT_V

    chroma_a = float((s_a * v_a)[lit_a].sum())
    chroma_b = float((s_b * v_b)[lit_b].sum())
    result: dict = {
        "chroma_ratio": round(chroma_b / chroma_a, 3) if chroma_a > 0 else None,
        "families": {},
    }
    for name, (lo, hi) in FAMILIES.items():
        fam_a = (((hue_a - lo) % 360) < (hi - lo)) & lit_a
        strong_a_mask = fam_a & (s_a >= STRONG_S)
        strong_a = int(strong_a_mask.sum())
        if strong_a < min_family_cells:
            continue
        hue_delta = np.abs((hue_b - hue_a + 180) % 360 - 180)
        same_hue = lit_b & (hue_delta <= HUE_TOLERANCE_DEG)
        retained = (
            strong_a_mask
            & same_hue
            & (s_b >= STRONG_S)
        )
        strong_b = int(retained.sum())
        ideal_chroma = (s_a * v_a)[strong_a_mask]
        actual_chroma = (s_b * v_b)[strong_a_mask]
        hue_ok = same_hue[strong_a_mask]
        retained_chroma = np.minimum(actual_chroma, ideal_chroma) * hue_ok
        energy_retention = (
            float(retained_chroma.sum() / ideal_chroma.sum())
            if ideal_chroma.sum() > 0 else 0.0
        )
        result["families"][name] = {
            "strong_ideal": strong_a,
            "strong_led_same_cells": strong_b,
            "strong_threshold_retention": round(strong_b / strong_a, 3),
            "retention": round(energy_retention, 3),
            "mean_s_ideal": round(float(s_a[fam_a].mean()), 3),
            "mean_s_led_same_cells": round(float(s_b[fam_a].mean()), 3),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_crop", type=Path)
    parser.add_argument("mapped", type=Path)
    parser.add_argument("-t", "--time", type=float, action="append", required=True)
    parser.add_argument("--min-retention", type=float, default=0.55,
                        help="per-family continuous same-cell chroma-energy floor")
    parser.add_argument("--min-chroma-ratio", type=float, default=0.62,
                        help="whole-frame S*V mass ratio floor")
    parser.add_argument("--min-family-cells", type=int, default=100,
                        help="families with fewer strong ideal cells are not judged")
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    report: dict = {}
    failed = False
    for t in args.time:
        ideal = cell_means(frame_at(args.source_crop, t))
        led = led_cores(frame_at(args.mapped, t))
        stats = analyze_frame(ideal, led, args.min_family_cells)
        deficits: dict[str, float] = {}
        if (
            stats["chroma_ratio"] is not None
            and stats["chroma_ratio"] < args.min_chroma_ratio
        ):
            deficits["chroma_ratio"] = round(
                args.min_chroma_ratio - stats["chroma_ratio"], 4
            )
        for name, fam in stats["families"].items():
            if fam["retention"] < args.min_retention:
                deficits[f"family.{name}.retention"] = round(
                    args.min_retention - fam["retention"], 4
                )
        frame_fail = bool(deficits)
        stats["deficits"] = deficits
        stats["pass"] = not frame_fail
        report[f"t={t:g}"] = stats
        failed = failed or frame_fail

    report["thresholds"] = {
        "min_retention": args.min_retention,
        "min_chroma_ratio": args.min_chroma_ratio,
        "min_family_cells": args.min_family_cells,
    }
    report["ALL_GATES_PASS"] = not failed
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.write_text(rendered, encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
