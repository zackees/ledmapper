import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScreenmapMultiStrip } from '../../src/common.js';
import { buildScreenmapMultiStripJson } from '../../src/screenmap-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

const PRESET_PATH = join(repoRoot, 'public', 'screenmaps', '64x64_quad_serpentine.json');

describe('64x64 quad serpentine preset', () => {
    const text = readFileSync(PRESET_PATH, 'utf-8');
    const parsed = parseScreenmapMultiStrip(text);

    it('has 16 strips of 256 LEDs (4096 total)', () => {
        assert.equal(parsed.strips.length, 16);
        for (const strip of parsed.strips) {
            assert.equal(strip.count, 256, `strip ${strip.name}`);
        }
        assert.equal(parsed.totalCount, 4096);
    });

    it('names strips q<quadrant>_p<panel> in reading order', () => {
        const expected = [];
        for (let q = 0; q < 4; q++) {
            for (let p = 0; p < 4; p++) {
                expected.push(`q${q}_p${p}`);
            }
        }
        assert.deepEqual(parsed.strips.map(s => s.name), expected);
    });

    it('has contiguous video_offsets of 256 in key order', () => {
        parsed.strips.forEach((strip, i) => {
            assert.equal(strip.video_offset, i * 256, `strip ${strip.name}`);
        });
    });

    it('covers the full 64x64 grid with no duplicates', () => {
        const seen = new Set(parsed.allPoints.map(([x, y]) => `${x},${y}`));
        assert.equal(seen.size, 4096);
        for (const [x, y] of parsed.allPoints) {
            assert.ok(Number.isInteger(x) && x >= 0 && x <= 63, `x out of range: ${x}`);
            assert.ok(Number.isInteger(y) && y >= 0 && y <= 63, `y out of range: ${y}`);
        }
    });

    it('centers each quadrant on its MCU centroid', () => {
        const centers = [[15.5, 15.5], [47.5, 15.5], [15.5, 47.5], [47.5, 47.5]];
        for (let q = 0; q < 4; q++) {
            const pts = parsed.strips
                .slice(q * 4, q * 4 + 4)
                .flatMap(s => s.points);
            const cx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
            const cy = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
            assert.ok(Math.abs(cx - centers[q][0]) < 1e-9, `quadrant ${q} cx=${cx}`);
            assert.ok(Math.abs(cy - centers[q][1]) < 1e-9, `quadrant ${q} cy=${cy}`);
        }
    });

    it('round-trips through buildScreenmapMultiStripJson', () => {
        const rebuilt = buildScreenmapMultiStripJson(parsed.strips);
        const reparsed = parseScreenmapMultiStrip(rebuilt);
        assert.equal(reparsed.totalCount, parsed.totalCount);
        assert.equal(reparsed.strips.length, parsed.strips.length);
        for (let i = 0; i < parsed.strips.length; i++) {
            const a = parsed.strips[i], b = reparsed.strips[i];
            assert.equal(b.name, a.name);
            assert.equal(b.count, a.count);
            assert.equal(b.diameter, a.diameter);
            assert.equal(b.video_offset, a.video_offset);
            assert.deepEqual(b.points, a.points);
        }
    });
});
