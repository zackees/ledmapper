import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parse_screenmap_data_json,
    parseScreenmapMultiStrip,
    getStripColors,
} from '../../src/common';
import {
    buildScreenmapMultiStripJson,
} from '../../src/screenmap-store';

// ── Single-strip fixtures ────────────────────────────────────────────

const SINGLE_STRIP = {
    map: {
        strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25 }
    }
};

const TWO_STRIPS = {
    map: {
        strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25 },
        strip2: { x: [10, 11, 12], y: [1, 1, 1], diameter: 0.5 }
    }
};

const TWO_STRIPS_WITH_OFFSETS = {
    map: {
        strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25, video_offset: 0 },
        strip2: { x: [10, 11, 12], y: [1, 1, 1], diameter: 0.5, video_offset: 100 }
    }
};

const EMPTY_MAP = { map: {} };

// ── parse_screenmap_data_json (backwards compat) ─────────────────────

describe('parse_screenmap_data_json backwards compatibility', () => {
    it('single strip returns same result as before', () => {
        const pts = parse_screenmap_data_json(SINGLE_STRIP);
        assert.strictEqual(pts.length, 4);
        assert.deepStrictEqual([...pts], [[0, 0], [1, 0], [2, 0], [3, 0]]);
    });

    it('single strip preserves .diameter', () => {
        const pts = parse_screenmap_data_json(SINGLE_STRIP);
        assert.strictEqual(pts.diameter, 0.25);
    });

    it('two strips returns ALL points concatenated (strip1 then strip2)', () => {
        const pts = parse_screenmap_data_json(TWO_STRIPS);
        assert.strictEqual(pts.length, 7);
        assert.deepStrictEqual(pts[0], [0, 0]);
        assert.deepStrictEqual(pts[3], [3, 0]);
        assert.deepStrictEqual(pts[4], [10, 1]);
        assert.deepStrictEqual(pts[6], [12, 1]);
    });

    it('two strips — .diameter from first strip', () => {
        const pts = parse_screenmap_data_json(TWO_STRIPS);
        assert.strictEqual(pts.diameter, 0.25);
    });

    it('accepts JSON string input', () => {
        const pts = parse_screenmap_data_json(JSON.stringify(SINGLE_STRIP));
        assert.strictEqual(pts.length, 4);
    });

    it('throws on missing map key', () => {
        assert.throws(() => parse_screenmap_data_json({}), /map/i);
    });

    it('throws on empty map', () => {
        assert.throws(() => parse_screenmap_data_json(EMPTY_MAP), /strip/i);
    });
});

// ── parseScreenmapMultiStrip ─────────────────────────────────────────

