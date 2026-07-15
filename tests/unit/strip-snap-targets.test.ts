import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    computeStripSnapGeometry,
    computeStripSnapTargets,
    inverseTransformSnapDelta,
    resolveStripDragSnap,
    transformPointForSnap,
    type SnapRulerRef,
    type SnapStripRef,
} from '../../src/shapeeditor/strip-snap-targets';

function includesNear(values: readonly number[], expected: number, eps = 1e-9): boolean {
    return values.some((value) => Math.abs(value - expected) < eps);
}

function targetValues(targets: ReturnType<typeof computeStripSnapTargets>, axis: 'x' | 'y'): number[] {
    return targets[axis].map((target) => target.value);
}

describe('strip snap geometry', () => {
    test('computes mean and world AABB while ignoring null points', () => {
        assert.deepEqual(
            computeStripSnapGeometry([[0, 5], null, [10, -5], undefined]),
            { centroid: { x: 5, y: 0 }, bounds: { minX: 0, maxX: 10, minY: -5, maxY: 5 } },
        );
        assert.equal(computeStripSnapGeometry([null, undefined]), null);
    });

    test('forward point transform and inverse delta transform round-trip', () => {
        const transform = { scaleX: 2, scaleY: 3, cos: 0, sin: 1, translateX: 10, translateY: -4 };
        assert.deepEqual(transformPointForSnap([2, 3], transform), [1, 0]);
        const local = inverseTransformSnapDelta({ x: 6, y: -4 }, transform);
        assert.ok(Math.abs(local.x + 2) < 1e-9);
        assert.ok(Math.abs(local.y + 2) < 1e-9);
    });
});

