#!/usr/bin/env python3
"""Unified bloom gate runner (#496 Phase 1).

Runs the complete mechanical gate suite against one candidate render:

  - bloom_metrics.py  — G1 halo aliveness, G2 veil, G3 temporal, G4 merge,
                        G5 energy (#495), S-scores
  - ring_analysis.py  — black-ring detector at the stress probes
  - whiteout_gate.py  — bright-region merge on any extra probe times

Exit code 0 only when EVERY gate passes. This is the ratchet from #496:
thresholds only tighten; a red gate blocks the change.

Usage:
  python scripts/bloom_gates.py CANDIDATE.mp4 --reference MINIMAL.mp4
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
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return proc.returncode, proc.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--ring-times", type=float, nargs="*",
                        default=[4.6, 10.0, 15.4])
    parser.add_argument("--merge-times", type=float, nargs="*", default=[])
    parser.add_argument("--probes", default=None)
    parser.add_argument("--source-crop", type=Path, default=None,
                        help="aligned source crop for the spatial chroma-leak gate")
    parser.add_argument("--spatial-times", type=float, nargs="*", default=[])
    args = parser.parse_args()
    if bool(args.source_crop) != bool(args.spatial_times):
        parser.error("--source-crop and --spatial-times must be supplied together")

    verdicts: dict[str, bool] = {}
    report: dict[str, object] = {}

    cmd = [sys.executable, str(SCRIPTS / "bloom_metrics.py"), str(args.candidate),
           "--reference", str(args.reference)]
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

    if args.source_crop and args.spatial_times:
        cmd = [
            sys.executable, str(SCRIPTS / "chroma_retention_gate.py"),
            str(args.source_crop), str(args.candidate),
        ]
        for time in args.spatial_times:
            cmd += ["-t", str(time)]
        code, out = run(cmd)
        report["chroma_retention"] = (
            json.loads(out) if out.strip().startswith("{") else {}
        )
        verdicts["chroma_retention"] = code == 0

        cmd = [
            sys.executable, str(SCRIPTS / "spatial_chroma_leak_gate.py"),
            str(args.source_crop), str(args.reference), str(args.candidate),
        ]
        for time in args.spatial_times:
            cmd += ["-t", str(time)]
        code, out = run(cmd)
        report["spatial_chroma_leak"] = (
            json.loads(out) if out.strip().startswith("{") else {}
        )
        verdicts["spatial_chroma_leak"] = code == 0

    report["verdicts"] = verdicts
    report["ALL_GATES_PASS"] = all(verdicts.values())
    print(json.dumps(report, indent=2))
    return 0 if report["ALL_GATES_PASS"] else 1


if __name__ == "__main__":
    sys.exit(main())
