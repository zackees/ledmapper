import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Selection } from '../../src/shapeeditor/selection';

describe('Selection', () => {
    it('starts empty and exposes primary compatibility', () => {
        const sel = new Selection();
        assert.equal(sel.getPointIdx(), null);
        assert.equal(sel.getStripIdx(), null);
        assert.deepEqual([...sel.getSelectedStripIdxs()], []);
        assert.equal(sel.hasSelection(), false);
    });

    it('selecting a point collapses group selection to its owner', () => {
        const sel = new Selection();
        sel.addStrip(1); sel.addStrip(2);
        sel.selectPoint(3, 0);
        assert.equal(sel.getPointIdx(), 3);
        assert.deepEqual([...sel.getSelectedStripIdxs()], [0]);
        assert.equal(sel.getPrimaryStripIdx(), 0);
    });

    it('select only, add, toggle, clear, and primary order work', () => {
        const sel = new Selection();
        sel.selectOnlyStrip(2); sel.addStrip(0); sel.addStrip(1);
        assert.deepEqual([...sel.getSelectedStripIdxs()], [2, 0, 1]);
        assert.equal(sel.getPrimaryStripIdx(), 1);
        const exposed = sel.getSelectedStripIdxs() as Set<number>;
        exposed.clear();
        assert.deepEqual([...sel.getSelectedStripIdxs()], [2, 0, 1]);
        sel.toggleStrip(1);
        assert.deepEqual([...sel.getSelectedStripIdxs()], [2, 0]);
        assert.equal(sel.getPrimaryStripIdx(), 0);
        sel.toggleStrip(3);
        assert.equal(sel.getPrimaryStripIdx(), 3);
        sel.clearStrips();
        assert.deepEqual([...sel.getSelectedStripIdxs()], []);
    });

    it('emits once for real public changes and not for no-ops', () => {
        const sel = new Selection();
        let count = 0;
        sel.setOnChange(() => count++);
        sel.selectOnlyStrip(1); sel.selectOnlyStrip(1); sel.addStrip(1);
        sel.addStrip(2); sel.toggleStrip(2); sel.clear(); sel.clear();
        assert.equal(count, 4);
    });

    it('tracks point insertion and deletion', () => {
        const sel = new Selection();
        sel.selectPoint(5, 0); sel.onPointInsert(3);
        assert.equal(sel.getPointIdx(), 6);
        sel.onPointDelete(6);
        assert.equal(sel.getPointIdx(), null);
        assert.equal(sel.getStripIdx(), 0);
    });

    it('remaps every selected strip on remove and reorder', () => {
        const sel = new Selection();
        sel.addStrip(0); sel.addStrip(2); sel.addStrip(4);
        sel.onStripRemove(2);
        assert.deepEqual([...sel.getSelectedStripIdxs()], [0, 3]);
        sel.onStripReorder(3, 1);
        assert.deepEqual([...sel.getSelectedStripIdxs()], [0, 1]);
        assert.equal(sel.getPrimaryStripIdx(), 1);
        sel.onStripRemove(1); sel.onStripRemove(0);
        assert.equal(sel.getPrimaryStripIdx(), null);
    });
});
