/**
 * Pure geometry helpers for the per-strip rotation handle in the shape editor.
 *
 * The handle rotates an individual strip's points (a v2 sub-group) around
 * the strip's bounding-box center, independently of the global
 * whole-screenmap rotation in the transform-overlay gizmo.
 */

export type Pt = [number, number];

export interface OrientedBox {
    cx: number;
    cy: number;
    cos: number;
    sin: number;
    hw: number;
    hh: number;
}

const EPSILON = 1e-9;

function cross(a: Pt, b: Pt, c: Pt): number {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function convexHull(points: readonly Pt[]): Pt[] {
    const sorted = [...points]
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
    const unique = sorted.filter((point, index) => index === 0 || point[0] !== sorted[index - 1]?.[0] || point[1] !== sorted[index - 1]?.[1]);
    if (unique.length <= 2) return unique;
    const lower: Pt[] = [];
    for (const point of unique) {
        while (lower.length >= 2) {
            const penultimate = lower[lower.length - 2] ?? point;
            const previous = lower[lower.length - 1] ?? point;
            if (cross(penultimate, previous, point) > 0) break;
            lower.pop();
        }
        lower.push(point);
    }
    const upper: Pt[] = [];
    for (const point of [...unique].reverse()) {
        while (upper.length >= 2) {
            const penultimate = upper[upper.length - 2] ?? point;
            const previous = upper[upper.length - 1] ?? point;
            if (cross(penultimate, previous, point) > 0) break;
            upper.pop();
        }
        upper.push(point);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function normalizeAxis(cos: number, sin: number): [number, number] {
    // An undirected box axis has two equivalent signs. Pick one deterministically.
    return cos < -EPSILON || (Math.abs(cos) <= EPSILON && sin < 0) ? [-cos, -sin] : [cos, sin];
}

/** Minimum-area oriented bounding box for canvas-space points. */
export function minimumAreaObb(points: readonly Pt[]): OrientedBox | null {
    const hull = convexHull(points);
    if (hull.length === 0) return null;
    if (hull.length === 1) return { cx: hull[0]![0], cy: hull[0]![1], cos: 1, sin: 0, hw: 0, hh: 0 };

    let best: OrientedBox | null = null;
    let bestArea = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i] ?? [0, 0];
        const b = hull[(i + 1) % hull.length] ?? [0, 0];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length <= EPSILON) continue;
        let cos = (b[0] - a[0]) / length;
        let sin = (b[1] - a[1]) / length;
        [cos, sin] = normalizeAxis(cos, sin);
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const [x, y] of hull) {
            const u = x * cos + y * sin;
            const v = -x * sin + y * cos;
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        const width = maxU - minU;
        const height = maxV - minV;
        const area = width * height;
        // Prefer the long edge as the x-axis. This removes the otherwise
        // equivalent 90-degree representation for rectangles.
        if (height > width + EPSILON) {
            [cos, sin] = normalizeAxis(-sin, cos);
            const oldMinU = minU, oldMaxU = maxU, oldMinV = minV, oldMaxV = maxV;
            minU = oldMinV; maxU = oldMaxV;
            minV = -oldMaxU; maxV = -oldMinU;
        }
        if (area < bestArea - EPSILON) {
            const centerU = (minU + maxU) / 2;
            const centerV = (minV + maxV) / 2;
            best = { cx: centerU * cos - centerV * sin, cy: centerU * sin + centerV * cos, cos, sin, hw: (maxU - minU) / 2, hh: (maxV - minV) / 2 };
            bestArea = area;
        }
    }
    return best;
}

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
