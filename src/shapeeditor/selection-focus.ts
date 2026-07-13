export const UNSELECTED_GROUP_OPACITY = 0.4;

export function groupFocusOpacity(selectedStripIdx: number | null, stripIdx: number): number {
    return selectedStripIdx === null || selectedStripIdx === stripIdx ? 1 : UNSELECTED_GROUP_OPACITY;
}
