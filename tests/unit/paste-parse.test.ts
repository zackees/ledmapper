import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePastedScreenmap, planPasteMerge } from '../../src/shapeeditor/paste-parse';

describe('parsePastedScreenmap', () => {
    it('parses full screenmap JSON', () => {
        const json = JSON.stringify({
            map: {
                stripA: { x: [0, 1, 2], y: [0, 1, 2], diameter: 0.5 },
                stripB: { x: [10, 11], y: [10, 11] },
            },
        });
        const out = parsePastedScreenmap(json);
        assert.ok(out);
        assert.equal(out.strips.length, 2);
        assert.equal(out.strips[0].name, 'stripA');
        assert.deepEqual(out.strips[0].points, [[0, 0], [1, 1], [2, 2]]);
        assert.equal(out.strips[0].diameter, 0.5);
        assert.equal(out.strips[1].name, 'stripB');
        assert.equal(out.strips[1].points.length, 2);
    });

    it('parses single strip {name, points, diameter}', () => {
        const json = JSON.stringify({ name: 'panel99', points: [[1, 2], [3, 4]], diameter: 0.3 });
        const out = parsePastedScreenmap(json);
        assert.ok(out);
        assert.equal(out.strips.length, 1);
        assert.equal(out.strips[0].name, 'panel99');
        assert.deepEqual(out.strips[0].points, [[1, 2], [3, 4]]);
        assert.equal(out.strips[0].diameter, 0.3);
    });

    it('parses single strip without name → "pasted1"', () => {
        const json = JSON.stringify({ points: [[1, 2]] });
        const out = parsePastedScreenmap(json);
        assert.ok(out);
        assert.equal(out.strips[0].name, 'pasted1');
    });

    it('parses bare points array → "pasted1"', () => {
        const json = JSON.stringify([[0, 0], [1, 1], [2, 2]]);
        const out = parsePastedScreenmap(json);
        assert.ok(out);
        assert.equal(out.strips.length, 1);
        assert.equal(out.strips[0].name, 'pasted1');
        assert.equal(out.strips[0].points.length, 3);
        assert.equal(out.strips[0].diameter, undefined);
    });

    it('rejects invalid JSON', () => {
        assert.equal(parsePastedScreenmap('not json'), null);
        assert.equal(parsePastedScreenmap('{ bad'), null);
    });

    it('rejects empty / whitespace input', () => {
        assert.equal(parsePastedScreenmap(''), null);
        assert.equal(parsePastedScreenmap('   '), null);
        assert.equal(parsePastedScreenmap(null), null);
        assert.equal(parsePastedScreenmap(undefined), null);
    });

    it('rejects empty arrays / degenerate shapes', () => {
        assert.equal(parsePastedScreenmap('[]'), null);
        assert.equal(parsePastedScreenmap('{}'), null);
        assert.equal(parsePastedScreenmap('{"map":{}}'), null);
        assert.equal(parsePastedScreenmap('{"points":[]}'), null);
        // strip with NaN
        assert.equal(parsePastedScreenmap('[["a","b"]]'), null);
        // Non-pair entries
        assert.equal(parsePastedScreenmap('[[1]]'), null);
    });

    it('rejects full screenmap with empty strips only', () => {
        const json = JSON.stringify({ map: { a: { x: [], y: [] } } });
        assert.equal(parsePastedScreenmap(json), null);
    });
});

describe('planPasteMerge', () => {
    it('renames colliding strip names with " (2)", " (3)"', () => {
        const parsed = {
            strips: [
                { name: 'panel1', points: [[0, 0]] },
                { name: 'panel1', points: [[1, 1]] },
                { name: 'panel1', points: [[2, 2]] },
            ],
        };
        const merged = planPasteMerge(parsed, new Set(['panel1']), 0);
        assert.deepEqual(merged.map((s) => s.name), ['panel1 (2)', 'panel1 (3)', 'panel1 (4)']);
    });

    it('re-indexes video_offset to append after currentTotalCount', () => {
        const parsed = {
            strips: [
                { name: 'a', points: [[0, 0], [1, 1]] },
                { name: 'b', points: [[2, 2], [3, 3], [4, 4]] },
            ],
        };
        const merged = planPasteMerge(parsed, new Set(), 100);
        assert.equal(merged[0].video_offset, 100);
        assert.equal(merged[1].video_offset, 102);
    });

    it('preserves diameter when present', () => {
        const parsed = { strips: [{ name: 'x', points: [[0, 0]], diameter: 0.42 }] };
        const merged = planPasteMerge(parsed, [], 0);
        assert.equal(merged[0].diameter, 0.42);
    });

    it('omits diameter when not provided', () => {
        const parsed = { strips: [{ name: 'x', points: [[0, 0]] }] };
        const merged = planPasteMerge(parsed, [], 0);
        assert.ok(!('diameter' in merged[0]));
    });
});
