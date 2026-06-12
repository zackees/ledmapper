/**
 * Deterministic point-feature label placement (issue #28).
 *
 * Greedy candidate-position model: each label tries ring slots of increasing
 * radius around its anchor and takes the first slot that does not overlap any
 * already-placed label (spatial-hash accelerated). Obstacles (e.g. LED rings)
 * are soft blockers — preferred against, but occluded rather than failing the
 * label. Pure ES module: no DOM, no Canvas — testable under Node.
 */

const EPS = 1e-6;

const DEFAULTS = {
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

function boxesOverlap(a: any, b: any) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function createGrid(cellSize: any) {
    const cells = new Map();
    const all = [];
    function keysFor(box: any, fn: any) {
        const x0 = Math.floor(box.x / cellSize);
        const y0 = Math.floor(box.y / cellSize);
        const x1 = Math.floor((box.x + box.w) / cellSize);
        const y1 = Math.floor((box.y + box.h) / cellSize);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                fn(cx + ',' + cy);
            }
        }
    }
    return {
        insert(box: any, hard: any) {
            const entry = { box, hard };
            all.push(entry);
            keysFor(box, (k: any) => {
                let bucket = cells.get(k);
                if (!bucket) { bucket = []; cells.set(k, bucket); }
                bucket.push(entry);
            });
        },
        // Returns { hard, soft } overlap counts for the candidate box.
        probe(box: any) {
            let hard = 0, soft = 0;
            const seen = new Set();
            keysFor(box, (k: any) => {
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

function median(values: any) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

// Midpoint of the label-box edge facing the anchor.
function leaderAttachment(anchorX: any, anchorY: any, box: any) {
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

function makePlacement(label: any, box: any, displacement: any, leaderThreshold: any, flags: any) {
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

function runLayout(labels: any, opts: any, preferredSlot: any) {
    const { padding, ringSlots, ringSteps, baseRadius, radiusStep, canvasBounds, obstacles, seedSlots } = opts;
    const leaderThreshold = opts.leaderThreshold !== null && opts.leaderThreshold !== undefined
        ? opts.leaderThreshold : 1.2 * baseRadius;

    // Priority desc, then stable on id, so output is deterministic.
    const order = [...labels].sort((a, b) =>
        ((b.priority || 0) - (a.priority || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const cell = Math.max(8, median(order.map((l) => Math.max(l.w, l.h))));
    const grid = createGrid(cell);
    // Lazy obstacles (a function) are only evaluated on a real layout run, so
    // per-frame callers pay nothing while the result cache holds.
    const obs = typeof obstacles === 'function' ? obstacles() : obstacles;
    if (obs) {
        for (const ob of obs) grid.insert(ob, false);
    }

    const inBounds = (box: any) => !canvasBounds || (
        box.x >= canvasBounds.x && box.y >= canvasBounds.y &&
        box.x + box.w <= canvasBounds.x + canvasBounds.w &&
        box.y + box.h <= canvasBounds.y + canvasBounds.h);

    const byId = new Map();
    for (const label of order) {
        const startSlot = seedSlots ? (preferredSlot.get(label.id) || 0) : 0;
        let clean = null;        // no hard overlaps, no soft overlaps
        let labelClean = null;   // no hard overlaps (may occlude obstacles)
        let best = null;         // fewest hard overlaps (degradation fallback)

        for (let step = 0; step < ringSteps && !clean; step++) {
            const r = baseRadius + step * radiusStep;
            for (let k = 0; k < ringSlots; k++) {
                const slot = (startSlot + k) % ringSlots;
                // Slot 0 = NE (screen coords, y down), proceeding clockwise.
                const angle = -Math.PI / 4 + slot * (2 * Math.PI / ringSlots);
                const cx = label.anchorX + r * Math.cos(angle);
                const cy = label.anchorY + r * Math.sin(angle);
                const box = { x: cx - label.w / 2, y: cy - label.h / 2, w: label.w, h: label.h };
                const padded = { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 };
                if (!inBounds(box)) continue;
                const { hard, soft } = grid.probe(padded);
                const candidate = { box, padded, slot, displacement: r, hard };
                if (best === null || hard < best.hard) best = candidate;
                if (hard === 0) {
                    if (labelClean === null) labelClean = candidate;
                    if (soft === 0) { clean = candidate; break; }
                }
            }
        }

        const pick = clean || labelClean;
        if (pick) {
            grid.insert(pick.padded, true);
            preferredSlot.set(label.id, pick.slot);
            byId.set(label.id, makePlacement(label, pick.box, pick.displacement, leaderThreshold, {}));
        } else if (best && best.hard <= 1) {
            byId.set(label.id, makePlacement(label, best.box, best.displacement, leaderThreshold, { demoted: true }));
        } else {
            const box = { x: label.anchorX, y: label.anchorY, w: label.w, h: label.h };
            byId.set(label.id, makePlacement(label, box, 0, leaderThreshold, { hidden: true }));
        }
    }

    // Return in input order so consumers can zip with their own arrays.
    return labels.map((l: any) => byId.get(l.id));
}

// True when `labels` is the previous input rigidly translated by a constant
// (dx, dy) — same ids in the same order, same box sizes.
function detectTranslation(prev: any, labels: any) {
    if (!prev || prev.length !== labels.length || labels.length === 0) return null;
    const dx = labels[0].anchorX - prev[0].anchorX;
    const dy = labels[0].anchorY - prev[0].anchorY;
    for (let i = 0; i < labels.length; i++) {
        const a = prev[i], b = labels[i];
        if (a.id !== b.id || a.w !== b.w || a.h !== b.h) return null;
        if (Math.abs((b.anchorX - a.anchorX) - dx) > EPS) return null;
        if (Math.abs((b.anchorY - a.anchorY) - dy) > EPS) return null;
    }
    return { dx, dy };
}

function translatePlacement(p: any, dx: any, dy: any) {
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
export function createLabelLayoutEngine(options: any = {}) {
    const baseOpts = { ...DEFAULTS, ...options };
    const preferredSlot = new Map();
    let lastInput: any = null;
    let lastOptsKey: any = null;
    let lastResult: any = null;
    const counters = { layoutRuns: 0, translations: 0, cacheHits: 0 };

    function snapshot(labels: any) {
        return labels.map((l: any) => ({ id: l.id, anchorX: l.anchorX, anchorY: l.anchorY, w: l.w, h: l.h }));
    }

    function layout(labels: any, callOptions: any = {}) {
        const opts = { ...baseOpts, ...callOptions };
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
                lastResult = lastResult.map((p: any) => translatePlacement(p, shift.dx, shift.dy));
                lastInput = snapshot(labels);
                return lastResult;
            }
        }
        counters.layoutRuns++;
        // Drop slot memory for labels that no longer exist.
        const liveIds = new Set(labels.map((l: any) => l.id));
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

    function debugDump() {
        return {
            placements: lastResult ? lastResult.map((p: any) => ({ ...p })) : [],
            counters: { ...counters },
        };
    }

    return { layout, invalidate, debugDump };
}

/** Stateless one-shot layout. */
export function layoutLabels(labels: any, options: any = {}) {
    return createLabelLayoutEngine(options).layout(labels);
}
