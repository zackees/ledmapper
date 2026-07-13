/**
 * DOM-free geometry, target generation, and resolution for whole-strip
 * magnetic snapping.  All coordinates in this module are rendered-world
 * coordinates (after document transform, before camera pan/zoom).
 */

export interface SnapStripRef {
    offset: number;
    count: number;
}

export interface SnapRulerRef {
    ax: number;
    ay: number;
    bx: number;
    by: number;
}

export type SnapAxis = 'x' | 'y';
export type SnapAnchorKind = 'centroid' | 'min' | 'max';
export type AxisSnapKind =
    | 'centroid'
    | 'led-pitch'
    | 'grid-pitch'
    | 'bbox-edge'
    | 'row'
    | 'column'
    | 'ruler-endpoint';

export interface StripSnapGeometry {
    centroid: { x: number; y: number };
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface AxisSnapTarget {
    id: number;
    axis: SnapAxis;
    value: number;
    kind: AxisSnapKind;
    anchors: readonly SnapAnchorKind[];
    order: number;
    sourceStripIdx?: number;
    sourceRulerIdx?: number;
    sourceEndpoint?: 'a' | 'b';
    supportStripIdxs?: readonly number[];
    /** All kinds merged into this coordinate, in stable emission order. */
    sourceKinds?: readonly AxisSnapKind[];
}

export interface RulerBodySnapTarget {
    id: number;
    kind: 'ruler-body';
    sourceRulerIdx: number;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    order: number;
}

export interface StripSnapTargetSet {
    x: AxisSnapTarget[];
    y: AxisSnapTarget[];
    rulerBodies: RulerBodySnapTarget[];
}

export type StripSnapEngagement =
    | { mode: 'none' }
    | { mode: 'origin' }
    | {
        mode: 'axis';
        x: { targetId: number; anchor: SnapAnchorKind } | null;
        y: { targetId: number; anchor: SnapAnchorKind } | null;
      }
    | { mode: 'ruler-body'; targetId: number; sourceRulerIdx: number };

export interface SnapDocumentTransform {
    scaleX: number;
    scaleY: number;
    cos: number;
    sin: number;
    translateX?: number;
    translateY?: number;
}

export interface StripSnapTargetInput {
    strips: readonly SnapStripRef[];
    draggedIdx: number;
    points: readonly ([number, number] | null | undefined)[];
    rulers?: readonly SnapRulerRef[];
    toleranceWorld?: number;
}

export interface StripSnapResolveInput {
    cursorDxPx: number;
    cursorDyPx: number;
    rawDx: number;
    rawDy: number;
    startGeometry: StripSnapGeometry | null;
    targets: StripSnapTargetSet;
    camZoom: number;
    tolerancePx: number;
    snapEnabled: boolean;
    shiftBypass: boolean;
}

export interface StripSnapResolveResult {
    dx: number;
    dy: number;
    engagement: StripSnapEngagement;
}

const LED_PITCH_K = [1, 2, 3];
const GRID_PITCH_K = [1, 2, 3, 4, 5];
const TARGET_EPSILON = 1e-9;
const ANCHOR_ORDER: readonly SnapAnchorKind[] = ['centroid', 'min', 'max'];

/** True median: average of the two middle values for even-length input. */
export function trueMedian(sorted: readonly number[]): number {
    const n = sorted.length;
    if (n === 0) return 0;
    const mid = n >> 1;
    if (n % 2 === 1) return sorted[mid] ?? 0;
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function finitePoint(point: [number, number] | null | undefined): point is [number, number] {
    if (!point) return false;
    return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/** Compute the arithmetic-mean center and world AABB of valid points. */
export function computeStripSnapGeometry(
    points: readonly ([number, number] | null | undefined)[],
): StripSnapGeometry | null {
    let sx = 0;
    let sy = 0;
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        if (!finitePoint(point)) continue;
        sx += point[0];
        sy += point[1];
        count++;
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
    }
    if (count === 0) return null;
    return {
        centroid: { x: sx / count, y: sy / count },
        bounds: { minX, maxX, minY, maxY },
    };
}

export function transformPointForSnap(
    point: [number, number],
    transform: SnapDocumentTransform,
): [number, number] {
    const sx = point[0] * transform.scaleX;
    const sy = point[1] * transform.scaleY;
    return [
        sx * transform.cos - sy * transform.sin + (transform.translateX ?? 0),
        sx * transform.sin + sy * transform.cos + (transform.translateY ?? 0),
    ];
}

/** Convert a rendered-world delta through the inverse document transform. */
export function inverseTransformSnapDelta(
    delta: { x: number; y: number },
    transform: SnapDocumentTransform,
): { x: number; y: number } {
    const ux = delta.x * transform.cos + delta.y * transform.sin;
    const uy = -delta.x * transform.sin + delta.y * transform.cos;
    return {
        x: transform.scaleX !== 0 ? ux / transform.scaleX : 0,
        y: transform.scaleY !== 0 ? uy / transform.scaleY : 0,
    };
}

export function emptyStripSnapTargetSet(): StripSnapTargetSet {
    return { x: [], y: [], rulerBodies: [] };
}

function bandFilterIndices(perpCoords: readonly number[], draggedPerp: number): number[] {
    if (perpCoords.length < 2) return perpCoords.map((_, i) => i);
    const dists = perpCoords.map((p) => Math.abs(p - draggedPerp));
    const sortedDists = dists.slice().sort((a, b) => a - b);
    const min = sortedDists[0] ?? 0;
    let threshold = Infinity;
    for (const distance of sortedDists) {
        if (distance > min + TARGET_EPSILON) {
            threshold = distance;
            break;
        }
    }
    if (!Number.isFinite(threshold)) return perpCoords.map((_, i) => i);
    return dists.reduce<number[]>((kept, distance, index) => {
        if (distance < threshold) kept.push(index);
        return kept;
    }, []);
}

function inferGridPitch(centers: readonly number[], indices: readonly number[]): number {
    if (indices.length < 2) return 0;
    const sorted = indices.map((i) => centers[i] ?? 0).sort((a, b) => a - b);
    const diffs: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        diffs.push((sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
    }
    if (diffs.length === 0) return 0;
    const sortedDiffs = diffs.slice().sort((a, b) => a - b);
    const median = trueMedian(sortedDiffs);
    const maxDiff = sortedDiffs[sortedDiffs.length - 1] ?? 0;
    return median > 0 && maxDiff <= 3 * median ? median : 0;
}

interface NeighborGeometry {
    stripIdx: number;
    geometry: StripSnapGeometry;
    pitch: number;
}

function stripPoints(
    strip: SnapStripRef,
    points: readonly ([number, number] | null | undefined)[],
): ([number, number] | null | undefined)[] {
    const result: ([number, number] | null | undefined)[] = [];
    for (let i = strip.offset; i < strip.offset + strip.count; i++) result.push(points[i]);
    return result;
}

function medianLedPitch(points: readonly ([number, number] | null | undefined)[]): number {
    const distances: number[] = [];
    let previous: [number, number] | null = null;
    for (const point of points) {
        if (!finitePoint(point)) continue;
        if (previous) {
            distances.push(Math.hypot(point[0] - previous[0], point[1] - previous[1]));
        }
        previous = point;
    }
    if (distances.length === 0) return 0;
    const sorted = distances.slice().sort((a, b) => a - b);
    const median = sorted[(sorted.length - 1) >> 1] ?? 0;
    const maxDistance = sorted[sorted.length - 1] ?? 0;
    return median > 0 && maxDistance <= 3 * median ? median : 0;
}

interface MutableAxisTarget extends AxisSnapTarget {
    anchors: SnapAnchorKind[];
    sourceKinds: AxisSnapKind[];
    supportStripIdxs?: number[];
}

function clusterTargets(
    values: readonly { value: number; stripIdx: number }[],
    toleranceWorld: number,
): { value: number; supportStripIdxs: number[] }[] {
    if (!Number.isFinite(toleranceWorld) || toleranceWorld <= 0) return [];
    const sorted = values.slice().sort((a, b) => a.value - b.value || a.stripIdx - b.stripIdx);
    const clusters: { members: { value: number; stripIdx: number }[] }[] = [];
    for (const item of sorted) {
        const current = clusters[clusters.length - 1];
        const min = current?.members[0]?.value ?? item.value;
        const max = current?.members[current.members.length - 1]?.value ?? item.value;
        if (current && item.value - min <= 2 * toleranceWorld && item.value - max <= 2 * toleranceWorld) {
            current.members.push(item);
        } else {
            clusters.push({ members: [item] });
        }
    }
    return clusters
        .filter((cluster) => cluster.members.length >= 2)
        .map((cluster) => ({
            value: trueMedian(cluster.members.map((member) => member.value).sort((a, b) => a - b)),
            supportStripIdxs: cluster.members.map((member) => member.stripIdx).sort((a, b) => a - b),
        }))
        .filter((entry) => Number.isFinite(entry.value));
}

function dedupeAxisTargets(targets: MutableAxisTarget[]): AxisSnapTarget[] {
    const result: MutableAxisTarget[] = [];
    for (const target of targets) {
        if (!Number.isFinite(target.value)) continue;
        const existing = result.find((candidate) => (
            candidate.axis === target.axis
            && Math.abs(candidate.value - target.value) <= TARGET_EPSILON
        ));
        if (!existing) {
            const clone: MutableAxisTarget = {
                ...target,
                anchors: [...target.anchors],
                sourceKinds: [...target.sourceKinds],
            };
            if (target.supportStripIdxs) clone.supportStripIdxs = [...target.supportStripIdxs];
            result.push(clone);
            continue;
        }
        existing.anchors = ANCHOR_ORDER.filter((anchor) => (
            existing.anchors.includes(anchor) || target.anchors.includes(anchor)
        ));
        existing.sourceKinds = [...new Set([...existing.sourceKinds, ...target.sourceKinds])];
        existing.supportStripIdxs = [...new Set([
            ...(existing.supportStripIdxs ?? []),
            ...(target.supportStripIdxs ?? []),
        ])].sort((a, b) => a - b);
    }
    return result;
}

/** Build all legacy and advanced targets once at drag start. */
export function computeStripSnapTargets(input: StripSnapTargetInput): StripSnapTargetSet {
    const x: MutableAxisTarget[] = [];
    const y: MutableAxisTarget[] = [];
    const rulerBodies: RulerBodySnapTarget[] = [];
    let nextId = 0;
    const neighbors: NeighborGeometry[] = [];
    const neighborCx: number[] = [];
    const neighborCy: number[] = [];

    const pushAxis = (
        axis: SnapAxis,
        value: number,
        kind: AxisSnapKind,
        anchors: readonly SnapAnchorKind[],
        metadata: Partial<AxisSnapTarget> = {},
    ) => {
        const target: MutableAxisTarget = {
            id: nextId++, axis, value, kind, anchors: [...anchors],
            order: nextId - 1, sourceKinds: [kind],
        };
        if (metadata.sourceStripIdx !== undefined) target.sourceStripIdx = metadata.sourceStripIdx;
        if (metadata.sourceRulerIdx !== undefined) target.sourceRulerIdx = metadata.sourceRulerIdx;
        if (metadata.sourceEndpoint !== undefined) target.sourceEndpoint = metadata.sourceEndpoint;
        if (metadata.supportStripIdxs !== undefined) target.supportStripIdxs = [...metadata.supportStripIdxs];
        (axis === 'x' ? x : y).push(target);
    };

    for (let stripIdx = 0; stripIdx < input.strips.length; stripIdx++) {
        if (stripIdx === input.draggedIdx) continue;
        const strip = input.strips[stripIdx];
        if (!strip || strip.count <= 0) continue;
        const points = stripPoints(strip, input.points);
        const geometry = computeStripSnapGeometry(points);
        if (!geometry) continue;
        const pitch = medianLedPitch(points);
        neighbors.push({ stripIdx, geometry, pitch });
        const { x: cx, y: cy } = geometry.centroid;
        neighborCx.push(cx);
        neighborCy.push(cy);

        // Preserve the old emission order: center, then LED-pitch candidates.
        pushAxis('x', cx, 'centroid', ['centroid'], { sourceStripIdx: stripIdx });
        pushAxis('y', cy, 'centroid', ['centroid'], { sourceStripIdx: stripIdx });
        if (pitch > 0) {
            for (const k of LED_PITCH_K) {
                const distance = k * pitch;
                pushAxis('x', cx + distance, 'led-pitch', ['centroid'], { sourceStripIdx: stripIdx });
                pushAxis('x', cx - distance, 'led-pitch', ['centroid'], { sourceStripIdx: stripIdx });
                pushAxis('y', cy + distance, 'led-pitch', ['centroid'], { sourceStripIdx: stripIdx });
                pushAxis('y', cy - distance, 'led-pitch', ['centroid'], { sourceStripIdx: stripIdx });
            }
        }
    }

    const draggedPoints = input.draggedIdx >= 0 && input.draggedIdx < input.strips.length
        ? stripPoints(input.strips[input.draggedIdx] ?? { offset: 0, count: 0 }, input.points)
        : [];
    const draggedGeometry = computeStripSnapGeometry(draggedPoints);
    const draggedCenter = draggedGeometry?.centroid ?? { x: 0, y: 0 };

    // Preserve #115's inter-strip pitch targets after the per-neighbor targets.
    const xBand = bandFilterIndices(neighborCy, draggedCenter.y);
    const xPitch = inferGridPitch(neighborCx, xBand);
    if (xPitch > 0) {
        for (const cx of neighborCx) {
            for (const k of GRID_PITCH_K) {
                pushAxis('x', cx + k * xPitch, 'grid-pitch', ['centroid']);
                pushAxis('x', cx - k * xPitch, 'grid-pitch', ['centroid']);
            }
        }
    }
    const yBand = bandFilterIndices(neighborCx, draggedCenter.x);
    const yPitch = inferGridPitch(neighborCy, yBand);
    if (yPitch > 0) {
        for (const cy of neighborCy) {
            for (const k of GRID_PITCH_K) {
                pushAxis('y', cy + k * yPitch, 'grid-pitch', ['centroid']);
                pushAxis('y', cy - k * yPitch, 'grid-pitch', ['centroid']);
            }
        }
    }

    // World AABB edges are appended after all legacy candidates.
    for (const neighbor of neighbors) {
        const { minX, maxX, minY, maxY } = neighbor.geometry.bounds;
        pushAxis('x', minX, 'bbox-edge', ['min', 'max'], { sourceStripIdx: neighbor.stripIdx });
        pushAxis('x', maxX, 'bbox-edge', ['min', 'max'], { sourceStripIdx: neighbor.stripIdx });
        pushAxis('y', minY, 'bbox-edge', ['min', 'max'], { sourceStripIdx: neighbor.stripIdx });
        pushAxis('y', maxY, 'bbox-edge', ['min', 'max'], { sourceStripIdx: neighbor.stripIdx });
    }

    const toleranceWorld = input.toleranceWorld ?? 0;
    const columns = clusterTargets(
        neighbors.map((neighbor) => ({ value: neighbor.geometry.centroid.x, stripIdx: neighbor.stripIdx })),
        toleranceWorld,
    );
    for (const column of columns) {
        pushAxis('x', column.value, 'column', ['centroid'], { supportStripIdxs: column.supportStripIdxs });
    }
    const rows = clusterTargets(
        neighbors.map((neighbor) => ({ value: neighbor.geometry.centroid.y, stripIdx: neighbor.stripIdx })),
        toleranceWorld,
    );
    for (const row of rows) {
        pushAxis('y', row.value, 'row', ['centroid'], { supportStripIdxs: row.supportStripIdxs });
    }

    for (let rulerIdx = 0; rulerIdx < (input.rulers?.length ?? 0); rulerIdx++) {
        const ruler = input.rulers?.[rulerIdx];
        if (!ruler) continue;
        pushAxis('x', ruler.ax, 'ruler-endpoint', ['centroid'], { sourceRulerIdx: rulerIdx, sourceEndpoint: 'a' });
        pushAxis('y', ruler.ay, 'ruler-endpoint', ['centroid'], { sourceRulerIdx: rulerIdx, sourceEndpoint: 'a' });
        pushAxis('x', ruler.bx, 'ruler-endpoint', ['centroid'], { sourceRulerIdx: rulerIdx, sourceEndpoint: 'b' });
        pushAxis('y', ruler.by, 'ruler-endpoint', ['centroid'], { sourceRulerIdx: rulerIdx, sourceEndpoint: 'b' });
        if (Math.hypot(ruler.bx - ruler.ax, ruler.by - ruler.ay) > TARGET_EPSILON) {
            rulerBodies.push({
                id: nextId++, kind: 'ruler-body', sourceRulerIdx: rulerIdx,
                ax: ruler.ax, ay: ruler.ay, bx: ruler.bx, by: ruler.by, order: nextId - 1,
            });
        }
    }

    return {
        x: dedupeAxisTargets(x),
        y: dedupeAxisTargets(y),
        rulerBodies,
    };
}

function anchorValue(geometry: StripSnapGeometry, anchor: SnapAnchorKind, axis: SnapAxis): number {
    if (anchor === 'centroid') return geometry.centroid[axis];
    if (axis === 'x') return anchor === 'min' ? geometry.bounds.minX : geometry.bounds.maxX;
    return anchor === 'min' ? geometry.bounds.minY : geometry.bounds.maxY;
}

function nearestAxisTarget(
    targets: readonly AxisSnapTarget[],
    axis: SnapAxis,
    geometry: StripSnapGeometry,
    rawDelta: number,
    toleranceWorld: number,
): { target: AxisSnapTarget; anchor: SnapAnchorKind; correction: number } | null {
    let best: { target: AxisSnapTarget; anchor: SnapAnchorKind; correction: number; distance: number } | null = null;
    for (const target of targets) {
        if (target.axis !== axis) continue;
        for (const anchor of ANCHOR_ORDER) {
            if (!target.anchors.includes(anchor)) continue;
            const candidate = anchorValue(geometry, anchor, axis) + rawDelta;
            const correction = target.value - candidate;
            const distance = Math.abs(correction);
            if (!(distance < toleranceWorld)) continue;
            if (!best || distance < best.distance
                || (distance === best.distance && target.order < best.target.order)) {
                best = { target, anchor, correction, distance };
            }
        }
    }
    return best ? { target: best.target, anchor: best.anchor, correction: best.correction } : null;
}

function nearestRulerBody(
    bodies: readonly RulerBodySnapTarget[],
    center: { x: number; y: number },
    rawDx: number,
    rawDy: number,
    toleranceWorld: number,
): { target: RulerBodySnapTarget; dx: number; dy: number; distance: number } | null {
    let best: { target: RulerBodySnapTarget; dx: number; dy: number; distance: number } | null = null;
    const px = center.x + rawDx;
    const py = center.y + rawDy;
    for (const target of bodies) {
        const vx = target.bx - target.ax;
        const vy = target.by - target.ay;
        const lengthSq = vx * vx + vy * vy;
        if (lengthSq <= TARGET_EPSILON) continue;
        const t = Math.max(0, Math.min(1, ((px - target.ax) * vx + (py - target.ay) * vy) / lengthSq));
        const projectedX = target.ax + t * vx;
        const projectedY = target.ay + t * vy;
        const correctionX = projectedX - px;
        const correctionY = projectedY - py;
        const distance = Math.hypot(correctionX, correctionY);
        if (!(distance < toleranceWorld)) continue;
        if (!best || distance < best.distance
            || (distance === best.distance && target.order < best.target.order)) {
            best = { target, dx: correctionX, dy: correctionY, distance };
        }
    }
    return best;
}

/** Resolve one strip-drag move using the current typed target set. */
export function resolveStripDragSnap(input: StripSnapResolveInput): StripSnapResolveResult {
    if (!input.startGeometry || !input.snapEnabled || input.shiftBypass) {
        return { dx: input.rawDx, dy: input.rawDy, engagement: { mode: 'none' } };
    }
    if (Math.hypot(input.cursorDxPx, input.cursorDyPx) < input.tolerancePx) {
        return { dx: 0, dy: 0, engagement: { mode: 'origin' } };
    }
    const camZoom = input.camZoom > 0 ? input.camZoom : 1;
    const toleranceWorld = input.tolerancePx / camZoom;
    const x = nearestAxisTarget(input.targets.x, 'x', input.startGeometry, input.rawDx, toleranceWorld);
    const y = nearestAxisTarget(input.targets.y, 'y', input.startGeometry, input.rawDy, toleranceWorld);
    const axisDx = input.rawDx + (x?.correction ?? 0);
    const axisDy = input.rawDy + (y?.correction ?? 0);
    const axisCorrection = x || y
        ? Math.max(Math.abs(x?.correction ?? 0), Math.abs(y?.correction ?? 0))
        : Infinity;
    const body = nearestRulerBody(
        input.targets.rulerBodies,
        input.startGeometry.centroid,
        input.rawDx,
        input.rawDy,
        toleranceWorld,
    );
    if (body && body.distance < axisCorrection) {
        return {
            dx: input.rawDx + body.dx,
            dy: input.rawDy + body.dy,
            engagement: { mode: 'ruler-body', targetId: body.target.id, sourceRulerIdx: body.target.sourceRulerIdx },
        };
    }
    if (!x && !y) return { dx: input.rawDx, dy: input.rawDy, engagement: { mode: 'none' } };
    return {
        dx: axisDx,
        dy: axisDy,
        engagement: {
            mode: 'axis',
            x: x ? { targetId: x.target.id, anchor: x.anchor } : null,
            y: y ? { targetId: y.target.id, anchor: y.anchor } : null,
        },
    };
}
