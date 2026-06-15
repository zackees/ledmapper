import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { formatCompactJson } from '../../src/json-compact';

describe('formatCompactJson', () => {
    test('inlines a numeric array (no per-element newlines)', () => {
        const out = formatCompactJson({ x: [0, 1, 2, 3, 4] });
        assert.equal(out.split('\n').length, 3); // open brace, line for x, close brace
        assert.match(out, /"x": \[0, 1, 2, 3, 4\]/);
    });

    test('inlines a boolean / null array', () => {
        const out = formatCompactJson([true, false, null]);
        assert.equal(out, '[true, false, null]');
    });

    test('inlines a string array', () => {
        const out = formatCompactJson(['a', 'b', 'c']);
        assert.equal(out, '["a", "b", "c"]');
    });

    test('point-pair array inline when short', () => {
        const out = formatCompactJson({ points: [[0, 0], [1, 0], [2, 0]] });
        assert.match(out, /"points": \[\[0, 0\], \[1, 0\], \[2, 0\]\]/);
    });

    test('point-pair array wraps to multi-line when long', () => {
        const points = Array.from({ length: 60 }, (_, i) => [i, i] as [number, number]);
        const out = formatCompactJson({ points }, { pointPairsInlineMaxLen: 100 });
        // The breakout should produce one tuple per line.
        const lines = out.split('\n');
        // First line is opening brace, then "points": [, then 60 tuple lines, then ], then closing brace.
        assert.ok(lines.length >= 60, `expected multi-line wrap, got ${String(lines.length)} lines`);
        assert.match(out, /\[0, 0\]/);
        assert.match(out, /\[59, 59\]/);
    });

    test('full v1 screenmap stays readable', () => {
        const v1 = {
            map: {
                strip1: {
                    x: [0, 1, 2, 3],
                    y: [0, 0, 0, 0],
                    diameter: 0.25,
                },
            },
        };
        const out = formatCompactJson(v1);
        assert.match(out, /"map":/);
        assert.match(out, /"strip1":/);
        assert.match(out, /"x": \[0, 1, 2, 3\]/);
        assert.match(out, /"y": \[0, 0, 0, 0\]/);
        assert.match(out, /"diameter": 0\.25/);
    });

    test('full v2 screenmap stays readable, x/y inline', () => {
        const v2 = {
            version: 2,
            groups: { trunk: { color: '#ffffff' } },
            segments: [
                { id: 'a', pin: 1, group: 'trunk', x: [0, 1, 2, 3, 4], y: [0, 0, 0, 0, 0] },
            ],
        };
        const out = formatCompactJson(v2);
        assert.match(out, /"version": 2/);
        assert.match(out, /"x": \[0, 1, 2, 3, 4\]/);
        assert.match(out, /"y": \[0, 0, 0, 0, 0\]/);
    });

    test('object values still pretty-print with indent', () => {
        const out = formatCompactJson({ a: { b: 1 } });
        assert.match(out, /^\{\n {2}"a": \{\n {4}"b": 1\n {2}\}\n\}$/);
    });

    test('round-trips: JSON.parse(formatCompactJson(x)) deep-equals x', () => {
        const cases: unknown[] = [
            null,
            true,
            'hello',
            42,
            { a: 1, b: 'two', c: [1, 2, 3], d: { e: [[0, 0], [1, 1]] } },
            [],
            {},
        ];
        for (const c of cases) {
            const round = JSON.parse(formatCompactJson(c)) as unknown;
            assert.deepEqual(round, c);
        }
    });

    test('handles empty arrays and empty objects', () => {
        assert.equal(formatCompactJson([]), '[]');
        assert.equal(formatCompactJson({}), '{}');
        assert.match(formatCompactJson({ x: [], y: {} }), /"x": \[\]/);
        assert.match(formatCompactJson({ x: [], y: {} }), /"y": \{\}/);
    });

    test('NaN and Infinity render as null (matches JSON.stringify behavior)', () => {
        assert.equal(formatCompactJson(NaN), 'null');
        assert.equal(formatCompactJson(Infinity), 'null');
    });
});
