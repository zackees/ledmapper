/**
 * StripStore — owns the multi-strip metadata for the ScreenMap editor.
 *
 * A `stripInfo` shape (as produced by `parseScreenmapMultiStrip` in
 * `src/common.js`) looks like:
 *   {
 *     strips: [{name, points, diameter, offset, count, video_offset}, ...],
 *     allPoints: [[x,y], ...],
 *     totalCount: number,
 *   }
 *
 * This class centralizes the mutations that previously lived as
 * `_stripInfoOnInsert / _stripInfoOnDelete / _snapshotStripInfo /
 * _restoreStripInfo / _findStripForIndex` helpers inside
 * `src/shapeeditor/shapeeditor.js`, and adds higher-level operations
 * (`addStrip / removeStrip / reorderStrip / renameStrip / updateStrip`)
 * for upcoming phases.
 *
 * The store wraps a `stripInfo` object so existing read patterns
 * (`stripInfo.strips`, `stripInfo.totalCount`, ...) keep working through
 * the same reference after `load()` is called. When `stripInfo` is `null`
 * (no screenmap loaded, or single-strip CSV-only path), all helpers
 * degrade gracefully like the original code did.
 */

/** A mutable strip entry inside StripStore (superset of ParsedStrip). */
export interface StripEntry {
    name: string;
    points: [number, number][];
    diameter: number | undefined;
    offset: number;
    count: number;
    video_offset: number;
    pin: string;
    videoOffsetOverride: boolean;
    [key: string]: unknown; // allow dynamic patching via updateStrip
}

/** The internal stripInfo object managed by StripStore. */
export interface StripInfo {
    strips: StripEntry[];
    allPoints?: [number, number][];
    totalCount: number;
}

/** Snapshot strip (metadata only, no point data). */
export interface StripSnapshotEntry {
    name: string;
    diameter: number | undefined;
    offset: number;
    count: number;
    video_offset: number;
    pin: string;
    videoOffsetOverride: boolean;
    points: undefined;
}

/** Snapshot for undo (metadata only, no point data). */
export interface StripSnapshot {
    strips: StripSnapshotEntry[];
    totalCount: number;
}

export class StripStore {
    _info: StripInfo | null = null;

    constructor() {
        this._info = null;
    }

    /**
     * Adopt an external `stripInfo` object. Pass `null` to clear.
     * The same reference is retained so callers holding `store.get()` see
     * subsequent mutations in place.
     */
    load(stripInfo: StripInfo | null | undefined) {
        this._info = stripInfo ?? null;
        if (this._info) {
            // Normalise pin fields and re-derive non-overridden video_offsets
            // (issue #24): derived order = pins in first-appearance order,
            // then within-pin (array) order.
            for (const s of this._info.strips) {
                if (typeof s.pin !== 'string' || s.pin.trim() === '') s.pin = 'pin1';
                if (typeof s.videoOffsetOverride !== 'boolean') s.videoOffsetOverride = false;
            }
            this.recomputeDerivedVideoOffsets();
        }
    }

    /** Pin id of a strip object (default 'pin1'). Defensively handles null/undefined input. */
    static pinOf(s: { pin?: string | undefined } | null | undefined): string {
        return (s !== null && s !== undefined && typeof s.pin === 'string' && s.pin.trim() !== '') ? s.pin : 'pin1';
    }

    /**
     * Distinct pin ids in first-appearance order while walking strips[]
     * (issue #24 §1.1 — the strip array is the single source of truth).
     */
    getPinOrder(): string[] {
        const order: string[] = [];
        const seen = new Set<string>();
        for (const s of this.getStrips()) {
            const p = StripStore.pinOf(s);
            if (!seen.has(p)) { seen.add(p); order.push(p); }
        }
        return order;
    }

    /**
     * Derived video_offset for the strip at `stripIdx`: sum of counts of all
     * strips that precede it in the (pin first-appearance order, within-pin
     * array order) walk. Returns 0 when out of range.
     */
    getDerivedVideoOffset(stripIdx: number): number {
        const strips = this.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return 0;
        const targetStrip = strips[stripIdx];
        if (!targetStrip) return 0;
        const targetPin = StripStore.pinOf(targetStrip);
        let acc = 0;
        for (const pin of this.getPinOrder()) {
            for (let i = 0; i < strips.length; i++) {
                const st = strips[i];
                if (!st) continue;
                if (StripStore.pinOf(st) !== pin) continue;
                if (pin === targetPin && i === stripIdx) return acc;
                acc += st.count;
            }
        }
        return acc;
    }

    /**
     * Recompute video_offset for every strip whose videoOffsetOverride is
     * false, walking pins in first-appearance order then within-pin order.
     * Overridden strips keep their manual value but still occupy their
     * count in the accumulated chain.
     */
    recomputeDerivedVideoOffsets(): void {
        const strips = this.getStrips();
        let acc = 0;
        for (const pin of this.getPinOrder()) {
            for (const s of strips) {
                if (StripStore.pinOf(s) !== pin) continue;
                if (!s.videoOffsetOverride) s.video_offset = acc;
                acc += s.count;
            }
        }
    }

