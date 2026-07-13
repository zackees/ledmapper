// Named ShapeEditor method bundle: paste.
import type { ShapeEditor } from './shapeeditor-class';
import type { StripEntry } from "./strips-model";
import { fireDialog } from "../ui/dialogs";
import type { InsertDialogOpts, PasteStateItem, UndoAction } from "./shapeeditor-types";
import { gfxColors, withAlpha } from "../ui/theme";
import { notePinMutation } from "../screenmap-store";
import { PANEL_CATALOG, generatePanelPoints, getCatalogEntry, type DataInCorner, type RotationDeg, type WiringStyle } from "./panel-catalog";
import { snapToGrid } from "./grid-snap";
import { parsePastedScreenmap, planPasteMerge } from "./paste-parse";

export interface EditorPasteMethods {
    _enterPasteFromText: (text: string) => boolean;
    _cancelPaste: () => void;
    _updatePasteGhostFromCanvas: (cx: number, cy: number) => void;
    _drawPasteGhost: () => void;
    _commitPasteAt: (cx: number, cy: number) => void;
    _uniqueNameAgainst: (baseName: string, used: Set<string>) => string;
    _doPasteStrips: (action: UndoAction) => void;
    _undoPasteStrips: (action: UndoAction) => void;
    _pasteFromClipboardAPI: () => Promise<void>;
    _copySelectedStripToClipboard: () => void;
    _openInsertDialog: () => Promise<string | null | undefined>;
    _readInsertDialog: () => InsertDialogOpts;
    _writeAccordionFromDialog: (opts: InsertDialogOpts) => void;
    _submitInsertDialog: (opts: InsertDialogOpts) => string | null;
}

