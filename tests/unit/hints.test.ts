import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintTextFor } from '../../src/shapeeditor/hints';

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

test('strip selected explains direct LED editing and group movement', () => {
    const t = hintTextFor({ empty: false, selectedStripName: 'strip1' });
    assert.match(t, /Drag LED: move LED/);
    assert.match(t, /drag strip line: move group/);
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

test('chain mode shows arrowhead rewire + Esc-to-exit hint', () => {
    const t = hintTextFor({ chainMode: true, empty: false });
    assert.match(t, /Chain edit/);
    assert.match(t, /drag an arrowhead to rewire/);
    assert.match(t, /right-click arrow: menu/);
    assert.match(t, /Esc\/\[Chain\]: exit/);
});

test('reorder mode shows move arrows + repin hint', () => {
    const t = hintTextFor({ reorderMode: true, empty: false });
    assert.match(t, /Reorder:/);
    assert.match(t, /move strips within a pin/);
    assert.match(t, /drag grip across pins to repin/);
    assert.match(t, /Esc\/\[Reorder\]: exit/);
});

test('chain mode takes priority over point-edit and selection', () => {
    const t = hintTextFor({
        chainMode: true,
        pointEditMode: true,
        pointEditStripName: 'strip9',
        selectedStripName: 'strip1',
    });
    assert.match(t, /Chain edit/);
});

test('placing takes priority over chain mode', () => {
    const t = hintTextFor({ placing: true, placingLabel: 'Ring 16', chainMode: true });
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
