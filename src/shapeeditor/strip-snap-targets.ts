/**
 * Snap-target precompute for the strip-drag magnetic snap.
 *
 * Two pitch sources are emitted onto each axis target list, in addition
 * to every other strip's bare center (k=0, issue #105):
 *
 *   1. Per-strip LED pitch (issue #110): `B.center ± k · LED_pitch_B` for
 *      k ∈ {1, 2, 3}, where LED_pitch_B is the median LED-to-LED distance
 *      inside neighbor strip B. Useful when the dragged strip should
 *      sit one LED away from a neighbor's existing LED column/row.
 *
 *   2. Inter-strip grid pitch (issue #115): `B.center ± k · grid_pitch`
 *      for k ∈ {1..5} on every neighbor B, where `grid_pitch` is inferred
 *      from the spacing between *strip centers* themselves. Useful when
 *      the dragged strip should sit one PANEL away — the bricklayer use
 *      case where a uniform panel grid exposes implicit grid lines that
 *      no individual strip occupies.
 *
 * The inter-strip pitch is computed per axis (X, Y) from the sorted
 * centers of all other strips. When a `draggedCenter` is supplied,
 * a perpendicular band filter narrows the pitch-inference set to
 * neighbors that sit in the same "row" (for X-pitch) or "column"
 * (for Y-pitch) as the dragged strip — see `gatherAxisCentersInBand`.
 *
 * Points are read from world-space `screenmap_pts` (already post-
 * transform), so rotation is folded in: the pitches are the on-screen
 * spacings regardless of strip orientation.
 */

export interface SnapStripRef {
    offset: number;
    count: number;
}

export interface SnapTargets {
    xTargets: number[];
    yTargets: number[];
}

const LED_PITCH_K = [1, 2, 3];
const GRID_PITCH_K = [1, 2, 3, 4, 5];

/** True median: average of the two middle values for even-length input. */
function trueMedian(sorted: readonly number[]): number {
    const n = sorted.length;
    if (n === 0) return 0;
    const mid = n >> 1;
    if (n % 2 === 1) return sorted[mid] ?? 0;
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Narrow a list of neighbor centers to those within the "near" cluster
 * on the perpendicular axis relative to `draggedPerp`.
 *
 * Algorithm: sort the perpendicular distances; the threshold is the
 * smallest distance strictly greater than the minimum (the first gap).
 * Anything below that threshold is in the same row/column band; anything
 * at or above it is an outlier and gets excluded from pitch inference.
 *
 * Falls back to "include all" when no draggedPerp is supplied or when
 * all neighbors share the same perpendicular position.
 */
function bandFilterIndices(
    perpCoords: readonly number[],
    draggedPerp: number | undefined,
): number[] {
    const all = perpCoords.map((_, i) => i);
    if (draggedPerp === undefined) return all;
    if (perpCoords.length < 2) return all;
    const dists = perpCoords.map((p) => Math.abs(p - draggedPerp));
    const sortedDists = dists.slice().sort((a, b) => a - b);
    const min = sortedDists[0] ?? 0;
    let threshold = Number.POSITIVE_INFINITY;
    for (const d of sortedDists) {
        if (d > min + 1e-6) { threshold = d; break; }
    }
    if (!Number.isFinite(threshold)) return all;
    const kept: number[] = [];
    for (let i = 0; i < dists.length; i++) {
        if ((dists[i] ?? 0) < threshold) kept.push(i);
    }
    return kept;
}

/**
 * Compute one axis's inter-strip pitch from a filtered set of neighbor
 * centers. Returns 0 when there aren't enough centers or the variance
 * guard fires.
 */
function inferGridPitch(
    centers: readonly number[],
    indices: readonly number[],
): number {
    if (indices.length < 2) return 0;
    const filtered = indices.map((i) => centers[i] ?? 0);
    const sorted = filtered.slice().sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        diffs.push((sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
    }
    if (diffs.length === 0) return 0;
    const sortedDiffs = diffs.slice().sort((a, b) => a - b);
    const median = trueMedian(sortedDiffs);
    if (median <= 0) return 0;
    const maxD = sortedDiffs[sortedDiffs.length - 1] ?? 0;
    if (maxD > 3 * median) return 0;
    return median;
}

export function computeStripSnapTargets(
    strips: readonly SnapStripRef[],
    draggedIdx: number,
    points: readonly ([number, number] | null | undefined)[],
    draggedCenter?: { x: number; y: number },
): SnapTargets {
    const xTargets: number[] = [];
    const yTargets: number[] = [];

    const neighborCx: number[] = [];
    const neighborCy: number[] = [];

    for (let si = 0; si < strips.length; si++) {
        if (si === draggedIdx) continue;
        const s = strips[si];
        if (!s || s.count <= 0) continue;

        let sx = 0, sy = 0, cnt = 0;
        const dists: number[] = [];
        let prev: [number, number] | null = null;
        for (let k = s.offset; k < s.offset + s.count; k++) {
            const p = points[k];
            if (!p) continue;
            sx += p[0]; sy += p[1]; cnt++;
            if (prev) {
                const dx = p[0] - prev[0];
                const dy = p[1] - prev[1];
                dists.push(Math.sqrt(dx * dx + dy * dy));
            }
            prev = p;
        }
        if (cnt === 0) continue;

        const cx = sx / cnt;
        const cy = sy / cnt;
        xTargets.push(cx);
        yTargets.push(cy);
        neighborCx.push(cx);
        neighborCy.push(cy);

        if (dists.length === 0) continue;
        const sorted = dists.slice().sort((a, b) => a - b);
        // Lower-middle median — preserved from #110 so its variance guard
        // (max > 3·median) keeps the same calibration.
        const median = sorted[(sorted.length - 1) >> 1] ?? 0;
        if (median <= 0) continue;
        const maxD = sorted[sorted.length - 1] ?? 0;
        if (maxD > 3 * median) continue;
        for (const k of LED_PITCH_K) {
            const d = k * median;
            xTargets.push(cx + d, cx - d);
            yTargets.push(cy + d, cy - d);
        }
    }

    // ── Inter-strip grid pitch (issue #115) ─────────────────────────────
    // For X-pitch, band-filter by Y-perp distance; for Y-pitch, by X-perp.
    const xBand = bandFilterIndices(neighborCy, draggedCenter?.y);
    const xPitch = inferGridPitch(neighborCx, xBand);
    if (xPitch > 0) {
        for (const cx of neighborCx) {
            for (const k of GRID_PITCH_K) {
                xTargets.push(cx + k * xPitch, cx - k * xPitch);
            }
        }
    }
    const yBand = bandFilterIndices(neighborCx, draggedCenter?.x);
    const yPitch = inferGridPitch(neighborCy, yBand);
    if (yPitch > 0) {
        for (const cy of neighborCy) {
            for (const k of GRID_PITCH_K) {
                yTargets.push(cy + k * yPitch, cy - k * yPitch);
            }
        }
    }

    return { xTargets, yTargets };
}
