/**
 * Unit tests for the per-strip (sub-group) rotation geometry helpers.
 * Covers the pure math used by the rotate handle in the shape editor.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { bboxCenter, minimumAreaObb, rotateOrientedBox, rotatePointsAround, rotationHandleFromObb, type Pt } from '../../src/shapeeditor/strip-rotate';

function approx(a: number, b: number, eps = 1e-9): boolean {
    return Math.abs(a - b) < eps;
}

function approxPt(a: Pt, b: Pt, eps = 1e-9): boolean {
    return approx(a[0], b[0], eps) && approx(a[1], b[1], eps);
}

describe('bboxCenter', () => {
    test('returns null for an empty list', () => {
        assert.equal(bboxCenter([]), null);
    });

    test('single point is its own center', () => {
        assert.deepEqual(bboxCenter([[5, 7]]), { x: 5, y: 7 });
    });

    test('center of an axis-aligned rectangle', () => {
        const c = bboxCenter([[0, 0], [10, 0], [10, 4], [0, 4]]);
        assert.deepEqual(c, { x: 5, y: 2 });
    });

    test('center is min/max midpoint, not centroid', () => {
        // 4 points clustered on the left + 1 on the right — centroid
        // would lean left, bbox center stays at the geometric midpoint.
        const c = bboxCenter([[0, 0], [0, 1], [0, 2], [0, 3], [10, 0]]);
        assert.ok(c !== null);
        assert.equal(c.x, 5);
        assert.equal(c.y, 1.5);
    });
});

describe('minimumAreaObb', () => {
    test('fits a rotated rectangle tightly and preserves its center', () => {
        const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
        const points: Pt[] = [[-5, -1], [5, -1], [5, 1], [-5, 1]].map(([x, y]) => [x * c - y * s + 8, x * s + y * c - 3]);
        const box = minimumAreaObb(points);
        assert.ok(box);
        assert.ok(Math.abs(box.cx - 8) < 1e-8);
        assert.ok(Math.abs(box.cy + 3) < 1e-8);
        assert.ok(Math.abs(box.hw - 5) < 1e-8);
        assert.ok(Math.abs(box.hh - 1) < 1e-8);
    });

    test('handles singleton and collinear groups deterministically', () => {
        assert.deepEqual(minimumAreaObb([[2, 3]]), { cx: 2, cy: 3, cos: 1, sin: 0, hw: 0, hh: 0 });
        const line = minimumAreaObb([[0, 0], [4, 4], [2, 2]]);
        assert.ok(line);
        assert.ok(Math.abs(line.cx - 2) < 1e-8);
        assert.ok(Math.abs(line.cy - 2) < 1e-8);
        assert.ok(Math.abs(line.hh) < 1e-8);
    });
});

describe('rotatePointsAround', () => {
    test('90° quarter-turn around origin: (1,0) -> (0,1)', () => {
        const out = rotatePointsAround([[1, 0]], 0, 0, Math.PI / 2);
        assert.ok(approxPt(out[0]!, [0, 1]));
    });

    test('180° turn around origin negates both axes', () => {
        const out = rotatePointsAround([[2, 3], [-1, 5]], 0, 0, Math.PI);
        assert.ok(approxPt(out[0]!, [-2, -3]));
        assert.ok(approxPt(out[1]!, [1, -5]));
    });

    test('rotation around an off-origin pivot preserves the pivot', () => {
        const out = rotatePointsAround([[3, 4], [10, 10]], 3, 4, Math.PI / 3);
        // The pivot point maps to itself
        assert.ok(approxPt(out[0]!, [3, 4]));
        // Distance from pivot is preserved
        const dx = (out[1]?.[0] ?? 0) - 3;
        const dy = (out[1]?.[1] ?? 0) - 4;
        const dOut = Math.hypot(dx, dy);
        const dIn = Math.hypot(10 - 3, 10 - 4);
        assert.ok(approx(dOut, dIn, 1e-9), `distance ${String(dOut)} != ${String(dIn)}`);
    });

    test('zero angle is identity (and returns a fresh array)', () => {
        const input: Pt[] = [[1, 2], [3, 4]];
        const out = rotatePointsAround(input, 0, 0, 0);
        assert.notEqual(out, input); // fresh array
        assert.ok(approxPt(out[0]!, [1, 2]));
        assert.ok(approxPt(out[1]!, [3, 4]));
    });

    test('round-trip: rotating by θ then -θ recovers the input', () => {
        const input: Pt[] = [[1, 2], [3, -4], [-5, 6]];
        const theta = 0.73;
        const r1 = rotatePointsAround(input, 1, 1, theta);
        const r2 = rotatePointsAround(r1, 1, 1, -theta);
        for (let i = 0; i < input.length; i++) {
            assert.ok(approxPt(r2[i]!, input[i]!, 1e-12), `point ${String(i)}`);
        }
    });

    test('handles empty input', () => {
        const out = rotatePointsAround([], 0, 0, Math.PI / 4);
        assert.deepEqual(out, []);
    });
});

describe('live rotation handle geometry', () => {
    test('rotates the directed OBB axes while preserving center and extents', () => {
        const input = { cx: 12, cy: -4, cos: Math.cos(0.37), sin: Math.sin(0.37), hw: 20, hh: 3 };
        const output = rotateOrientedBox(input, Math.PI / 2);
        assert.ok(approx(output.cx, input.cx));
        assert.ok(approx(output.cy, input.cy));
        assert.ok(approx(output.hw, input.hw));
        assert.ok(approx(output.hh, input.hh));
        assert.ok(approx(output.cos, Math.cos(0.37 + Math.PI / 2)));
        assert.ok(approx(output.sin, Math.sin(0.37 + Math.PI / 2)));
        assert.ok(approx(Math.hypot(output.cos, output.sin), 1));
        assert.deepEqual(input, { cx: 12, cy: -4, cos: Math.cos(0.37), sin: Math.sin(0.37), hw: 20, hh: 3 });
    });

    test('keeps the handle attached to the OBB at a fixed arm length', () => {
        const box = { cx: 12, cy: -4, cos: 1, sin: 0, hw: 20, hh: 3 };
        const start = rotationHandleFromObb(box);
        const rotated = rotationHandleFromObb(rotateOrientedBox(box, Math.PI / 2));
        assert.ok(approx(Math.hypot(start.anchorX - box.cx, start.anchorY - box.cy), box.hh));
        assert.ok(approx(Math.hypot(start.handleX - start.anchorX, start.handleY - start.anchorY), 30));
        assert.ok(approx(Math.hypot(rotated.handleX - rotated.anchorX, rotated.handleY - rotated.anchorY), 30));
        assert.ok(approx(rotated.handleX - box.cx, -(start.handleY - box.cy)));
        assert.ok(approx(rotated.handleY - box.cy, start.handleX - box.cx));
    });

    test('handles a degenerate OBB without producing non-finite coordinates', () => {
        const handle = rotationHandleFromObb({ cx: 2, cy: 3, cos: 1, sin: 0, hw: 0, hh: 0 });
        for (const value of Object.values(handle)) assert.ok(Number.isFinite(value));
        assert.ok(approx(Math.hypot(handle.handleX - handle.anchorX, handle.handleY - handle.anchorY), 30));
    });
});
