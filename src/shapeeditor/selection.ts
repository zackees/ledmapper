/** Reactive point and group selection store. The last selected group is primary. */
export class Selection {
    _pointIdx: number | null = null;
    _stripIdxs = new Set<number>();
    _onChange: (() => void) | null = null;

    setOnChange(fn: (() => void) | null | undefined) { this._onChange = typeof fn === 'function' ? fn : null; }
    getPointIdx() { return this._pointIdx; }
    /** Compatibility alias for consumers that explicitly need the primary group. */
    getStripIdx() { return this.getPrimaryStripIdx(); }
    getPrimaryStripIdx(): number | null {
        let primary: number | null = null;
        for (const idx of this._stripIdxs) primary = idx;
        return primary;
    }
    /** Defensive snapshot, never the mutable backing set. */
    getSelectedStripIdxs(): ReadonlySet<number> { return new Set(this._stripIdxs); }
    isStripSelected(stripIdx: number): boolean { return this._stripIdxs.has(stripIdx); }
    hasSelection() { return this._pointIdx !== null || this._stripIdxs.size > 0; }

    /** Selecting a point always collapses group selection to its owning group. */
    selectPoint(pointIdx: number | null, stripIdx: number | null) {
        const nextPoint = typeof pointIdx === 'number' && pointIdx >= 0 ? pointIdx : null;
        const nextStrip = typeof stripIdx === 'number' && stripIdx >= 0 ? stripIdx : this.getPrimaryStripIdx();
        const sameGroups = this._stripIdxs.size === (nextStrip === null ? 0 : 1) && this.getPrimaryStripIdx() === nextStrip;
        if (nextPoint === this._pointIdx && sameGroups) return;
        this._pointIdx = nextPoint;
        this._stripIdxs = nextStrip === null ? new Set() : new Set([nextStrip]);
        this._emit();
    }

    selectStrip(stripIdx: number | null) { this.selectOnlyStrip(stripIdx); }
    selectOnlyStrip(stripIdx: number | null) {
        const next = typeof stripIdx === 'number' && stripIdx >= 0 ? stripIdx : null;
        if (this._pointIdx === null && this._stripIdxs.size === (next === null ? 0 : 1) && this.getPrimaryStripIdx() === next) return;
        this._pointIdx = null;
        this._stripIdxs = next === null ? new Set() : new Set([next]);
        this._emit();
    }
    addStrip(stripIdx: number) {
        if (!Number.isInteger(stripIdx) || stripIdx < 0) return;
        if (this.getPrimaryStripIdx() === stripIdx && this._pointIdx === null) return;
        this._stripIdxs.delete(stripIdx);
        this._stripIdxs.add(stripIdx);
        this._pointIdx = null;
        this._emit();
    }
    toggleStrip(stripIdx: number) {
        if (!Number.isInteger(stripIdx) || stripIdx < 0) return;
        if (this._stripIdxs.has(stripIdx)) this._stripIdxs.delete(stripIdx); else this._stripIdxs.add(stripIdx);
        this._pointIdx = null;
        this._emit();
    }
    clearStrips() { this.selectOnlyStrip(null); }
    clear() { this.selectOnlyStrip(null); }

    onPointInsert(idx: number) {
        if (this._pointIdx !== null && this._pointIdx >= idx) { this._pointIdx++; this._emit(); }
    }
    onPointDelete(idx: number) {
        if (this._pointIdx === null) return;
        if (this._pointIdx === idx) this._pointIdx = null;
        else if (this._pointIdx > idx) this._pointIdx--;
        else return;
        this._emit();
    }
    onStripRemove(stripIdx: number) {
        if (this._stripIdxs.size === 0) return;
        const next = new Set<number>();
        for (const idx of this._stripIdxs) if (idx !== stripIdx) next.add(idx > stripIdx ? idx - 1 : idx);
        if (next.size === this._stripIdxs.size) return;
        this._stripIdxs = next;
        if (next.size === 0) this._pointIdx = null;
        this._emit();
    }
    onStripReorder(fromIdx: number, toIdx: number) {
        if (this._stripIdxs.size === 0 || fromIdx === toIdx) return;
        const remap = (idx: number) => idx === fromIdx ? toIdx : fromIdx < idx && idx <= toIdx ? idx - 1 : toIdx <= idx && idx < fromIdx ? idx + 1 : idx;
        const before = [...this._stripIdxs];
        const next = new Set(before.map(remap));
        if (before.every((idx, i) => idx === [...next][i])) return;
        this._stripIdxs = next;
        this._emit();
    }
    _emit() { this._onChange?.(); }
}
