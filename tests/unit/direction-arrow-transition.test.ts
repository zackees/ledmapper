import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DirectionArrowTransition,
    type DirectionArrowAnchor,
} from '../../src/shapeeditor/direction-arrow-transition';

function anchors(count: number): DirectionArrowAnchor[] {
    return Array.from({ length: count }, (_, index) => ({
        stripIndex: 0,
        segmentIndex: index,
        fraction: 0.5,
    }));
}

test('holds the committed density until 250ms after the last zoom update', () => {
    const transition = new DirectionArrowTransition({ settleMs: 250, fadeMs: 200 });
    transition.update(anchors(2), 0);

    transition.noteZoom(10);
    assert.deepEqual(transition.update(anchors(4), 259), [
        { anchors: anchors(2), opacity: 1 },
    ]);

    transition.noteZoom(200);
    assert.deepEqual(transition.update(anchors(4), 449), [
        { anchors: anchors(2), opacity: 1 },
    ]);
    assert.equal(transition.getPhase(), 'settling');
});

test('crossfades old and new densities over 200ms without a blank frame', () => {
    const transition = new DirectionArrowTransition({ settleMs: 250, fadeMs: 200 });
    transition.update(anchors(2), 0);
    transition.noteZoom(10);

    assert.deepEqual(transition.update(anchors(4), 260), [
        { anchors: anchors(2), opacity: 1 },
        { anchors: anchors(4), opacity: 0 },
    ]);
    assert.equal(transition.getPhase(), 'crossfading');

    const halfway = transition.update(anchors(4), 360);
    assert.deepEqual(halfway, [
        { anchors: anchors(2), opacity: 0.5 },
        { anchors: anchors(4), opacity: 0.5 },
    ]);
    assert.equal(halfway.reduce((sum, layer) => sum + layer.opacity, 0), 1);

    assert.deepEqual(transition.update(anchors(4), 460), [
        { anchors: anchors(4), opacity: 1 },
    ]);
    assert.equal(transition.getPhase(), 'idle');
});

test('zoom resuming during a crossfade freezes the current blend without popping', () => {
    const transition = new DirectionArrowTransition({ settleMs: 250, fadeMs: 200 });
    transition.update(anchors(2), 0);
    transition.noteZoom(0);
    transition.update(anchors(4), 250);

    const beforeInterrupt = transition.update(anchors(4), 330);
    transition.noteZoom(330);
    const afterInterrupt = transition.update(anchors(6), 331);

    assert.deepEqual(afterInterrupt, beforeInterrupt);
    assert.equal(transition.getPhase(), 'settling');
    assert.equal(afterInterrupt.reduce((sum, layer) => sum + layer.opacity, 0), 1);

    const restarted = transition.update(anchors(6), 580);
    assert.deepEqual(restarted, [
        ...beforeInterrupt,
        { anchors: anchors(6), opacity: 0 },
    ]);
});

test('does not crossfade when zoom settles without a density change', () => {
    const transition = new DirectionArrowTransition({ settleMs: 250, fadeMs: 200 });
    transition.update(anchors(3), 0);
    transition.noteZoom(0);

    assert.deepEqual(transition.update(anchors(3), 250), [
        { anchors: anchors(3), opacity: 1 },
    ]);
    assert.equal(transition.getPhase(), 'idle');
});

test('non-zoom layout changes still apply immediately', () => {
    const transition = new DirectionArrowTransition({ settleMs: 250, fadeMs: 200 });
    transition.update(anchors(2), 0);

    assert.deepEqual(transition.update(anchors(5), 10), [
        { anchors: anchors(5), opacity: 1 },
    ]);
    assert.equal(transition.getPhase(), 'idle');
});
