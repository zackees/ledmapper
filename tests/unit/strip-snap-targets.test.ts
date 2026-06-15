/**
 * Tests for computeStripSnapTargets — issue #110 (brick-laying snap).
 *
 * The helper extends the center-to-center snap (#105) with ±k·pitch
 * candidates so a dragged strip can lock onto the neighbor's LED grid.
 * These tests pin the math and the variance guard.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    computeStripSnapTargets,
    type SnapStripRef,
} from '../../src/shapeeditor/strip-snap-targets';

function near(actual: number, expected: number, eps = 1e-9): boolean {
    return Math.abs(actual - expected) < eps;
}

function includesNear(actuals: readonly number[], expected: number, eps = 1e-9): boolean {
    for (const a of actuals) if (near(a, expected, eps)) return true;
    return false;
}

describe('computeStripSnapTargets (issue #110)', () => {
    test('horizontal strip emits center + ±k·pitch on both axes', () => {
        // Strip A: 3 LEDs along x at y=0, spaced 10. Center = (10, 0).
        // Dragged strip is index 1 (single LED, off to the side).
        const strips: SnapStripRef[] = [
            { offset: 0, count: 3 },
            { offset: 3, count: 1 },
        ];
        const points: [number, number][] = [
            [0, 0], [10, 0], [20, 0],
            [999, 999],
        ];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, 1, points);

        // k=0 center, then k = ±1, ±2, ±3 at pitch=10.
        for (const k of [0, 1, -1, 2, -2, 3, -3]) {
            assert.ok(includesNear(xTargets, 10 + k * 10), `xTargets missing ${String(10 + k * 10)}: ${JSON.stringify(xTargets)}`);
            assert.ok(includesNear(yTargets, 0 + k * 10), `yTargets missing ${String(0 + k * 10)}: ${JSON.stringify(yTargets)}`);
        }
        assert.equal(xTargets.length, 7);
        assert.equal(yTargets.length, 7);
    });

    test('rotated 45° strip yields pitch = √2 · leg', () => {
        // 3 LEDs on the y=x diagonal, leg=5 ⇒ LED-to-LED dist = √50 ≈ 7.071.
        const strips: SnapStripRef[] = [{ offset: 0, count: 3 }];
        const points: [number, number][] = [[0, 0], [5, 5], [10, 10]];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, -1, points);

        const pitch = Math.sqrt(50);
        // center is (5, 5).
        for (const k of [0, 1, -1, 2, -2, 3, -3]) {
            assert.ok(includesNear(xTargets, 5 + k * pitch, 1e-9));
            assert.ok(includesNear(yTargets, 5 + k * pitch, 1e-9));
        }
    });

    test('singleton strip emits only k=0 (no pitch)', () => {
        const strips: SnapStripRef[] = [{ offset: 0, count: 1 }];
        const points: [number, number][] = [[3, 4]];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, -1, points);

        assert.deepEqual(xTargets, [3]);
        assert.deepEqual(yTargets, [4]);
    });

    test('variance guard: irregular strip drops the ±k·pitch extras', () => {
        // Distances [1, 99] — clearly not a uniform grid; only k=0 should
        // be emitted so we don't pollute the candidate set.
        const strips: SnapStripRef[] = [{ offset: 0, count: 3 }];
        const points: [number, number][] = [[0, 0], [1, 0], [100, 0]];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, -1, points);

        // center = ((0 + 1 + 100)/3, 0) = (101/3, 0).
        assert.equal(xTargets.length, 1);
        assert.equal(yTargets.length, 1);
        assert.ok(near(xTargets[0]!, 101 / 3));
        assert.ok(near(yTargets[0]!, 0));
    });

    test('dragged strip is excluded from targets', () => {
        // Two horizontal strips. If we drag strip 0, only strip 1
        // should contribute targets, and vice versa.
        const strips: SnapStripRef[] = [
            { offset: 0, count: 3 },   // center (10, 0), pitch 10
            { offset: 3, count: 3 },   // center (60, 50), pitch 10
        ];
        const points: [number, number][] = [
            [0, 0], [10, 0], [20, 0],
            [50, 50], [60, 50], [70, 50],
        ];

        const dragging0 = computeStripSnapTargets(strips, 0, points);
        assert.ok(includesNear(dragging0.xTargets, 60));   // strip 1's center
        assert.ok(!includesNear(dragging0.xTargets, 10));  // strip 0 must be skipped

        const dragging1 = computeStripSnapTargets(strips, 1, points);
        assert.ok(includesNear(dragging1.xTargets, 10));
        assert.ok(!includesNear(dragging1.xTargets, 60));
    });

    test('zero-count strip contributes nothing', () => {
        const strips: SnapStripRef[] = [
            { offset: 0, count: 0 },
            { offset: 0, count: 2 },
        ];
        const points: [number, number][] = [[0, 0], [4, 0]];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, -1, points);

        // Only strip 1 contributes: center (2, 0), pitch 4. 7 entries each.
        assert.equal(xTargets.length, 7);
        assert.equal(yTargets.length, 7);
        assert.ok(includesNear(xTargets, 2));
        assert.ok(includesNear(xTargets, 2 + 4));
        assert.ok(includesNear(xTargets, 2 - 4));
    });

    test('null points in the array are ignored', () => {
        // A null gap between two LEDs shouldn't produce a bogus huge distance.
        const strips: SnapStripRef[] = [{ offset: 0, count: 3 }];
        const points: ([number, number] | null)[] = [[0, 0], null, [10, 0]];
        const { xTargets, yTargets } = computeStripSnapTargets(strips, -1, points);

        // Two surviving points (0,0) and (10,0), so center=(5,0), pitch=10.
        assert.ok(includesNear(xTargets, 5));
        assert.ok(includesNear(xTargets, 5 + 10));
        assert.ok(includesNear(yTargets, 0));
        assert.ok(includesNear(yTargets, 10));
    });
});

describe('inter-strip grid pitch (issue #115)', () => {
    test('Red 1: 4-panel row infers pitch and snaps one panel beyond each end', () => {
        // 4 horizontal strips, 2 LEDs each, centered at x = 0, 10, 20, 30 on y=0.
        const strips: SnapStripRef[] = [
            { offset: 0, count: 2 }, { offset: 2, count: 2 },
            { offset: 4, count: 2 }, { offset: 6, count: 2 },
        ];
        const points: [number, number][] = [
            [-1, 0], [1, 0],
            [9, 0], [11, 0],
            [19, 0], [21, 0],
            [29, 0], [31, 0],
        ];
        const { xTargets } = computeStripSnapTargets(strips, -1, points, { x: 40, y: 0 });
        assert.ok(
            xTargets.some((v) => Math.abs(v - 40) < 1e-9),
            `expected 40, got ${JSON.stringify(xTargets)}`,
        );
        assert.ok(
            xTargets.some((v) => Math.abs(v + 10) < 1e-9),
            `expected -10, got ${JSON.stringify(xTargets)}`,
        );
    });

    test('Red 2: 5-panel row emits ±k targets two panels out', () => {
        // 5 strips at cx = 0, 10, 20, 30, 40. Inter-strip pitch = 10.
        // Expect 50 (k=1 past 40), 60 (k=2 past 40), -10 (k=1 below 0), -20 (k=2).
        const strips: SnapStripRef[] = Array.from(
            { length: 5 },
            (_, i) => ({ offset: i * 2, count: 2 }),
        );
        const points: [number, number][] = [];
        for (let i = 0; i < 5; i++) {
            points.push([i * 10 - 1, 0], [i * 10 + 1, 0]);
        }
        const { xTargets } = computeStripSnapTargets(strips, -1, points, { x: 50, y: 0 });
        for (const x of [50, 60, -10, -20]) {
            assert.ok(
                xTargets.some((v) => Math.abs(v - x) < 1e-9),
                `missing ${String(x)}: ${JSON.stringify(xTargets)}`,
            );
        }
    });

    test('Red 3: irregular spacing yields true-median pitch', () => {
        // 3 strips at cx = 0, 10, 25. Diffs = [10, 15]. True median = 12.5.
        // Expect a target at 25 + 12.5 = 37.5 OR 0 - 12.5 = -12.5.
        const strips: SnapStripRef[] = [
            { offset: 0, count: 2 }, { offset: 2, count: 2 }, { offset: 4, count: 2 },
        ];
        const points: [number, number][] = [
            [-1, 0], [1, 0],
            [9, 0], [11, 0],
            [24, 0], [26, 0],
        ];
        const { xTargets } = computeStripSnapTargets(strips, -1, points, { x: 35, y: 0 });
        assert.ok(
            xTargets.some((v) => Math.abs(v - 37.5) < 1e-6)
            || xTargets.some((v) => Math.abs(v + 12.5) < 1e-6),
            `expected 37.5 or -12.5, got ${JSON.stringify(xTargets)}`,
        );
    });

    test('Red 4: perpendicular band filter excludes far-axis strip from pitch inference', () => {
        // A=(0,0) B=(20,0) C=(10,100). Dragging near y=0 ⇒ pitch from {A,B} only.
        // Inter-strip X pitch = 20. Expect 40 (B + 20) in targets.
        // Without the band filter a buggy implementation would infer pitch=10
        // from {0, 10, 20} and yield x=30 (and miss x=40).
        const strips: SnapStripRef[] = [
            { offset: 0, count: 2 }, { offset: 2, count: 2 }, { offset: 4, count: 2 },
        ];
        const points: [number, number][] = [
            [-1, 0], [1, 0],
            [19, 0], [21, 0],
            [9, 100], [11, 100],
        ];
        const { xTargets } = computeStripSnapTargets(strips, -1, points, { x: 30, y: 0 });
        assert.ok(
            xTargets.some((v) => Math.abs(v - 40) < 1e-9),
            `expected 40 from {A,B} pitch=20, got ${JSON.stringify(xTargets)}`,
        );
    });
});
