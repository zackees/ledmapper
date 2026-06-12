import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScreenmapMultiStrip } from '../../src/common';
import { buildScreenmapMultiStripJson } from '../../src/screenmap-store';

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
        assert.deepEqual(parsed.strips.map((s) => s.name), expected);
    });

    it('has contiguous video_offsets of 256 in key order', () => {
        parsed.strips.forEach((strip, i) => {
            assert.equal(strip.video_offset, i * 256, `strip ${strip.name}`);
        });
    });

    it('covers the full 64x64 grid with no duplicates', () => {
        const seen = new Set(parsed.allPoints.map(([x, y]: [any, any]) => `${x},${y}`));
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
                .flatMap((s) => s.points);
            const cx = pts.reduce((a: number, [x]: [number, number]) => a + x, 0) / pts.length;
            const cy = pts.reduce((a: number, p: [number, number]) => a + p[1], 0) / pts.length;
            assert.ok(Math.abs(cx - centers[q]![0]!) < 1e-9, `quadrant ${q} cx=${cx}`);
            assert.ok(Math.abs(cy - centers[q]![1]!) < 1e-9, `quadrant ${q} cy=${cy}`);
        }
    });

    it('round-trips through buildScreenmapMultiStripJson', () => {
        const rebuilt = buildScreenmapMultiStripJson(parsed.strips);
        const reparsed = parseScreenmapMultiStrip(rebuilt);
        assert.equal(reparsed.totalCount, parsed.totalCount);
        assert.equal(reparsed.strips.length, parsed.strips.length);
        for (let i = 0; i < parsed.strips.length; i++) {
            const a = parsed.strips[i]!, b = reparsed.strips[i]!;
            assert.equal(b.name, a.name);
            assert.equal(b.count, a.count);
            assert.equal(b.diameter, a.diameter);
            assert.equal(b.video_offset, a.video_offset);
            assert.deepEqual(b.points, a.points);
        }
    });
});

describe('22x22 serpentine preset', () => {
    const text = readFileSync(join(repoRoot, 'public', 'screenmaps', '22x22_serpentine.json'), 'utf-8');
    const parsed = parseScreenmapMultiStrip(text);

    it('is a single strip named strip1 with 484 LEDs', () => {
        assert.equal(parsed.strips.length, 1);
        assert.equal(parsed.strips[0]!.name, 'strip1');
        assert.equal(parsed.strips[0]!.count, 484);
        assert.equal(parsed.totalCount, 484);
    });

    it('covers the full 22x22 grid with no duplicates', () => {
        const seen = new Set(parsed.allPoints.map(([x, y]: [any, any]) => `${x},${y}`));
        assert.equal(seen.size, 484);
        for (const [x, y] of parsed.allPoints) {
            assert.ok(Number.isInteger(x) && x >= 0 && x <= 21, `x out of range: ${x}`);
            assert.ok(Number.isInteger(y) && y >= 0 && y <= 21, `y out of range: ${y}`);
        }
    });

    it('is serpentine: each step moves exactly one cell', () => {
        const pts = parsed.allPoints;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
            assert.equal(d, 1, `step ${i} has distance ${d}`);
        }
    });

    it('round-trips through buildScreenmapMultiStripJson', () => {
        const reparsed = parseScreenmapMultiStrip(buildScreenmapMultiStripJson(parsed.strips));
        assert.equal(reparsed.totalCount, 484);
        assert.deepEqual(reparsed.strips[0]!.points, parsed.strips[0]!.points);
        assert.equal(reparsed.strips[0]!.diameter, parsed.strips[0]!.diameter);
    });
});

describe('44x44 quad pinwheel preset', () => {
    const text = readFileSync(join(repoRoot, 'public', 'screenmaps', '44x44_quad_serpentine.json'), 'utf-8');
    const parsed = parseScreenmapMultiStrip(text);

    it('has 4 strips q0..q3 of 484 LEDs (1936 total)', () => {
        assert.deepEqual(parsed.strips.map((s) => s.name), ['q0', 'q1', 'q2', 'q3']);
        for (const strip of parsed.strips) {
            assert.equal(strip.count, 484, `strip ${strip.name}`);
        }
        assert.equal(parsed.totalCount, 1936);
    });

    it('every strip starts at the inner corner beside the center MCU', () => {
        for (const strip of parsed.strips) {
            const [x, y] = strip.points[0]!;
            assert.equal(Math.abs(x), 0.5, `strip ${strip.name} start x=${x}`);
            assert.equal(Math.abs(y), 0.5, `strip ${strip.name} start y=${y}`);
        }
    });

    it('covers the full 44x44 grid with no duplicates, centered on the MCU', () => {
        const seen = new Set(parsed.allPoints.map(([x, y]: [any, any]) => `${x},${y}`));
        assert.equal(seen.size, 1936);
        let cx = 0, cy = 0;
        for (const [x, y] of parsed.allPoints) {
            assert.ok(Math.abs(x) <= 21.5 && Math.abs(y) <= 21.5, `(${x},${y}) out of range`);
            cx += x; cy += y;
        }
        assert.ok(Math.abs(cx / 1936) < 1e-9 && Math.abs(cy / 1936) < 1e-9, 'centroid not at MCU center');
    });

    it('has sequential video offsets of 484 in key order', () => {
        parsed.strips.forEach((strip, i) => {
            assert.equal(strip.video_offset, i * 484, `strip ${strip.name}`);
        });
    });

    it('round-trips through buildScreenmapMultiStripJson', () => {
        const reparsed = parseScreenmapMultiStrip(buildScreenmapMultiStripJson(parsed.strips));
        assert.equal(reparsed.totalCount, parsed.totalCount);
        for (let i = 0; i < 4; i++) {
            assert.equal(reparsed.strips[i]!.name, parsed.strips[i]!.name);
            assert.deepEqual(reparsed.strips[i]!.points, parsed.strips[i]!.points);
        }
    });
});
