import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, createLabelLayoutEngine } from '../../src/label-layout.js';

const BOUNDS = { x: 0, y: 0, w: 800, h: 800 };

function box(p) {
    return { x: p.labelX, y: p.labelY, w: p.w, h: p.h };
}

function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function assertNoOverlaps(placements) {
    const visible = placements.filter((p) => !p.hidden && !p.demoted);
    for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
            assert.ok(!overlap(box(visible[i]), box(visible[j])),
                `labels ${visible[i].id} and ${visible[j].id} overlap`);
        }
    }
}

// 16 panels in a 4x4 arrangement (the 64x64 serpentine preset layout): every
// panel corner carries a Start and End label whose anchors cluster tightly.
function sixteenPanelFixture() {
    const labels = [];
    for (let q = 0; q < 4; q++) {
        for (let p = 0; p < 4; p++) {
            const px = 100 + p * 160;
            const py = 100 + q * 160;
            const i = q * 4 + p;
            labels.push({ id: `start-${i}`, anchorX: px, anchorY: py, w: 45, h: 14 });
            labels.push({ id: `end-${i}`, anchorX: px + 8, anchorY: py + 152, w: 40, h: 14 });
        }
    }
    return labels;
}

describe('layoutLabels', () => {
    it('places 16-panel fixture with no overlapping non-degraded boxes', () => {
        const placements = layoutLabels(sixteenPanelFixture(), { canvasBounds: BOUNDS });
        assert.equal(placements.length, 32);
        assertNoOverlaps(placements);
        assert.ok(placements.every((p) => !p.hidden), 'no label should be hidden at this density');
    });

    it('is deterministic: identical input gives identical output', () => {
        const a = layoutLabels(sixteenPanelFixture(), { canvasBounds: BOUNDS });
        const b = layoutLabels(sixteenPanelFixture(), { canvasBounds: BOUNDS });
        assert.deepEqual(a, b);
    });

    it('returns placements in input order', () => {
        const labels = sixteenPanelFixture();
        const placements = layoutLabels(labels, { canvasBounds: BOUNDS });
        assert.deepEqual(placements.map((p) => p.id), labels.map((l) => l.id));
    });

    it('keeps every non-hidden label inside canvasBounds', () => {
        const placements = layoutLabels(sixteenPanelFixture(), { canvasBounds: BOUNDS });
        for (const p of placements) {
            if (p.hidden || p.demoted) continue;
            assert.ok(p.labelX >= BOUNDS.x && p.labelY >= BOUNDS.y &&
                p.labelX + p.w <= BOUNDS.x + BOUNDS.w && p.labelY + p.h <= BOUNDS.y + BOUNDS.h,
                `label ${p.id} exceeds bounds`);
        }
    });

    it('terminates under degenerate stress: 200 labels on one pixel', () => {
        const labels = [];
        for (let i = 0; i < 200; i++) {
            labels.push({ id: `l${String(i).padStart(3, '0')}`, anchorX: 400, anchorY: 400, w: 40, h: 14 });
        }
        const placements = layoutLabels(labels, { canvasBounds: BOUNDS });
        assert.equal(placements.length, 200);
        assertNoOverlaps(placements);
        const placed = placements.filter((p) => !p.hidden && !p.demoted).length;
        const demoted = placements.filter((p) => p.demoted).length;
        const hidden = placements.filter((p) => p.hidden).length;
        assert.equal(placed + demoted + hidden, 200);
        assert.ok(demoted + hidden > 0, 'extreme contention must degrade some labels');
    });

    it('sets needsLeader only beyond the leader threshold', () => {
        const near = layoutLabels(
            [{ id: 'solo', anchorX: 400, anchorY: 400, w: 40, h: 14 }],
            { canvasBounds: BOUNDS });
        assert.equal(near[0].needsLeader, false, 'undisplaced label needs no leader');

        // Crowd the anchor so the label is pushed to an outer ring.
        const obstacles = [];
        for (let dx = -60; dx <= 60; dx += 10) {
            for (let dy = -60; dy <= 60; dy += 10) {
                obstacles.push({ x: 395 + dx, y: 395 + dy, w: 10, h: 10 });
            }
        }
        const crowded = [
            { id: 'aa', anchorX: 395, anchorY: 395, w: 40, h: 14 },
            { id: 'bb', anchorX: 400, anchorY: 400, w: 40, h: 14 },
            { id: 'cc', anchorX: 405, anchorY: 405, w: 40, h: 14 },
            { id: 'dd', anchorX: 398, anchorY: 402, w: 40, h: 14 },
        ];
        const far = layoutLabels(crowded, { canvasBounds: BOUNDS, obstacles });
        assert.ok(far.some((p) => p.needsLeader), 'displaced labels gain leader lines');
        for (const p of far) {
            if (!p.needsLeader) continue;
            assert.equal(p.leaderX0, p.anchorX);
            assert.equal(p.leaderY0, p.anchorY);
            // Attachment point sits on the label box border.
            const onX = p.leaderX1 >= p.labelX && p.leaderX1 <= p.labelX + p.w;
            const onY = p.leaderY1 >= p.labelY && p.leaderY1 <= p.labelY + p.h;
            assert.ok(onX && onY, 'leader endpoint attaches to the label box');
        }
    });
});