describe('typed legacy and advanced target generation', () => {
    test('preserves center and LED-pitch candidates', () => {
        const strips: SnapStripRef[] = [{ offset: 0, count: 3 }, { offset: 3, count: 1 }];
        const points: [number, number][] = [[0, 0], [10, 0], [20, 0], [999, 999]];
        const targets = computeStripSnapTargets({ strips, draggedIdx: 1, points });
        const xs = targetValues(targets, 'x');
        const ys = targetValues(targets, 'y');
        for (const k of [0, 1, -1, 2, -2, 3, -3]) {
            assert.ok(includesNear(xs, 10 + k * 10), `missing x=${String(10 + k * 10)}`);
            assert.ok(includesNear(ys, k * 10), `missing y=${String(k * 10)}`);
        }
        assert.equal(targets.x[0]!.kind, 'centroid');
        assert.equal(targets.x[0]?.sourceStripIdx, 0);
    });

    test('rotated strip keeps rendered LED pitch', () => {
        const targets = computeStripSnapTargets({
            strips: [{ offset: 0, count: 3 }], draggedIdx: -1,
            points: [[0, 0], [5, 5], [10, 10]],
        });
        const pitch = Math.sqrt(50);
        for (const k of [0, 1, -1, 2, -2, 3, -3]) {
            assert.ok(includesNear(targetValues(targets, 'x'), 5 + k * pitch));
            assert.ok(includesNear(targetValues(targets, 'y'), 5 + k * pitch));
        }
    });

    test('singleton and irregular strips emit no pitch extras', () => {
        const singleton = computeStripSnapTargets({
            strips: [{ offset: 0, count: 1 }], draggedIdx: -1, points: [[3, 4]],
        });
        assert.deepEqual(targetValues(singleton, 'x'), [3]);
        assert.deepEqual(targetValues(singleton, 'y'), [4]);
        const irregular = computeStripSnapTargets({
            strips: [{ offset: 0, count: 3 }], draggedIdx: -1,
            points: [[0, 0], [1, 0], [100, 0]],
        });
        assert.ok(includesNear(targetValues(irregular, 'x'), 101 / 3));
    });

    test('excludes dragged and zero-count strips', () => {
        const strips = [{ offset: 0, count: 3 }, { offset: 3, count: 3 }, { offset: 6, count: 0 }];
        const points: [number, number][] = [[0, 0], [10, 0], [20, 0], [50, 50], [60, 50], [70, 50]];
        const targets = computeStripSnapTargets({ strips, draggedIdx: 0, points });
        assert.ok(targetValues(targets, 'x').includes(60));
        assert.ok(!targetValues(targets, 'x').includes(10));
    });

    test('excludes every selected group from aggregate snapping', () => {
        const strips = [{ offset: 0, count: 1 }, { offset: 1, count: 1 }, { offset: 2, count: 1 }];
        const targets = computeStripSnapTargets({
            strips,
            excludedStripIdxs: new Set([0, 1]),
            points: [[0, 0], [10, 0], [50, 0]],
        });
        assert.ok(targetValues(targets, 'x').includes(50));
        assert.ok(!targetValues(targets, 'x').includes(0));
        assert.ok(!targetValues(targets, 'x').includes(10));
    });

    test('infers inter-strip pitch and preserves band filtering', () => {
        const strips: SnapStripRef[] = [
            { offset: 0, count: 2 }, { offset: 2, count: 2 },
            { offset: 4, count: 2 }, { offset: 6, count: 2 },
        ];
        const points: [number, number][] = [
            [-1, 0], [1, 0], [9, 0], [11, 0], [19, 0], [21, 0], [29, 0], [31, 0],
        ];
        const targets = computeStripSnapTargets({
            strips, draggedIdx: -1, points, toleranceWorld: 1,
        });
        assert.ok(includesNear(targetValues(targets, 'x'), 40));
        assert.ok(includesNear(targetValues(targets, 'x'), -10));
    });

    test('adds AABB edge targets and rotated world bounds', () => {
        const targets = computeStripSnapTargets({
            strips: [{ offset: 0, count: 4 }, { offset: 4, count: 2 }], draggedIdx: 1,
            points: [[-2, -1], [2, -1], [2, 1], [-2, 1], [20, 20], [21, 21]],
        });
        const edgeTargets = targets.x.filter((target) => target.kind === 'bbox-edge');
        assert.deepEqual(edgeTargets.map((target) => target.value), [-2, 2]);
        assert.deepEqual(edgeTargets[0]?.anchors, ['min', 'max']);

        const rotated = computeStripSnapTargets({
            strips: [{ offset: 0, count: 4 }, { offset: 4, count: 1 }], draggedIdx: 1,
            points: [[-1, -2], [2, 1], [1, 3], [-2, 0], [20, 20]],
        });
        assert.ok(includesNear(targetValues(rotated, 'x'), -2));
        assert.ok(includesNear(targetValues(rotated, 'x'), 2));
        assert.ok(includesNear(targetValues(rotated, 'y'), -2));
        assert.ok(includesNear(targetValues(rotated, 'y'), 3));
    });

    test('creates median row/column clusters without transitive chaining', () => {
        const targets = computeStripSnapTargets({
            strips: [{ offset: 0, count: 1 }, { offset: 1, count: 1 }, { offset: 2, count: 1 }, { offset: 3, count: 1 }],
            draggedIdx: 3,
            points: [[0, 0], [10, 0.4], [20, 100], [30, 30]],
            toleranceWorld: 0.5,
        });
        const row = targets.y.find((target) => target.kind === 'row');
        assert.ok(row);
        assert.ok(Math.abs(row.value - 0.2) < 1e-9);
        assert.deepEqual(row.supportStripIdxs, [0, 1]);
        assert.equal(targets.x.some((target) => target.kind === 'column'), false);
    });

    test('adds endpoint and finite ruler-body targets', () => {
        const rulers: SnapRulerRef[] = [
            { ax: 0, ay: 0, bx: 10, by: 0 },
            { ax: 5, ay: 5, bx: 5, by: 5 },
        ];
        const targets = computeStripSnapTargets({
            strips: [{ offset: 0, count: 1 }], draggedIdx: -1, points: [[20, 20]], rulers,
        });
        assert.equal(targets.rulerBodies.length, 1);
        assert.equal(targets.rulerBodies[0]?.sourceRulerIdx, 0);
        assert.equal(targets.x.filter((target) => target.kind === 'ruler-endpoint').length, 3);
    });

    test('deduplicates coordinates while retaining source kinds and legacy order', () => {
        const targets = computeStripSnapTargets({
            strips: [{ offset: 0, count: 1 }, { offset: 1, count: 1 }], draggedIdx: 1,
            points: [[0, 0], [10, 10]], rulers: [{ ax: 0, ay: 5, bx: 2, by: 5 }],
        });
        const zero = targets.x.find((target) => Math.abs(target.value) < 1e-9);
        assert.ok(zero);
        assert.equal(zero.kind, 'centroid');
        assert.ok(zero.sourceKinds?.includes('ruler-endpoint'));
    });
});

