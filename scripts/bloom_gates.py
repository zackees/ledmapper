#!/usr/bin/env python3
"""Unified bloom gate runner (#496 Phase 1).

Runs the complete mechanical gate suite against one candidate render. The
base suite covers halo, veil, temporal stability, merge, energy, rings, and
stream color metadata. Optional aligned-source probes add the two-sided
spatial corridor: chroma retention and mid-frequency neighbour fill are the
lower bounds, while far-field cross-hue pull is the upper bound.

Exit code 0 only when EVERY selected gate passes. This is the ratchet from
#496: thresholds only tighten; a red gate blocks the change.

Usage:
  uv run python scripts/bloom_gates.py CANDIDATE.mp4 --reference MINIMAL.mp4
      [--source-crop SOURCE_CROP.mp4]
      [--spatial-times 11] [--mid-frequency-times 2 7 12 17 22 27]
      [--frequency-baseline BASELINE.mp4] [--frequency-times 4]
      [--low-light-baseline BASELINE.mp4] [--low-light-times .5 1.5]
      [--local-midtone-baseline BASELINE.mp4] [--local-midtone-times 9]
      [--shadow-times 14 --shadow-roi 0 0 0.58 0.92]
      [--ring-times 4.6 10.0 15.4] [--merge-times ...] [--probes ...]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return proc.returncode, proc.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument(
        "--ring-times", type=float, nargs="*", default=[4.6, 10.0, 15.4]
    )
    parser.add_argument("--merge-times", type=float, nargs="*", default=[])
    parser.add_argument("--probes", default=None)
    parser.add_argument(
        "--source-crop",
        type=Path,
        default=None,
        help="aligned source crop for spatial/chroma/fill gates",
    )
    parser.add_argument("--spatial-times", type=float, nargs="*", default=[])
    parser.add_argument("--mid-frequency-times", type=float, nargs="*", default=[])
    parser.add_argument(
        "--frequency-baseline",
        type=Path,
        default=None,
        help="fixed-mip baseline for regime-aware quality ranking",
    )
    parser.add_argument("--frequency-times", type=float, nargs="*", default=[])
    parser.add_argument(
        "--low-light-baseline",
        type=Path,
        default=None,
        help="previous approved render for globally-dark coherent-splat gain",
    )
    parser.add_argument("--low-light-times", type=float, nargs="*", default=[])
    parser.add_argument(
        "--local-midtone-baseline",
        type=Path,
        default=None,
        help="previous approved render for spatial low/mid fill gain",
    )
    parser.add_argument("--local-midtone-times", type=float, nargs="*", default=[])
    parser.add_argument(
        "--local-midtone-roi",
        type=float,
        nargs=4,
        metavar=("X0", "Y0", "X1", "Y1"),
        default=[0.22, 0.68, 0.75, 1.0],
        help="normalized AQNF neck-piece ROI used by the calibrated local gate",
    )
    parser.add_argument(
        "--frequency-regime", choices=("auto", "low", "high"), default="auto"
    )
    parser.add_argument("--shadow-times", type=float, nargs="*", default=[])
    parser.add_argument(
        "--shadow-roi",
        type=float,
        nargs=4,
        metavar=("X0", "Y0", "X1", "Y1"),
        default=[0.0, 0.0, 1.0, 1.0],
        help="normalized source ROI used by the colored-shadow structure gate",
    )
    args = parser.parse_args()
    quality_times = sorted(
        set(
            args.spatial_times
            + args.mid_frequency_times
            + args.frequency_times
            + args.shadow_times
            + args.low_light_times
            + args.local_midtone_times
        )
    )
    if bool(args.source_crop) != bool(quality_times):
        parser.error(
            "--source-crop and at least one spatial/mid-frequency/shadow time must "
            "be supplied together"
        )
    if bool(args.frequency_baseline) != bool(args.frequency_times):
        parser.error(
            "--frequency-baseline and at least one --frequency-times value "
            "must be supplied together"
        )
    if bool(args.low_light_baseline) != bool(args.low_light_times):
        parser.error(
            "--low-light-baseline and at least one --low-light-times value "
            "must be supplied together"
        )
    if bool(args.local_midtone_baseline) != bool(args.local_midtone_times):
        parser.error(
            "--local-midtone-baseline and at least one --local-midtone-times "
            "value must be supplied together"
        )

    verdicts: dict[str, bool] = {}
    report: dict[str, object] = {}

    cmd = [
        sys.executable,
        str(SCRIPTS / "bloom_metrics.py"),
        str(args.candidate),
        "--reference",
        str(args.reference),
    ]
    if args.probes:
        cmd += ["--probes", args.probes]
    code, out = run(cmd)
    metrics = json.loads(out) if out.strip().startswith("{") else {}
    report["metrics"] = metrics
    verdicts["metrics"] = bool(metrics.get("gates_pass"))

    cmd = [sys.executable, str(SCRIPTS / "ring_analysis.py"), str(args.candidate)]
    for t in args.ring_times:
        cmd += ["-t", str(t)]
    code, out = run(cmd)
    report["rings"] = json.loads(out) if out.strip().startswith("{") else {}
    verdicts["rings"] = code == 0

    if args.merge_times:
        cmd = [sys.executable, str(SCRIPTS / "whiteout_gate.py"), str(args.candidate)]
        for t in args.merge_times:
            cmd += ["-t", str(t)]
        code, out = run(cmd)
        report["merge_extra"] = json.loads(out) if out.strip().startswith("{") else {}
        verdicts["merge_extra"] = code == 0

    # Color-profile gate always runs: this suite MISSED the untagged-color
    # desaturation defect (2026-08-24) because no gate examined stream
    # metadata — locked down per user direction.
    cmd = [sys.executable, str(SCRIPTS / "color_profile_gate.py"), str(args.candidate)]
    code, out = run(cmd)
    report["color_profile"] = json.loads(out) if out.strip().startswith("{") else {}
    verdicts["color_profile"] = code == 0

    if args.source_crop and quality_times:
        cmd = [
            sys.executable,
            str(SCRIPTS / "chroma_retention_gate.py"),
            str(args.source_crop),
            str(args.candidate),
        ]
        for time in quality_times:
            cmd += ["-t", str(time)]
        code, out = run(cmd)
        report["chroma_retention"] = (
            json.loads(out) if out.strip().startswith("{") else {}
        )
        verdicts["chroma_retention"] = code == 0

        if args.spatial_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "spatial_chroma_leak_gate.py"),
                str(args.source_crop),
                str(args.reference),
                str(args.candidate),
            ]
            for time in args.spatial_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["spatial_chroma_leak"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["spatial_chroma_leak"] = code == 0

        if args.mid_frequency_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "mid_frequency_bloom_gate.py"),
                str(args.source_crop),
                str(args.reference),
                str(args.candidate),
            ]
            for time in args.mid_frequency_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["mid_frequency_fill"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["mid_frequency_fill"] = code == 0

        if args.frequency_baseline and args.frequency_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "frequency_adaptive_bloom_gate.py"),
                str(args.source_crop),
                str(args.frequency_baseline),
                str(args.candidate),
                "--regime",
                args.frequency_regime,
            ]
            for time in args.frequency_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["frequency_adaptive_quality"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["frequency_adaptive_quality"] = code == 0

        if args.shadow_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "shadow_structure_gate.py"),
                str(args.source_crop),
                str(args.candidate),
                "--reference",
                str(args.reference),
                "--roi",
                *(str(value) for value in args.shadow_roi),
            ]
            for time in args.shadow_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["shadow_structure"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["shadow_structure"] = code == 0

        if args.low_light_baseline and args.low_light_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "low_light_splat_gate.py"),
                str(args.source_crop),
                str(args.low_light_baseline),
                str(args.candidate),
            ]
            for time in args.low_light_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["low_light_splat"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["low_light_splat"] = code == 0

        if args.local_midtone_baseline and args.local_midtone_times:
            cmd = [
                sys.executable,
                str(SCRIPTS / "local_midtone_bias_gate.py"),
                str(args.source_crop),
                str(args.local_midtone_baseline),
                str(args.candidate),
                "--roi",
                *(str(value) for value in args.local_midtone_roi),
            ]
            for time in args.local_midtone_times:
                cmd += ["-t", str(time)]
            code, out = run(cmd)
            report["local_midtone_bias"] = (
                json.loads(out) if out.strip().startswith("{") else {}
            )
            verdicts["local_midtone_bias"] = code == 0

    report["verdicts"] = verdicts
    report["ALL_GATES_PASS"] = all(verdicts.values())
    print(json.dumps(report, indent=2))
    return 0 if report["ALL_GATES_PASS"] else 1


if __name__ == "__main__":
    sys.exit(main())