describe('parseScreenmapMultiStrip', () => {
    it('single strip returns structured result', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(SINGLE_STRIP));
        assert.strictEqual(result.strips.length, 1);
        assert.strictEqual(result.totalCount, 4);
        assert.deepStrictEqual(result.allPoints, [[0, 0], [1, 0], [2, 0], [3, 0]]);
    });

    it('single strip entry has name, points, diameter, offset, count', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(SINGLE_STRIP));
        const s = result.strips[0];
        assert.strictEqual(s.name, 'strip1');
        assert.deepStrictEqual(s.points, [[0, 0], [1, 0], [2, 0], [3, 0]]);
        assert.strictEqual(s.diameter, 0.25);
        assert.strictEqual(s.offset, 0);
        assert.strictEqual(s.count, 4);
    });

    it('two strips — strips array has 2 entries with correct metadata', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS));
        assert.strictEqual(result.strips.length, 2);

        const s1 = result.strips[0];
        assert.strictEqual(s1.name, 'strip1');
        assert.strictEqual(s1.offset, 0);
        assert.strictEqual(s1.count, 4);
        assert.strictEqual(s1.diameter, 0.25);

        const s2 = result.strips[1];
        assert.strictEqual(s2.name, 'strip2');
        assert.strictEqual(s2.offset, 4);
        assert.strictEqual(s2.count, 3);
        assert.strictEqual(s2.diameter, 0.5);
    });

    it('two strips — allPoints is concatenation in key order', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS));
        assert.strictEqual(result.allPoints.length, 7);
        assert.deepStrictEqual(result.allPoints[0], [0, 0]);
        assert.deepStrictEqual(result.allPoints[4], [10, 1]);
        assert.strictEqual(result.totalCount, 7);
    });

    it('two strips — different diameters preserved per strip', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS));
        assert.strictEqual(result.strips[0].diameter, 0.25);
        assert.strictEqual(result.strips[1].diameter, 0.5);
    });

    it('empty map (0 strips) throws', () => {
        assert.throws(() => parseScreenmapMultiStrip(JSON.stringify(EMPTY_MAP)));
    });

    it('CSV input wraps in single strip named "strip1"', () => {
        const csv = '0,0\n1,0\n2,0\n';
        const result = parseScreenmapMultiStrip(csv);
        assert.strictEqual(result.strips.length, 1);
        assert.strictEqual(result.strips[0].name, 'strip1');
        assert.strictEqual(result.strips[0].count, 3);
        assert.strictEqual(result.totalCount, 3);
    });

    it('video_offset parsed when present', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS_WITH_OFFSETS));
        assert.strictEqual(result.strips[0].video_offset, 0);
        assert.strictEqual(result.strips[1].video_offset, 100);
    });

    it('video_offset defaults to sequential offset when absent', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS));
        // No video_offset in fixture — should default to sequential: 0, 4
        assert.strictEqual(result.strips[0].video_offset, 0);
        assert.strictEqual(result.strips[1].video_offset, 4);
    });

    it('CSV input strip has video_offset 0', () => {
        const csv = '0,0\n1,0\n';
        const result = parseScreenmapMultiStrip(csv);
        assert.strictEqual(result.strips[0].video_offset, 0);
    });

    it('accepts already-parsed object (not a string)', () => {
        const result = parseScreenmapMultiStrip(SINGLE_STRIP);
        assert.strictEqual(result.strips.length, 1);
        assert.strictEqual(result.totalCount, 4);
        assert.deepStrictEqual(result.allPoints, [[0, 0], [1, 0], [2, 0], [3, 0]]);
    });

    it('throws on missing map key (object input)', () => {
        assert.throws(() => parseScreenmapMultiStrip({}), /map/i);
    });

    it('throws on missing map key (string input)', () => {
        assert.throws(() => parseScreenmapMultiStrip('{}'), /map/i);
    });

    it('truncates to shorter array when x and y lengths differ', () => {
        const mismatch = {
            map: { strip1: { x: [0, 1, 2, 3], y: [0, 0], diameter: 0.5 } }
        };
        const result = parseScreenmapMultiStrip(JSON.stringify(mismatch));
        // Should use min(4, 2) = 2 points
        assert.strictEqual(result.totalCount, 2);
        assert.strictEqual(result.strips[0].count, 2);
        assert.deepStrictEqual(result.allPoints, [[0, 0], [1, 0]]);
    });

    it('diameter is undefined when strip omits it', () => {
        const noDiam = { map: { strip1: { x: [0, 1], y: [0, 0] } } };
        const result = parseScreenmapMultiStrip(JSON.stringify(noDiam));
        assert.strictEqual(result.strips[0].diameter, undefined);
    });

    it('round-trips through JSON serialization', () => {
        const result1 = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS_WITH_OFFSETS));
        // Rebuild JSON from the structured result
        const rebuilt: any = { map: {} };
        for (const s of result1.strips) {
            const entry: any = {
                x: s.points.map((p: any) => p[0]),
                y: s.points.map((p: any) => p[1]),
                diameter: s.diameter,
            };
            if (typeof s.video_offset === 'number') entry.video_offset = s.video_offset;
            rebuilt.map[s.name] = entry;
        }
        const result2 = parseScreenmapMultiStrip(JSON.stringify(rebuilt));
        assert.deepStrictEqual(result2.allPoints, result1.allPoints);
        assert.strictEqual(result2.totalCount, result1.totalCount);
        assert.strictEqual(result2.strips.length, result1.strips.length);
        assert.strictEqual(result2.strips[0].video_offset, result1.strips[0].video_offset);
        assert.strictEqual(result2.strips[1].video_offset, result1.strips[1].video_offset);
    });
});

// ── buildScreenmapMultiStripJson (persistence) ──────────────────────

