// Named ShapeEditor method bundle: panels.
import type { ShapeEditor } from './shapeeditor-class';
import type { UndoAction } from "./shapeeditor-types";
import { gfxColors, withAlpha } from "../ui/theme";
import { notePinMutation } from "../screenmap-store";
import { generatePanelPoints, getCatalogEntry, type DataInCorner, type PanelOpts, type RotationDeg, type WiringStyle } from "./panel-catalog";
import { snapToGrid } from "./grid-snap";

export interface EditorPanelsMethods {
    _readPanelOpts: () => PanelOpts;
    _enterPlacing: (catalogId: string) => void;
    _cancelPlacing: () => void;
    _canvasToWorldPx: (cx: number, cy: number) => [number, number];
    _gridSizePx: () => number;
    _updateGhostFromCanvas: (cx: number, cy: number) => void;
    _drawPlacingGhost: () => void;
    _uniqueStripName: (base: string) => string;
    _isEmptyScreenmap: () => boolean;
    _initFreshScreenmapForPanel: () => void;
    _commitPlacingAt: (cx: number, cy: number) => void;
    _doPanelPlace: (action: UndoAction) => void;
    _redoPanelPlace: (action: UndoAction) => void;
    _undoPanelPlace: (action: UndoAction) => void;
    _debugPlacePanel: (catalogId: string, worldX: number, worldY: number, opts: PanelOpts) => string | null;
}

