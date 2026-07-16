import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    detectScreenmapVersion,
    parseScreenmapV2,
    v2ToMultiStripResult,
    resolveForkOffset,
} from '../../src/screenmap-v2';
import { parseScreenmapMultiStrip } from '../../src/common';

const V1_SAMPLE = {
    map: {
        strip1: { x: [0, 1, 2], y: [0, 0, 0], diameter: 0.25 },
        strip2: { x: [5, 6], y: [10, 10] },
    },
};

const V2_SAMPLE = {
    version: 2,
    groups: {
        trunk: { color: '#ffffff' },
        branch: { color: '#ff0000' },
    },
    segments: [
        { id: 'a', pin: 1, group: 'trunk', x: [0, 1, 2, 3, 4], y: [0, 0, 0, 0, 0] },
        {
            id: 'b',
            pin: 2,
            group: 'branch',
            parent: 'a',
            offset: 2,
            x: [2, 2, 2],
            y: [0, 1, 2],
        },
    ],
};

describe('detectScreenmapVersion', () => {
    test('explicit version: 2 → 2', () => {
        assert.equal(detectScreenmapVersion({ version: 2, segments: [] }), 2);
    });

    test('explicit version: 1 → 1', () => {
        assert.equal(detectScreenmapVersion({ version: 1, map: {} }), 1);
    });

    test('auto-detect v2 via top-level segments[]', () => {
        assert.equal(detectScreenmapVersion({ segments: [] }), 2);
    });

    test('auto-detect v1 via top-level map{}', () => {
        assert.equal(detectScreenmapVersion({ map: {} }), 1);
    });

    test('explicit version takes priority over shape', () => {
        // Hostile but valid: explicit v1 wins even if segments[] is also present.
        assert.equal(detectScreenmapVersion({ version: 1, map: {}, segments: [] }), 1);
    });

    test('throws on unrecognized shape', () => {
        assert.throws(() => detectScreenmapVersion({}));
        assert.throws(() => detectScreenmapVersion(null));
        assert.throws(() => detectScreenmapVersion('string'));
    });
});

describe('parseScreenmapV2', () => {
    test('parses the canonical worked example', () => {
        const out = parseScreenmapV2(JSON.stringify(V2_SAMPLE));
        assert.equal(out.version, 2);
        assert.equal(out.segments.length, 2);
        assert.equal(out.segments[0]!.id, 'a');
        assert.equal(out.segments[1]!.parent, 'a');
        assert.equal(out.segments[1]!.offset, 2);
        assert.equal(out.groups.trunk!.color, '#ffffff');
        assert.equal(out.groups.branch!.color, '#ff0000');
    });

    test('accepts an object directly (not just a string)', () => {
        const out = parseScreenmapV2(V2_SAMPLE);
        assert.equal(out.segments.length, 2);
    });

    test('omitting version still works (auto-detect via segments)', () => {
        const { version: _v, ...rest } = V2_SAMPLE;
        const out = parseScreenmapV2(rest);
        assert.equal(out.version, undefined);
        assert.equal(out.segments.length, 2);
    });

    test('accepts optional z[] when matching x/y length', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [
                { id: 's', pin: 1, group: 'g', x: [0, 1], y: [0, 1], z: [0, 1] },
            ],
        };
        const out = parseScreenmapV2(doc);
        assert.deepEqual(out.segments[0]!.z, [0, 1]);
    });

    test('offset can be null (explicit) — meaning tip', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [
                { id: 'a', pin: 1, group: 'g', x: [0, 1, 2], y: [0, 0, 0] },
                { id: 'b', pin: 1, group: 'g', parent: 'a', offset: null, x: [2], y: [1] },
            ],
        };
        const out = parseScreenmapV2(doc);
        assert.equal(out.segments[1]!.offset, null);
    });

    test('rejects wrong explicit version', () => {
        assert.throws(() => parseScreenmapV2({ version: 1, map: {} }), /version=1/);
    });

    test('rejects missing segments[]', () => {
        assert.throws(() => parseScreenmapV2({ groups: {} }), /segments/);
    });

    test('rejects unknown group reference', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [{ id: 's', pin: 1, group: 'nope', x: [0], y: [0] }],
        };
        assert.throws(() => parseScreenmapV2(doc), /unknown group/);
    });

    test('rejects fork pointing at unknown parent', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [
                { id: 'a', pin: 1, group: 'g', x: [0], y: [0] },
                { id: 'b', pin: 1, group: 'g', parent: 'ghost', x: [0], y: [0] },
            ],
        };
        assert.throws(() => parseScreenmapV2(doc), /unknown parent/);
    });

    test('rejects offset out of range', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [
                { id: 'a', pin: 1, group: 'g', x: [0, 1, 2], y: [0, 0, 0] },
                { id: 'b', pin: 1, group: 'g', parent: 'a', offset: 99, x: [0], y: [0] },
            ],
        };
        assert.throws(() => parseScreenmapV2(doc), /out of range/);
    });

    test('rejects mismatched x/y length', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [{ id: 's', pin: 1, group: 'g', x: [0, 1], y: [0] }],
        };
        assert.throws(() => parseScreenmapV2(doc), /mismatched x\/y/);
    });

    test('rejects z[] length mismatch', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [{ id: 's', pin: 1, group: 'g', x: [0, 1], y: [0, 1], z: [0] }],
        };
        assert.throws(() => parseScreenmapV2(doc), /'z' length/);
    });
});

