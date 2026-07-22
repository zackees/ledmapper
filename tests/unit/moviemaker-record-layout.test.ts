import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { polygonCentroid, polylineMidpoint, prepareRecordLayout } from '../../src/moviemaker/record-layout';

const hydropack = JSON.stringify({
    version: 2,
    groups: {
        panels: { color: '#3b82f6' },
        center: { color: '#3b82f6' },
    },
    segments: [
        { id: 'left', type: 'el_panel', pin: 'pin1', group: 'panels', x: [-5, -2, -2], y: [0, -1.5, 1.5] },
        { id: 'center', type: 'el_panel', pin: 'pin2', group: 'center', x: [-0.5, 0.5, 0.5, -0.5], y: [-3, -3, 3, 3] },
        { id: 'right', type: 'el_panel', pin: 'pin3', group: 'panels', x: [5, 2, 2], y: [0, 1.5, -1.5] },
    ],
});

describe('moviemaker record layout', () => {
    test('uses polygon centroid anchors for HydroPack', () => {
        const layout = prepareRecordLayout(hydropack, 640, 480);
        assert.equal(layout.channelCount, 3);
        assert.equal(layout.ledCount, 0);
        assert.equal(layout.shapeCount, 3);
        assert.deepEqual(layout.samplePoints.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), [[-180, 0], [0, 0], [180, 0]]);
    });

    test('uses area centroid and arc-length midpoint helpers', () => {
        assert.deepEqual(polygonCentroid([[-5, 0], [-2, -1.5], [-2, 1.5]]), [-3, 0]);
        assert.deepEqual(polylineMidpoint([[0, 0], [1, 0], [11, 0]]), [5.5, 0]);
    });

    test('keeps mixed LED/EL channel offsets separate from visible LED points', () => {
        const mixed = JSON.stringify({
            version: 2,
            groups: { el: { color: '#fff' }, leds: { color: '#fff' } },
            segments: [
                { id: 'panel', type: 'el_panel', pin: 'p1', group: 'el', x: [-2, 0, 0], y: [0, -1, 1] },
                { id: 'leds', pin: 'p2', group: 'leds', x: [2, 3], y: [0, 0] },
            ],
        });
        const layout = prepareRecordLayout(mixed, 640, 480);
        assert.equal(layout.channelCount, 3);
        assert.deepEqual(layout.ledPointChannelOffsets, [1, 2]);
        assert.equal(layout.shapes[0]?.offset, 0);
        assert.equal(layout.samplePoints.length, 3);
    });
});
