import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PANEL_CATALOG,
    getCatalogEntry,
    generatePanelPoints,
} from '../../src/shapeeditor/panel-catalog';
import { snapToGrid } from '../../src/shapeeditor/grid-snap';

describe('PANEL_CATALOG', () => {
    it('contains expected matrices, rings, and a strip', () => {
        const ids = PANEL_CATALOG.map(e => e.id);
        assert.ok(ids.includes('matrix-8x8'));
        assert.ok(ids.includes('matrix-16x16'));
        assert.ok(ids.includes('matrix-8x32'));
        assert.ok(ids.includes('matrix-4x16'));
        assert.ok(ids.includes('ring-8'));
        assert.ok(ids.includes('ring-12'));
        assert.ok(ids.includes('ring-16'));
        assert.ok(ids.includes('ring-24'));
        assert.ok(ids.includes('strip-60'));
    });

    it('getCatalogEntry returns null for unknown ids', () => {
        assert.equal(getCatalogEntry('nope'), null);
        assert.equal(getCatalogEntry('matrix-8x8')!.cols, 8);
    });
});

describe('generatePanelPoints — matrix wiring', () => {
    const entry = getCatalogEntry('matrix-8x8');

    it('serpentine TL: starts at (0,0), row 1 reverses', () => {
        const pts = generatePanelPoints(entry, { wiring: 'serpentine', dataInCorner: 'TL' });
        assert.equal(pts.length, 64);
        assert.deepEqual(pts[0], [0, 0]);
        assert.deepEqual(pts[7], [7, 0]);
        // Row 1 reversed: first LED of row 1 is column 7
        assert.deepEqual(pts[8], [7, 1]);
        assert.deepEqual(pts[15], [0, 1]);
    });

    it('progressive TL: every row goes left→right', () => {
        const pts = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL' });
        assert.deepEqual(pts[0], [0, 0]);
        assert.deepEqual(pts[7], [7, 0]);
        assert.deepEqual(pts[8], [0, 1]);
        assert.deepEqual(pts[15], [7, 1]);
    });

    it('dataInCorner=TR starts at top-right', () => {
        const pts = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TR' });
        assert.deepEqual(pts[0], [7, 0]);
        assert.deepEqual(pts[7], [0, 0]);
    });

    it('dataInCorner=BL starts at bottom-left', () => {
        const pts = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'BL' });
        assert.deepEqual(pts[0], [0, 7]);
        assert.deepEqual(pts[63], [7, 0]);
    });

    it('dataInCorner=BR starts at bottom-right', () => {
        const pts = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'BR' });
        assert.deepEqual(pts[0], [7, 7]);
        assert.deepEqual(pts[63], [0, 0]);
    });

    it('spacing scales coordinates', () => {
        const pts = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', spacing: 2 });
        assert.deepEqual(pts[0], [0, 0]);
        assert.deepEqual(pts[1], [2, 0]);
        assert.deepEqual(pts[8], [0, 2]);
    });
});

describe('generatePanelPoints — rotation and flip', () => {
    const entry = getCatalogEntry('matrix-4x16');

    // normalise -0 → 0 for stable equality
    const z = (v: any) => (v === 0 ? 0 : v);

    it('rotation 90 swaps axes', () => {
        const ptsBase = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 0 });
        const ptsRot = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 90 });
        assert.equal(ptsBase.length, ptsRot.length);
        for (let i = 0; i < ptsBase.length; i++) {
            const [x, y] = ptsBase[i];
            assert.deepEqual(ptsRot[i], [z(-y), z(x)]);
        }
    });

    it('rotation 180 negates both', () => {
        const ptsBase = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 0 });
        const ptsRot = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 180 });
        for (let i = 0; i < ptsBase.length; i++) {
            assert.deepEqual(ptsRot[i], [z(-ptsBase[i][0]), z(-ptsBase[i][1])]);
        }
    });

    it('flipH negates x; flipV negates y', () => {
        const base = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 0 });
        const fh = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 0, flipH: true });
        const fv = generatePanelPoints(entry, { wiring: 'progressive', dataInCorner: 'TL', rotation: 0, flipV: true });
        for (let i = 0; i < base.length; i++) {
            assert.equal(fh[i][0], z(-base[i][0]));
            assert.equal(fh[i][1], base[i][1]);
            assert.equal(fv[i][0], base[i][0]);
            assert.equal(fv[i][1], z(-base[i][1]));
        }
    });
});

describe('generatePanelPoints — ring and strip', () => {
    it('ring-8 produces 8 points on a circle', () => {
        const entry = getCatalogEntry('ring-8');
        const pts = generatePanelPoints(entry, { spacing: 1 });
        assert.equal(pts.length, 8);
        const r0 = Math.hypot(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) {
            const r = Math.hypot(x, y);
            assert.ok(Math.abs(r - r0) < 1e-9);
        }
    });

    it('strip-60 is a horizontal line of 60 LEDs', () => {
        const entry = getCatalogEntry('strip-60');
        const pts = generatePanelPoints(entry, { spacing: 1 });
        assert.equal(pts.length, 60);
        assert.deepEqual(pts[0], [0, 0]);
        assert.deepEqual(pts[59], [59, 0]);
    });
});

describe('snapToGrid', () => {
    it('snaps to nearest grid intersection', () => {
        assert.deepEqual(snapToGrid([0.4, 0.6], 1), [0, 1]);
        assert.deepEqual(snapToGrid([1.4, -0.6], 1), [1, -1]);
        assert.deepEqual(snapToGrid([2.49, 2.5], 1), [2, 3]);
    });

    it('honors non-unit grid sizes', () => {
        assert.deepEqual(snapToGrid([3, 4], 2), [4, 4]);
        assert.deepEqual(snapToGrid([5, 6], 5), [5, 5]);
    });

    it('returns the original point when gridSize is 0 or negative', () => {
        assert.deepEqual(snapToGrid([1.3, 4.7], 0), [1.3, 4.7]);
        assert.deepEqual(snapToGrid([1.3, 4.7], -1), [1.3, 4.7]);
    });
});
