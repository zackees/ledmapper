/**
 * Tiny logic test for the center-to-center snap math in issue #105.
 *
 * The strip-drag mousemove path is too tangled with DOM state to unit-
 * test directly, but the *core* — picking the nearest target on an axis
 * within a tolerance — is pure. This test mirrors that logic exactly
 * so we can pin the behavior and the rotation-invariance claim from
 * the issue.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

/** Mirrors the loop inside the strip-drag mousemove. */
function snapAxis(targets: number[], candidate: number, tolCm: number): number | null {
    let best: number | null = null;
    let bestDist = tolCm;
    for (const t of targets) {
        const d = Math.abs(t - candidate);
        if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
}

/** Mean of a list of points along the given axis. Matches how the
 *  precompute averages `screenmap_pts` to get a strip's center. */
function centerOf(points: [number, number][], axis: 0 | 1): number {
    let s = 0;
    for (const p of points) s += p[axis];
    return points.length > 0 ? s / points.length : 0;
}

describe('strip center snap (issue #105)', () => {
    test('returns null when no target is in range', () => {
        assert.equal(snapAxis([10, 20, 30], 50, 2), null);
    });

    test('returns the closest target within tolerance', () => {
        // candidate = 11, targets at 10 and 20, tol = 2 → snap to 10.
        assert.equal(snapAxis([10, 20], 11, 2), 10);
    });

    test('ties go to the first-seen target', () => {
        // candidate exactly between; bestDist starts at tol = 5, both
        // distances are 5. Neither beats bestDist strictly, so neither
        // snaps. This is by design — half-overlap shouldn't pin you.
        assert.equal(snapAxis([0, 10], 5, 5), null);
        // With tolerance 6, both are within range and 0 wins by `<`.
        assert.equal(snapAxis([0, 10], 5, 6), 0);
    });

    test('rotation-invariance: AABB center of rotated points == mean of points', () => {
        // Build a 4-point rectangle (length 10, width 4) centered at (5, 3),
        // then rotate it 30° about that center. The center of the rotated
        // points (mean of the 4 rotated corners) should still equal (5, 3)
        // because the AABB center is rotation-invariant about the centroid.
        const cx = 5, cy = 3;
        const corners: [number, number][] = [
            [-5, -2], [5, -2], [5, 2], [-5, 2],
        ].map(([x, y]) => [x + cx, y + cy] as [number, number]);

        const theta = (30 * Math.PI) / 180;
        const cos = Math.cos(theta), sin = Math.sin(theta);
        const rotated: [number, number][] = corners.map(([x, y]) => {
            const dx = x - cx, dy = y - cy;
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        });

        const meanX = centerOf(rotated, 0);
        const meanY = centerOf(rotated, 1);
        assert.ok(Math.abs(meanX - cx) < 1e-9, `meanX=${String(meanX)}`);
        assert.ok(Math.abs(meanY - cy) < 1e-9, `meanY=${String(meanY)}`);
    });

    test('rotated strip pair snaps center-to-center on both axes', () => {
        // Two rotated strips with centers at world (5, 3) and (5, 9).
        // Dragging the second from (5, 9) → candidate (5.4, 3.1). With
        // tolerance 1, x snaps to 5 and y snaps to 3.
        const xTargets = [5];
        const yTargets = [3];
        const candX = 5.4;
        const candY = 3.1;
        assert.equal(snapAxis(xTargets, candX, 1), 5);
        assert.equal(snapAxis(yTargets, candY, 1), 3);
    });

    test('only one axis engages when the other is out of range', () => {
        const xTargets = [10];
        const yTargets = [10];
        // candidate (10.1, 50): only x snaps.
        assert.equal(snapAxis(xTargets, 10.1, 1), 10);
        assert.equal(snapAxis(yTargets, 50, 1), null);
    });
});
