import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeScreenmap } from '../../src/gfx/screenmap';

const SIMPLE_MAP = {
    map: {
        strip1: { x: [0, 1, 2], y: [0, 0, 0], diameter: 0.25 },
    },
};

test('normalizeScreenmap: accepts a v1 JSON object', () => {
    const sm = normalizeScreenmap(SIMPLE_MAP, 800);
    assert.equal(sm.points.length, 3);
    assert.equal(sm.diameter, 0.25);
});

test('normalizeScreenmap: accepts a JSON string', () => {
    const sm = normalizeScreenmap(JSON.stringify(SIMPLE_MAP), 800);
    assert.equal(sm.points.length, 3);
});

test('normalizeScreenmap: passthrough for an already-normalized shape', () => {
    const pre = {
        points: [[10, 20] as const, [30, 40] as const],
        strips: [{ name: 'a', offset: 0, count: 2 }],
    };
    const sm = normalizeScreenmap(pre, 800);
    assert.equal(sm, pre);
});

test('normalizeScreenmap: strips metadata is preserved', () => {
    const multi = {
        map: {
            a: { x: [0, 1], y: [0, 0] },
            b: { x: [2, 3], y: [1, 1] },
        },
    };
    const sm = normalizeScreenmap(multi, 800);
    assert.equal(sm.points.length, 4);
    assert.equal(sm.strips?.length, 2);
});

test('normalizeScreenmap: throws on a screenmap with zero points', () => {
    assert.throws(() => normalizeScreenmap({ map: {} }, 800));
});

test('normalizeScreenmap: points are fit-and-centered into the pane', () => {
    const sm = normalizeScreenmap(SIMPLE_MAP, 800);
    // After centerAndFitPoints, all points lie inside [0, 800] on both axes.
    for (const [x, y] of sm.points) {
        assert.ok(x >= 0 && x <= 800, `x=${String(x)} out of pane`);
        assert.ok(y >= 0 && y <= 800, `y=${String(y)} out of pane`);
    }
});

test('normalizeScreenmap: preserves EL panels and wire as shapes/channels', () => {
    const map = {
        version: 2,
        groups: { left: { color: '#f00' }, center: { color: '#0f0' }, right: { color: '#00f' } },
        segments: [
            { id: 'left', type: 'el_panel', pin: 'p1', group: 'left', electrical_group: 'paired-panels', x: [-20, -40, -40], y: [0, -20, 20] },
            { id: 'center', type: 'el_wire', pin: 'p2', group: 'center', x: [-10, 10], y: [0, 0], thickness: 5 },
            { id: 'right', type: 'el_panel', pin: 'p3', group: 'right', electrical_group: 'paired-panels', x: [20, 40, 40], y: [0, -20, 20] },
        ],
    };
    const sm = normalizeScreenmap(map, 800);
    assert.equal(sm.points.length, 0);
    assert.equal(sm.channelCount, 3);
    assert.equal(sm.shapes?.length, 3);
    assert.equal(sm.shapes[0]?.electricalGroup, 'paired-panels');
    assert.equal(sm.shapes[2]?.electricalGroup, 'paired-panels');
    assert.ok((sm.shapes[1]?.thickness ?? 0) > 5);
});
