/**
 * Snap-target precompute for the strip-drag magnetic snap (issue #110).
 *
 * For each strip OTHER than the one being dragged, emit:
 *   - X targets: cx_B + k·pitch_B  for k ∈ {-3, -2, -1, 0, 1, 2, 3}
 *   - Y targets: cy_B + k·pitch_B  for k ∈ {-3, -2, -1, 0, 1, 2, 3}
 *
 * (cx_B, cy_B) is the strip's centroid; pitch_B is the median distance
 * between consecutive LEDs in that strip. k=0 preserves the existing
 * center-to-center snap from issue #105 and is always emitted.
 *
 * k≠0 candidates are skipped when:
 *   - the strip has fewer than 2 LEDs (pitch undefined), or
 *   - max(consecutive-distance) > 3·median (irregular/curved strip — a
 *     bricklayer grid wouldn't be useful here).
 *
 * Points are read from world-space `screenmap_pts` (already post-
 * transform), so rotation is folded in: the pitch is the on-screen LED
 * spacing regardless of strip orientation.
 */

export interface SnapStripRef {
    offset: number;
    count: number;
}

export interface SnapTargets {
    xTargets: number[];
    yTargets: number[];
}

const PITCH_K = [1, 2, 3];

export function computeStripSnapTargets(
    strips: readonly SnapStripRef[],
    draggedIdx: number,
    points: readonly ([number, number] | null | undefined)[],
): SnapTargets {
    const xTargets: number[] = [];
    const yTargets: number[] = [];
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

        if (dists.length === 0) continue;
        const sorted = dists.slice().sort((a, b) => a - b);
        const median = sorted[(sorted.length - 1) >> 1] ?? 0;
        if (median <= 0) continue;
        const maxD = sorted[sorted.length - 1] ?? 0;
        if (maxD > 3 * median) continue;
        for (const k of PITCH_K) {
            const d = k * median;
            xTargets.push(cx + d, cx - d);
            yTargets.push(cy + d, cy - d);
        }
    }
    return { xTargets, yTargets };
}