    /** Returns the raw stripInfo object (or null). */
    get(): StripInfo | null {
        return this._info;
    }

    /** Returns the strips array, or [] if no info loaded. */
    getStrips(): StripEntry[] {
        return this._info ? this._info.strips : [];
    }

    /** Returns totalCount, or 0 if no info loaded. */
    getTotalCount(): number {
        return this._info ? this._info.totalCount : 0;
    }

    /** Returns the number of strips, or 0 if no info loaded. */
    getStripCount(): number {
        return this._info ? this._info.strips.length : 0;
    }

    /**
     * Find the strip index that owns the given flat point index.
     * Returns -1 when no info is loaded or the index is out of range.
     */
    findStripForIndex(flatIdx: number): number {
        if (!this._info) return -1;
        const strips = this._info.strips;
        for (let s = 0; s < strips.length; s++) {
            const st = strips[s];
            if (!st) continue;
            if (flatIdx >= st.offset && flatIdx < st.offset + st.count) return s;
        }
        return -1;
    }

    /**
     * Update strip offsets/counts/totalCount after a point has been
     * inserted at flat index `flatIdx`. The new point is assigned to the
     * strip whose [offset, offset+count] range covers `flatIdx`; on a
     * boundary (idx == strip.offset for s>0) it is assigned to the
     * previous strip (extending the strip you inserted "after"). Appends
     * past the end attach to the last strip.
     *
     * Also pushes the new point into the owning strip's `points` array
     * and into `allPoints` so the in-memory model stays consistent.
     */
    onInsert(flatIdx: number, point: [number, number] | null = null): void {
        const info = this._info;
        if (!info || info.strips.length === 0) return;
        const strips = info.strips;

        let s = -1;
        for (let k = 0; k < strips.length; k++) {
            const st = strips[k];
            if (!st) continue;
            if (flatIdx >= st.offset && flatIdx <= st.offset + st.count) { s = k; break; }
        }
        if (s < 0) s = strips.length - 1;

        const owning = strips[s];
        if (!owning) return;
        const localIdx = Math.max(0, Math.min(owning.count, flatIdx - owning.offset));
        owning.count++;
        if (Array.isArray(owning.points) && point) {
            owning.points.splice(localIdx, 0, point);
        }
        for (let k = s + 1; k < strips.length; k++) {
            const st = strips[k];
            if (st) st.offset++;
        }
        info.totalCount++;
        if (Array.isArray(info.allPoints) && point) {
            info.allPoints.splice(flatIdx, 0, point);
        }
        this.recomputeDerivedVideoOffsets();
    }

    /**
     * Update strip offsets/counts/totalCount after a point at flat index
     * `flatIdx` has been deleted.
     */
    onDelete(flatIdx: number): void {
        const info = this._info;
        if (!info) return;
        const s = this.findStripForIndex(flatIdx);
        if (s < 0) return;
        const strips = info.strips;
        const owning = strips[s];
        if (!owning) return;
        const localIdx = flatIdx - owning.offset;
        owning.count--;
        if (Array.isArray(owning.points)) {
            owning.points.splice(localIdx, 1);
        }
        for (let k = s + 1; k < strips.length; k++) {
            const st = strips[k];
            if (st) st.offset--;
        }
        info.totalCount--;
        if (Array.isArray(info.allPoints)) {
            info.allPoints.splice(flatIdx, 1);
        }
        this.recomputeDerivedVideoOffsets();
    }

    /**
     * Capture per-strip offset/count and totalCount so a subsequent
     * `restore()` can undo any `onInsert`/`onDelete` bookkeeping. Does
     * NOT snapshot point data — the caller is responsible for restoring
     * points (the editor keeps screenmap_pts / rawPts undo data already).
     */
    snapshot(): StripSnapshot | null {
        if (!this._info) return null;
        return {
            strips: this._info.strips.map(s => ({
                name: s.name,
                diameter: s.diameter,
                offset: s.offset,
                count: s.count,
                video_offset: s.video_offset,
                pin: s.pin,
                videoOffsetOverride: s.videoOffsetOverride,
                points: undefined,
            })),
            totalCount: this._info.totalCount,
        };
    }

    /**
     * Restore offset/count/totalCount from a snapshot. Mirrors the
     * original `_restoreStripInfo` semantics: only metadata, no points.
     */
    restore(snap: StripSnapshot | null | undefined): void {
        if (!this._info || !snap) return;
        const strips = this._info.strips;
        for (let i = 0; i < snap.strips.length && i < strips.length; i++) {
            const snapStrip = snap.strips[i];
            const strip = strips[i];
            if (!snapStrip || !strip) continue;
            strip.offset = snapStrip.offset;
            strip.count = snapStrip.count;
            if (typeof snapStrip.pin === 'string') {
                strip.pin = snapStrip.pin;
            }
            if (typeof snapStrip.videoOffsetOverride === 'boolean') {
                strip.videoOffsetOverride = snapStrip.videoOffsetOverride;
            }
            if (typeof snapStrip.video_offset === 'number') {
                strip.video_offset = snapStrip.video_offset;
            }
        }
        this._info.totalCount = snap.totalCount;
    }

