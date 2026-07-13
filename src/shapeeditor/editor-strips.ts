// Named ShapeEditor method bundle: strips.
import type { ShapeEditor } from './shapeeditor-class';
import { StripStore, type StripEntry, type StripSnapshot } from "./strips-model";
import { safeStorage } from "../services/storage";
import { fireDialog } from "../ui/dialogs";
import { getBackup, notePinMutation } from "../screenmap-store";
import type { UndoAction } from "./shapeeditor-types";
import { getStripColors } from "../common";
import { gfxColors } from "../ui/theme";
import { rotatePointsAround } from "./strip-rotate";
import type { PointArrayWithDiameter } from "../common";

export interface EditorStripsMethods {
    _removeStripPoints: (stripIdx: number) => { removedStrip: StripEntry & { points: [number, number][] }; removedScreenmap: PointArrayWithDiameter; removedRaw: [number, number][] };
    _insertStripPoints:  (stripIdx: number, removed: ReturnType<ShapeEditor['_removeStripPoints']>) => void;
    _reorderStripPoints: (fromIdx: number, toIdx: number) => void;
    _pinOfStrip: (s: StripEntry) => string;
    _withinPinIdx: (stripIdx: number) => number;
    _nextFreePinId: () => string;
    _defaultNewStripPin: () => string;
    _applyRepin: (action: UndoAction) => void;
    _revertRepin: (action: UndoAction) => void;
    _applyPinOrder: (order: string[]) => void;
    _applyPinRename: (fromId: string, toId: string) => void;
    _snapshotStripInfo: () => StripSnapshot | null;
    _restoreStripInfo: (snap: StripSnapshot) => void;
    _stripInfoOnDelete: (idx: number) => void;
    _stripInfoOnInsert: (idx: number) => void;
    hslAccentForStrip: (s: number, total: number) => string;
    _withinPinNeighbor: (stripIdx: number, dir: 1 | -1) => number;
    renderStripsPanel: () => void;
    setEditorMode: (mode: string | null) => void;
    renderSelectedStripRow: () => void;
    _reverseStripInPlace: (stripIdx: number) => boolean;
    doReverseStrip: (stripIdx: number) => void;
    doSetVideoOffset: (stripIdx: number, rawValue: string | number) => void;
    _maybeShowRepinToast: (stripName: string, newPin: string) => void;
    doRepinStrip: (stripIdx: number, newPinRaw: string) => boolean;
    doToggleVoLock: (stripIdx: number) => void;
    doRenamePin: (oldId: string, newIdRaw: string) => boolean;
    doRenamePinPrompt: (pinId: string) => Promise<void>;
    doReorderPin: (pinId: string, toIdx: number) => boolean;
    doAddPin: () => string | null;
    _makeRepinAction: (stripIdx: number, newPin: string) => UndoAction;
    doReorderStrip: (fromIdx: number, toIdx: number) => void;
    doRenameStripPrompt: (stripIdx: number) => Promise<void>;
    doDeleteStripPrompt: (stripIdx: number) => Promise<void>;
    _finalizeStripDrag: () => void;
    _applyStripTranslate: (stripIdx: number, sdx: number, sdy: number) => void;
    _applyStripRotate: (stripIdx: number, deltaRad: number, centerSm: { x: number; y: number }, centerRaw: { x: number; y: number }) => void;
    _finalizeStripRotate: () => void;
    doRotateSelectedStripByDegrees: (degrees: number) => boolean;
}

