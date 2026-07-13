/**
 * Pure hint-text generator for the ScreenMap Editor hint strip.
 *
 * State shape:
 *   {
 *     empty: boolean,           // no screenmap loaded / 0 strips
 *     placing: boolean,         // panel-placement ghost active
 *     placingLabel: string,     // panel name being placed
 *     pasting: boolean,         // paste-ghost active
 *     pastingCount: number,     // number of pasted strips
 *     pointEditMode: boolean,   // double-clicked into point-edit mode
 *     pointEditStripName: string, // strip name in point-edit
 *     selectedStripName: string|null, // strip currently selected (null if none)
 *     chainMode: boolean,       // [Chain] toolbar mode active (issue #24)
 *     reorderMode: boolean,     // [Reorder] toolbar mode active (issue #24)
 *   }
 *
 * Returns the left-side hint string per the discoverability spec.
 */
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
    if (s.placing) {
        const label = s.placingLabel ?? 'panel';
        return `Click to place "${label}" • Esc / right-click: cancel`;
    }
    if (s.pasting) {
        const n = typeof s.pastingCount === 'number' ? s.pastingCount : 0;
        return `Click to drop pasted strips (${String(n)}) • Esc: cancel`;
    }
    if (s.chainMode) {
        return 'Chain edit: drag an arrowhead to rewire • right-click arrow: menu • Esc/[Chain]: exit';
    }
    if (s.reorderMode) {
        return 'Reorder: ▲/▼ move strips within a pin • drag grip across pins to repin • Esc/[Reorder]: exit';
    }
    if (s.pointEditMode) {
        const name = s.pointEditStripName ?? '';
        return `Editing points in "${name}" • drag LED: move single • Shift+click edge: insert • Esc: exit`;
    }
    if (s.empty) {
        return 'Right-click for menu • drop a .json to load • press I to insert a panel';
    }
    if (s.selectedStripName) {
        return 'Drag LED or strip line: move group • double-click LED: edit points • Ctrl+drag: shape select • handles: scale/rotate strip • Del: remove strip';
    }
    return 'Drag canvas: pan • Ctrl+drag: shape select • R-drag: zoom • click LED: select strip • I: insert • Ctrl+V: paste';
}