describe('buildScreenmapMultiStripJson', () => {
    it('single strip produces valid JSON matching existing format', () => {
        const strips = [{ name: 'strip1', points: [[0, 0], [1, 0]], diameter: 0.25, offset: 0, count: 2, video_offset: 0 }];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.ok(parsed.map.strip1);
        assert.deepStrictEqual(parsed.map.strip1.x, [0, 1]);
        assert.deepStrictEqual(parsed.map.strip1.y, [0, 0]);
        assert.strictEqual(parsed.map.strip1.diameter, 0.25);
    });

    it('two strips produces correct JSON with both strips', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0], [1, 0]], diameter: 0.25, offset: 0, count: 2, video_offset: 0 },
            { name: 'strip2', points: [[5, 5]], diameter: 0.5, offset: 2, count: 1, video_offset: 2 },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.ok(parsed.map.strip1);
        assert.ok(parsed.map.strip2);
        assert.deepStrictEqual(parsed.map.strip2.x, [5]);
        assert.deepStrictEqual(parsed.map.strip2.y, [5]);
    });

    it('preserves per-strip diameter', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0]], diameter: 0.25, offset: 0, count: 1, video_offset: 0 },
            { name: 'strip2', points: [[1, 1]], diameter: 0.75, offset: 1, count: 1, video_offset: 1 },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.map.strip1.diameter, 0.25);
        assert.strictEqual(parsed.map.strip2.diameter, 0.75);
    });

    it('includes video_offset (with override flag) when videoOffsetOverride is true', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0]], diameter: 0.25, offset: 0, count: 1, video_offset: 0 },
            { name: 'strip2', points: [[1, 1]], diameter: 0.5, offset: 1, count: 1, video_offset: 100, videoOffsetOverride: true },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.map.strip2.video_offset, 100);
        assert.strictEqual(parsed.map.strip2.video_offset_override, true);
    });

    it('omits video_offset when videoOffsetOverride is false, even if non-sequential', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0]], diameter: 0.25, offset: 0, count: 1, video_offset: 0 },
            { name: 'strip2', points: [[1, 1]], diameter: 0.5, offset: 1, count: 1, video_offset: 100 },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.map.strip2.video_offset, undefined);
        assert.strictEqual(parsed.map.strip2.video_offset_override, undefined);
    });

    it('round-trips through parseScreenmapMultiStrip', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0], [1, 0]], diameter: 0.25, offset: 0, count: 2, video_offset: 0 },
            { name: 'strip2', points: [[5, 5], [6, 6]], diameter: 0.5, offset: 2, count: 2, video_offset: 50, videoOffsetOverride: true },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const result = parseScreenmapMultiStrip(json);
        assert.strictEqual(result.strips.length, 2);
        assert.strictEqual(result.totalCount, 4);
        assert.deepStrictEqual(result.strips[0].points, [[0, 0], [1, 0]]);
        assert.deepStrictEqual(result.strips[1].points, [[5, 5], [6, 6]]);
        assert.strictEqual(result.strips[1].video_offset, 50);
    });

    it('omits video_offset from JSON when sequential (clean output)', () => {
        const strips = [
            { name: 'strip1', points: [[0, 0], [1, 0]], diameter: 0.25, offset: 0, count: 2, video_offset: 0 },
            { name: 'strip2', points: [[5, 5]], diameter: 0.5, offset: 2, count: 1, video_offset: 2 },
        ];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        // When video_offset matches sequential offset, it should be omitted for cleaner JSON
        assert.strictEqual(parsed.map.strip1.video_offset, undefined);
        assert.strictEqual(parsed.map.strip2.video_offset, undefined);
    });

    it('throws on empty strips array', () => {
        assert.throws(() => buildScreenmapMultiStripJson([]), /non-empty/i);
    });

    it('throws on non-array input', () => {
        assert.throws(() => buildScreenmapMultiStripJson(null), /non-empty/i);
        assert.throws(() => buildScreenmapMultiStripJson(undefined), /non-empty/i);
    });

    it('throws when a strip has undefined points', () => {
        const strips = [{ name: 'bad', diameter: 0.25, offset: 0, count: 0 }];
        assert.throws(() => buildScreenmapMultiStripJson(strips), /points/i);
    });

    it('throws when a strip has 0 points', () => {
        const strips = [{ name: 'empty', points: [], diameter: 0.25, offset: 0, count: 0, video_offset: 0 }];
        assert.throws(() => buildScreenmapMultiStripJson(strips), /0 points/i);
    });

    it('omits diameter when undefined', () => {
        const strips = [{ name: 'strip1', points: [[0, 0]], diameter: undefined, offset: 0, count: 1, video_offset: 0 }];
        const json = buildScreenmapMultiStripJson(strips);
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.map.strip1.diameter, undefined);
        assert.deepStrictEqual(parsed.map.strip1.x, [0]);
    });
});

// ── getStripColors ──────────────────────────────────────────────────

describe('getStripColors', () => {
    it('returns array with 1 color string for n=1', () => {
        const colors = getStripColors(1);
        assert.strictEqual(colors.length, 1);
        assert.ok(typeof colors[0] === 'string');
    });

    it('returns 3 distinct HSL color strings for n=3', () => {
        const colors = getStripColors(3);
        assert.strictEqual(colors.length, 3);
        const unique = new Set(colors);
        assert.strictEqual(unique.size, 3, 'colors should be distinct');
        for (const c of colors) {
            assert.ok(c.startsWith('hsl('), `expected HSL string, got: ${c}`);
        }
    });

    it('returns empty array for n=0', () => {
        const colors = getStripColors(0);
        assert.deepStrictEqual(colors, []);
    });

    it('returns empty array for negative n', () => {
        const colors = getStripColors(-1);
        assert.deepStrictEqual(colors, []);
    });
});

// ── Pins (issue #24): parse + emission rules ─────────────────────────