describe('strip snap resolver', () => {
    const geometry = computeStripSnapGeometry([[20, 20], [30, 30]])!;
    const axisTargets = computeStripSnapTargets({
        strips: [{ offset: 0, count: 2 }, { offset: 2, count: 2 }], draggedIdx: 0,
        points: [[20, 20], [30, 30], [0, 0], [10, 10]],
    });

    test('snaps a dragged edge to an opposite reference edge', () => {
        const result = resolveStripDragSnap({
            cursorDxPx: 9, cursorDyPx: 0, rawDx: -9, rawDy: 0,
            startGeometry: geometry,
            targets: {
                x: [{ id: 1, axis: 'x', value: 10, kind: 'bbox-edge', anchors: ['min', 'max'], order: 0 }],
                y: [], rulerBodies: [],
            },
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.equal(result.dx, -10);
        assert.deepEqual(result.engagement, { mode: 'axis', x: { targetId: 1, anchor: 'min' }, y: null });
    });

    test('allows both axes to engage and preserves origin priority', () => {
        const both = resolveStripDragSnap({
            cursorDxPx: 9, cursorDyPx: 9, rawDx: -9, rawDy: -9,
            startGeometry: geometry,
            targets: {
                x: [{ id: 1, axis: 'x', value: 10, kind: 'bbox-edge', anchors: ['min'], order: 0 }],
                y: [{ id: 2, axis: 'y', value: 10, kind: 'bbox-edge', anchors: ['min'], order: 1 }], rulerBodies: [],
            },
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.equal(both.dx, -10);
        assert.equal(both.dy, -10);
        const origin = resolveStripDragSnap({
            cursorDxPx: 1, cursorDyPx: 1, rawDx: 10, rawDy: 10,
            startGeometry: geometry, targets: axisTargets, camZoom: 1, tolerancePx: 2,
            snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(origin, { dx: 0, dy: 0, engagement: { mode: 'origin' } });
    });

    test('Shift and disabled settings bypass every target', () => {
        const input = {
            cursorDxPx: 9, cursorDyPx: 0, rawDx: -9, rawDy: 0,
            startGeometry: geometry, targets: axisTargets, camZoom: 1, tolerancePx: 2,
            snapEnabled: true, shiftBypass: true,
        };
        assert.deepEqual(resolveStripDragSnap(input), { dx: -9, dy: 0, engagement: { mode: 'none' } });
        assert.deepEqual(resolveStripDragSnap({ ...input, shiftBypass: false, snapEnabled: false }), {
            dx: -9, dy: 0, engagement: { mode: 'none' },
        });
    });

    test('projects to horizontal and diagonal finite ruler bodies', () => {
        const bodyTargets = {
            x: [], y: [],
            rulerBodies: [{ id: 7, kind: 'ruler-body' as const, sourceRulerIdx: 3, ax: 0, ay: 0, bx: 10, by: 0, order: 0 }],
        };
        const horizontal = resolveStripDragSnap({
            cursorDxPx: -15, cursorDyPx: -19, rawDx: -15, rawDy: -19,
            startGeometry: computeStripSnapGeometry([[15, 20]])!, targets: bodyTargets,
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(horizontal.engagement, { mode: 'ruler-body', targetId: 7, sourceRulerIdx: 3 });
        assert.equal(horizontal.dx, -15);
        assert.equal(horizontal.dy, -20);

        const diagonal = resolveStripDragSnap({
            cursorDxPx: -4, cursorDyPx: -6, rawDx: -4, rawDy: -6,
            startGeometry: computeStripSnapGeometry([[5, 5]])!,
            targets: { x: [], y: [], rulerBodies: [{ id: 8, kind: 'ruler-body', sourceRulerIdx: 1, ax: 0, ay: 0, bx: 10, by: 10, order: 0 }] },
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(diagonal.engagement, { mode: 'ruler-body', targetId: 8, sourceRulerIdx: 1 });
        assert.equal(diagonal.dx, -5);
        assert.equal(diagonal.dy, -5);
    });

    test('axis proposal wins exact ruler score ties', () => {
        const result = resolveStripDragSnap({
            cursorDxPx: 9, cursorDyPx: 0, rawDx: -9, rawDy: 0,
            startGeometry: computeStripSnapGeometry([[10, 0]])!,
            targets: {
                x: [{ id: 2, axis: 'x', value: 0, kind: 'centroid', anchors: ['centroid'], order: 0 }], y: [],
                rulerBodies: [{ id: 3, kind: 'ruler-body', sourceRulerIdx: 0, ax: 0, ay: -1, bx: 0, by: 1, order: 1 }],
            },
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.equal(result.engagement.mode, 'axis');
    });
});
