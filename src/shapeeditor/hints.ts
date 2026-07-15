/** Pure hint-text generator for the /create editor hint strip. */
interface HintState {
    empty?: boolean;
    placing?: boolean;
    placingLabel?: string;
    pasting?: boolean;
    pastingCount?: number;
    pointEditMode?: boolean;
    pointEditStripName?: string;
    selectedStripName?: string | null;
    chainMode?: boolean;
    reorderMode?: boolean;
}

export function hintTextFor(state: HintState | null | undefined) {
    const s = state ?? {};
    if (s.placing) return `Click to place "${s.placingLabel ?? 'panel'}" · Esc / right-click: cancel`;
    if (s.pasting) return `Click to drop pasted strips (${String(s.pastingCount ?? 0)}) · Esc: cancel`;
    if (s.chainMode) return 'Chain edit: drag an arrowhead to rewire · right-click arrow: menu · Esc/[Chain]: exit';
    if (s.reorderMode) return 'Reorder: ▲/▼ move strips within a pin · drag grip across pins to repin · Esc/[Reorder]: exit';
    if (s.pointEditMode) return `Editing points in "${s.pointEditStripName ?? ''}" · drag LED: move single · Shift+click edge: insert · Esc: exit`;
    if (s.empty) return 'Right-click for menu · drop a .json to load · press I to insert a panel';
    if (s.selectedStripName) return 'Drag selected group: move · Shift+click: add/remove group · Ctrl+drag: group marquee · double-click LED: edit points · rotate handle: rotate selection';
    return 'Drag canvas: pan · R-drag: zoom · click group: select · Ctrl+drag: group marquee · double-click LED: edit points · I: insert';
}
