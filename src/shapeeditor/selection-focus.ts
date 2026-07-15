export const UNSELECTED_GROUP_OPACITY = 0.4;

export function groupFocusOpacity(selectedStripIdxs: ReadonlySet<number> | number | null, stripIdx: number): number {
    if (selectedStripIdxs === null) return 1;
    if (typeof selectedStripIdxs === 'number') return selectedStripIdxs === stripIdx ? 1 : UNSELECTED_GROUP_OPACITY;
    return selectedStripIdxs.size === 0 || selectedStripIdxs.has(stripIdx) ? 1 : UNSELECTED_GROUP_OPACITY;
}