    /**
     * Append a new strip at the end. `points` is copied; offsets are
     * recomputed to chain after the previous last strip.
     */
    addStrip({ name, points = [], diameter, video_offset, pin, videoOffsetOverride }: {
        name?: string;
        points?: [number, number][];
        diameter?: number | undefined;
        video_offset?: number;
        pin?: string;
        videoOffsetOverride?: boolean;
    } = {}): number {
        this._info ??= { strips: [], allPoints: [], totalCount: 0 };
        const info = this._info;
        const stripName = name ?? `strip${String(info.strips.length + 1)}`;
        const ptsCopy: [number, number][] = points.map(p => [p[0], p[1]]);
        const offset = info.totalCount;
        const vo = typeof video_offset === 'number' ? video_offset : offset;
        info.strips.push({
            name: stripName,
            points: ptsCopy,
            diameter,
            offset,
            count: ptsCopy.length,
            video_offset: vo,
            pin: (typeof pin === 'string' && pin.trim() !== '') ? pin : 'pin1',
            videoOffsetOverride: videoOffsetOverride === true,
        });
        info.totalCount += ptsCopy.length;
        if (Array.isArray(info.allPoints)) {
            for (const p of ptsCopy) info.allPoints.push([p[0], p[1]]);
        }
        this.recomputeDerivedVideoOffsets();
        return info.strips.length - 1;
    }

    /**
     * Remove the strip at `stripIdx`. Subsequent strips' offsets are
     * decreased by the removed strip's count; totalCount is updated and
     * the removed range is spliced out of allPoints.
     */
    removeStrip(stripIdx: number): void {
        const info = this._info;
        if (!info) return;
        const strips = info.strips;
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const removed = strips[stripIdx];
        if (!removed) return;
        const removedCount = removed.count;
        const removedOffset = removed.offset;
        strips.splice(stripIdx, 1);
        for (let k = stripIdx; k < strips.length; k++) {
            const st = strips[k];
            if (st) st.offset -= removedCount;
        }
        info.totalCount -= removedCount;
        if (Array.isArray(info.allPoints)) {
            info.allPoints.splice(removedOffset, removedCount);
        }
        this.recomputeDerivedVideoOffsets();
    }

    /**
     * Move the strip at `fromIdx` to `toIdx` (insertion index in the new
     * arrangement). Recomputes offsets and the `allPoints` ordering.
     */
    reorderStrip(fromIdx: number, toIdx: number): void {
        const info = this._info;
        if (!info) return;
        const strips = info.strips;
        if (fromIdx < 0 || fromIdx >= strips.length) return;
        if (toIdx < 0) toIdx = 0;
        if (toIdx >= strips.length) toIdx = strips.length - 1;
        if (fromIdx === toIdx) return;
        const [moving] = strips.splice(fromIdx, 1) as [StripEntry];
        strips.splice(toIdx, 0, moving);
        this._recomputeOffsetsAndAllPoints();
    }

    /** Rename the strip at `stripIdx`. */
    renameStrip(stripIdx: number, newName: string): void {
        const info = this._info;
        if (!info) return;
        const strips = info.strips;
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const s = strips[stripIdx];
        if (s) s.name = newName;
    }

    /**
     * Patch arbitrary fields on a strip. If `points` is supplied, the
     * strip's count, downstream offsets, totalCount, and allPoints are
     * all rebuilt to stay consistent.
     */
    updateStrip(stripIdx: number, patch: Partial<StripEntry> & { points?: [number, number][] }): void {
        const info = this._info;
        if (!info) return;
        const strips = info.strips;
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const strip = strips[stripIdx];
        if (!strip) return;
        const pointsChanged = Object.prototype.hasOwnProperty.call(patch, 'points');
        const pinChanged = Object.prototype.hasOwnProperty.call(patch, 'pin');
        for (const key of Object.keys(patch) as (keyof StripEntry)[]) {
            if (key === 'offset' || key === 'count') continue; // managed
            if (key === 'points') {
                strip.points = (patch.points ?? []).map(p => [p[0], p[1]] as [number, number]);
                strip.count = strip.points.length;
            } else {
                (strip as Record<string, unknown>)[key] = patch[key];
            }
        }
        if (pointsChanged) {
            this._recomputeOffsetsAndAllPoints();
        } else if (pinChanged) {
            this.recomputeDerivedVideoOffsets();
        }
    }

    /**
     * Recompute every strip's `offset` from its `count`, refresh
     * `totalCount`, and (if present) rebuild `allPoints` by concatenating
     * each strip's `points`.
     */
    _recomputeOffsetsAndAllPoints(): void {
        const info = this._info;
        if (!info) return;
        const strips = info.strips;
        let offset = 0;
        for (const s of strips) {
            s.offset = offset;
            offset += s.count;
        }
        info.totalCount = offset;
        if (Array.isArray(info.allPoints)) {
            const next: [number, number][] = [];
            for (const s of strips) {
                if (Array.isArray(s.points)) {
                    for (const p of s.points) next.push([p[0], p[1]]);
                }
            }
            info.allPoints = next;
        }
        this.recomputeDerivedVideoOffsets();
    }
}
