import assert from 'node:assert/strict';
import test from 'node:test';
import {
    computeDirectionArrowPlacements,
    directionArrowAnchorsFromPlacements,
    projectDirectionArrowAnchors,
} from '../../src/shapeeditor/direction-arrows';

test('places arrows at even screen-space intervals near the target density', () => {
    const arrows = computeDirectionArrowPlacements([[0, 0], [450, 0]], [{ offset: 0, count: 2 }]);
    assert.equal(arrows.length, 2);
    assert.deepEqual(arrows.map((arrow) => arrow.x), [112.5, 337.5]);
    assert.ok(arrows.every((arrow) => arrow.angle === 0));
});

test('keeps the confirmed 225px gap on non-multiple path lengths', () => {
    const arrows = computeDirectionArrowPlacements([[0, 0], [550, 0]], [{ offset: 0, count: 2 }]);
    assert.deepEqual(arrows.map((arrow) => arrow.x), [162.5, 387.5]);
    assert.equal((arrows[1]?.x ?? 0) - (arrows[0]?.x ?? 0), 225);
});

test('zooming the same path in produces more arrows', () => {
    const normal = computeDirectionArrowPlacements([[0, 0], [450, 0]], [{ offset: 0, count: 2 }]);
    const zoomed = computeDirectionArrowPlacements([[0, 0], [900, 0]], [{ offset: 0, count: 2 }]);
    assert.equal(normal.length, 2);
    assert.equal(zoomed.length, 4);
});

test('resets density at strip boundaries and never bridges their gap', () => {
    const arrows = computeDirectionArrowPlacements(
        [[0, 0], [100, 0], [1000, 0], [1100, 0]],
        [{ offset: 0, count: 2 }, { offset: 2, count: 2 }],
    );
    assert.equal(arrows.length, 2);
    assert.deepEqual(arrows.map((arrow) => [arrow.x, arrow.stripIndex]), [[50, 0], [1050, 1]]);
});

test('gives a short eligible strip one centered arrow', () => {
    const arrows = computeDirectionArrowPlacements([[10, 20], [40, 20]], [{ offset: 0, count: 2 }]);
    assert.deepEqual(arrows.map((arrow) => [arrow.x, arrow.y]), [[25, 20]]);
});

test('accumulates distance across segments', () => {
    const arrows = computeDirectionArrowPlacements(
        [[0, 0], [100, 0], [100, 350]],
        [{ offset: 0, count: 3 }],
    );
    assert.equal(arrows.length, 2);
    assert.deepEqual(arrows.map((arrow) => [arrow.x, arrow.y]), [[100, 12.5], [100, 237.5]]);
});

test('ignores empty, singleton, and fully degenerate strips', () => {
    const arrows = computeDirectionArrowPlacements(
        [[0, 0], [0, 0], [10, 10]],
        [{ offset: 0, count: 0 }, { offset: 0, count: 1 }, { offset: 0, count: 2 }],
    );
    assert.deepEqual(arrows, []);
});

test('reprojects frozen anchors onto the current zoomed path', () => {
    const initial = computeDirectionArrowPlacements(
        [[0, 0], [450, 0]],
        [{ offset: 0, count: 2 }],
    );
    const anchors = directionArrowAnchorsFromPlacements(initial);
    const zoomed = projectDirectionArrowAnchors([[0, 0], [900, 0]], anchors);

    assert.equal(zoomed.length, initial.length);
    assert.deepEqual(zoomed.map((arrow) => arrow.x), [225, 675]);
    assert.deepEqual(zoomed.map((arrow) => arrow.segmentIndex), [0, 0]);
});
