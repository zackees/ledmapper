/**
 * Deterministic point-feature label placement (issue #28).
 *
 * Greedy candidate-position model: each label tries ring slots of increasing
 * radius around its anchor and takes the first slot that does not overlap any
 * already-placed label (spatial-hash accelerated). Obstacles (e.g. LED rings)
 * are soft blockers — preferred against, but occluded rather than failing the
 * label. Pure ES module: no DOM, no Canvas — testable under Node.
 */

import type { LabelAnchorInput, LabelPlacement, LabelLayoutOptions, LabelLayoutDebugDump, LabelLayoutEngine, CanvasBounds, ObstacleBox } from './types/domain';

const EPS = 1e-6;

interface ResolvedLayoutOptions {
    padding: number;
    ringSlots: number;
    ringSteps: number;
    baseRadius: number;
    radiusStep: number;
    leaderThreshold: number | null;
    canvasBounds: CanvasBounds | null;
    obstacles: ObstacleBox[] | (() => ObstacleBox[]) | null;
    seedSlots: boolean;
}

const DEFAULTS: ResolvedLayoutOptions = {
    padding: 2,
    ringSlots: 8,
    ringSteps: 4,
    baseRadius: 14,
    radiusStep: 12,
    leaderThreshold: null, // defaults to 1.2 * baseRadius
    canvasBounds: null,
    obstacles: null,
    seedSlots: true,
};

interface Box { x: number; y: number; w: number; h: number; }
interface GridEntry { box: Box; hard: boolean; }
interface Candidate { box: Box; padded: Box; slot: number; displacement: number; hard: number; }

function boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function createGrid(cellSize: number) {
    const cells = new Map<string, GridEntry[]>();
    function keysFor(box: Box, fn: (k: string) => void) {
        const x0 = Math.floor(box.x / cellSize);
        const y0 = Math.floor(box.y / cellSize);
        const x1 = Math.floor((box.x + box.w) / cellSize);
        const y1 = Math.floor((box.y + box.h) / cellSize);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                fn(`${String(cx)},${String(cy)}`);
            }
        }
    }
    return {
        insert(box: Box, hard: boolean) {
            const entry: GridEntry = { box, hard };
            keysFor(box, (k) => {
                let bucket = cells.get(k);
                if (!bucket) { bucket = []; cells.set(k, bucket); }
                bucket.push(entry);
            });
        },
        probe(box: Box): { hard: number; soft: number } {
            let hard = 0, soft = 0;
            const seen = new Set<GridEntry>();
            keysFor(box, (k) => {
                const bucket = cells.get(k);
                if (!bucket) return;
                for (const entry of bucket) {
                    if (seen.has(entry)) continue;
                    seen.add(entry);
                    if (boxesOverlap(box, entry.box)) {
                        if (entry.hard) hard++;
                        else soft++;
                    }
                }
            });
            return { hard, soft };
        },
    };
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface Point2D { x: number; y: number; }

// Midpoint of the label-box edge facing the anchor.
function leaderAttachment(anchorX: number, anchorY: number, box: Box): Point2D {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = anchorX - cx;
    const dy = anchorY - cy;
    // Scale by half-extents so a wide box doesn't always pick left/right.
    if (Math.abs(dx) / (box.w / 2 + EPS) > Math.abs(dy) / (box.h / 2 + EPS)) {
        return { x: dx > 0 ? box.x + box.w : box.x, y: cy };
    }
    return { x: cx, y: dy > 0 ? box.y + box.h : box.y };
}

interface PlacementFlags { hidden?: boolean; demoted?: boolean; }

function makePlacement(label: LabelAnchorInput, box: Box, displacement: number, leaderThreshold: number, flags: PlacementFlags): LabelPlacement {
    const needsLeader = !flags.hidden && displacement > leaderThreshold;
    const attach = leaderAttachment(label.anchorX, label.anchorY, box);
    return {
        id: label.id,
        anchorX: label.anchorX,
        anchorY: label.anchorY,
        labelX: box.x,
        labelY: box.y,
        w: label.w,
        h: label.h,
        needsLeader,
        leaderX0: label.anchorX,
        leaderY0: label.anchorY,
        leaderX1: attach.x,
        leaderY1: attach.y,
        hidden: !!flags.hidden,
        demoted: !!flags.demoted,
    };
}