describe('createLabelLayoutEngine', () => {
    it('translates cached layout on pan without re-running', () => {
        const engine = createLabelLayoutEngine({ canvasBounds: null });
        const labels = sixteenPanelFixture();
        const first = engine.layout(labels);
        assert.equal(engine.debugDump().counters.layoutRuns, 1);

        const panned = labels.map((l) => ({ ...l, anchorX: l.anchorX + 37, anchorY: l.anchorY - 12 }));
        const second = engine.layout(panned);
        const counters = engine.debugDump().counters;
        assert.equal(counters.layoutRuns, 1, 'pan must not re-run the layout');
        assert.equal(counters.translations, 1);
        for (let i = 0; i < first.length; i++) {
            assert.equal(second[i].labelX, first[i].labelX + 37);
            assert.equal(second[i].labelY, first[i].labelY - 12);
        }
    });

    it('returns the cached result for identical input', () => {
        const engine = createLabelLayoutEngine();
        const labels = sixteenPanelFixture();
        engine.layout(labels);
        engine.layout(labels.map((l) => ({ ...l })));
        const counters = engine.debugDump().counters;
        assert.equal(counters.layoutRuns, 1);
        assert.equal(counters.cacheHits, 1);
    });

    it('keeps other labels in their slots when one label is perturbed', () => {
        const engine = createLabelLayoutEngine({ canvasBounds: BOUNDS });
        const labels = sixteenPanelFixture();
        const first = engine.layout(labels);

        const perturbed = labels.map((l) =>
            l.id === 'start-5' ? { ...l, anchorX: l.anchorX + 1 } : { ...l });
        const second = engine.layout(perturbed);
        assert.equal(engine.debugDump().counters.layoutRuns, 2);

        for (let i = 0; i < labels.length; i++) {
            if (labels[i].id === 'start-5') continue;
            const a = first[i], b = second[i];
            assert.equal(b.labelX - b.anchorX, a.labelX - a.anchorX, `${a.id} shifted slots`);
            assert.equal(b.labelY - b.anchorY, a.labelY - a.anchorY, `${a.id} shifted slots`);
        }
    });

    it('invalidate() drops caches and forces a fresh run', () => {
        const engine = createLabelLayoutEngine();
        const labels = sixteenPanelFixture();
        engine.layout(labels);
        engine.invalidate();
        assert.deepEqual(engine.debugDump().placements, []);
        engine.layout(labels);
        assert.equal(engine.debugDump().counters.layoutRuns, 2);
    });
});
