import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateStaggeredColumns, generateStaggeredGrid } from '../../src/staggered-fill.js';

const S = 2.54;
const LATERAL = S * Math.sqrt(3) / 2;
const EPS = 1e-6;

const rectHeightAt = (height) => () => ({ yMin: 0, yMax: height });

describe('generateStaggeredColumns', () => {
    it('offsets odd columns by spacing/2', () => {
        const { x, y } = generateStaggeredColumns({
            widthCm: LATERAL * 5, spacingCm: S, heightAt: rectHeightAt(S * 6),
        });
        const byCol = new Map();
        for (let i = 0; i < x.length; i++) {
            const c = Math.round(x[i] / LATERAL);
            if (!byCol.has(c)) byCol.set(c, []);
            byCol.get(c).push(y[i]);
        }
        assert.equal(byCol.size, 6);
        for (const [c, ys] of byCol) {
            const minY = Math.min(...ys);
            assert.ok(Math.abs(minY - (c % 2 === 1 ? S / 2 : 0)) < EPS,
                `column ${c} should start at ${c % 2 === 1 ? S / 2 : 0}, got ${minY}`);
        }
    });

    it('no stagger when stagger=false', () => {
        const { x, y } = generateStaggeredColumns({
            widthCm: LATERAL * 3, spacingCm: S, stagger: false, heightAt: rectHeightAt(S * 4),
        });
        for (let i = 0; i < x.length; i++) {
            assert.ok(Math.abs(y[i] / S - Math.round(y[i] / S)) < EPS);
        }
    });

    it('orders points as a vertical serpentine', () => {
        const { x, y } = generateStaggeredColumns({
            widthCm: LATERAL * 4, spacingCm: S, heightAt: rectHeightAt(S * 5),
        });
        let prevCol = -1;
        let dir = 0;
        for (let i = 1; i < x.length; i++) {
            const col = Math.round(x[i] / LATERAL);
            if (col !== Math.round(x[i - 1] / LATERAL)) {
                assert.equal(col, Math.round(x[i - 1] / LATERAL) + 1, 'columns advance left to right');
                prevCol = col;
                dir = 0;
                continue;
            }
            const step = Math.sign(y[i] - y[i - 1]);
            if (dir === 0) {
                dir = step;
                assert.equal(step, col % 2 === 0 ? 1 : -1, `column ${col} direction alternates`);
            } else {
                assert.equal(step, dir, `column ${prevCol} y is monotonic`);
            }
        }
    });

    it('respects heightAt regions and skips null columns', () => {
        const { x, y } = generateStaggeredColumns({
            widthCm: LATERAL * 4, spacingCm: S,
            heightAt: (px) => (px > LATERAL * 2.5 ? null : { yMin: S, yMax: S * 3 }),
        });
        assert.ok(x.length > 0);
        for (let i = 0; i < x.length; i++) {
            assert.ok(x[i] <= LATERAL * 2.5 + EPS);
            assert.ok(y[i] >= S - EPS && y[i] <= S * 3 + EPS);
        }
    });

    it('maintains hexagonal min nearest-neighbor distance', () => {
        const { x, y } = generateStaggeredColumns({
            widthCm: LATERAL * 7, spacingCm: S, heightAt: rectHeightAt(S * 7),
        });
        let minD = Infinity;
        for (let i = 0; i < x.length; i++) {
            for (let j = i + 1; j < x.length; j++) {
                const d = Math.hypot(x[i] - x[j], y[i] - y[j]);
                if (d < minD) minD = d;
            }
        }
        assert.ok(minD >= S * Math.sqrt(3) / 2 - EPS, `min NN ${minD} too small`);
        assert.ok(minD >= S - EPS, 'global lattice gives full hex spacing');
    });

    it('is deterministic', () => {
        const args = { widthCm: LATERAL * 6, spacingCm: S, heightAt: rectHeightAt(S * 6) };
        assert.deepEqual(generateStaggeredColumns(args), generateStaggeredColumns(args));
    });
});

describe('generateStaggeredGrid', () => {
    it('produces exactly cols*rows points with and without stagger', () => {
        assert.equal(generateStaggeredGrid({ cols: 8, rows: 8 }).length, 64);
        assert.equal(generateStaggeredGrid({ cols: 8, rows: 8, stagger: false }).length, 64);
        assert.equal(generateStaggeredGrid({ cols: 5, rows: 3, spacingCm: 1 }).length, 15);
        assert.equal(generateStaggeredGrid({ cols: 1, rows: 1 }).length, 1);
    });

    it('odd columns are offset by spacing/2', () => {
        const pts = generateStaggeredGrid({ cols: 4, rows: 4, spacingCm: S });
        for (const [px, py] of pts) {
            const c = Math.round(px / LATERAL);
            const expectedPhase = c % 2 === 1 ? S / 2 : 0;
            const phase = ((py % S) + S) % S;
            assert.ok(Math.abs(phase - expectedPhase) < EPS);
        }
    });

    it('returns [] for invalid sizes', () => {
        assert.deepEqual(generateStaggeredGrid({ cols: 0, rows: 5 }), []);
        assert.deepEqual(generateStaggeredGrid({ cols: 5, rows: NaN }), []);
    });
});

describe('regenerated piano_grand.json preset', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const preset = JSON.parse(readFileSync(join(root, 'public', 'screenmaps', 'piano_grand.json'), 'utf8'));
    const strip = preset.map.strip1;

    it('has a single strip1 with matching x/y arrays', () => {
        assert.deepEqual(Object.keys(preset.map), ['strip1']);
        assert.equal(strip.x.length, strip.y.length);
    });

    it('total LED count is in [1700, 1820] (~1760 physical pixels)', () => {
        assert.ok(strip.x.length >= 1700 && strip.x.length <= 1820,
            `count ${strip.x.length} outside range`);
    });

    it('diameter is 1.2 cm (12 mm TCL bullet pixel)', () => {
        assert.equal(strip.diameter, 1.2);
    });

    it('width is ~132.08 cm (52 in)', () => {
        const w = Math.max(...strip.x) - Math.min(...strip.x);
        assert.ok(Math.abs(w - 132.08) < 2.2, `width ${w}`);
    });

    it('no two points closer than 2.19 cm', () => {
        const { x, y } = strip;
        let minD2 = Infinity;
        for (let i = 0; i < x.length; i++) {
            for (let j = i + 1; j < x.length; j++) {
                const dx = x[i] - x[j];
                const dy = y[i] - y[j];
                const d2 = dx * dx + dy * dy;
                if (d2 < minD2) minD2 = d2;
            }
        }
        assert.ok(Math.sqrt(minD2) >= 2.19, `min NN ${Math.sqrt(minD2)}`);
    });

    it('generator script reproduces the committed file', () => {
        const before = readFileSync(join(root, 'public', 'screenmaps', 'piano_grand.json'), 'utf8');
        execFileSync(process.execPath, [join(root, 'scripts', 'generate-piano-grand.mjs')]);
        const after = readFileSync(join(root, 'public', 'screenmaps', 'piano_grand.json'), 'utf8');
        assert.equal(after, before);
    });
});
