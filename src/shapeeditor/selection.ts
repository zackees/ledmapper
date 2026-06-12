/**
 * Selection — small reactive store for the ScreenMap editor's
 * point and strip selection. Used by shapeeditor.js to drive
 * inspector UI updates and dirty flags.
 */
export class Selection {
    _pointIdx: number | null = null;
    _stripIdx: number | null = null;
    _onChange: (() => void) | null = null;

    constructor() {
        this._pointIdx = null;
        this._stripIdx = null;
        this._onChange = null;
    }

    /** Register a callback fired after any change. */
    setOnChange(fn: any) {
        this._onChange = typeof fn === 'function' ? fn : null;
    }

    getPointIdx() { return this._pointIdx; }
    getStripIdx() { return this._stripIdx; }

    /** True when either a point or strip is selected. */
    hasSelection() {
        return this._pointIdx !== null || this._stripIdx !== null;
    }

    /**
     * Select a point. `stripIdx` may be supplied to set both at once
     * (used when clicking an LED — selecting the point also selects
     * its owning strip). Pass `null` to clear the point.
     */
    selectPoint(pointIdx: any, stripIdx: any) {
        const newPoint = (typeof pointIdx === 'number' && pointIdx >= 0) ? pointIdx : null;
        const newStrip = (typeof stripIdx === 'number' && stripIdx >= 0) ? stripIdx : this._stripIdx;
        if (newPoint === this._pointIdx && newStrip === this._stripIdx) return;
        this._pointIdx = newPoint;
        this._stripIdx = newStrip;
        this._emit();
    }

    /** Select a strip; clears point selection. */
    selectStrip(stripIdx: any) {
        const newStrip = (typeof stripIdx === 'number' && stripIdx >= 0) ? stripIdx : null;
        if (newStrip === this._stripIdx && this._pointIdx === null) return;
        this._stripIdx = newStrip;
        this._pointIdx = null;
        this._emit();
    }

    /** Clear all selection. */
    clear() {
        if (this._pointIdx === null && this._stripIdx === null) return;
        this._pointIdx = null;
        this._stripIdx = null;
        this._emit();
    }

    /**
     * Adjust selection after a point is inserted at `idx`. Mirrors
     * Array.prototype.splice semantics for the selected index.
     */
    onPointInsert(idx: any) {
        if (this._pointIdx !== null && this._pointIdx >= idx) {
            this._pointIdx++;
            this._emit();
        }
    }

    /**
     * Adjust selection after a point at `idx` is deleted. If the
     * selected point was removed, selection is cleared (but the
     * stripIdx is kept).
     */
    onPointDelete(idx: any) {
        if (this._pointIdx === null) return;
        if (this._pointIdx === idx) {
            this._pointIdx = null;
            this._emit();
        } else if (this._pointIdx > idx) {
            this._pointIdx--;
            this._emit();
        }
    }

    /**
     * Adjust strip selection after `removeStrip(stripIdx)`. If the
     * removed strip was selected, clears strip selection.
     */
    onStripRemove(stripIdx: any) {
        if (this._stripIdx === null) return;
        if (this._stripIdx === stripIdx) {
            this._stripIdx = null;
            this._pointIdx = null;
            this._emit();
        } else if (this._stripIdx > stripIdx) {
            this._stripIdx--;
            this._emit();
        }
    }

    /**
     * Adjust strip selection after `reorderStrip(fromIdx, toIdx)`.
     */
    onStripReorder(fromIdx: any, toIdx: any) {
        if (this._stripIdx === null) return;
        let s = this._stripIdx;
        if (s === fromIdx) s = toIdx;
        else if (fromIdx < s && s <= toIdx) s--;
        else if (toIdx <= s && s < fromIdx) s++;
        if (s !== this._stripIdx) {
            this._stripIdx = s;
            this._emit();
        }
    }

    _emit() {
        if (this._onChange) this._onChange();
    }
}
