/**
 * Panel catalog: commodity LED matrices, rings, and strips with
 * configurable wiring (serpentine vs progressive), data-in corner
 * (TL/TR/BL/BR), rotation (0/90/180/270), and flip.
 *
 * Each catalog entry: { id, label, kind, cols?, rows?, count?, defaults }.
 * `generatePanelPoints(entry, opts)` returns a fresh array of [x,y]
 * coordinates in panel-local space, ordered along the wiring path.
 */
import { generateStrip, generateRing } from '../shape-presets.js';
import { generateStaggeredGrid } from '../staggered-fill.js';

/** @typedef {{wiring?:'serpentine'|'progressive', dataInCorner?:'TL'|'TR'|'BL'|'BR', rotation?:0|90|180|270, flipH?:boolean, flipV?:boolean, spacing?:number, cols?:number, rows?:number, stagger?:boolean}} PanelOpts */

export const PANEL_CATALOG = [
    { id: 'matrix-8x8',   label: '8Ã—8 Matrix',   kind: 'matrix', cols: 8,  rows: 8,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-16x16', label: '16Ã—16 Matrix', kind: 'matrix', cols: 16, rows: 16,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-8x32',  label: '8Ã—32 Matrix',  kind: 'matrix', cols: 8,  rows: 32,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-4x16',  label: '4Ã—16 Matrix',  kind: 'matrix', cols: 4,  rows: 16,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'ring-8',  label: 'Ring 8',  kind: 'ring', count: 8,  defaults: {} },
    { id: 'ring-12', label: 'Ring 12', kind: 'ring', count: 12, defaults: {} },
    { id: 'ring-16', label: 'Ring 16', kind: 'ring', count: 16, defaults: {} },
    { id: 'ring-24', label: 'Ring 24', kind: 'ring', count: 24, defaults: {} },
    { id: 'strip-60', label: 'Strip 60', kind: 'strip', count: 60, defaults: {} },
    { id: 'staggered-tcl', label: 'Staggered grid (TCL)', kind: 'staggered', cols: 8, rows: 8,
      defaults: { spacing: 2.54, stagger: true, diameter: 0.75 } },
];

export function getCatalogEntry(id) {
    return PANEL_CATALOG.find(e => e.id === id) || null;
}

/**
 * Generate a matrix in panel-local coords following the wiring path.
 * Local coordinate origin is the TL corner of the matrix (x: cols, y: rows).
 */
function generateMatrix(cols, rows, opts) {
    const wiring = opts.wiring || 'serpentine';
    const corner = opts.dataInCorner || 'TL';
    const spacing = typeof opts.spacing === 'number' ? opts.spacing : 1;

    // Decide row iteration order and starting column direction based on corner.
    // TL = start top-left, walking right. TR = start top-right, walking left.
    // BL = start bottom-left, walking right. BR = start bottom-right, walking left.
    const startTop = corner === 'TL' || corner === 'TR';
    const startLeft = corner === 'TL' || corner === 'BL';

    const pts = [];
    for (let r = 0; r < rows; r++) {
        const rowIdx = startTop ? r : (rows - 1 - r);
        // Direction for this row: flips each row when serpentine, fixed when progressive.
        const isFirstDir = (wiring === 'progressive') || (r % 2 === 0);
        const goRight = isFirstDir ? startLeft : !startLeft;
        for (let c = 0; c < cols; c++) {
            const colIdx = goRight ? c : (cols - 1 - c);
            pts.push([colIdx * spacing, rowIdx * spacing]);
        }
    }
    return pts;
}

/**
 * Apply rotation (0/90/180/270 degrees) and optional flips.
 * Coordinates only â€” LED order is preserved.
 */
function transformPoints(pts, rotation, flipH, flipV) {
    if (pts.length === 0) return pts;
    let out = pts.map(p => [p[0], p[1]]);
    const rot = ((rotation || 0) % 360 + 360) % 360;
    const z = (v) => (v === 0 ? 0 : v); // normalise -0 â†’ 0
    if (rot === 90) out = out.map(([x, y]) => [z(-y), z(x)]);
    else if (rot === 180) out = out.map(([x, y]) => [z(-x), z(-y)]);
    else if (rot === 270) out = out.map(([x, y]) => [z(y), z(-x)]);
    if (flipH) out = out.map(([x, y]) => [z(-x), y]);
    if (flipV) out = out.map(([x, y]) => [x, z(-y)]);
    return out;
}

/**
 * Generate the LED point list for a catalog entry.
 * @param {object} entry
 * @param {PanelOpts} opts
 * @returns {Array<[number,number]>}
 */
export function generatePanelPoints(entry, opts = {}) {
    const merged = { ...(entry.defaults || {}), ...opts };
    const spacing = typeof merged.spacing === 'number' ? merged.spacing : 1;
    let pts;
    if (entry.kind === 'matrix') {
        pts = generateMatrix(entry.cols, entry.rows, merged);
    } else if (entry.kind === 'ring') {
        // Ring radius scales with spacing for a reasonable footprint.
        const radius = spacing * entry.count / (2 * Math.PI);
        pts = generateRing(entry.count, radius);
    } else if (entry.kind === 'strip') {
        pts = generateStrip(entry.count, spacing);
    } else if (entry.kind === 'staggered') {
        pts = generateStaggeredGrid({
            cols: Math.max(1, Math.round(merged.cols) || entry.cols),
            rows: Math.max(1, Math.round(merged.rows) || entry.rows),
            spacingCm: spacing,
            stagger: merged.stagger !== false,
        });
    } else {
        pts = [];
    }
    return transformPoints(pts, merged.rotation, merged.flipH, merged.flipV);
}
