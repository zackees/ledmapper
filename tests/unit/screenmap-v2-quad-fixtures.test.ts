/**
 * Regression test for the two 4-tile v2 fixtures under public/screenmaps/v2/.
 *
 *   4tile_parallel.json — 4 separate pins (1 per tile)
 *   4tile_chained.json  — 1 pin, all 4 tiles daisy-chained (e.g. SPI serpentine)
 *
 * Both fixtures describe the SAME physical placement of 64 LEDs (4 tiles ×
 * 4×4 LEDs); only the pin assignment differs. This exercises the audit
 * finding that the strips panel + chain mode + video offsets already
 * support N segments per pin without code changes.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseScreenmapV2,
    v2ToMultiStripResult,
} from '../../src/screenmap-v2';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
    return readFileSync(
        resolve(__dirname, '../../public/screenmaps/v2', name),
        'utf-8',
    );
}

describe('v2 4-tile fixtures', () => {
    test('parallel fixture parses with 4 distinct pins', () => {
        const raw = loadFixture('4tile_parallel.json');
        const v2 = parseScreenmapV2(raw);
        assert.equal(v2.segments.length, 4);
        const pins = new Set(v2.segments.map((s) => s.pin));
        assert.equal(pins.size, 4, 'expected 4 distinct pins');
        assert.deepEqual([...pins].sort(), [1, 2, 3, 4]);
    });

    test('chained fixture parses with 1 pin shared across all 4 segments', () => {
        const raw = loadFixture('4tile_chained.json');
        const v2 = parseScreenmapV2(raw);
        assert.equal(v2.segments.length, 4);
        const pins = new Set(v2.segments.map((s) => s.pin));
        assert.equal(pins.size, 1, 'expected 1 distinct pin');
        assert.deepEqual([...pins], [1]);
    });

    test('both fixtures describe identical physical placements', () => {
        const parallel = parseScreenmapV2(loadFixture('4tile_parallel.json'));
        const chained = parseScreenmapV2(loadFixture('4tile_chained.json'));
        assert.equal(parallel.segments.length, chained.segments.length);
        for (let i = 0; i < parallel.segments.length; i++) {
            const p = parallel.segments[i]!;
            const c = chained.segments[i]!;
            assert.equal(p.id, c.id, `segment ${String(i)} id mismatch`);
            assert.deepEqual(p.x, c.x, `segment ${p.id} x[] mismatch`);
            assert.deepEqual(p.y, c.y, `segment ${p.id} y[] mismatch`);
        }
    });

    test('chained fixture: v2->MultiStrip adapter groups all 4 segments under pin "1"', () => {
        const v2 = parseScreenmapV2(loadFixture('4tile_chained.json'));
        const result = v2ToMultiStripResult(v2);

        // 4 strips total, all assigned pin "1" (string after adapter).
        assert.equal(result.strips.length, 4);
        for (const s of result.strips) {
            assert.equal(s.pin, '1');
        }

        // Sequential video_offsets accumulate across the chain (16 LEDs per tile).
        assert.equal(result.strips[0]!.video_offset, 0);
        assert.equal(result.strips[1]!.video_offset, 16);
        assert.equal(result.strips[2]!.video_offset, 32);
        assert.equal(result.strips[3]!.video_offset, 48);
        assert.equal(result.totalCount, 64);
    });

    test('parallel fixture: v2->MultiStrip adapter assigns one strip per pin', () => {
        const v2 = parseScreenmapV2(loadFixture('4tile_parallel.json'));
        const result = v2ToMultiStripResult(v2);

        assert.equal(result.strips.length, 4);
        assert.equal(result.strips[0]!.pin, '1');
        assert.equal(result.strips[1]!.pin, '2');
        assert.equal(result.strips[2]!.pin, '3');
        assert.equal(result.strips[3]!.pin, '4');
        assert.equal(result.totalCount, 64);
    });
});
