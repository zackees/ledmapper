import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintTextFor } from '../../src/shapeeditor/hints.js';

test('empty state shows discoverability nudge for right-click and I', () => {
    const t = hintTextFor({ empty: true });
    assert.match(t, /Right-click for menu/);
    assert.match(t, /press I to insert a panel/);
});

test('idle (loaded, no selection) shows pan/zoom/select hint', () => {
    const t = hintTextFor({ empty: false, selectedStripName: null });
    assert.match(t, /Drag canvas: pan/);
    assert.match(t, /R-drag: zoom/);
    assert.match(t, /click LED: select strip/);
    assert.match(t, /I: insert/);
    assert.match(t, /Ctrl\+V: paste/);
});

test('strip selected shows group-move + double-click + handles hint', () => {
    const t = hintTextFor({ empty: false, selectedStripName: 'strip1' });
    assert.match(t, /Drag LED\/strip: move group/);
    assert.match(t, /dbl-click LED: edit point/);
    assert.match(t, /handles: scale\/rotate strip/);
    assert.match(t, /Del: remove strip/);
});

test('point-edit mode shows strip name and Esc-to-exit', () => {
    const t = hintTextFor({ pointEditMode: true, pointEditStripName: 'strip2' });
    assert.match(t, /Editing points in "strip2"/);
    assert.match(t, /drag LED: move single/);
    assert.match(t, /Shift\+click edge: insert/);
    assert.match(t, /Esc: exit/);
});

test('placing shows the entry label and cancel hint', () => {
    const t = hintTextFor({ placing: true, placingLabel: '8×8 Matrix' });
    assert.match(t, /Click to place "8×8 Matrix"/);
    assert.match(t, /Esc \/ right-click: cancel/);
});

test('paste-pending shows count and Esc-to-cancel', () => {
    const t = hintTextFor({ pasting: true, pastingCount: 3 });
    assert.match(t, /Click to drop pasted strips \(3\)/);
    assert.match(t, /Esc: cancel/);
});

test('placing takes priority over strip selection', () => {
    const t = hintTextFor({
        placing: true,
        placingLabel: 'Ring 16',
        selectedStripName: 'strip1',
        empty: false,
    });
    assert.match(t, /Click to place "Ring 16"/);
});

test('point-edit takes priority over empty/idle', () => {
    const t = hintTextFor({
        pointEditMode: true,
        pointEditStripName: 'panel1',
        empty: true,
    });
    assert.match(t, /Editing points in "panel1"/);
});
