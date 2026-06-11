#!/usr/bin/env python3
"""Generate a 64x64 multi-strip screenmap decomposed into 4 quadrants of
2x2 16x16 serpentine panels (16 strips total), per
https://github.com/zackees/ledmapper/issues/11.

Strip key order is reading order: quadrants q0(TL), q1(TR), q2(BL), q3(BR);
panels within each quadrant p0(TL), p1(TR), p2(BL), p3(BR). Each strip gets
an explicit video_offset = strip_index * leds_per_panel. Each quadrant's MCU
is assumed to live at the quadrant centroid.

Run with --verify to check all structural invariants before writing.
"""

import argparse
import json
import math
import sys


def panel_points(panel_size, spacing, serpentine, first_row):
    """Local serpentine points for one panel, starting at (0, 0)."""
    pts = []
    for major in range(panel_size):
        rng = range(panel_size)
        forward = (major % 2 == 0) == (first_row == "ltr")
        if not forward:
            rng = reversed(rng)
        for minor in rng:
            if serpentine == "row":
                pts.append((minor * spacing, major * spacing))
            else:
                pts.append((major * spacing, minor * spacing))
    return pts


def compute_mcu_centers(panel_size, panels_per_quadrant, quadrants, spacing):
    """Centroid of each quadrant (where the microcontroller lives)."""
    quad_extent = panel_size * panels_per_quadrant * spacing
    half = (panel_size * panels_per_quadrant - 1) * spacing / 2.0
    centers = []
    for qr in range(quadrants):
        for qc in range(quadrants):
            centers.append((qc * quad_extent + half, qr * quad_extent + half))
    return centers


def build_strips(args):
    """Return ordered list of (name, xs, ys, video_offset)."""
    leds_per_panel = args.panel_size * args.panel_size
    local = panel_points(args.panel_size, args.spacing, args.serpentine, args.first_row)
    quad_extent = args.panel_size * args.panels_per_quadrant * args.spacing
    panel_extent = args.panel_size * args.spacing
    mcu_centers = compute_mcu_centers(
        args.panel_size, args.panels_per_quadrant, args.quadrants, args.spacing)

    strips = []
    index = 0
    for qr in range(args.quadrants):
        for qc in range(args.quadrants):
            q = qr * args.quadrants + qc
            qx, qy = qc * quad_extent, qr * quad_extent
            for pr in range(args.panels_per_quadrant):
                for pc in range(args.panels_per_quadrant):
                    p = pr * args.panels_per_quadrant + pc
                    px, py = qx + pc * panel_extent, qy + pr * panel_extent
                    xs = [px + x for x, _ in local]
                    ys = [py + y for _, y in local]
                    if args.frame == "per-mcu":
                        cx, cy = mcu_centers[q]
                        xs = [x - cx for x in xs]
                        ys = [y - cy for y in ys]
                    strips.append((f"q{q}_p{p}", xs, ys, index * leds_per_panel))
                    index += 1
    return strips