export const editorPasteMethods: EditorPasteMethods & ThisType<ShapeEditor> = {
    _enterPasteFromText(this: ShapeEditor, text: string){

        const parsed = parsePastedScreenmap(text);
        if (!parsed) {
            void this._toastInfo("Clipboard didn't look like a screenmap");
            return false;
        }
        // Cancel any in-flight placing so the modes don't overlap
        if (this.placingState) this._cancelPlacing();

        const existingNames = new Set(this.stripStore.getStrips().map((s: StripEntry) => s.name));
        const merged = planPasteMerge(parsed, existingNames, this.stripStore.getTotalCount());

        // Compute centroid of the source points (in raw cm space).
        let sx = 0, sy = 0, n = 0;
        for (const s of merged) {
            for (const p of s.points) { sx += p[0]; sy += p[1]; n++; }
        }
        if (n === 0) {
            void this._toastInfo("Clipboard didn't look like a screenmap");
            return false;
        }
        const cxRaw = sx / n, cyRaw = sy / n;

        // Determine the cm-to-pixel scale to apply. If we have an existing
        // screenmap, reuse its fitScale so pasted strips visually match.
        // For an empty editor, defer; we'll initialise fitScale on commit.
        const fs = (this.rawPts.length > 0 && this.fitScale > 0) ? this.fitScale : 1;
        // Offsets in screenmap-pixel space, centred around (0,0)
        const strips: PasteStateItem[] = merged.map((s) => {
            const offsetsLocal: [number, number][] = s.points.map((p: [number, number]) => [(p[0] - cxRaw) * fs, (p[1] - cyRaw) * fs] as [number, number]);
            return { ...s, offsetsLocal };
        });
        const totalCount = merged.reduce((a, s) => a + s.points.length, 0);
        this.pasteState = { strips, ghostWorld: null, totalCount };
        this._oc().style.cursor = 'crosshair';
        this._updateHintStrip();
        this.setNeedsRender();
        return true;
    },
    _cancelPaste(this: ShapeEditor){

        if (!this.pasteState) return;
        this.pasteState = null;
        this._oc().style.cursor = 'default';
        this._updateHintStrip();
        this.setNeedsRender();
    },
    _updatePasteGhostFromCanvas(this: ShapeEditor, cx: number, cy: number){

        if (!this.pasteState) return;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        this.pasteState.ghostWorld = [wx, wy];
        this.setNeedsRender();
    },
    _drawPasteGhost(this: ShapeEditor){

        if (!this.pasteState?.ghostWorld) return;
        const ctx = this._octx();
        const [wx, wy] = this.pasteState.ghostWorld;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(gfxColors.accentPurple(), 0.9);
        ctx.fillStyle = withAlpha(gfxColors.accentPurple(), 0.4);
        for (const strip of this.pasteState.strips) {
            if (!strip.offsetsLocal) continue;
            // Polyline of this strip
            ctx.beginPath();
            for (let i = 0; i < strip.offsetsLocal.length; i++) {
                const [ox, oy] = this.nn(strip.offsetsLocal[i]);
                const [px, py] = this.toCanvasCoords(wx + ox, wy + oy);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
            const r = Math.max(2, 0.25 * (this.fitScale > 0 ? this.fitScale : 1) * this.camZoom);
            for (const [ox, oy] of strip.offsetsLocal) {
                const [px, py] = this.toCanvasCoords(wx + ox, wy + oy);
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // Crosshair at drop centroid
        const [ocx, ocy] = this.toCanvasCoords(wx, wy);
        ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.8);
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    },
    _commitPasteAt(this: ShapeEditor, cx: number, cy: number){

        if (!this.pasteState) return;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
}
        if (this._isEmptyScreenmap()) {
            this._initFreshScreenmapForPanel();
            // After fresh init, fitScale is freshly chosen. Recompute the
            // strips' offsetsLocal in that new scale.
            const fs = this.fitScale > 0 ? this.fitScale : 1;
            // Find raw centroid again to keep ghost-centred layout consistent.
            let sxR = 0, syR = 0, n = 0;
            for (const s of this.pasteState.strips) {
                for (const p of s.points) { sxR += p[0]; syR += p[1]; n++; }
            }
            const cxRaw = n ? sxR / n : 0;
            const cyRaw = n ? syR / n : 0;
            for (const s of this.pasteState.strips) {
                s.offsetsLocal = s.points.map((p: [number, number]) => [(p[0] - cxRaw) * fs, (p[1] - cyRaw) * fs] as [number, number]);
            }
        }

        const fs = this.fitScale > 0 ? this.fitScale : 1;
        // raw -> screenmap conversion offset (matches _doPanelPlace's logic)
        let offX = 0, offY = 0;
        if (this.rawPts.length > 0) {
            offX = this.nn(this.rawPts[0])[0] * fs - this.nn(this.screenmap_pts[0])[0];
            offY = this.nn(this.rawPts[0])[1] * fs - this.nn(this.screenmap_pts[0])[1];
        }

        // Rebuild the "addedStrips" descriptor with screenmap-coord points.
        // Re-resolve unique names AGAIN here in case the editor changed
        // between parse-time and commit-time (e.g. an undo happened while
        // paste was pending).
        const existingNames = new Set(this.stripStore.getStrips().map((s: StripEntry) => s.name));
        const addedDescriptors = [];
        const base = this.stripStore.getTotalCount();
        let running = 0;
        const pastePin = this._defaultNewStripPin();
        for (const s of this.pasteState.strips) {
            const name = this._uniqueNameAgainst(s.name, existingNames);
            existingNames.add(name);
            const sm = (s.offsetsLocal ?? []).map(([ox, oy]: [number, number]) => [wx + ox, wy + oy] as [number, number]);
            const raw = sm.map(([smx, smy]: [number, number]) => [(smx + offX) / fs, (smy + offY) / fs] as [number, number]);
            addedDescriptors.push({
                name,
                screenmapPts: sm,
                rawPts: raw,
                diameter: typeof s.diameter === 'number' ? s.diameter : (typeof this.origDiameter === 'number' ? this.origDiameter : 0.5),
                video_offset: base + running,
                pin: pastePin,
            });
            running += sm.length;
        }

        const action = { type: 'paste-strips', strips: addedDescriptors };
        this._doPasteStrips(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        const pastedCount = action.strips.length;
        this.pasteState = null;
        this._oc().style.cursor = 'default';
        this._updateHintStrip();
        void this._toastSuccess(`Pasted ${String(pastedCount)} strip${pastedCount === 1 ? '' : 's'}`);
        // Select the first pasted strip for discoverability
        if (action.strips.length > 0 && this.stripInfo) {
            for (let i = this.stripInfo.strips.length - 1; i >= 0; i--) {
                if (this.stripInfo.strips[i]?.name === action.strips[0]?.name) {
                    this.selection.selectStrip(i);
                    break;
                }
            }
        }
    },
    _uniqueNameAgainst(this: ShapeEditor, baseName: string, used: Set<string>){

        if (!used.has(baseName)) return baseName;
        let n = 2;
        while (used.has(`${baseName} (${String(n)})`)) n++;
        return `${baseName} (${String(n)})`;
    },
    _doPasteStrips(this: ShapeEditor, action: UndoAction){

        // Append every strip atomically. Identical scheme to _doPanelPlace
        // (append to flat arrays + stripStore.addStrip), but for many at once.
        const actionStrips = action.strips as { name: string; screenmapPts: [number, number][]; rawPts: [number, number][]; diameter?: number; video_offset: number; pin?: string; _insertAt?: number; _count?: number }[];
        for (const desc of actionStrips) {
            const insertAt = this.screenmap_pts.length;
            for (let i = 0; i < desc.screenmapPts.length; i++) {
                this.screenmap_pts.push([this.nn(desc.screenmapPts[i])[0], this.nn(desc.screenmapPts[i])[1]]);
                this.rawPts.push([this.nn(desc.rawPts[i])[0], this.nn(desc.rawPts[i])[1]]);
            }
            this.stripStore.addStrip({
                name: desc.name,
                points: desc.rawPts,
                diameter: desc.diameter,
                video_offset: desc.video_offset,
                pin: (typeof desc.pin === 'string' && desc.pin) ? desc.pin : 'pin1',
                videoOffsetOverride: false,
            });
            desc._insertAt = insertAt;
            desc._count = desc.screenmapPts.length;
        }
        this.stripInfo = this.stripStore.get();
        if (this.origWidth === 0 && this.origHeight === 0 && this.rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of this.rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            this.origWidth = xmax - xmin;
            this.origHeight = ymax - ymin;
        }
    },
    _undoPasteStrips(this: ShapeEditor, action: UndoAction){

        if (!this.stripInfo) return;
        // Walk added strips in reverse order; locate each by name (most recent
        // additions are at the end) and remove from both flat arrays + store.
        const undoStrips = action.strips as { name: string }[];
        for (let i = undoStrips.length - 1; i >= 0; i--) {
            const desc = this.nn(undoStrips[i]);
            const strips = this.stripInfo.strips;
            let stripIdx = -1;
            for (let k = strips.length - 1; k >= 0; k--) {
                if (strips[k]?.name === desc.name) { stripIdx = k; break; }
            }
            if (stripIdx < 0) continue;
            const strip = this.nn(strips[stripIdx]);
            this.screenmap_pts.splice(strip.offset, strip.count);
            this.rawPts.splice(strip.offset, strip.count);
            this.stripStore.removeStrip(stripIdx);
            this.selection.onStripRemove(stripIdx);
        }
        this.selectedIdx = -1;
        this.stripInfo = this.stripStore.get();
    },
    async _pasteFromClipboardAPI(this: ShapeEditor){

        try {
            // navigator.clipboard can be absent at runtime (e.g., non-secure contexts,
            // Playwright without clipboard permissions). Access via unknown to avoid
            // no-unnecessary-condition; the catch below handles any TypeError.
            const cb = (navigator as unknown as { clipboard?: { readText?: unknown } }).clipboard;
            if (!cb || typeof cb.readText !== 'function') {
                void this._toastInfo('Clipboard read unavailable — try Ctrl+V');
                return;
            }
            const text = await navigator.clipboard.readText();
            this._enterPasteFromText(text || '');
        } catch {
            void this._toastInfo("Clipboard didn't look like a screenmap");
        }
    },
    _copySelectedStripToClipboard(this: ShapeEditor){

        const sIdx = this.selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        const strips = this.stripStore.getStrips();
        if (sIdx >= strips.length) return;
        const s = this.nn(strips[sIdx]);
        const x = [], y = [];
        for (let i = s.offset; i < s.offset + s.count; i++) {
            x.push(+this.nn(this.rawPts[i])[0].toFixed(4));
            y.push(+this.nn(this.rawPts[i])[1].toFixed(4));
        }
        const d = typeof s.diameter === 'number' ? s.diameter : (parseFloat(this.dom_txt_diameter.value) || 0.25);
        const json = JSON.stringify({ map: { [s.name]: { x, y, diameter: d } } }, null, 2);
        try {
            // navigator.clipboard can be absent at runtime; access via unknown to avoid no-unnecessary-condition
            const cbw = (navigator as unknown as { clipboard?: { writeText?: unknown } }).clipboard;
            if (cbw && typeof cbw.writeText === 'function') {
                void navigator.clipboard.writeText(json).then(
                    () => this._toastSuccess(`Copied "${s.name}" to clipboard`),
                    () => this._toastInfo('Copy failed — clipboard unavailable'),
                );
            } else {
                void this._toastInfo('Copy failed — clipboard unavailable');
            }
        } catch {
            void this._toastInfo('Copy failed — clipboard unavailable');
        }
    },
    async _openInsertDialog(this: ShapeEditor){

        try {
            if (this.signal.aborted) return;

            // Snapshot current accordion values for initial form state
            const initial = {
                catalogId: PANEL_CATALOG[0] ? PANEL_CATALOG[0].id : '',
                wiring: this.dom_pp_wiring.value,
                corner: this.dom_pp_corner.value,
                rotation: this.dom_pp_rotation.value,
                flipH: this.dom_pp_flipH.checked,
                flipV: this.dom_pp_flipV.checked,
                spacing: this.dom_pp_spacing.value,
                snap: this.dom_pp_snap.checked,
                grid: this.dom_pp_grid.value,
            };

            const catalogOptions = PANEL_CATALOG.map((e) => `<option value="${e.id}">${e.label}</option>`).join('');
            const html = `
                <div class="ins-dialog-form">
                    <label for="ins_catalog">Panel</label>
                    <select id="ins_catalog">${catalogOptions}</select>
                    <label for="ins_wiring">Wiring</label>
                    <select id="ins_wiring">
                        <option value="serpentine">Serpentine</option>
                        <option value="progressive">Progressive</option>
                    </select>
                    <label for="ins_corner">Data In</label>
                    <select id="ins_corner">
                        <option value="TL">TL</option><option value="TR">TR</option>
                        <option value="BL">BL</option><option value="BR">BR</option>
                    </select>
                    <label for="ins_rotation">Rotate</label>
                    <select id="ins_rotation">
                        <option value="0">0°</option><option value="90">90°</option>
                        <option value="180">180°</option><option value="270">270°</option>
                    </select>
                    <label>Flips</label>
                    <div>
                        <label class="ins-dialog-inline-label is-spaced"><input id="ins_flipH" type="checkbox"> H</label>
                        <label class="ins-dialog-inline-label"><input id="ins_flipV" type="checkbox"> V</label>
                    </div>
                    <label for="ins_spacing">Spacing</label>
                    <input id="ins_spacing" type="number" step="0.1" min="0.01">
                    <label>Snap / Grid</label>
                    <div>
                        <label class="ins-dialog-inline-label is-spaced"><input id="ins_snap" type="checkbox"> Snap</label>
                        <input id="ins_grid" type="number" step="0.1" min="0.01" class="ins-dialog-grid-input">
                    </div>
                </div>
                <div class="ins-dialog-preview-row">
                    <canvas id="ins_preview" width="320" height="200" class="ins-dialog-preview-canvas"></canvas>
                </div>
            `;

            const res = await fireDialog({
                title: 'Insert Panel',
                html,
                width: 480,
                showCancelButton: true,
                showDenyButton: true,
                cancelButtonText: 'Cancel',
                denyButtonText: 'Place…',
                confirmButtonText: 'Insert at center',
                focusConfirm: false,
                didOpen: () => {
                    const $inp = (id: string) => document.getElementById(id) as HTMLInputElement | null;
                    const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement | null;
                    const $cvs = (id: string) => document.getElementById(id) as HTMLCanvasElement | null;
                    const catalog = $sel('ins_catalog');
                    const wiring = $sel('ins_wiring');
                    const corner = $sel('ins_corner');
                    const rotation = $inp('ins_rotation');
                    const flipH = $inp('ins_flipH');
                    const flipV = $inp('ins_flipV');
                    const spacing = $inp('ins_spacing');
                    const snap = $inp('ins_snap');
                    const grid = $inp('ins_grid');
                    const preview = $cvs('ins_preview');

                    if (catalog) catalog.value = initial.catalogId;
                    if (wiring) wiring.value = initial.wiring;
                    if (corner) corner.value = initial.corner;
                    if (rotation) rotation.value = initial.rotation;
                    if (flipH) flipH.checked = initial.flipH;
                    if (flipV) flipV.checked = initial.flipV;
                    if (spacing) spacing.value = initial.spacing;
                    if (snap) snap.checked = initial.snap;
                    if (grid) grid.value = initial.grid;

                    const readForm = () => {
                        return {
                            catalogId: catalog ? catalog.value : initial.catalogId,
                            wiring: wiring ? wiring.value : 'serpentine',
                            corner: corner ? corner.value : 'TL',
                            rotation: rotation ? parseInt(rotation.value, 10) || 0 : 0,
                            flipH: flipH ? flipH.checked : false,
                            flipV: flipV ? flipV.checked : false,
                            spacing: spacing ? (parseFloat(spacing.value) || 1) : 1,
                            snap: snap ? snap.checked : true,
                            grid: grid ? (parseFloat(grid.value) || 1) : 1,
                        };
                    }

                    const redrawPreview = () => {
                        if (!preview) return;
                        const ctx = preview.getContext('2d');
                        if (!ctx) return;
                        ctx.clearRect(0, 0, preview.width, preview.height);
                        const opts = readForm();
                        const entry = getCatalogEntry(opts.catalogId);
                        if (!entry) return;
                        const pts = generatePanelPoints(entry, {
                            wiring: opts.wiring as WiringStyle,
                            dataInCorner: opts.corner as DataInCorner,
                            rotation: opts.rotation as RotationDeg,
                            flipH: opts.flipH,
                            flipV: opts.flipV,
                            spacing: opts.spacing,
                        });
                        if (pts.length === 0) return;
                        let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
                        for (const [x, y] of pts) {
                            if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                            if (y < ymin) ymin = y; if (y > ymax) ymax = y;
                        }
                        const w = xmax - xmin || 1;
                        const h = ymax - ymin || 1;
                        const margin = 14;
                        const sc = Math.min((preview.width - margin * 2) / w, (preview.height - margin * 2) / h);
                        const cxOff = preview.width / 2 - ((xmin + xmax) / 2) * sc;
                        const cyOff = preview.height / 2 - ((ymin + ymax) / 2) * sc;
                        // Polyline
                        ctx.strokeStyle = gfxColors.accentBlue();
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        for (let i = 0; i < pts.length; i++) {
                            const x = this.nn(pts[i])[0] * sc + cxOff;
                            const y = this.nn(pts[i])[1] * sc + cyOff;
                            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                        ctx.fillStyle = gfxColors.textLink();
                        for (const [px, py] of pts) {
                            const x = px * sc + cxOff;
                            const y = py * sc + cyOff;
                            ctx.beginPath();
                            ctx.arc(x, y, 2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        // First LED green
                        if (pts.length > 0) {
                            ctx.fillStyle = gfxColors.accentGreen();
                            ctx.beginPath();
                            ctx.arc(this.nn(pts[0])[0] * sc + cxOff, this.nn(pts[0])[1] * sc + cyOff, 3, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }

                    for (const el of [catalog, wiring, corner, rotation, flipH, flipV, spacing, snap, grid]) {
                        if (el) {
                            el.addEventListener('input', redrawPreview);
                            el.addEventListener('change', redrawPreview);
                        }
                    }
                    redrawPreview();
                },
                preConfirm: () => this._readInsertDialog(),
                preDeny: () => this._readInsertDialog(),
            });

            const action = res.isConfirmed ? 'center' : (res.isDenied ? 'ghost' : null);
            if (!action) { this.pendingNewStripPin = null; return null; }
            const opts: InsertDialogOpts = this._readInsertDialog();
            return this._submitInsertDialog({ ...opts, place: action });
        } catch {
            return null;
        }
    },
    _readInsertDialog(this: ShapeEditor): InsertDialogOpts{

        const $inp = (id: string) => document.getElementById(id) as HTMLInputElement | null;
        const $sel = (id: string) => document.getElementById(id) as HTMLSelectElement | null;
        const insCatalog = $sel('ins_catalog');
        const insWiring = $sel('ins_wiring');
        const insCorner = $sel('ins_corner');
        const insRotation = $inp('ins_rotation');
        const insFlipH = $inp('ins_flipH');
        const insFlipV = $inp('ins_flipV');
        const insSpacing = $inp('ins_spacing');
        const insSnap = $inp('ins_snap');
        const insGrid = $inp('ins_grid');
        return {
            catalogId: insCatalog ? insCatalog.value : '',
            wiring: insWiring ? insWiring.value : 'serpentine',
            corner: insCorner ? insCorner.value : 'TL',
            rotation: insRotation ? parseInt(insRotation.value, 10) || 0 : 0,
            flipH: insFlipH ? insFlipH.checked : false,
            flipV: insFlipV ? insFlipV.checked : false,
            spacing: insSpacing ? (parseFloat(insSpacing.value) || 1) : 1,
            snap: insSnap ? insSnap.checked : true,
            grid: insGrid ? (parseFloat(insGrid.value) || 1) : 1,
        };
    },
    _writeAccordionFromDialog(this: ShapeEditor, opts: InsertDialogOpts){

        if (opts.wiring) this.dom_pp_wiring.value = opts.wiring;
        if (opts.corner) this.dom_pp_corner.value = opts.corner;
        if (opts.rotation || opts.rotation === 0) this.dom_pp_rotation.value = String(opts.rotation);
        this.dom_pp_flipH.checked = opts.flipH;
        this.dom_pp_flipV.checked = opts.flipV;
        if (opts.spacing || opts.spacing === 0) this.dom_pp_spacing.value = String(opts.spacing);
        this.dom_pp_snap.checked = opts.snap;
        if (opts.grid || opts.grid === 0) this.dom_pp_grid.value = String(opts.grid);
    },
    _submitInsertDialog(this: ShapeEditor, opts: InsertDialogOpts){

        if (!opts.catalogId) return null;
        const entry = getCatalogEntry(opts.catalogId);
        if (!entry) return null;
        this._writeAccordionFromDialog(opts);
        if (opts.place === 'center') {
            // Place at viewport center via existing commit path.
            // _commitPlacingAt uses canvas coords; canvas center is (canvasW/2, canvasH/2).
            // Use _enterPlacing then immediately commit at center, so undo is
            // a single panel-place action.
            this._enterPlacing(opts.catalogId);
            this._commitPlacingAt(this.canvasW / 2, this.canvasH / 2);
            return entry.label;
        }
        if (opts.place === 'ghost') {
            this._enterPlacing(opts.catalogId);
            return entry.label;
        }
        return null;
    },
};`n