#!/usr/bin/env node
/**
 * Regenerates public/screenmaps/piano_grand.json — the "Luminescent Grand"
 * LED piano harp: 12 mm TCL bullet pixels hand-placed in CNC-drilled holes
 * as staggered vertical strand columns (hexagonal dense packing, 1" in-strand
 * pitch), wired as a vertical serpentine. Single strip, real-cm units.
 *
 * Usage: node scripts/generate-piano-grand.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateStaggeredColumns } from '../src/staggered-fill.js';

const SPACING_CM = 2.54;            // in-strand (vertical) TCL pitch: 1 inch
const WIDTH_CM = 132.08;            // keyboard-edge width: 52 inches
const DIAMETER_CM = 1.2;            // 12 mm TCL bullet pixel bulb

// Baldwin baby-grand harp outline traced from the original hand-built
// preset (pre-2026 piano_grand.json, 28 rows, y-pitch 0.42, x-pitch
// 0.176): per-row {y, xMin, xMax} extents in the original arbitrary
// units. Rescaled below so the widest row (the keyboard edge) spans
// WIDTH_CM.
const OUTLINE_ROWS = [
    { y: 0.00,  xMin: 1.0584, xMax: 7.5852 },
    { y: 0.42,  xMin: 0.7056, xMax: 7.938 },
    { y: 0.84,  xMin: 0.3528, xMax: 8.2908 },
    { y: 1.26,  xMin: 0,      xMax: 8.6436 },
    { y: 1.68,  xMin: 0,      xMax: 8.9964 },
    { y: 2.10,  xMin: 0,      xMax: 9.3492 },
    { y: 2.52,  xMin: 0,      xMax: 9.3492 },
    { y: 2.94,  xMin: 0,      xMax: 9.5256 },
    { y: 3.36,  xMin: 0,      xMax: 9.702 },
    { y: 3.78,  xMin: 0,      xMax: 9.702 },
    { y: 4.20,  xMin: 0,      xMax: 9.8784 },
    { y: 4.62,  xMin: 0,      xMax: 10.0548 },
    { y: 5.04,  xMin: 0,      xMax: 10.0548 },
    { y: 5.46,  xMin: 0,      xMax: 10.2312 },
    { y: 5.88,  xMin: 0,      xMax: 10.4076 },
    { y: 6.30,  xMin: 0,      xMax: 10.4076 },
    { y: 6.72,  xMin: 0,      xMax: 10.584 },
    { y: 7.14,  xMin: 0,      xMax: 10.7604 },
    { y: 7.56,  xMin: 0,      xMax: 11.1132 },
    { y: 7.98,  xMin: 0,      xMax: 11.466 },
    { y: 8.40,  xMin: 0,      xMax: 11.8188 },
    { y: 8.82,  xMin: 0,      xMax: 12.1716 },
    { y: 9.24,  xMin: 0,      xMax: 12.8772 },
    { y: 9.66,  xMin: 0,      xMax: 13.5828 },
    { y: 10.08, xMin: 0,      xMax: 14.2884 },
    { y: 10.50, xMin: 0,      xMax: 14.6412 },
    { y: 10.92, xMin: 0,      xMax: 14.994 },
    { y: 11.34, xMin: 0,      xMax: 15.1704 },
];

const SCALE = WIDTH_CM / 15.1704; // ≈ 8.7064 → real cm
// The traced rows mark the outermost LED holes of the old coarse grid;
// the physical board edge sits roughly half a hole-pitch beyond them, so
// grow the fill region by half the in-strand spacing on every side.
const MARGIN_CM = SPACING_CM / 2;

const rows = OUTLINE_ROWS.map((r) => ({
    y: r.y * SCALE,
    xMin: r.xMin * SCALE - MARGIN_CM,
    xMax: r.xMax * SCALE + MARGIN_CM,
}));

/**
 * Vertical extent of the harp at lateral position x: intersect the
 * vertical line with the linearly-interpolated left/right edges of each
 * row-to-row segment, then take the union of the resulting y-intervals.
 */
function heightAt(x) {
    let yMin = Infinity;
    let yMax = -Infinity;
    const yTop = rows[0].y - MARGIN_CM;
    const yBot = rows[rows.length - 1].y + MARGIN_CM;
    for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i];
        const b = rows[i + 1];
        let t0 = 0;
        let t1 = 1;
        // xMin(t) <= x  and  xMax(t) >= x, both linear in t
        for (const [v0, v1, sign] of [[a.xMin, b.xMin, 1], [a.xMax, b.xMax, -1]]) {
            const g0 = sign * (v0 - x);
            const g1 = sign * (v1 - x);
            if (g0 > 0 && g1 > 0) { t0 = 1; t1 = 0; break; }
            if (g0 > 0) t0 = Math.max(t0, g0 / (g0 - g1));
            else if (g1 > 0) t1 = Math.min(t1, g0 / (g0 - g1));
        }
        if (t0 > t1) continue;
        const ya = a.y + (b.y - a.y) * t0;
        const yb = a.y + (b.y - a.y) * t1;
        if (ya < yMin) yMin = ya;
        if (yb > yMax) yMax = yb;
    }
    if (yMin > yMax) return null;
    // Extend rows that already reach the outline's top/bottom row into the
    // vertical margin.
    if (yMin <= rows[0].y + 1e-9) yMin = yTop;
    if (yMax >= rows[rows.length - 1].y - 1e-9) yMax = yBot;
    return { yMin, yMax };
}

const { x, y } = generateStaggeredColumns({
    widthCm: WIDTH_CM,
    spacingCm: SPACING_CM,
    stagger: true,
    heightAt,
});

const round2 = (v) => Math.round(v * 100) / 100;
const out = {
    map: {
        strip1: {
            x: x.map(round2),
            y: y.map(round2),
            diameter: DIAMETER_CM,
        },
    },
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'screenmaps', 'piano_grand.json');
writeFileSync(outPath, JSON.stringify(out));

let minX = Infinity, maxX = -Infinity;
for (const v of x) { if (v < minX) minX = v; if (v > maxX) maxX = v; }
console.log(`piano_grand.json: ${x.length} LEDs, width ${(maxX - minX).toFixed(2)} cm`);