function runLayout(labels: LabelAnchorInput[], opts: ResolvedLayoutOptions, preferredSlot: Map<string, number>): LabelPlacement[] {
    const { padding, ringSlots, ringSteps, baseRadius, radiusStep, canvasBounds, obstacles, seedSlots } = opts;
    const leaderThreshold = opts.leaderThreshold ?? 1.2 * baseRadius;

    // Priority desc, then stable on id, so output is deterministic.
    const order = [...labels].sort((a, b) =>
        ((b.priority ?? 0) - (a.priority ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const cell = Math.max(8, median(order.map((l) => Math.max(l.w, l.h))));
    const grid = createGrid(cell);
    // Lazy obstacles (a function) are only evaluated on a real layout run.
    const obs = typeof obstacles === 'function' ? obstacles() : obstacles;
    if (obs) {
        for (const ob of obs) grid.insert(ob, false);
    }

    const inBounds = (box: Box) => !canvasBounds || (
        box.x >= canvasBounds.x && box.y >= canvasBounds.y &&
        box.x + box.w <= canvasBounds.x + canvasBounds.w &&
        box.y + box.h <= canvasBounds.y + canvasBounds.h);

    const byId = new Map<string, LabelPlacement>();
    for (const label of order) {
        const startSlot = seedSlots ? (preferredSlot.get(label.id) ?? 0) : 0;
        let clean: Candidate | null = null;        // no hard overlaps, no soft overlaps
        let labelClean: Candidate | null = null;   // no hard overlaps (may occlude obstacles)
        let best: Candidate | null = null;         // fewest hard overlaps (degradation fallback)

        for (let step = 0; step < ringSteps && !clean; step++) {
            const r = baseRadius + step * radiusStep;
            for (let k = 0; k < ringSlots; k++) {
                const slot = (startSlot + k) % ringSlots;
                // Slot 0 = NE (screen coords, y down), proceeding clockwise.
                const angle = -Math.PI / 4 + slot * (2 * Math.PI / ringSlots);
                const cx = label.anchorX + r * Math.cos(angle);
                const cy = label.anchorY + r * Math.sin(angle);
                const box: Box = { x: cx - label.w / 2, y: cy - label.h / 2, w: label.w, h: label.h };
                const padded: Box = { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 };
                if (!inBounds(box)) continue;
                const { hard, soft } = grid.probe(padded);
                const candidate: Candidate = { box, padded, slot, displacement: r, hard };
                if (best === null || hard < best.hard) best = candidate;
                if (hard === 0) {
                    labelClean ??= candidate;
                    if (soft === 0) { clean = candidate; break; }
                }
            }
        }

        const pick = clean ?? labelClean;
        if (pick) {
            grid.insert(pick.padded, true);
            preferredSlot.set(label.id, pick.slot);
            byId.set(label.id, makePlacement(label, pick.box, pick.displacement, leaderThreshold, {}));
        } else if (best && best.hard <= 1) {
            byId.set(label.id, makePlacement(label, best.box, best.displacement, leaderThreshold, { demoted: true }));
        } else {
            const box: Box = { x: label.anchorX, y: label.anchorY, w: label.w, h: label.h };
            byId.set(label.id, makePlacement(label, box, 0, leaderThreshold, { hidden: true }));
        }
    }

    // Return in input order so consumers can zip with their own arrays.
    return labels.map((l) => {
        const p = byId.get(l.id);
        if (!p) throw new Error(`runLayout: missing placement for label id "${l.id}"`);
        return p;
    });
}

interface SnapshotEntry { id: string; anchorX: number; anchorY: number; w: number; h: number; }

// True when `labels` is the previous input rigidly translated by a constant
// (dx, dy) — same ids in the same order, same box sizes.
function detectTranslation(prev: SnapshotEntry[] | null, labels: LabelAnchorInput[]): { dx: number; dy: number } | null {
    if (prev?.length !== labels.length || labels.length === 0) return null;
    const l0 = labels[0];
    const p0 = prev[0];
    if (!l0 || !p0) return null;
    const dx = l0.anchorX - p0.anchorX;
    const dy = l0.anchorY - p0.anchorY;
    for (let i = 0; i < labels.length; i++) {
        const a = prev[i];
        const b = labels[i];
        if (!a || !b) return null;
        if (a.id !== b.id || a.w !== b.w || a.h !== b.h) return null;
        if (Math.abs((b.anchorX - a.anchorX) - dx) > EPS) return null;
        if (Math.abs((b.anchorY - a.anchorY) - dy) > EPS) return null;
    }
    return { dx, dy };
}

function translatePlacement(p: LabelPlacement, dx: number, dy: number): LabelPlacement {
    return {
        ...p,
        anchorX: p.anchorX + dx, anchorY: p.anchorY + dy,
        labelX: p.labelX + dx, labelY: p.labelY + dy,
        leaderX0: p.leaderX0 + dx, leaderY0: p.leaderY0 + dy,
        leaderX1: p.leaderX1 + dx, leaderY1: p.leaderY1 + dy,
    };
}

/**
 * Stateful engine owning the preferred-slot cache (placement stability across
 * zooms) and the last-result cache (pan = free translation, no re-layout).
 */
export function createLabelLayoutEngine(options: LabelLayoutOptions = {}): LabelLayoutEngine {
    const baseOpts: ResolvedLayoutOptions = { ...DEFAULTS, ...options };
    const preferredSlot = new Map<string, number>();
    let lastInput: SnapshotEntry[] | null = null;
    let lastOptsKey: string | null = null;
    let lastResult: LabelPlacement[] | null = null;
    const counters = { layoutRuns: 0, translations: 0, cacheHits: 0 };

    function snapshot(labels: LabelAnchorInput[]): SnapshotEntry[] {
        return labels.map((l) => ({ id: l.id, anchorX: l.anchorX, anchorY: l.anchorY, w: l.w, h: l.h }));
    }

    function layout(labels: LabelAnchorInput[], callOptions: LabelLayoutOptions = {}): LabelPlacement[] {
        const opts: ResolvedLayoutOptions = { ...baseOpts, ...callOptions };
        const optsKey = JSON.stringify({
            padding: opts.padding, ringSlots: opts.ringSlots, ringSteps: opts.ringSteps,
            baseRadius: opts.baseRadius, radiusStep: opts.radiusStep,
            leaderThreshold: opts.leaderThreshold, canvasBounds: opts.canvasBounds,
            obstacleCount: typeof opts.obstacles === 'function' ? 'fn'
                : (opts.obstacles ? opts.obstacles.length : 0),
        });
        if (lastResult && optsKey === lastOptsKey) {
            const shift = detectTranslation(lastInput, labels);
            if (shift) {
                if (shift.dx === 0 && shift.dy === 0) {
                    counters.cacheHits++;
                    return lastResult;
                }
                counters.translations++;
                lastResult = lastResult.map((p) => translatePlacement(p, shift.dx, shift.dy));
                lastInput = snapshot(labels);
                return lastResult;
            }
        }
        counters.layoutRuns++;
        // Drop slot memory for labels that no longer exist.
        const liveIds = new Set(labels.map((l) => l.id));
        for (const id of preferredSlot.keys()) {
            if (!liveIds.has(id)) preferredSlot.delete(id);
        }
        lastResult = runLayout(labels, opts, preferredSlot);
        lastInput = snapshot(labels);
        lastOptsKey = optsKey;
        return lastResult;
    }

    function invalidate() {
        preferredSlot.clear();
        lastInput = null;
        lastOptsKey = null;
        lastResult = null;
    }

    function debugDump(): LabelLayoutDebugDump {
        return {
            placements: lastResult ? lastResult.map((p) => ({ ...p })) : [],
            counters: { ...counters },
        };
    }

    return { layout, invalidate, debugDump };
}

/** Stateless one-shot layout. */
export function layoutLabels(labels: LabelAnchorInput[], options: LabelLayoutOptions = {}): LabelPlacement[] {
    return createLabelLayoutEngine(options).layout(labels);
}