describe('parseScreenmapMultiStrip — pins', () => {
    it('defaults pin to "pin1" when absent', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS));
        assert.strictEqual(result.strips[0].pin, 'pin1');
        assert.strictEqual(result.strips[1].pin, 'pin1');
    });

    it('reads explicit pin strings, defaulting blank/missing to pin1', () => {
        const blob = {
            map: {
                a: { x: [0], y: [0], pin: 'pin2' },
                b: { x: [1], y: [0], pin: '  ' },
                c: { x: [2], y: [0] },
            }
        };
        const result = parseScreenmapMultiStrip(JSON.stringify(blob));
        assert.strictEqual(result.strips[0].pin, 'pin2');
        assert.strictEqual(result.strips[1].pin, 'pin1');
        assert.strictEqual(result.strips[2].pin, 'pin1');
    });

    it('reads explicit video_offset_override flag', () => {
        const blob = {
            map: {
                a: { x: [0, 1], y: [0, 0] },
                b: { x: [2], y: [0], video_offset: 2, video_offset_override: true },
            }
        };
        const result = parseScreenmapMultiStrip(JSON.stringify(blob));
        assert.strictEqual(result.strips[0].videoOffsetOverride, false);
        assert.strictEqual(result.strips[1].videoOffsetOverride, true);
        assert.strictEqual(result.strips[1].video_offset, 2);
    });

    it('legacy migration: non-sequential video_offset without flag becomes override', () => {
        const result = parseScreenmapMultiStrip(JSON.stringify(TWO_STRIPS_WITH_OFFSETS));
        // strip1: video_offset 0 === sequential offset 0 → no override
        assert.strictEqual(result.strips[0].videoOffsetOverride, false);
        // strip2: video_offset 100 !== sequential offset 4 → migrated override
        assert.strictEqual(result.strips[1].videoOffsetOverride, true);
        assert.strictEqual(result.strips[1].video_offset, 100);
    });

    it('explicit override:false wins over legacy heuristic', () => {
        const blob = {
            map: {
                a: { x: [0, 1], y: [0, 0] },
                b: { x: [2], y: [0], video_offset: 99, video_offset_override: false },
            }
        };
        const result = parseScreenmapMultiStrip(JSON.stringify(blob));
        assert.strictEqual(result.strips[1].videoOffsetOverride, false);
    });

    it('CSV fallback strip gets pin1 and no override', () => {
        const result = parseScreenmapMultiStrip('0,0\n1,0\n');
        assert.strictEqual(result.strips[0].pin, 'pin1');
        assert.strictEqual(result.strips[0].videoOffsetOverride, false);
    });
});

describe('buildScreenmapMultiStripJson — pin emission', () => {
    it('omits pin when every strip is on default pin1', () => {
        const strips = [
            { name: 'a', points: [[0, 0]], offset: 0, count: 1, video_offset: 0, pin: 'pin1' },
            { name: 'b', points: [[1, 1]], offset: 1, count: 1, video_offset: 1, pin: 'pin1' },
        ];
        const parsed = JSON.parse(buildScreenmapMultiStripJson(strips));
        assert.strictEqual(parsed.map.a.pin, undefined);
        assert.strictEqual(parsed.map.b.pin, undefined);
    });

    it('emits pin on every strip when two distinct pins exist', () => {
        const strips = [
            { name: 'a', points: [[0, 0]], offset: 0, count: 1, video_offset: 0, pin: 'pin1' },
            { name: 'b', points: [[1, 1]], offset: 1, count: 1, video_offset: 1, pin: 'pin2' },
        ];
        const parsed = JSON.parse(buildScreenmapMultiStripJson(strips));
        assert.strictEqual(parsed.map.a.pin, 'pin1');
        assert.strictEqual(parsed.map.b.pin, 'pin2');
    });

    it('emits pin when single non-default pin', () => {
        const strips = [
            { name: 'a', points: [[0, 0]], offset: 0, count: 1, video_offset: 0, pin: 'gpio5' },
        ];
        const parsed = JSON.parse(buildScreenmapMultiStripJson(strips));
        assert.strictEqual(parsed.map.a.pin, 'gpio5');
    });

    it('pin + override round-trip through parseScreenmapMultiStrip', () => {
        const strips = [
            { name: 'a', points: [[0, 0], [1, 0]], offset: 0, count: 2, video_offset: 0, pin: 'pin1' },
            { name: 'b', points: [[5, 5]], offset: 2, count: 1, video_offset: 7, pin: 'pin2', videoOffsetOverride: true },
        ];
        const result = parseScreenmapMultiStrip(buildScreenmapMultiStripJson(strips));
        assert.strictEqual(result.strips[0].pin, 'pin1');
        assert.strictEqual(result.strips[0].videoOffsetOverride, false);
        assert.strictEqual(result.strips[1].pin, 'pin2');
        assert.strictEqual(result.strips[1].videoOffsetOverride, true);
        assert.strictEqual(result.strips[1].video_offset, 7);
    });
});
