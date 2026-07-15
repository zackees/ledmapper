import { minimumAreaObb, type OrientedBox, type Pt } from './strip-rotate';
export interface GroupStripRef { offset: number; count: number; }
const EPSILON = 1e-9;
export function normalizeStripIdxs(indices: Iterable<number>, stripCount: number): number[] { const seen = new Set<number>(); for (const idx of indices) if (Number.isInteger(idx) && idx >= 0 && idx < stripCount) seen.add(idx); return [...seen].sort((a, b) => a - b); }
export function flatPointIndicesForStrips(strips: readonly GroupStripRef[], indices: Iterable<number>): number[] { const result: number[] = []; for (const idx of normalizeStripIdxs(indices, strips.length)) { const strip = strips[idx]; if (!strip) continue; for (let i = strip.offset; i < strip.offset + strip.count; i++) result.push(i); } return result; }
export function canvasPointsForStrips(strips: readonly GroupStripRef[], points: readonly (Pt | null | undefined)[], indices: Iterable<number>): Pt[] { return flatPointIndicesForStrips(strips, indices).flatMap((idx) => { const point = points[idx]; return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [[point[0], point[1]] as Pt] : []; }); }
function inRect(p: Pt, minX: number, minY: number, maxX: number, maxY: number) { return p[0] >= minX - EPSILON && p[0] <= maxX + EPSILON && p[1] >= minY - EPSILON && p[1] <= maxY + EPSILON; }
function orient(a: Pt, b: Pt, c: Pt) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(a: Pt, b: Pt, p: Pt) { return Math.abs(orient(a, b, p)) <= EPSILON && p[0] >= Math.min(a[0], b[0]) - EPSILON && p[0] <= Math.max(a[0], b[0]) + EPSILON && p[1] >= Math.min(a[1], b[1]) - EPSILON && p[1] <= Math.max(a[1], b[1]) + EPSILON; }
function intersects(a: Pt, b: Pt, c: Pt, d: Pt) { const ac = orient(a, b, c), ad = orient(a, b, d), ca = orient(c, d, a), cb = orient(c, d, b); return (((ac > EPSILON && ad < -EPSILON) || (ac < -EPSILON && ad > EPSILON)) && ((ca > EPSILON && cb < -EPSILON) || (ca < -EPSILON && cb > EPSILON))) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b); }
export function stripIntersectsCanvasRect(strip: GroupStripRef, points: readonly (Pt | null | undefined)[], ax: number, ay: number, bx: number, by: number): boolean {
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
    const finite: Pt[] = [];
    for (let i = strip.offset; i < strip.offset + strip.count; i++) {
        const point = points[i];
        if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) finite.push(point);
    }
    if (finite.some((point) => inRect(point, minX, minY, maxX, maxY))) return true;
    const corners: Pt[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    for (let i = 1; i < finite.length; i++) {
        const start = finite[i - 1];
        const end = finite[i];
        if (!start || !end) continue;
        for (let edge = 0; edge < 4; edge++) {
            const edgeStart = corners[edge];
            const edgeEnd = corners[(edge + 1) % 4];
            if (edgeStart && edgeEnd && intersects(start, end, edgeStart, edgeEnd)) return true;
        }
    }
    return false;
}
export function stripsIntersectingCanvasRect(strips: readonly GroupStripRef[], points: readonly (Pt | null | undefined)[], ax: number, ay: number, bx: number, by: number): number[] { return strips.flatMap((strip, idx) => stripIntersectsCanvasRect(strip, points, ax, ay, bx, by) ? [idx] : []); }
export function selectedStripObbs(strips: readonly GroupStripRef[], points: readonly (Pt | null | undefined)[], indices: Iterable<number>): { idx: number; obb: OrientedBox }[] { return normalizeStripIdxs(indices, strips.length).flatMap((idx) => { const obb = minimumAreaObb(canvasPointsForStrips(strips, points, [idx])); return obb ? [{ idx, obb }] : []; }); }
export function aggregateSelectionObb(strips: readonly GroupStripRef[], points: readonly (Pt | null | undefined)[], indices: Iterable<number>): OrientedBox | null { return minimumAreaObb(canvasPointsForStrips(strips, points, indices)); }
