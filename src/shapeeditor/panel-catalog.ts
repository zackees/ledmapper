/**
 * Panel catalog: commodity LED matrices, rings, and strips with
 * configurable wiring (serpentine vs progressive), data-in corner
 * (TL/TR/BL/BR), rotation (0/90/180/270), and flip.
 *
 * Each catalog entry: { id, label, kind, cols?, rows?, count?, defaults }.
 * `generatePanelPoints(entry, opts)` returns a fresh array of [x,y]
 * coordinates in panel-local space, ordered along the wiring path.
 */
import { generateStrip, generateRing } from '../shape-presets';

export type DataInCorner = 'TL' | 'TR' | 'BL' | 'BR';
export type WiringStyle = 'serpentine' | 'progressive';
export type RotationDeg = 0 | 90 | 180 | 270;

export interface PanelOpts {
    wiring?: WiringStyle;
    dataInCorner?: DataInCorner;
    rotation?: RotationDeg;
    flipH?: boolean;
    flipV?: boolean;
    spacing?: number;
}

export interface CatalogEntry {
    id: string;
    label: string;
    kind: 'matrix' | 'ring' | 'strip';
    cols?: number;
    rows?: number;
    count?: number;
    defaults: Partial<PanelOpts>;
}

export const PANEL_CATALOG: CatalogEntry[] = [
    { id: 'matrix-8x8',   label: '8×8 Matrix',   kind: 'matrix', cols: 8,  rows: 8,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-16x16', label: '16×16 Matrix', kind: 'matrix', cols: 16, rows: 16,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-8x32',  label: '8×32 Matrix',  kind: 'matrix', cols: 8,  rows: 32,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'matrix-4x16',  label: '4×16 Matrix',  kind: 'matrix', cols: 4,  rows: 16,
      defaults: { wiring: 'serpentine', dataInCorner: 'TL' } },
    { id: 'ring-8',  label: 'Ring 8',  kind: 'ring', count: 8,  defaults: {} },
    { id: 'ring-12', label: 'Ring 12', kind: 'ring', count: 12, defaults: {} },
    { id: 'ring-16', label: 'Ring 16', kind: 'ring', count: 16, defaults: {} },
    { id: 'ring-24', label: 'Ring 24', kind: 'ring', count: 24, defaults: {} },
    { id: 'strip-60', label: 'Strip 60', kind: 'strip', count: 60, defaults: {} },
];

export function getCatalogEntry(id: string): CatalogEntry | null {
    return PANEL_CATALOG.find(e => e.id === id) ?? null;
}

/**
 * Generate a matrix in panel-local coords following the wiring path.
 * Local coordinate origin is the TL corner of the matrix (x: cols, y: rows).
 */
function generateMatrix(cols: number, rows: number, opts: PanelOpts): [number, number][] {
    const wiring = opts.wiring ?? 'serpentine';
    const corner = opts.dataInCorner ?? 'TL';
    const spacing = typeof opts.spacing === 'number' ? opts.spacing : 1;

    // Decide row iteration order and starting column direction based on corner.
    // TL = start top-left, walking right. TR = start top-right, walking left.
    // BL = start bottom-left, walking right. BR = start bottom-right, walking left.
    const startTop = corner === 'TL' || corner === 'TR';
    const startLeft = corner === 'TL' || corner === 'BL';

    const pts: [number, number][] = [];
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
 * Coordinates only — LED order is preserved.
 */
function transformPoints(pts: [number, number][], rotation: RotationDeg | undefined, flipH: boolean | undefined, flipV: boolean | undefined): [number, number][] {
    if (pts.length === 0) return pts;
    let out: [number, number][] = pts.map(p => [p[0], p[1]]);
    const rot = ((rotation ?? 0) % 360 + 360) % 360;
    const z = (v: number) => (v === 0 ? 0 : v); // normalise -0 → 0
    if (rot === 90) out = out.map(([x, y]) => [z(-y), z(x)]);
    else if (rot === 180) out = out.map(([x, y]) => [z(-x), z(-y)]);
    else if (rot === 270) out = out.map(([x, y]) => [z(y), z(-x)]);
    if (flipH) out = out.map(([x, y]) => [z(-x), y]);
    if (flipV) out = out.map(([x, y]) => [x, z(-y)]);
    return out;
}

/**
 * Generate the LED point list for a catalog entry.
 * @param entry
 * @param opts
 * @returns {Array<[number,number]>}
 */
export function generatePanelPoints(entry: CatalogEntry, opts: PanelOpts = {}): [number, number][] {
    const merged: PanelOpts = { ...(entry.defaults ?? {}), ...opts };
    const spacing = typeof merged.spacing === 'number' ? merged.spacing : 1;
    let pts: [number, number][];
    if (entry.kind === 'matrix') {
        pts = generateMatrix(entry.cols ?? 1, entry.rows ?? 1, merged);
    } else if (entry.kind === 'ring') {
        // Ring radius scales with spacing for a reasonable footprint.
        const radius = spacing * (entry.count ?? 1) / (2 * Math.PI);
        pts = generateRing(entry.count ?? 1, radius);
    } else if (entry.kind === 'strip') {
        pts = generateStrip(entry.count ?? 1, spacing);
    } else {
        pts = [];
    }
    return transformPoints(pts, merged.rotation, merged.flipH, merged.flipV);
}