def verify(strips, args):
    """Check all invariants from issue #11; raise AssertionError on failure."""
    n = args.panel_size
    ppq = args.panels_per_quadrant
    quads = args.quadrants
    sp = args.spacing
    leds_per_panel = n * n
    strip_count = quads * quads * ppq * ppq
    total = strip_count * leds_per_panel
    side = n * ppq * quads

    # 1. Totals
    assert len(strips) == strip_count, f"expected {strip_count} strips, got {len(strips)}"
    for name, xs, ys, _ in strips:
        assert len(xs) == leds_per_panel, f"{name}: expected {leds_per_panel} LEDs, got {len(xs)}"
    assert sum(len(xs) for _, xs, _, _ in strips) == total

    # 2. x/y lengths match and values are finite
    for name, xs, ys, _ in strips:
        assert len(xs) == len(ys), f"{name}: len(x) != len(y)"
        assert all(math.isfinite(v) for v in xs + ys), f"{name}: non-finite coordinate"

    if args.frame == "global":
        # 3. Exact per-panel bounds
        for i, (name, xs, ys, _) in enumerate(strips):
            q, p = divmod(i, ppq * ppq)
            qr, qc = divmod(q, quads)
            pr, pc = divmod(p, ppq)
            x0 = (qc * ppq + pc) * n * sp
            y0 = (qr * ppq + pr) * n * sp
            x1, y1 = x0 + (n - 1) * sp, y0 + (n - 1) * sp
            assert min(xs) == x0 and max(xs) == x1, \
                f"{name}: x bounds [{min(xs)},{max(xs)}] != [{x0},{x1}]"
            assert min(ys) == y0 and max(ys) == y1, \
                f"{name}: y bounds [{min(ys)},{max(ys)}] != [{y0},{y1}]"

        # 4. Per-quadrant and global bounds
        quad_side = n * ppq
        for q in range(quads * quads):
            qr, qc = divmod(q, quads)
            qxs = [v for i, (_, xs, _, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in xs]
            qys = [v for i, (_, _, ys, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in ys]
            assert min(qxs) == qc * quad_side * sp
            assert max(qxs) == (qc * quad_side + quad_side - 1) * sp
            assert min(qys) == qr * quad_side * sp
            assert max(qys) == (qr * quad_side + quad_side - 1) * sp
        all_xs = [v for _, xs, _, _ in strips for v in xs]
        all_ys = [v for _, _, ys, _ in strips for v in ys]
        assert min(all_xs) == 0 and max(all_xs) == (side - 1) * sp
        assert min(all_ys) == 0 and max(all_ys) == (side - 1) * sp

        # 5. Perfect grid permutation: every cell exactly once
        seen = set()
        for _, xs, ys, _ in strips:
            for x, y in zip(xs, ys):
                seen.add((x, y))
        expected = {(c * sp, r * sp) for r in range(side) for c in range(side)}
        assert len(seen) == total, "duplicate (x,y) points found"
        assert seen == expected, "points do not form the full grid"

        # 8. Quadrant centroid == MCU center
        centers = compute_mcu_centers(n, ppq, quads, sp)
        for q in range(quads * quads):
            qxs = [v for i, (_, xs, _, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in xs]
            qys = [v for i, (_, _, ys, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in ys]
            cx, cy = sum(qxs) / len(qxs), sum(qys) / len(qys)
            assert abs(cx - centers[q][0]) < 1e-9 and abs(cy - centers[q][1]) < 1e-9, \
                f"quadrant {q} centroid ({cx},{cy}) != MCU center {centers[q]}"
    else:
        # per-mcu frame: each quadrant centroid sits at the origin
        for q in range(quads * quads):
            qxs = [v for i, (_, xs, _, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in xs]
            qys = [v for i, (_, _, ys, _) in enumerate(strips)
                   if i // (ppq * ppq) == q for v in ys]
            assert abs(sum(qxs) / len(qxs)) < 1e-9 and abs(sum(qys) / len(qys)) < 1e-9

    # 6. video_offsets contiguous in key order
    offsets = [off for _, _, _, off in strips]
    assert offsets == [i * leds_per_panel for i in range(strip_count)], \
        f"video_offsets not contiguous: {offsets}"

    # 7. Serpentine adjacency within each panel
    for name, xs, ys, _ in strips:
        assert xs[0] == min(xs) and ys[0] == min(ys), \
            f"{name}: first point is not the panel-local origin"
        for i in range(len(xs) - 1):
            dx, dy = xs[i + 1] - xs[i], ys[i + 1] - ys[i]
            in_row_end = (i + 1) % n == 0
            if args.serpentine == "row":
                if in_row_end:
                    assert dx == 0 and abs(dy - sp) < 1e-12, f"{name}: bad row turn at {i}"
                else:
                    assert dy == 0 and abs(abs(dx) - sp) < 1e-12, f"{name}: bad step at {i}"
            else:
                if in_row_end:
                    assert dy == 0 and abs(dx - sp) < 1e-12, f"{name}: bad column turn at {i}"
                else:
                    assert dx == 0 and abs(abs(dy) - sp) < 1e-12, f"{name}: bad step at {i}"

    print(f"verify OK: {strip_count} strips x {leds_per_panel} LEDs = {total} total, "
          f"{side}x{side} grid, frame={args.frame}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate a quad-decomposed multi-strip serpentine screenmap")
    parser.add_argument("--panel-size", type=int, default=16)
    parser.add_argument("--panels-per-quadrant", type=int, default=2,
                        help="panels per quadrant side (2 -> 2x2 panels)")
    parser.add_argument("--quadrants", type=int, default=2,
                        help="quadrants per side (2 -> 2x2 quadrants)")
    parser.add_argument("--spacing", type=float, default=1.0)
    parser.add_argument("--diameter", type=float, default=0.25)
    parser.add_argument("--serpentine", choices=["row", "column"], default="row")
    parser.add_argument("--first-row", choices=["ltr", "rtl"], default="ltr")
    parser.add_argument("--frame", choices=["global", "per-mcu"], default="global")
    parser.add_argument("--out", default="public/screenmaps/64x64_quad_serpentine.json")
    parser.add_argument("--strip-name", default=None,
                        help="override the strip name (single-strip output only); "
                             "also omits the redundant video_offset")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    strips = build_strips(args)
    if args.verify:
        verify(strips, args)

    if args.strip_name is not None and len(strips) != 1:
        parser.error("--strip-name requires a single-strip layout "
                     f"(got {len(strips)} strips)")

    def fmt(v):
        return int(v) if float(v).is_integer() else v

    out = {"map": {}}
    for name, xs, ys, video_offset in strips:
        entry = {
            "x": [fmt(v) for v in xs],
            "y": [fmt(v) for v in ys],
            "diameter": args.diameter,
        }
        if args.strip_name is None:
            entry["video_offset"] = video_offset
            out["map"][name] = entry
        else:
            out["map"][args.strip_name] = entry

    with open(args.out, "w", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))
        f.write("\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