export const editorStripsMethods: EditorStripsMethods & ThisType<ShapeEditor> = {
    _removeStripPoints(this: ShapeEditor, stripIdx: number){

        if (!this.stripInfo) throw new Error('No stripInfo in _removeStripPoints');
        const strip = this.stripInfo.strips[stripIdx];
        if (!strip) throw new Error(`Strip ${String(stripIdx)} not found`);
        const removedScreenmap = this._spliceArray(this.screenmap_pts, strip.offset, strip.count);
        const removedRaw = this._spliceArray(this.rawPts, strip.offset, strip.count);
        const removedStrip: StripEntry & { points: [number, number][] } = { ...strip, points: strip.points.map((p) => [p[0], p[1]] as [number, number]) };
        this.stripStore.removeStrip(stripIdx);
        return { removedStrip, removedScreenmap, removedRaw };
    },
    _insertStripPoints(this: ShapeEditor, stripIdx: number, removed: ReturnType<ShapeEditor['_removeStripPoints']>){

        const { removedStrip, removedScreenmap, removedRaw } = removed;
        // Compute the flat insertion point for screenmap_pts/rawPts:
        // the strip will be placed at stripIdx; its starting offset equals
        // sum of counts of strips [0..stripIdx).
        let insertAt = 0;
        if (this.stripInfo) {
            for (let k = 0; k < stripIdx && k < this.stripInfo.strips.length; k++) {
                insertAt += this.stripInfo.strips[k]?.count ?? 0;
            }
        }
        this.screenmap_pts.splice(insertAt, 0, ...removedScreenmap);
        this.rawPts.splice(insertAt, 0, ...removedRaw);
        // Reinsert in StripStore
        const info = this.stripStore.get();
        const stripObj = {
            name: removedStrip.name,
            points: removedStrip.points,
            diameter: removedStrip.diameter,
            offset: 0, // recomputed
            count: removedStrip.count,
            video_offset: typeof removedStrip.video_offset === 'number' ? removedStrip.video_offset : 0,
            pin: typeof removedStrip.pin === 'string' ? removedStrip.pin : 'pin1',
            videoOffsetOverride: removedStrip.videoOffsetOverride,
        };
        if (info) info.strips.splice(stripIdx, 0, stripObj);
        // Recompute offsets/allPoints
        this.stripStore._recomputeOffsetsAndAllPoints();
    },
    _reorderStripPoints(this: ShapeEditor, fromIdx: number, toIdx: number){

        if (!this.stripInfo) return;
        // Splice screenmap_pts/rawPts to mirror the strip move.
        const fromStrip = this.stripInfo.strips[fromIdx];
        if (!fromStrip) return;
        const fromOff = fromStrip.offset;
        const fromCnt = fromStrip.count;
        const movedScreenmap = this.screenmap_pts.splice(fromOff, fromCnt);
        const movedRaw = this.rawPts.splice(fromOff, fromCnt);
        this.stripStore.reorderStrip(fromIdx, toIdx);
        // After reorder, the moved strip is at toIdx; compute its new offset
        const newOffset = this.stripInfo.strips[toIdx]?.offset ?? 0;
        this.screenmap_pts.splice(newOffset, 0, ...movedScreenmap);
        this.rawPts.splice(newOffset, 0, ...movedRaw);
    },
    _pinOfStrip(this: ShapeEditor, s: StripEntry){

        return StripStore.pinOf(s);
    },
    _withinPinIdx(this: ShapeEditor, stripIdx: number){

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const si = strips[stripIdx];
        if (!si) return -1;
        const pin = this._pinOfStrip(si);
        let n = 0;
        for (let i = 0; i < stripIdx; i++) {
            const st = strips[i];
            if (st && this._pinOfStrip(st) === pin) n++;
        }
        return n;
    },
    _nextFreePinId(this: ShapeEditor){

        const used = new Set(this.stripStore.getStrips().map(this._pinOfStrip));
        let n = 1;
        while (used.has(`pin${String(n)}`)) n++;
        return `pin${String(n)}`;
    },
    _defaultNewStripPin(this: ShapeEditor){

        const strips = this.stripStore.getStrips();
        const sIdx = this.selection.getStripIdx();
        if (sIdx !== null && sIdx >= 0 && sIdx < strips.length) {
            const s = strips[sIdx];
            if (s) return this._pinOfStrip(s);
        }
        if (strips.length > 0) {
            const last = strips[strips.length - 1];
            if (last) return this._pinOfStrip(last);
        }
        return 'pin1';
    },
    _applyRepin(this: ShapeEditor, action: UndoAction){

        const a = action as Record<string, unknown>;
        const strips = this.stripStore.getStrips();
        const s = strips[a.stripIdx as number];
        if (!s) return;
        s.pin = a.newPin as string;
        s.videoOffsetOverride = false;
        // Target index: just after the last existing strip of newPin
        // (excluding the strip itself); append at end for a brand-new pin.
        let lastSame = -1;
        for (let i = 0; i < strips.length; i++) {
            if (i === (a.stripIdx as number)) continue;
            if (this._pinOfStrip(this.nn(strips[i])) === (a.newPin as string)) lastSame = i;
        }
        let target;
        if (lastSame < 0) target = strips.length - 1;
        else target = lastSame > (a.stripIdx as number) ? lastSame : lastSame + 1;
        if (target !== (a.stripIdx as number)) {
            this._reorderStripPoints(a.stripIdx as number, target);
            this.selection.onStripReorder(a.stripIdx as number, target);
        } else {
            this.stripStore.recomputeDerivedVideoOffsets();
        }
        a.newStripIdx = target;
    },
    _revertRepin(this: ShapeEditor, action: UndoAction){

        const a = action as Record<string, unknown>;
        const strips = this.stripStore.getStrips();
        const fromIdx = typeof a.newStripIdx === 'number' ? (a.newStripIdx) : (a.stripIdx as number);
        const s = strips[fromIdx];
        if (!s) return;
        s.pin = a.oldPin as string;
        s.videoOffsetOverride = a.oldOverride === true;
        if (fromIdx !== (a.stripIdx as number)) {
            this._reorderStripPoints(fromIdx, a.stripIdx as number);
            this.selection.onStripReorder(fromIdx, a.stripIdx as number);
        } else {
            this.stripStore.recomputeDerivedVideoOffsets();
        }
        if (a.oldOverride === true && typeof a.oldVideoOffset === 'number') {
            this.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.oldVideoOffset });
        }
    },
    _applyPinOrder(this: ShapeEditor, order: string[]){

        const info = this.stripStore.get();
        if (!info) return;
        const strips = info.strips;
        const selStrip = (() => {
            const i = this.selection.getStripIdx();
            return (i !== null && i >= 0 && i < strips.length) ? (strips[i] ?? null) : null;
        })();
        const groups = new Map<string, number[]>();
        for (let i = 0; i < strips.length; i++) {
            const st = strips[i];
            if (!st) continue;
            const p = this._pinOfStrip(st);
            if (!groups.has(p)) groups.set(p, []);
            groups.get(p)?.push(i);
        }
        const fullOrder = [...order];
        for (const p of groups.keys()) {
            if (!fullOrder.includes(p)) fullOrder.push(p);
        }
        const newIdxOrder = [];
        for (const p of fullOrder) {
            const g = groups.get(p);
            if (g) newIdxOrder.push(...g);
        }
        if (newIdxOrder.length !== strips.length) return;
        // Rebuild flat arrays + strips array in the new order.
        const newScreen: [number, number][] = [];
        const newRaw: [number, number][] = [];
        const newStrips = [];
        for (const idx of newIdxOrder) {
            const st = strips[idx];
            if (!st) continue;
            for (let k = st.offset; k < st.offset + st.count; k++) {
                newScreen.push(this.screenmap_pts[k] ?? ([0, 0] as [number, number]));
                newRaw.push(this.rawPts[k] ?? ([0, 0] as [number, number]));
            }
            newStrips.push(st);
        }
        this.screenmap_pts.length = 0;
        this.screenmap_pts.push(...newScreen);
        this.rawPts.length = 0;
        this.rawPts.push(...newRaw);
        strips.length = 0;
        strips.push(...(newStrips));
        this.stripStore._recomputeOffsetsAndAllPoints();
        // Re-select the same strip object at its new index.
        if (selStrip) {
            const newIdx = strips.indexOf(selStrip);
            if (newIdx >= 0) this.selection.selectStrip(newIdx);
        }
    },
    _applyPinRename(this: ShapeEditor, fromId: string, toId: string){

        const strips = this.stripStore.getStrips();
        for (const s of strips) {
            if (this._pinOfStrip(s) === fromId) s.pin = toId;
        }
    },
    _snapshotStripInfo(this: ShapeEditor){
 return this.stripStore.snapshot(); },
    _restoreStripInfo(this: ShapeEditor, snap: StripSnapshot){
 this.stripStore.restore(snap); },
    _stripInfoOnDelete(this: ShapeEditor, idx: number){
 this.stripStore.onDelete(idx); },
    _stripInfoOnInsert(this: ShapeEditor, idx: number){
 this.stripStore.onInsert(idx); },
    hslAccentForStrip(this: ShapeEditor, s: number, total: number): string{

        if (total <= 1) return gfxColors.accentBlue();
        const colors = getStripColors(total);
        return colors[s] ?? gfxColors.accentBlue();
    },
    _withinPinNeighbor(this: ShapeEditor, stripIdx: number, dir: 1 | -1){

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const pin = this._pinOfStrip(this.nn(strips[stripIdx]));
        let i = stripIdx + dir;
        while (i >= 0 && i < strips.length) {
            if (this._pinOfStrip(this.nn(strips[i])) === pin) return i;
            i += dir;
        }
        return -1;
    },
    renderStripsPanel(this: ShapeEditor){

        const strips = this.stripStore.getStrips();
        this.dom_strips_list.innerHTML = '';
        // Keep the panel visible whenever we have a backup to surface — even
        // when no strips are currently loaded — so the user can find "Restore
        // backup…" after pressing New.
        const haveBackup = !!getBackup();
        if (strips.length === 0) {
            this.dom_strips_panel.style.display = haveBackup ? '' : 'none';
            this.renderSelectedStripRow();
            return;
        }
        this.dom_strips_panel.style.display = '';
        this.dom_strips_list.classList.toggle('chain-mode', this.editorMode === 'chain');
        this.dom_strips_list.classList.toggle('reorder-mode', this.editorMode === 'reorder');
        const selStripIdx = this.selection.getStripIdx();
        const total = strips.length;

        // Group strip indices under pins in first-appearance order (§1.1).
        const pinOrder: string[] = [];
        const groups = new Map<string, number[]>();
        for (let i = 0; i < strips.length; i++) {
            const p = this._pinOfStrip(this.nn(strips[i]));
            if (!groups.has(p)) { groups.set(p, []); pinOrder.push(p); }
            groups.get(p)?.push(i);
        }

        const buildStripRow = (i: number) => {
            const s = this.nn(strips[i]);
            const row = document.createElement('div');
            row.className = 'strip-row' + (i === selStripIdx ? ' active' : '');
            row.dataset.stripIdx = String(i);
            row.dataset.pinId = this._pinOfStrip(s);

            const grip = document.createElement('span');
            grip.className = 'strip-grip';
            grip.textContent = '⠿';
            grip.title = 'Drag within pin to reorder | drag onto a pin header to repin';
            grip.draggable = true;
            grip.dataset.stripIdx = String(i);
            row.appendChild(grip);

            const swatch = document.createElement('span');
            swatch.className = 'strip-swatch';
            swatch.style.background = this.hslAccentForStrip(i, total);
            row.appendChild(swatch);

            const name = document.createElement('span');
            name.className = 'strip-name';
            name.textContent = s.name;
            row.appendChild(name);

            const count = document.createElement('span');
            count.className = 'strip-count';
            count.textContent = `${String(s.count)} LED${s.count === 1 ? '' : 's'}`;
            row.appendChild(count);

            const mkBtn = (label: string, title: string, action: string, disabled: boolean) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'strip-btn';
                b.textContent = label;
                b.title = title;
                b.dataset.action = action;
                b.dataset.stripIdx = String(i);
                if (disabled) b.disabled = true;
                return b;
            };

            row.appendChild(mkBtn('▲', 'Move up within pin', 'up', this._withinPinNeighbor(i, -1) < 0));
            row.appendChild(mkBtn('▼', 'Move down within pin', 'down', this._withinPinNeighbor(i, 1) < 0));
            row.appendChild(mkBtn('Rev', 'Reverse LED order', 'reverse', s.count < 2));
            row.appendChild(mkBtn('Rename', 'Rename strip', 'rename', false));
            row.appendChild(mkBtn('×', 'Delete strip', 'delete', strips.length <= 1));

            // video_offset display: read-only unless this strip's LOCK
            // (videoOffsetOverride) is engaged (§1.4).
            const overridden = s.videoOffsetOverride;
            const off = document.createElement('input');
            off.type = 'number';
            off.className = 'strip-offset' + (overridden ? '' : ' derived');
            off.min = '0';
            off.step = '1';
            off.title = overridden
                ? 'video_offset (manual override)'
                : 'video_offset (derived from pin order — engage LOCK to edit)';
            off.value = String(typeof s.video_offset === 'number' ? s.video_offset : s.offset);
            off.dataset.stripIdx = String(i);
            off.dataset.role = 'video-offset';
            off.readOnly = !overridden;
            row.appendChild(off);

            const lock = document.createElement('button');
            lock.type = 'button';
            lock.className = 'strip-btn strip-lock' + (overridden ? ' engaged' : '');
            lock.textContent = overridden ? '🔒' : '🔓';
            lock.title = overridden
                ? 'Unlock: re-derive video_offset from pin order'
                : 'Lock: override video_offset manually';
            lock.dataset.action = 'lock';
            lock.dataset.stripIdx = String(i);
            lock.setAttribute('aria-pressed', overridden ? 'true' : 'false');
            row.appendChild(lock);

            return row;
        };

        let connectorN = 0;
        for (const pin of pinOrder) {
            const idxs = this.nn(groups.get(pin), `pin ${pin} missing from groups`);
            const ledTotal = idxs.reduce((a: number, i: number) => a + this.nn(strips[i]).count, 0);
            const det = document.createElement('details');
            det.className = 'pin-group';
            det.dataset.pinId = pin;
            det.open = !this.collapsedPins.has(pin);
            det.addEventListener('toggle', () => {
                if (det.open) this.collapsedPins.delete(pin);
                else this.collapsedPins.add(pin);
            }, { signal: this.signal });

            const sum = document.createElement('summary');
            sum.className = 'pin-header';
            sum.dataset.pinId = pin;
            sum.draggable = true;
            sum.title = 'Drag to reorder pins | click name to rename';

            const pinName = document.createElement('span');
            pinName.className = 'pin-name';
            pinName.textContent = pin;
            pinName.dataset.pinId = pin;
            pinName.title = 'Click to rename pin';
            sum.appendChild(pinName);

            const pinMeta = document.createElement('span');
            pinMeta.className = 'pin-meta';
            pinMeta.textContent = `${String(idxs.length)} strip${idxs.length === 1 ? '' : 's'} · ${String(ledTotal)} LED${ledTotal === 1 ? '' : 's'}`;
            sum.appendChild(pinMeta);

            const addStrip = document.createElement('button');
            addStrip.type = 'button';
            addStrip.className = 'strip-btn pin-add-strip';
            addStrip.textContent = '+ strip';
            addStrip.title = `Insert a new strip on ${pin}`;
            addStrip.dataset.action = 'add-strip';
            addStrip.dataset.pinId = pin;
            sum.appendChild(addStrip);

            det.appendChild(sum);

            const body = document.createElement('div');
            body.className = 'pin-strips';
            for (let k = 0; k < idxs.length; k++) {
                body.appendChild(buildStripRow(this.nn(idxs[k])));
                // Connector rows between same-pin strips — visible only in
                // Chain mode (§1.6); click opens the inline connector menu.
                if (this.editorMode === 'chain' && k < idxs.length - 1) {
                    connectorN++;
                    const cr = document.createElement('div');
                    cr.className = 'connector-row';
                    cr.dataset.upIdx = String(this.nn(idxs[k]));
                    cr.dataset.downIdx = String(this.nn(idxs[k + 1]));
                    cr.textContent = `──(${String(connectorN)})──▶`;
                    cr.title = 'Connector — click for Swap / Split / Move options';
                    body.appendChild(cr);
                }
            }
            det.appendChild(body);

            this.dom_strips_list.appendChild(det);
        }
        this.renderSelectedStripRow();
    },
    setEditorMode(this: ShapeEditor, mode: string | null){

        const m = (mode === 'chain' || mode === 'reorder') ? mode : null;
        if (m === this.editorMode) return;
        this.editorMode = m;
        this.connectorDrag = null;
        this.startHandleDrag = null;
        if (m) (this.dom_strips_panel as HTMLDetailsElement).open = true;
        this.dom_strips_btn_chain.classList.toggle('active', m === 'chain');
        this.dom_strips_btn_chain.setAttribute('aria-pressed', m === 'chain' ? 'true' : 'false');
        this.dom_strips_btn_reorder.classList.toggle('active', m === 'reorder');
        this.dom_strips_btn_reorder.setAttribute('aria-pressed', m === 'reorder' ? 'true' : 'false');
        // Reorder mode dims the canvas (§1.6); wrapper exists post-initRenderer.
        if (this.wrapper) this.wrapper.classList.toggle('canvas-dim', m === 'reorder');
        this._hideConnectorMenu();
        this.renderStripsPanel();
        this._updateHintStrip();
        this.setNeedsRender();
    },
    renderSelectedStripRow(this: ShapeEditor){

        const strips = this.stripStore.getStrips();
        const sIdx = this.selection.getStripIdx();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            this.dom_strips_selected_row.style.display = 'none';
            return;
        }
        const s = this.nn(strips[sIdx]);
        const pin = this._pinOfStrip(s);
        this.dom_strips_selected_row.style.display = '';
        this.dom_strips_selected_label.textContent = `Selected: ${s.name} (${pin})`;
        this.dom_strips_move_pin.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Move to pin…';
        placeholder.selected = true;
        placeholder.disabled = true;
        this.dom_strips_move_pin.appendChild(placeholder);
        for (const p of this.stripStore.getPinOrder()) {
            if (p === pin) continue;
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            this.dom_strips_move_pin.appendChild(opt);
        }
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = 'New pin…';
        this.dom_strips_move_pin.appendChild(newOpt);
    },
    _reverseStripInPlace(this: ShapeEditor, stripIdx: number){

        const info = this.stripStore.get();
        if (!info) return false;
        const strip = info.strips[stripIdx];
        if (!strip || strip.count < 2) return false;
        const lo = strip.offset, hi = strip.offset + strip.count;
        // Reverse the flat slice in both screenmap_pts and rawPts.
        const sm = this.screenmap_pts.slice(lo, hi).reverse();
        const rw = this.rawPts.slice(lo, hi).reverse();
        for (let i = 0; i < sm.length; i++) {
            this.screenmap_pts[lo + i] = this.nn(sm[i]);
            this.rawPts[lo + i] = this.nn(rw[i]);
        }
        if (Array.isArray(strip.points)) strip.points.reverse();
        if (Array.isArray(info.allPoints)) {
            for (let i = 0; i < sm.length; i++) info.allPoints[lo + i] = [this.nn(sm[i])[0], this.nn(sm[i])[1]];
        }
        return true;
    },
    doReverseStrip(this: ShapeEditor, stripIdx: number){

        if (!this._reverseStripInPlace(stripIdx)) return;
        this.pushUndo({ type: 'strip-reverse', stripIdx });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
    },
    doSetVideoOffset(this: ShapeEditor, stripIdx: number, rawValue: string | number){

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const v = parseInt(String(rawValue), 10);
        if (!Number.isFinite(v) || v < 0) {
            this.renderStripsPanel();
            return;
        }
        const oldValue = typeof this.nn(strips[stripIdx]).video_offset === 'number'
            ? this.nn(strips[stripIdx]).video_offset
            : this.nn(strips[stripIdx]).offset;
        if (oldValue === v) return;
        this.stripStore.updateStrip(stripIdx, { video_offset: v });
        this.pushUndo({ type: 'strip-offset', stripIdx, oldValue, newValue: v });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsRender();
    },
    _maybeShowRepinToast(this: ShapeEditor, stripName: string, newPin: string){

        if (safeStorage.get('lm:shapeeditor-repinToastShown')) return;
        safeStorage.set('lm:shapeeditor-repinToastShown', '1');
        void this._toastInfo(`Moved "${stripName}" to ${newPin}. vo: was reset; Undo to restore.`);
    },
    doRepinStrip(this: ShapeEditor, stripIdx: number, newPinRaw: string){

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return false;
        const newPin = typeof newPinRaw === 'string' ? newPinRaw.trim() : '';
        if (!newPin) return false;
        const s = this.nn(strips[stripIdx]);
        const oldPin = this._pinOfStrip(s);
        if (newPin === oldPin) return false;
        const action = {
            type: 'strip-repin',
            stripIdx,
            oldPin,
            newPin,
            oldWithinPinIdx: this._withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st) => this._pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride,
        };
        this._applyRepin(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        this._maybeShowRepinToast(s.name, newPin);
        return true;
    },
    doToggleVoLock(this: ShapeEditor, stripIdx: number){

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const s = this.nn(strips[stripIdx]);
        const oldOverride = s.videoOffsetOverride;
        const newOverride = !oldOverride;
        const oldValue = typeof s.video_offset === 'number' ? s.video_offset : s.offset;
        const newValue = newOverride ? oldValue : this.stripStore.getDerivedVideoOffset(stripIdx);
        this.stripStore.updateStrip(stripIdx, { videoOffsetOverride: newOverride, video_offset: newValue });
        this.pushUndo({ type: 'vo-override-toggle', stripIdx, oldOverride, newOverride, oldValue, newValue });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsRender();
    },
    doRenamePin(this: ShapeEditor, oldId: string, newIdRaw: string){

        const newId = typeof newIdRaw === 'string' ? newIdRaw.trim() : '';
        if (!newId || newId === oldId) return false;
        const pins = this.stripStore.getPinOrder();
        if (!pins.includes(oldId)) return false;
        if (pins.includes(newId)) return false;
        this._applyPinRename(oldId, newId);
        this.pushUndo({ type: 'pin-rename', oldId, newId });
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        return true;
    },
    async doRenamePinPrompt(this: ShapeEditor, pinId: string){

        const pins = this.stripStore.getPinOrder();
        if (!pins.includes(pinId)) return;
        if (this.signal.aborted) return;
        const swalResult1 = await fireDialog({
            title: 'Rename Pin',
            input: 'text',
            inputValue: pinId,
            inputLabel: `New name for "${pinId}" (labels only — export order determines addLeds order)`,
            showCancelButton: true,
            inputValidator: (v) => {
                const name = (v || '').trim();
                if (!name) return 'Pin name cannot be empty';
                if (name !== pinId && pins.includes(name)) {
                    return `A pin named "${name}" already exists`;
                }
                return null;
            },
        });
        const value1: unknown = swalResult1.value;
        if (typeof value1 !== 'string') return;
        this.doRenamePin(pinId, value1);
    },
    doReorderPin(this: ShapeEditor, pinId: string, toIdx: number){

        const oldOrder = this.stripStore.getPinOrder();
        const fromIdx = oldOrder.indexOf(pinId);
        if (fromIdx < 0) return false;
        const clamped = Math.max(0, Math.min(oldOrder.length - 1, toIdx));
        if (clamped === fromIdx) return false;
        const newOrder = [...oldOrder];
        newOrder.splice(fromIdx, 1);
        newOrder.splice(clamped, 0, pinId);
        this._applyPinOrder(newOrder);
        this.pushUndo({ type: 'pin-reorder', oldOrder, newOrder });
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        return true;
    },
    doAddPin(this: ShapeEditor){

        const sIdx = this.selection.getStripIdx();
        const strips = this.stripStore.getStrips();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            void this._toastInfo('Select a strip first — [+ Pin] moves it to a new pin');
            return null;
        }
        const newPin = this._nextFreePinId();
        this.doRepinStrip(sIdx, newPin);
        return newPin;
    },
    _makeRepinAction(this: ShapeEditor, stripIdx: number, newPin: string){

        const strips = this.stripStore.getStrips();
        const s = this.nn(strips[stripIdx]);
        return {
            type: 'strip-repin',
            stripIdx,
            oldPin: this._pinOfStrip(s),
            newPin,
            oldWithinPinIdx: this._withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st) => this._pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride,
        };
    },
    doReorderStrip(this: ShapeEditor, fromIdx: number, toIdx: number){

        const strips = this.stripStore.getStrips();
        if (fromIdx < 0 || fromIdx >= strips.length) return;
        if (toIdx < 0 || toIdx >= strips.length) return;
        if (fromIdx === toIdx) return;
        this._reorderStripPoints(fromIdx, toIdx);
        this.selection.onStripReorder(fromIdx, toIdx);
        this.pushUndo({ type: 'strip-reorder', fromIdx, toIdx });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
    },
    async doRenameStripPrompt(this: ShapeEditor, stripIdx: number){

        const strips = this.stripStore.getStrips();
        const strip = strips[stripIdx];
        if (!strip) return;
        const oldName = strip.name;
        if (this.signal.aborted) return;
        const swalResult3 = await fireDialog({
            title: 'Rename Strip',
            input: 'text',
            inputValue: oldName,
            inputLabel: `New name for "${oldName}"`,
            showCancelButton: true,
            inputValidator: (v) => {
                const name = (v || '').trim();
                if (!name) return 'Strip name cannot be empty';
                if (name !== oldName) {
                    for (let i = 0; i < strips.length; i++) {
                        if (i !== stripIdx && this.nn(strips[i]).name === name) {
                            return `A strip named "${name}" already exists`;
                        }
                    }
                }
                return null;
            },
        });
        const value3: unknown = swalResult3.value;
        if (typeof value3 !== 'string') return;
        const newName = value3.trim();
        if (!newName || newName === oldName) return;
        this.stripStore.renameStrip(stripIdx, newName);
        this.pushUndo({ type: 'strip-rename', stripIdx, oldName, newName });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
    },
    async doDeleteStripPrompt(this: ShapeEditor, stripIdx: number){

        const strips = this.stripStore.getStrips();
        if (strips.length <= 1) return;
        const strip = strips[stripIdx];
        if (!strip) return;
        if (this.signal.aborted) return;
        const result = await fireDialog({
            title: `Delete "${strip.name}"?`,
            text: `${String(strip.count)} LED${strip.count === 1 ? '' : 's'} will be removed.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: gfxColors.accentRed(),
        });
        if (!result.isConfirmed) return;
        const removed = this._removeStripPoints(stripIdx);
        this.selection.onStripRemove(stripIdx);
        this.selectedIdx = -1;
        this.pushUndo({ type: 'strip-delete', stripIdx, removed });
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
    },
    _finalizeStripDrag(this: ShapeEditor){

        if (!this.stripDragActive) return;
        const sdx = this.stripDragLastSdx;
        const sdy = this.stripDragLastSdy;
        if (sdx !== 0 || sdy !== 0) {
            this.pushUndo({
                type: 'strip-translate',
                stripIdx: this.stripDragIdx,
                sdx,
                sdy,
            });
            this._persistMultiStrip();
        }
        this.stripDragActive = false;
        this.stripDragIdx = -1;
        this.stripDragStartScreenmap = null;
        this.stripDragStartRaw = null;
        this._clearStripSnapState();
        this.stripDragLastSdx = 0;
        this.stripDragLastSdy = 0;
    },
    _applyStripTranslate(this: ShapeEditor, stripIdx: number, sdx: number, sdy: number){

        if (!this.stripInfo || stripIdx < 0 || stripIdx >= this.stripInfo.strips.length) return;
        const strip = this.nn(this.stripInfo.strips[stripIdx]);
        for (let k = strip.offset; k < strip.offset + strip.count; k++) {
            this.screenmap_pts[k] = [this.nn(this.screenmap_pts[k])[0] + sdx, this.nn(this.screenmap_pts[k])[1] + sdy];
            this.rawPts[k] = [this.nn(this.rawPts[k])[0] + sdx / this.fitScale, this.nn(this.rawPts[k])[1] + sdy / this.fitScale];
        }
    },
    doRotateSelectedStripByDegrees(this: ShapeEditor, degrees: number){
        const stripIdx = this.selection.getStripIdx();
        const deltaDeg = Math.round(degrees);
        if (stripIdx === null || !isFinite(deltaDeg) || deltaDeg === 0 || !this.stripInfo) return false;
        const strip = this.stripInfo.strips[stripIdx];
        if (!strip || strip.count <= 0) return false;
        const handle = this._stripRotateHandlePos();
        if (!handle) return false;
        const [smX, smY] = this.canvasToScreenmapCoords(handle.centerX, handle.centerY);
        const [rawX, rawY] = this.screenmapToRawCoords(smX, smY);
        const centerSm = { x: smX, y: smY };
        const centerRaw = { x: rawX, y: rawY };
        this._applyStripRotate(stripIdx, deltaDeg * Math.PI / 180, centerSm, centerRaw);
        this.pushUndo({
            type: 'strip-rotate',
            stripIdx,
            deltaDeg,
            centerSm,
            centerRaw,
        });
        this._persistMultiStrip();
        this.setNeedsGeometryUpdate();
        return true;
    },
    _finalizeStripRotate(this: ShapeEditor){
        if (!this.stripRotateActive) return;
        const deg = this.stripRotateLastDeg;
        const stripIdx = this.stripRotateIdx;
        const csm = this.stripRotateCenterSm;
        const crw = this.stripRotateCenterRaw;
        if (deg !== 0 && csm && crw && stripIdx >= 0) {
            this.pushUndo({
                type: 'strip-rotate',
                stripIdx,
                deltaDeg: deg,
                centerSm: { x: csm.x, y: csm.y },
                centerRaw: { x: crw.x, y: crw.y },
            });
            this._persistMultiStrip();
        }
        this.stripRotateActive = false;
        this.stripRotateIdx = -1;
        this.stripRotateStartScreenmap = null;
        this.stripRotateStartRaw = null;
        this.stripRotateCenterSm = null;
        this.stripRotateCenterRaw = null;
        this.stripRotateStartAngle = 0;
        this.stripRotateLastDeg = 0;
        this.stripRotateHandleSnapshot = null;
    },
    _applyStripRotate(this: ShapeEditor, stripIdx: number, deltaRad: number, centerSm: { x: number; y: number }, centerRaw: { x: number; y: number }){
        if (!this.stripInfo || stripIdx < 0 || stripIdx >= this.stripInfo.strips.length) return;
        const strip = this.nn(this.stripInfo.strips[stripIdx]);
        const lo = strip.offset;
        const hi = strip.offset + strip.count;
        const sliceSm: [number, number][] = [];
        const sliceRw: [number, number][] = [];
        for (let k = lo; k < hi; k++) {
            sliceSm.push([this.nn(this.screenmap_pts[k])[0], this.nn(this.screenmap_pts[k])[1]]);
            sliceRw.push([this.nn(this.rawPts[k])[0], this.nn(this.rawPts[k])[1]]);
        }
        const rotatedSm = rotatePointsAround(sliceSm, centerSm.x, centerSm.y, deltaRad);
        const rotatedRw = rotatePointsAround(sliceRw, centerRaw.x, centerRaw.y, deltaRad);
        for (let k = lo; k < hi; k++) {
            this.screenmap_pts[k] = rotatedSm[k - lo] ?? [0, 0] as [number, number];
            this.rawPts[k] = rotatedRw[k - lo] ?? [0, 0] as [number, number];
        }
    },
};