describe('resolveForkOffset', () => {
    test('null/undefined → tip (length - 1)', () => {
        assert.equal(resolveForkOffset(null, 5), 4);
        assert.equal(resolveForkOffset(undefined, 5), 4);
    });

    test('non-negative is forward index', () => {
        assert.equal(resolveForkOffset(0, 5), 0);
        assert.equal(resolveForkOffset(2, 5), 2);
        assert.equal(resolveForkOffset(4, 5), 4);
    });

    test('negative is N before the tip (per #91 rule)', () => {
        assert.equal(resolveForkOffset(-1, 5), 3); // penultimate
        assert.equal(resolveForkOffset(-2, 5), 2);
    });
});

describe('v2ToMultiStripResult', () => {
    test('converts v2 segments into ParsedStrip[] keyed by id', () => {
        const v2 = parseScreenmapV2(V2_SAMPLE);
        const result = v2ToMultiStripResult(v2);
        assert.equal(result.strips.length, 2);
        assert.equal(result.strips[0]!.name, 'a');
        assert.equal(result.strips[0]!.count, 5);
        assert.equal(result.strips[0]!.offset, 0);
        assert.equal(result.strips[1]!.name, 'b');
        assert.equal(result.strips[1]!.count, 3);
        assert.equal(result.strips[1]!.offset, 5);
        assert.equal(result.totalCount, 8);
    });

    test('pin string roundtrips through ParsedStrip.pin', () => {
        const doc = {
            version: 2,
            groups: { g: { color: '#fff' } },
            segments: [{ id: 's', pin: 'pin1', group: 'g', x: [0], y: [0] }],
        };
        const result = v2ToMultiStripResult(parseScreenmapV2(doc));
        assert.equal(result.strips[0]!.pin, 'pin1');
    });

    test('numeric pin stringifies', () => {
        const result = v2ToMultiStripResult(parseScreenmapV2(V2_SAMPLE));
        assert.equal(result.strips[0]!.pin, '1');
        assert.equal(result.strips[1]!.pin, '2');
    });
});

describe('EL geometry segments', () => {
    const fixture = {
        version: 2 as const,
        groups: {
            left: { color: '#f00' }, center: { color: '#0f0' }, right: { color: '#00f' },
        },
        segments: [
            { id: 'left', type: 'el_panel' as const, pin: 'p1', group: 'left', x: [-20, -40, -40], y: [0, -20, 20] },
            { id: 'center', type: 'el_wire' as const, pin: 'p2', group: 'center', x: [-10, 10], y: [0, 0], thickness: 5 },
            { id: 'right', type: 'el_panel' as const, pin: 'p3', group: 'right', x: [20, 40, 40], y: [0, -20, 20] },
        ],
    };

    test('preserves geometry and counts one channel per shape', () => {
        const parsed = parseScreenmapV2(fixture);
        assert.equal(parsed.segments[0]?.type, 'el_panel');
        assert.equal(parsed.segments[1]?.thickness, 5);
        const result = v2ToMultiStripResult(parsed);
        assert.deepEqual(result.allPoints, []);
        assert.equal(result.totalCount, 3);
        assert.deepEqual(result.strips.map((s) => [s.type, s.count, s.vertices?.length]), [
            ['el_panel', 1, 3], ['el_wire', 1, 2], ['el_panel', 1, 3],
        ]);
    });

    test('rejects invalid EL geometry', () => {
        assert.throws(() => parseScreenmapV2({ ...fixture, segments: [{ ...fixture.segments[1], thickness: 0 }] }), /positive finite/);
        assert.throws(() => parseScreenmapV2({ ...fixture, segments: [{ ...fixture.segments[0], x: [1, 2] }] }), /mismatched|at least 3 vertices/);
        assert.throws(() => parseScreenmapV2({ ...fixture, segments: [{ ...fixture.segments[1], type: 'unknown' }] }), /unsupported type/);
    });
});

describe('parseScreenmapMultiStrip dispatcher', () => {
    test('v1 file still parses through the legacy path', () => {
        const result = parseScreenmapMultiStrip(V1_SAMPLE);
        assert.equal(result.strips.length, 2);
        assert.equal(result.strips[0]!.name, 'strip1');
        assert.equal(result.strips[0]!.count, 3);
        assert.equal(result.strips[0]!.diameter, 0.25);
    });

    test('v2 file is auto-detected and adapted to MultiStripParseResult', () => {
        const result = parseScreenmapMultiStrip(V2_SAMPLE);
        assert.equal(result.strips.length, 2);
        assert.equal(result.strips[0]!.name, 'a');
        assert.equal(result.strips[1]!.name, 'b');
        assert.equal(result.totalCount, 8);
    });

    test('v2 file from a string blob round-trips through the dispatcher', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(V2_SAMPLE));
        assert.equal(result.strips.length, 2);
        assert.equal(result.totalCount, 8);
    });
});
