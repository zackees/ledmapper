import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateSelectionObb, flatPointIndicesForStrips, normalizeStripIdxs, stripIntersectsCanvasRect, stripsIntersectingCanvasRect } from '../../src/shapeeditor/group-selection';
const strips = [{ offset: 0, count: 2 }, { offset: 2, count: 2 }, { offset: 4, count: 1 }, { offset: 5, count: 0 }];
const points: [number, number][] = [[0, 0], [10, 10], [20, 0], [30, 0], [100, 100]];
test('normalizes group indices and expands only valid selected strips', () => {
    assert.deepEqual(normalizeStripIdxs([2, 0, 2, -1, 99], strips.length), [0, 2]);
    assert.deepEqual(flatPointIndicesForStrips(strips, [2, 0, 2, -1]), [0, 1, 4]);
});
test('marquee accepts centers and boundaries irrespective of direction', () => {
    assert.equal(stripIntersectsCanvasRect(strips[0]!, points, 0, 0, 0, 0), true);
    assert.deepEqual(stripsIntersectingCanvasRect(strips, points, 11, 11, -1, -1), [0]);
});
test('marquee selects a sparse diagonal when only its wire crosses', () => {
    assert.equal(stripIntersectsCanvasRect(strips[0]!, points, 4, 5, 6, 5), true);
    assert.equal(stripIntersectsCanvasRect(strips[1]!, points, 24, 3, 26, 5), false);
});
test('does not create cross-strip wires and ignores empty strips', () => {
    assert.equal(stripIntersectsCanvasRect({ offset: 0, count: 1 }, points, 5, -1, 6, 1), false);
    assert.equal(stripIntersectsCanvasRect(strips[3]!, points, -10, -10, 200, 200), false);
});
test('aggregate OBB includes only selected groups', () => {
    const obb = aggregateSelectionObb(strips, points, [0, 1]);
    assert.ok(obb && obb.cx >= 14 && obb.cx <= 16);
    assert.equal(aggregateSelectionObb(strips, points, []), null);
});