export const editorPanelsMethods: EditorPanelsMethods & ThisType<ShapeEditor> = {
    _readPanelOpts(this: ShapeEditor): PanelOpts{

        const rot = parseInt(this.dom_pp_rotation.value, 10) || 0;
        // Clamp to the valid RotationDeg union
        const validRots: RotationDeg[] = [0, 90, 180, 270];
        const rotation = (validRots.includes(rot as RotationDeg)
            ? rot
            : 0) as RotationDeg;
        return {
            wiring: this.dom_pp_wiring.value as WiringStyle,
            dataInCorner: this.dom_pp_corner.value as DataInCorner,
            rotation,
            flipH: this.dom_pp_flipH.checked,
            flipV: this.dom_pp_flipV.checked,
            spacing: parseFloat(this.dom_pp_spacing.value) || 1,
        };
    },
    _enterPlacing(this: ShapeEditor, catalogId: string){

        const entry = getCatalogEntry(catalogId);
        if (!entry) return;
        // Placement owns the canvas until the new panel is committed. Exit
        // chain/reorder mode up front so the placed strip is immediately
        // selectable and draggable instead of inheriting a stale mode that
        // deliberately suppresses LED hit-testing.
        if (this.editorMode !== 'select') this.setEditorMode('select');
        const opts = this._readPanelOpts();
        const localPts = generatePanelPoints(entry, opts);
        this.placingState = { entry, opts, localPts, ghostWorld: null };
        this._updateHintStrip();
        this.dom_pp_status.textContent = `Placing ${entry.label} — click canvas (Esc to cancel)`;
        this._oc().style.cursor = 'crosshair';
        this.setNeedsRender();
    },
    _cancelPlacing(this: ShapeEditor){

        this.placingState = null;
        this.pendingNewStripPin = null;
        this.dom_pp_status.textContent = '';
        this._oc().style.cursor = 'default';
        this.setNeedsRender();
        this._updateHintStrip();
    },
    _canvasToWorldPx(this: ShapeEditor, cx: number, cy: number): [number, number]{

        return [
            (cx - this.canvasW / 2) / this.camZoom - this.camPanX,
            (cy - this.canvasH / 2) / this.camZoom - this.camPanY,
        ];
    },
    _gridSizePx(this: ShapeEditor){

        const grid = parseFloat(this.dom_pp_grid.value) || 1;
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        return grid * fs;
    },
    _updateGhostFromCanvas(this: ShapeEditor, cx: number, cy: number){

        if (!this.placingState) return;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        this.placingState.ghostWorld = [wx, wy];
        this.setNeedsRender();
    },
    _drawPlacingGhost(this: ShapeEditor){

        if (!this.placingState?.ghostWorld) return;
        const ctx = this._octx();
        const [wx, wy] = this.placingState.ghostWorld;
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        const pts = this.placingState.localPts;
        if (pts.length === 0) return;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(gfxColors.accentBlue(), 0.9);
        ctx.fillStyle = withAlpha(gfxColors.accentBlue(), 0.4);
        // Connecting polyline (wiring order)
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const [px, py] = this.nn(pts[i]);
            const [cx, cy] = this.toCanvasCoords(wx + px * fs, wy + py * fs);
            if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        const r = Math.max(2, 0.3 * fs * this.camZoom);
        for (const [px, py] of pts) {
            const [cx, cy] = this.toCanvasCoords(wx + px * fs, wy + py * fs);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Crosshair at origin
        const [ocx, ocy] = this.toCanvasCoords(wx, wy);
        ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.8);
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    },
    _uniqueStripName(this: ShapeEditor, base: string){

        const used = new Set();
        const strips = this.stripStore.getStrips();
        for (const s of strips) used.add(s.name);
        let i = 1;
        while (used.has(`${base}${String(i)}`)) i++;
        return `${base}${String(i)}`;
    },
    _isEmptyScreenmap(this: ShapeEditor){

        return !this.stripInfo || this.stripInfo.strips.length === 0
            || (this.stripInfo.strips.length === 1 && (this.stripInfo.strips[0]?.count ?? 0) <= 1
                && this.stripInfo.totalCount <= 1);
    },
    _initFreshScreenmapForPanel(this: ShapeEditor){

        // Initialise transform + fitScale + storage for a brand-new screenmap
        // when the user places a panel onto an empty editor.
        this.screenmap_pts = [];
        this.rawPts = [];
        this.screenmapShapes = [];
        this.lastTransformedShapes = [];
        this.stripInfo = null;
        this.stripStore.load(null);
        this.origDiameter = 0.5;
        this.dom_txt_diameter.value = String(this.origDiameter);
        this.origWidth = 0;
        this.origHeight = 0;
        // Choose a fitScale that gives a reasonable initial pixel pitch.
        const { width: fitW, height: fitH } = this.getFitSize();
        this.fitScale = Math.min(fitW, fitH) / 40;
        if (!isFinite(this.fitScale) || this.fitScale <= 0) this.fitScale = 20;
        this.resetTransforms();
    },
    _commitPlacingAt(this: ShapeEditor, cx: number, cy: number){

        if (!this.placingState) return;
        const entry = this.placingState.entry;
        const opts = this.placingState.opts;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        if (this._isEmptyScreenmap()) {
            this._initFreshScreenmapForPanel();
        }
        const name = this._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId: entry.id,
            opts: { ...opts },
            worldX: wx,
            worldY: wy,
            name,
            pin: this.pendingNewStripPin ?? this._defaultNewStripPin(),
        };
        this.pendingNewStripPin = null;
        this._doPanelPlace(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        this.placingState = null;
        this.dom_pp_status.textContent = `Placed ${entry.label} as ${name}`;
        this._oc().style.cursor = 'default';
        this._updateHintStrip();
    },
    _doPanelPlace(this: ShapeEditor, action: UndoAction){

        const entry = getCatalogEntry(action.catalogId as string);
        if (!entry) return;
        const localPts = generatePanelPoints(entry, (action.opts as PanelOpts | undefined) ?? {});
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        // rawPts (cm-units): use worldX/worldY divided by fitScale to place
        // the panel origin at the click point. screenmap_pts = rawPts * fs
        // - offset (keeps consistency with existing screenmap_pts coords).
        // For a fresh map (rawPts empty) we set rawPts directly so
        // rawPts[i]*fitScale == screenmap_pts[i].
        const screenmapPts: [number, number][] = [];
        const rawPtsAdd: [number, number][] = [];
        // Determine current "raw->screenmap" offset using existing point 0
        let offX = 0, offY = 0;
        if (this.rawPts.length > 0) {
            offX = this.nn(this.rawPts[0])[0] * fs - this.nn(this.screenmap_pts[0])[0];
            offY = this.nn(this.rawPts[0])[1] * fs - this.nn(this.screenmap_pts[0])[1];
        }
        const actionWorldX = action.worldX as number;
        const actionWorldY = action.worldY as number;
        for (const [px, py] of localPts) {
            const sx = actionWorldX + px * fs;
            const sy = actionWorldY + py * fs;
            screenmapPts.push([sx, sy]);
            rawPtsAdd.push([(sx + offX) / fs, (sy + offY) / fs]);
        }
        // Append to flat arrays
        const insertAt = this.screenmap_pts.length;
        for (let i = 0; i < screenmapPts.length; i++) {
            this.screenmap_pts.push(this.nn(screenmapPts[i]));
            this.rawPts.push(this.nn(rawPtsAdd[i]));
        }
        const newIdx = this.stripStore.addStrip({
            name: action.name as string,
            points: rawPtsAdd,
            diameter: typeof this.origDiameter === 'number' ? this.origDiameter : 0.5,
            video_offset: insertAt,
            pin: (typeof action.pin === 'string' && action.pin) ? (action.pin) : 'pin1',
            videoOffsetOverride: false,
        });
        this.stripInfo = this.stripStore.get();
        // origWidth/Height may still be 0 for fresh maps — recompute from rawPts
        // so the cm size label is reasonable.
        if (this.origWidth === 0 && this.origHeight === 0 && this.rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of this.rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            this.origWidth = xmax - xmin;
            this.origHeight = ymax - ymin;
        }
        this.selection.selectStrip(newIdx);
        action._insertAt = insertAt;
        action._count = screenmapPts.length;
    },
    _redoPanelPlace(this: ShapeEditor, action: UndoAction){

        this._doPanelPlace(action);
    },
    _undoPanelPlace(this: ShapeEditor, action: UndoAction){

        if (!this.stripInfo) return;
        // Find the strip we added by name (most reliable after reordering).
        let stripIdx = -1;
        const strips = this.stripInfo.strips;
        for (let i = strips.length - 1; i >= 0; i--) {
            if (strips[i]?.name === action.name) { stripIdx = i; break; }
        }
        if (stripIdx < 0) return;
        const strip = this.nn(strips[stripIdx]);
        this.screenmap_pts.splice(strip.offset, strip.count);
        this.rawPts.splice(strip.offset, strip.count);
        this.stripStore.removeStrip(stripIdx);
        this.selection.onStripRemove(stripIdx);
        this.selectedIdx = -1;
        this.stripInfo = this.stripStore.get();
    },
    _debugPlacePanel(this: ShapeEditor, catalogId: string, worldX: number, worldY: number, opts: PanelOpts){

        const entry = getCatalogEntry(catalogId);
        if (!entry) return null;
        const mergedOpts = { ...this._readPanelOpts(), ...opts };
        if (this._isEmptyScreenmap()) {
            this._initFreshScreenmapForPanel();
        }
        const name = this._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId,
            opts: mergedOpts,
            worldX,
            worldY,
            name,
            pin: this.pendingNewStripPin ?? this._defaultNewStripPin(),
        };
        this.pendingNewStripPin = null;
        this._doPanelPlace(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        return name;
    },
};
