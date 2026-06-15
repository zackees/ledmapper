/**
 * Pure geometry helpers for the per-strip rotation handle in the shape editor.
 *
 * The handle rotates an individual strip's points (a v2 sub-group) around
 * the strip's bounding-box center, independently of the global
 * whole-screenmap rotation in the transform-overlay gizmo.
 */

export type Pt = [number, number];

/** Axis-aligned bounding-box center of a list of points. Returns null if empty. */
export function bboxCenter(pts: Pt[]): { x: number; y: number } | null {
    if (pts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Rotate `pts` around `(cx, cy)` by `deltaRad`. Returns a fresh array;
 * caller decides whether to splice it back into the source.
 */
export function rotatePointsAround(
    pts: readonly Pt[],
    cx: number,
    cy: number,
    deltaRad: number,
): Pt[] {
    const cos = Math.cos(deltaRad);
    const sin = Math.sin(deltaRad);
    const out: Pt[] = new Array(pts.length) as Pt[];
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i] ?? [0, 0];
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        out[i] = [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    }
    return out;
}
