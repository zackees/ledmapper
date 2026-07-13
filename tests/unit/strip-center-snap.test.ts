/** Regression coverage for the production strip-drag resolver (#105). */
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    computeStripSnapGeometry,
    resolveStripDragSnap,
    type StripSnapTargetSet,
} from '../../src/shapeeditor/strip-snap-targets';

const emptyTargets: StripSnapTargetSet = { x: [], y: [], rulerBodies: [] };

describe('strip center snap resolver', () => {
    test('returns the closest target within tolerance', () => {
        const result = resolveStripDragSnap({
            cursorDxPx: 1, cursorDyPx: 50, rawDx: 1, rawDy: 50,
            startGeometry: computeStripSnapGeometry([[0, 0]])!,
            targets: {
                x: [{ id: 1, axis: 'x', value: 0, kind: 'centroid', anchors: ['centroid'], order: 0 }],
                y: [], rulerBodies: [],
            },
            camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.equal(result.dx, 0);
        assert.deepEqual(result.engagement, { mode: 'axis', x: { targetId: 1, anchor: 'centroid' }, y: null });
    });

    test('does not snap outside tolerance and supports both axes', () => {
        const none = resolveStripDragSnap({
            cursorDxPx: 5, cursorDyPx: 0, rawDx: 5, rawDy: 0,
            startGeometry: computeStripSnapGeometry([[0, 0]])!, targets: {
                x: [{ id: 1, axis: 'x', value: 0, kind: 'centroid', anchors: ['centroid'], order: 0 }],
                y: [], rulerBodies: [],
            }, camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(none, { dx: 5, dy: 0, engagement: { mode: 'none' } });
        const both = resolveStripDragSnap({
            cursorDxPx: 9, cursorDyPx: 9, rawDx: 9, rawDy: 9,
            startGeometry: computeStripSnapGeometry([[0, 0]])!, targets: {
                x: [{ id: 1, axis: 'x', value: 10, kind: 'centroid', anchors: ['centroid'], order: 0 }],
                y: [{ id: 2, axis: 'y', value: 10, kind: 'centroid', anchors: ['centroid'], order: 1 }], rulerBodies: [],
            }, camZoom: 1, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(both.engagement, {
            mode: 'axis', x: { targetId: 1, anchor: 'centroid' }, y: { targetId: 2, anchor: 'centroid' },
        });
    });

    test('origin snap remains exact and highest priority', () => {
        const result = resolveStripDragSnap({
            cursorDxPx: 1, cursorDyPx: 1, rawDx: 100, rawDy: 100,
            startGeometry: computeStripSnapGeometry([[0, 0]])!, targets: emptyTargets,
            camZoom: 4, tolerancePx: 2, snapEnabled: true, shiftBypass: false,
        });
        assert.deepEqual(result, { dx: 0, dy: 0, engagement: { mode: 'origin' } });
    });
});
