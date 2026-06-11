#!/usr/bin/env python3
"""Regenerate public/screenmaps/32x32_quad_serpentine.json.

A 32x32 aggregate built from four 16x16 serpentine panels in a pinwheel:
every panel STARTS at the inner corner next to the aggregate center (where
the microcontroller lives) and serpentines outward, ENDING at the outer
edge on the same row/column it started on. Panel k is panel 0 rotated by
k * 90 degrees, and the whole map is rotated 45 degrees (diamond) like the
original preset.

The original hand-made file squeezed the four rows/columns flanking the
center seams to ~0.7 spacing; this generator uses exact 1.0 spacing.
"""

import argparse
import json
import math
import sys


def panel0_points(panel_size, spacing):
    """Top-left panel: starts at inner corner (-0.5,-0.5)*spacing, advances
    columns outward in -x, serpentining each column along y; ends back on
    the inner row at the outer edge."""
    pts = []
    for c in range(panel_size):
        x = -(0.5 + c) * spacing
        rows = range(panel_size)
        if c % 2 == 1:
            rows = reversed(rows)
        for r in rows:
            pts.append((x, -(0.5 + r) * spacing))
    return pts


def rotate90(pts, k):
    """Rotate points by k * 90 degrees CCW about the origin."""
    for _ in range(k % 4):
        pts = [(-y, x) for x, y in pts]
    return pts


def build_strips(panel_size, spacing):
    base = panel0_points(panel_size, spacing)
    return [(f"q{k}", rotate90(base, k)) for k in range(4)]


def verify(strips, panel_size, spacing):
    n = panel_size
    leds = n * n
    assert len(strips) == 4
    half = n * spacing

    all_pts = set()
    for k, (name, pts) in enumerate(strips):
        assert len(pts) == leds, f"{name}: expected {leds} points"
        # Start at the inner corner beside the MCU center, end on the outer
        # edge of the same row/column.
        sx, sy = pts[0]
        ex, ey = pts[-1]
        assert abs(sx) == spacing / 2 and abs(sy) == spacing / 2, \
            f"{name}: start {pts[0]} is not the inner corner"
        assert max(abs(ex), abs(ey)) == half - spacing / 2, \
            f"{name}: end {pts[-1]} is not on the outer edge"
        assert min(abs(ex), abs(ey)) == spacing / 2, \
            f"{name}: end {pts[-1]} left the inner row/column"
        # Serpentine adjacency: every consecutive step is exactly one spacing.
        for i in range(leds - 1):
            d = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            assert abs(d - spacing) < 1e-9, f"{name}: step {i} has distance {d}"
        # Rotational symmetry with panel 0.
        expected = rotate90(list(strips[0][1]), k)
        assert pts == expected, f"{name}: not a {k * 90} degree rotation of q0"
        all_pts.update(pts)

    # Perfect grid: the union covers the full 32x32 lattice exactly once.
    assert len(all_pts) == 4 * leds, "duplicate points across panels"
    expected_grid = {
        ((c + 0.5 - n) * spacing, (r + 0.5 - n) * spacing)
        for r in range(2 * n) for c in range(2 * n)
    }
    assert all_pts == expected_grid, "points do not form the full grid"

    # Aggregate centroid is the MCU center (origin).
    cx = sum(x for x, _ in all_pts) / len(all_pts)
    cy = sum(y for _, y in all_pts) / len(all_pts)
    assert abs(cx) < 1e-9 and abs(cy) < 1e-9

    print(f"verify OK: 4 strips x {leds} LEDs, {2 * n}x{2 * n} pinwheel grid, "
          f"all starts at center, exact {spacing} spacing")


def main():
    parser = argparse.ArgumentParser(
        description="Regenerate the 32x32 quad serpentine pinwheel preset")
    parser.add_argument("--panel-size", type=int, default=16)
    parser.add_argument("--spacing", type=float, default=1.0)
    parser.add_argument("--diameter", type=float, default=0.25)
    parser.add_argument("--rotate", type=float, default=-45.0,
                        help="final rotation in degrees (diamond orientation)")
    parser.add_argument("--out", default="public/screenmaps/32x32_quad_serpentine.json")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    strips = build_strips(args.panel_size, args.spacing)
    if args.verify:
        verify(strips, args.panel_size, args.spacing)

    a = math.radians(args.rotate)
    cos_a, sin_a = math.cos(a), math.sin(a)

    out = {"map": {}}
    for name, pts in strips:
        out["map"][name] = {
            "x": [round(x * cos_a - y * sin_a, 4) for x, y in pts],
            "y": [round(x * sin_a + y * cos_a, 4) for x, y in pts],
            "diameter": args.diameter,
        }

    with open(args.out, "w", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
