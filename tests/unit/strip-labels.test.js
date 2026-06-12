import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripStartEndLabels, getPinColors } from '../../src/common.js';

describe('getPinColors', () => {
    it('returns n distinct HSL colors', () => {
        const colors = getPinColors(4);
        assert.equal(colors.length, 4);
        assert.equal(new Set(colors).size, 4);
        for (const c of colors) assert.match(c, /^hsl\(/);
    });

    it('returns empty array for n=0 without throwing', () => {
        assert.deepEqual(getPinColors(0), []);
    });
});

describe('stripStartEndLabels', () => {
    it('named strip uses its name', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'Left', count: 10 }, 0),
            { start: 'StartLeft', end: 'EndLeft' }
        );
    });

    it('auto-indexed stripN names fall back to strip index', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'strip1', count: 5 }, 0),
            { start: 'Start0', end: 'End0' }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: 'strip2', count: 5 }, 1),
            { start: 'Start1', end: 'End1' }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: 'Strip10', count: 5 }, 3),
            { start: 'Start3', end: 'End3' }
        );
    });

    it('bare "strip" and empty/whitespace names fall back to index', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'strip', count: 2 }, 2),
            { start: 'Start2', end: 'End2' }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: '', count: 2 }, 4),
            { start: 'Start4', end: 'End4' }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: '   ', count: 2 }, 5),
            { start: 'Start5', end: 'End5' }
        );
        assert.deepEqual(
            stripStartEndLabels({ count: 2 }, 6),
            { start: 'Start6', end: 'End6' }
        );
    });

    it('non-auto names containing "strip" are kept verbatim', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'strip_left', count: 3 }, 0),
            { start: 'Startstrip_left', end: 'Endstrip_left' }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: 'q0_p1', count: 256 }, 1),
            { start: 'Startq0_p1', end: 'Endq0_p1' }
        );
    });

    it('single-LED strip collapses to one combined label', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'Solo', count: 1 }, 0),
            { start: 'Start/EndSolo', end: null }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: 'strip1', count: 1 }, 0),
            { start: 'Start/End0', end: null }
        );
    });

    it('falls back to points length when count is missing', () => {
        assert.deepEqual(
            stripStartEndLabels({ name: 'Left', points: [[0, 0]] }, 0),
            { start: 'Start/EndLeft', end: null }
        );
        assert.deepEqual(
            stripStartEndLabels({ name: 'Left', points: [[0, 0], [1, 0]] }, 0),
            { start: 'StartLeft', end: 'EndLeft' }
        );
    });
});
