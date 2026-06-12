import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Selection } from '../../src/shapeeditor/selection';

describe('Selection — basic API', () => {
    it('starts empty', () => {
        const sel = new Selection();
        assert.strictEqual(sel.getPointIdx(), null);
        assert.strictEqual(sel.getStripIdx(), null);
        assert.strictEqual(sel.hasSelection(), false);
    });

    it('selectPoint sets point and (when given) strip', () => {
        const sel = new Selection();
        sel.selectPoint(3, 1);
        assert.strictEqual(sel.getPointIdx(), 3);
        assert.strictEqual(sel.getStripIdx(), 1);
        assert.strictEqual(sel.hasSelection(), true);
    });

    it('selectStrip clears point selection', () => {
        const sel = new Selection();
        sel.selectPoint(3, 1);
        sel.selectStrip(2);
        assert.strictEqual(sel.getPointIdx(), null);
        assert.strictEqual(sel.getStripIdx(), 2);
    });

    it('clear resets both', () => {
        const sel = new Selection();
        sel.selectPoint(3, 1);
        sel.clear();
        assert.strictEqual(sel.getPointIdx(), null);
        assert.strictEqual(sel.getStripIdx(), null);
    });
});

describe('Selection — onChange', () => {
    it('fires on real changes only', () => {
        const sel = new Selection();
        let count = 0;
        sel.setOnChange(() => count++);
        sel.selectPoint(1, 0);
        assert.strictEqual(count, 1);
        sel.selectPoint(1, 0); // no-op
        assert.strictEqual(count, 1);
        sel.selectStrip(2);
        assert.strictEqual(count, 2);
        sel.clear();
        assert.strictEqual(count, 3);
        sel.clear(); // no-op
        assert.strictEqual(count, 3);
    });
});

describe('Selection — point splice tracking', () => {
    it('onPointInsert shifts selection forward when at-or-after insert', () => {
        const sel = new Selection();
        sel.selectPoint(5, 0);
        sel.onPointInsert(3);
        assert.strictEqual(sel.getPointIdx(), 6);
        sel.onPointInsert(7); // after selection => no shift
        assert.strictEqual(sel.getPointIdx(), 6);
    });

    it('onPointDelete clears selection when the selected point is removed', () => {
        const sel = new Selection();
        sel.selectPoint(4, 0);
        sel.onPointDelete(4);
        assert.strictEqual(sel.getPointIdx(), null);
        assert.strictEqual(sel.getStripIdx(), 0);
    });

    it('onPointDelete shifts selection back when deletion is before it', () => {
        const sel = new Selection();
        sel.selectPoint(4, 0);
        sel.onPointDelete(1);
        assert.strictEqual(sel.getPointIdx(), 3);
    });
});

describe('Selection — strip mutation tracking', () => {
    it('onStripRemove clears when the selected strip is removed', () => {
        const sel = new Selection();
        sel.selectStrip(2);
        sel.onStripRemove(2);
        assert.strictEqual(sel.getStripIdx(), null);
    });

    it('onStripRemove shifts back when removal is before selection', () => {
        const sel = new Selection();
        sel.selectStrip(2);
        sel.onStripRemove(0);
        assert.strictEqual(sel.getStripIdx(), 1);
    });

    it('onStripReorder follows the moved strip', () => {
        const sel = new Selection();
        sel.selectStrip(0);
        sel.onStripReorder(0, 2); // a → end
        assert.strictEqual(sel.getStripIdx(), 2);
    });

    it('onStripReorder shifts neighbors when something moves across them', () => {
        const sel = new Selection();
        sel.selectStrip(1);
        sel.onStripReorder(0, 2); // moving a past b: b shifts left
        assert.strictEqual(sel.getStripIdx(), 0);
    });
});
