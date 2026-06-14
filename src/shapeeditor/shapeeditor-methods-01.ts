// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 1/8).

import { ShapeEditor } from './shapeeditor-class';
import {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    BufferGeometry,
    Float32BufferAttribute,
    DynamicDrawUsage,
    LineSegments,
    LineBasicMaterial,
    Line,
    TextureLoader,
    PlaneGeometry,
    MeshBasicMaterial,
    Mesh,
    SRGBColorSpace,
    DoubleSide,
    type Points,
    type BufferAttribute,
    type Texture,
    type PointsMaterial,
    type Material,
} from 'three';
import type { StripEntry, StripSnapshot, StripInfo } from './strips-model';
import type { CatalogEntry, PanelOpts, WiringStyle, DataInCorner, RotationDeg } from './panel-catalog';
import { parse_screenmap_data, centerAndFitPoints, download_text_as_file, parseScreenmapMultiStrip, getStripColors, getPinColors, stripStartEndLabels } from '../common';
import type { PointArrayWithDiameter } from '../common';
import { createLabelRenderer } from '../label-render';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop';
import {
    saveScreenmap,
    getScreenmap,
    saveScreenmapMultiStrip,
    buildScreenmapMultiStripJson,
    getScreenmapMeta,
    getBackup,
    promoteToBackup,
    restoreBackup,
    backfillMeta,
    isDegenerate,
    notePinMutation,
} from '../screenmap-store';
import type { BackupMeta } from '../screenmap-store';
import { createCircleTexture, buildPointsMesh } from '../three-utils';
import { StripStore } from './strips-model';
import { Selection } from './selection';
import { PANEL_CATALOG, getCatalogEntry, generatePanelPoints } from './panel-catalog';
import { snapToGrid } from './grid-snap';
import { hintTextFor } from './hints';
import { parsePastedScreenmap, planPasteMerge } from './paste-parse';
import templateHtml from './template.html?raw';
import type {
    UndoAction,
    InsertDialogOpts,
    OBBox,
    GizmoDragStart,
    BgGizmoDragStart,
    BgImageBBox,
    GizmoHandle,
    RulerDragStart,
    ConnectorDrag,
    StartHandleDrag,
    PlacingState,
    PasteStateItem,
    PasteStateActive,
    StripDragPt,
    PresetEntry,
} from './shapeeditor-types';

ShapeEditor.prototype.qe = function <T extends HTMLElement>(this: ShapeEditor, sel: string, _cast?: (e: Element) => T): T {
    const self = this;

        const el = self.container.querySelector(sel);
        if (!el) throw new Error(`Missing element "${sel}"`);
        return el as T;
    };

ShapeEditor.prototype.nn = function <T>(this: ShapeEditor, v: T | null | undefined, msg?: string): T {
    const self = this;

        if (v === null || v === undefined) throw new Error(msg ?? 'unexpected null/undefined');
        return v;
    };

ShapeEditor.prototype.markDirty = function (this: ShapeEditor) {
    const self = this;

        self.dom_btn_save.disabled = false;
        self.dom_btn_reset.disabled = false;
    };

ShapeEditor.prototype.clearDirty = function (this: ShapeEditor) {
    const self = this;

        self.dom_btn_save.disabled = true;
        self.dom_btn_reset.disabled = true;
    };

ShapeEditor.prototype.markDirtyAndGeometry = function (this: ShapeEditor) {
    const self = this;
 self.markDirty(); self.setNeedsGeometryUpdate(); };

ShapeEditor.prototype.resetTransforms = function (this: ShapeEditor) {
    const self = this;

        self.writeScale(self.dom_txt_scale, 1);
        self.writeScale(self.dom_txt_scale_x, 1);
        self.writeScale(self.dom_txt_scale_y, 1);
        self.setRotate(0);
        self.setTranslate(0, 0);
        self.dom_txt_diameter.value = String(self.origDiameter);
        self.committedTransform.scale = 1;
        self.committedTransform.scaleX = 1;
        self.committedTransform.scaleY = 1;
        self.committedTransform.rotate = 0;
        self.committedTransform.translateX = 0;
        self.committedTransform.translateY = 0;
        self.clearDirty();
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.saveAs = function (this: ShapeEditor) {
    const self = this;

        if (self.rawPts.length === 0) return;

        const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
        const sX = (parseFloat(self.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(self.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(self.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);
        // Translation is in world-pixel space; convert to cm for export
        const txCm = (parseFloat(self.dom_txt_translate_x.value) || 0) / self.fitScale;
        const tyCm = (parseFloat(self.dom_txt_translate_y.value) || 0) / self.fitScale;
        const fallbackDiameter = parseFloat(self.dom_txt_diameter.value) || 0.25;

        const transformPoint = ([x, y]: [number, number]) => {
            const rx = x * sX;
            const ry = y * sY;
            return [
                +(rx * cosR - ry * sinR + txCm).toFixed(4),
                +(rx * sinR + ry * cosR + tyCm).toFixed(4),
            ];
        };

        let json;
        if (self.stripInfo && self.stripInfo.strips.length >= 1
            && self.stripInfo.totalCount === self.rawPts.length) {
            // Preserve multi-strip structure (including non-sequential video_offset)
            // via the shared builder.
            const stripsOut = self.stripInfo.strips.map((strip: StripEntry) => {
                const pts = [];
                for (let i = strip.offset; i < strip.offset + strip.count; i++) {
                    pts.push(transformPoint(self.rawPts[i] ?? [0, 0]));
                }
                const d = typeof strip.diameter === 'number' ? strip.diameter : fallbackDiameter;
                return {
                    name: strip.name,
                    points: pts,
                    diameter: d,
                    offset: strip.offset,
                    count: strip.count,
                    video_offset: typeof strip.video_offset === 'number' ? strip.video_offset : strip.offset,
                    pin: typeof strip.pin === 'string' ? strip.pin : 'pin1',
                    videoOffsetOverride: strip.videoOffsetOverride,
                };
            });
            json = buildScreenmapMultiStripJson(stripsOut);
        } else {
            const xArr = [];
            const yArr = [];
            for (const pt of self.rawPts) {
                const [tx, ty] = transformPoint(pt);
                xArr.push(tx);
                yArr.push(ty);
            }
            const map = { strip1: { x: xArr, y: yArr, diameter: fallbackDiameter } };
            json = JSON.stringify({ map }, null, 2);
        }

        saveScreenmap(json);
        download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
        self.clearDirty();
        try { self.renderBackupRow(); } catch { /* render is best-effort */ }
    };

ShapeEditor.prototype.clampScale = function (this: ShapeEditor, v: number | string) {
    const self = this;

        const n = parseFloat(String(v));
        if (isNaN(n)) return 1;
        const abs = Math.abs(n);
        const sign = n < 0 ? -1 : 1;
        return sign * Math.max(self.SCALE_MIN, Math.min(self.SCALE_MAX, abs));
    };

ShapeEditor.prototype.writeScale = function (this: ShapeEditor, txt: HTMLInputElement, val: number | string) {
    const self = this;

        txt.value = self.clampScale(val).toFixed(2);
    };

ShapeEditor.prototype.clampRotate = function (this: ShapeEditor, v: number | string) {
    const self = this;

        const n = typeof v === 'number' ? v : parseInt(v);
        return isNaN(n) ? 0 : Math.max(-180, Math.min(180, n));
    };

ShapeEditor.prototype.setRotate = function (this: ShapeEditor, rawVal: number | string) {
    const self = this;

        self.dom_txt_rotate.value = String(self.clampRotate(rawVal));
    };

ShapeEditor.prototype.clampTranslate = function (this: ShapeEditor, v: number | string) {
    const self = this;

        const n = parseFloat(String(v));
        return isNaN(n) ? 0 : Math.max(-500, Math.min(500, Math.round(n)));
    };

ShapeEditor.prototype.setTranslate = function (this: ShapeEditor, x: number | string, y: number | string) {
    const self = this;

        self.dom_txt_translate_x.value = String(self.clampTranslate(x));
        self.dom_txt_translate_y.value = String(self.clampTranslate(y));
    };

ShapeEditor.prototype.wireTransformUndo = function (this: ShapeEditor, controlName: string, ...elements: HTMLInputElement[]) {
    const self = this;

        for (const el of elements) {
            el.addEventListener('change', () => {
                const newVal = self.getTransformValue(controlName);
                const oldVal = self.committedTransform[controlName] ?? 0;
                if (oldVal !== newVal) {
                    self.pushUndo({ type: 'transform', control: controlName, oldValue: oldVal, newValue: newVal });
                    self.committedTransform[controlName] = newVal;
                }
            }, { signal: self.signal });
        }
    };

ShapeEditor.prototype._relativeTime = function (this: ShapeEditor, savedAt: number) {
    const self = this;

        const ms = Math.max(0, Date.now() - savedAt);
        const sec = Math.floor(ms / 1000);
        if (sec < 45) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${String(min)} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${String(hr)} h ago`;
        const day = Math.floor(hr / 24);
        return `${String(day)} d ago`;
    };

ShapeEditor.prototype._toast = async function (this: ShapeEditor, opts: Record<string, unknown>) {
    const self = this;

        try {
            const Swal = (await import('sweetalert2')).default;
            if (self.signal.aborted) return null;
            return await Swal.fire({
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 6000,
                timerProgressBar: true,
                background: '#1a1a1a',
                color: '#e5e7eb',
                ...opts,
            });
        } catch { return null; }
    };

ShapeEditor.prototype._toastInfo = function (this: ShapeEditor, text: string) {
    const self = this;

        return self._toast({ icon: 'info', title: text });
    };

ShapeEditor.prototype._toastSuccess = function (this: ShapeEditor, text: string) {
    const self = this;

        return self._toast({ icon: 'success', title: text });
    };

ShapeEditor.prototype._toastFreshDegenerate = async function (this: ShapeEditor, backupMeta: BackupMeta | null | undefined) {
    const self = this;

        const ledCount = (backupMeta && typeof backupMeta.ledCount === 'number')
            ? backupMeta.ledCount : 0;
        try {
            const Swal = (await import('sweetalert2')).default;
            if (self.signal.aborted) return;
            const res = await Swal.fire({
                toast: true,
                position: 'top',
                icon: 'info',
                title: 'Looks like an empty edit',
                html: `Your last good layout had <b>${String(ledCount)} LED${ledCount === 1 ? '' : 's'}</b>.`,
                showConfirmButton: true,
                showCancelButton: true,
                confirmButtonText: 'Restore previous layout',
                cancelButtonText: 'Dismiss',
                background: '#1a1a1a',
                color: '#e5e7eb',
                timer: 12000,
                timerProgressBar: true,
            });
            if (res.isConfirmed) {
                const json = restoreBackup();
                if (json) {
                    self.load_screenmap_data(json);
                    self.renderBackupRow();
                }
            }
        } catch { /* ignore */ }
    };

ShapeEditor.prototype._toastSilentRestored = async function (this: ShapeEditor, restoredMeta: BackupMeta | null | undefined, degenerateJson: string | null) {
    const self = this;

        const ledCount = (restoredMeta && typeof restoredMeta.ledCount === 'number')
            ? restoredMeta.ledCount : 0;
        const when = (restoredMeta && typeof restoredMeta.savedAt === 'number')
            ? self._relativeTime(restoredMeta.savedAt) : 'recently';
        try {
            const Swal = (await import('sweetalert2')).default;
            if (self.signal.aborted) return;
            const res = await Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: 'Restored your last good layout',
                html: `${String(ledCount)} LED${ledCount === 1 ? '' : 's'}, saved ${when}`,
                showConfirmButton: true,
                confirmButtonText: 'Undo',
                showCancelButton: false,
                background: '#1a1a1a',
                color: '#e5e7eb',
                timer: 8000,
                timerProgressBar: true,
            });
            if (res.isConfirmed && typeof degenerateJson === 'string') {
                // Put the degenerate copy back as the working copy. We bypass
                // the save gate by writing directly to the store keys.
                try {
                    localStorage.setItem('lm:screenmap', degenerateJson);
                    localStorage.removeItem('lm:screenmap-meta');
                } catch { /* ignore */ }
                self.load_screenmap_data(degenerateJson);
                self.renderBackupRow();
            }
        } catch { /* ignore */ }
    };

ShapeEditor.prototype._autoloadOnLaunch = function (this: ShapeEditor) {
    const self = this;

        backfillMeta();
        const stored = getScreenmap();
        const meta = getScreenmapMeta();
        const backup = getBackup();
        const STALE_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        if (stored && !isDegenerate(stored)) {
            // Valid working copy — load it; if stale, show passive toast.
            self.load_screenmap_data(stored);
            if (meta && typeof meta.savedAt === 'number'
                && (now - meta.savedAt) > STALE_MS) {
                void self._toastInfo(`Loaded layout from ${self._relativeTime(meta.savedAt)}`);
            }
            return true;
        }

        if (stored && isDegenerate(stored)) {
            // Working copy is degenerate. Decide based on staleness + backup.
            const stale = !meta || typeof meta.savedAt !== 'number'
                || (now - meta.savedAt) > STALE_MS;
            if (stale && backup) {
                // Silent restore + Undo toast.
                const restored = restoreBackup();
                if (restored) {
                    self.load_screenmap_data(restored);
                    void self._toastSilentRestored(backup.meta, stored);
                    return true;
                }
            } else if (!stale && backup) {
                // Fresh degenerate — load the degenerate copy and show banner.
                self.load_screenmap_data(stored);
                void self._toastFreshDegenerate(backup.meta);
                return true;
            }
            // Degenerate, no backup — fall through to default behavior.
            return false;
        }

        // Missing/corrupt JSON — try backup, otherwise fall through.
        if (backup) {
            const restored = restoreBackup();
            if (restored) {
                self.load_screenmap_data(restored);
                void self._toastSuccess('Restored your last good layout');
                return true;
            }
        }
        return false;
    };

ShapeEditor.prototype.hslStringToRgb = function (this: ShapeEditor, hslStr: string) {
    const self = this;

        const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(hslStr);
        if (!m?.[1] || !m[2] || !m[3]) return [1, 1, 1];
        const h = parseFloat(m[1]) / 360;
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        if (s === 0) return [l, l, l];
        const hue2rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
    };

ShapeEditor.prototype.setNeedsGeometryUpdate = function (this: ShapeEditor) {
    const self = this;
 self.geometryDirty = true; self.frameDirty = true; };

ShapeEditor.prototype.setNeedsRender = function (this: ShapeEditor) {
    const self = this;
 self.frameDirty = true; };

ShapeEditor.prototype._oc = function (this: ShapeEditor): HTMLCanvasElement {
    const self = this;

        if (!self.overlayCanvas) throw new Error('overlayCanvas not initialized');
        return self.overlayCanvas;
    };

ShapeEditor.prototype._octx = function (this: ShapeEditor): CanvasRenderingContext2D {
    const self = this;

        if (!self.overlayCtx) throw new Error('overlayCtx not initialized');
        return self.overlayCtx;
    };

ShapeEditor.prototype._scene = function (this: ShapeEditor): Scene {
    const self = this;

        if (!self.scene) throw new Error('scene not initialized');
        return self.scene;
    };

ShapeEditor.prototype._renderer = function (this: ShapeEditor): WebGLRenderer {
    const self = this;

        if (!self.renderer) throw new Error('renderer not initialized');
        return self.renderer;
    };

ShapeEditor.prototype._camera = function (this: ShapeEditor): OrthographicCamera {
    const self = this;

        if (!self.camera) throw new Error('camera not initialized');
        return self.camera;
    };

ShapeEditor.prototype._si = function (this: ShapeEditor): StripInfo {
    const self = this;

        if (!self.stripInfo) throw new Error('stripInfo not initialized');
        return self.stripInfo;
    };

ShapeEditor.prototype._tooltip = function (this: ShapeEditor): HTMLElement {
    const self = this;

        if (!self.tooltip) throw new Error('tooltip not initialized');
        return self.tooltip;
    };

ShapeEditor.prototype._outline = function (this: ShapeEditor): Line {
    const self = this;

        if (!self.screenmapOutline) throw new Error('screenmapOutline not initialized');
        return self.screenmapOutline;
    };

ShapeEditor.prototype._infoDiv = function (this: ShapeEditor): HTMLElement {
    const self = this;

        if (!self.infoDiv) throw new Error('infoDiv not initialized');
        return self.infoDiv;
    };

ShapeEditor.prototype._placeholderDiv = function (this: ShapeEditor): HTMLElement {
    const self = this;

        if (!self.placeholderDiv) throw new Error('placeholderDiv not initialized');
        return self.placeholderDiv;
    };

ShapeEditor.prototype.syncPointSelection = function (this: ShapeEditor, idx: number) {
    const self = this;

        if (idx >= 0) {
            const sIdx = self.stripStore.findStripForIndex(idx);
            self.selection.selectPoint(idx, sIdx);
        } else if (self.selection.getPointIdx() !== null) {
            // Clear point but keep strip selection if explicit
            self.selection.selectPoint(null, self.selection.getStripIdx());
        }
    };

ShapeEditor.prototype.makeCtxBtn = function (this: ShapeEditor, label: string, action: string, parent?: HTMLElement | null) {
    const self = this;

        const ctxContainer = parent ?? self.ctxMenu;
        const btn = document.createElement('button');
        btn.dataset.action = action;
        btn.textContent = label;
        btn.style.cssText = self.ctxBtnStyle;
        btn.addEventListener('mouseenter', () => { btn.style.background = '#3b82f6'; btn.style.color = '#fff'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.color = '#eee'; });
        if (ctxContainer) ctxContainer.appendChild(btn);
        return btn;
    };

ShapeEditor.prototype.makeCtxSeparator = function (this: ShapeEditor) {
    const self = this;

        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#444;margin:4px 0;';
        if (self.ctxMenu) self.ctxMenu.appendChild(sep);
        return sep;
    };

ShapeEditor.prototype.getTransformValue = function (this: ShapeEditor, control: string) {
    const self = this;

        switch (control) {
            case 'scale': return parseFloat(self.dom_txt_scale.value) || 1;
            case 'scaleX': return parseFloat(self.dom_txt_scale_x.value) || 1;
            case 'scaleY': return parseFloat(self.dom_txt_scale_y.value) || 1;
            case 'rotate': return parseInt(self.dom_txt_rotate.value) || 0;
            case 'translateX': return parseInt(self.dom_txt_translate_x.value) || 0;
            case 'translateY': return parseInt(self.dom_txt_translate_y.value) || 0;
            default: return 0;
        }
    };

ShapeEditor.prototype.setTransformValue = function (this: ShapeEditor, control: string, value: number) {
    const self = this;

        switch (control) {
            case 'scale': self.writeScale(self.dom_txt_scale, value); break;
            case 'scaleX': self.writeScale(self.dom_txt_scale_x, value); break;
            case 'scaleY': self.writeScale(self.dom_txt_scale_y, value); break;
            case 'rotate': self.setRotate(value); break;
            case 'translateX': self.setTranslate(value, parseInt(self.dom_txt_translate_y.value) || 0); break;
            case 'translateY': self.setTranslate(parseInt(self.dom_txt_translate_x.value) || 0, value); break;
        }
    };

ShapeEditor.prototype.pushUndo = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        self.undoStack.push(action);
        self.redoStack.length = 0;
        self.updateUndoRedoButtons();
        self.markDirty();
    };

ShapeEditor.prototype._persistMultiStrip = function (this: ShapeEditor) {
    const self = this;

        if (!self.stripInfo || self.stripInfo.strips.length === 0) return;
        try {
            const fallbackDiameter = parseFloat(self.dom_txt_diameter.value) || 0.25;
            const strips = self.stripInfo.strips.map((s) => {
                const pts: [number, number][] = [];
                for (let i = s.offset; i < s.offset + s.count; i++) {
                    const rp = self.rawPts[i] ?? [0, 0];
                    pts.push([rp[0], rp[1]]);
                }
                return {
                    name: s.name,
                    points: pts,
                    diameter: typeof s.diameter === 'number' ? s.diameter : fallbackDiameter,
                    offset: s.offset,
                    count: s.count,
                    video_offset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
                    pin: typeof s.pin === 'string' ? s.pin : 'pin1',
                    videoOffsetOverride: s.videoOffsetOverride,
                };
            });
            saveScreenmapMultiStrip(strips);
        } catch { /* persistence is best-effort */ }
        try { self.renderBackupRow(); } catch { /* render is best-effort */ }
    };

ShapeEditor.prototype._spliceArray = function <T>(this: ShapeEditor, arr: T[], idx: number, count: number): T[] {
    const self = this;

        return arr.splice(idx, count);
    };

ShapeEditor.prototype._removeStripPoints = function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        if (!self.stripInfo) throw new Error('No stripInfo in _removeStripPoints');
        const strip = self.stripInfo.strips[stripIdx];
        if (!strip) throw new Error(`Strip ${String(stripIdx)} not found`);
        const removedScreenmap = self._spliceArray(self.screenmap_pts, strip.offset, strip.count);
        const removedRaw = self._spliceArray(self.rawPts, strip.offset, strip.count);
        const removedStrip: StripEntry & { points: [number, number][] } = { ...strip, points: strip.points.map((p) => [p[0], p[1]] as [number, number]) };
        self.stripStore.removeStrip(stripIdx);
        return { removedStrip, removedScreenmap, removedRaw };
    };

ShapeEditor.prototype._insertStripPoints = function (this: ShapeEditor, stripIdx: number, removed: ReturnType<ShapeEditor['_removeStripPoints']>) {
    const self = this;

        const { removedStrip, removedScreenmap, removedRaw } = removed;
        // Compute the flat insertion point for screenmap_pts/rawPts:
        // the strip will be placed at stripIdx; its starting offset equals
        // sum of counts of strips [0..stripIdx).
        let insertAt = 0;
        if (self.stripInfo) {
            for (let k = 0; k < stripIdx && k < self.stripInfo.strips.length; k++) {
                insertAt += self.stripInfo.strips[k]?.count ?? 0;
            }
        }
        self.screenmap_pts.splice(insertAt, 0, ...removedScreenmap);
        self.rawPts.splice(insertAt, 0, ...removedRaw);
        // Reinsert in StripStore
        const info = self.stripStore.get();
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
        self.stripStore._recomputeOffsetsAndAllPoints();
    };

ShapeEditor.prototype._reorderStripPoints = function (this: ShapeEditor, fromIdx: number, toIdx: number) {
    const self = this;

        if (!self.stripInfo) return;
        // Splice screenmap_pts/rawPts to mirror the strip move.
        const fromStrip = self.stripInfo.strips[fromIdx];
        if (!fromStrip) return;
        const fromOff = fromStrip.offset;
        const fromCnt = fromStrip.count;
        const movedScreenmap = self.screenmap_pts.splice(fromOff, fromCnt);
        const movedRaw = self.rawPts.splice(fromOff, fromCnt);
        self.stripStore.reorderStrip(fromIdx, toIdx);
        // After reorder, the moved strip is at toIdx; compute its new offset
        const newOffset = self.stripInfo.strips[toIdx]?.offset ?? 0;
        self.screenmap_pts.splice(newOffset, 0, ...movedScreenmap);
        self.rawPts.splice(newOffset, 0, ...movedRaw);
    };

ShapeEditor.prototype._pinOfStrip = function (this: ShapeEditor, s: StripEntry) {
    const self = this;

        return StripStore.pinOf(s);
    };

ShapeEditor.prototype._withinPinIdx = function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const si = strips[stripIdx];
        if (!si) return -1;
        const pin = self._pinOfStrip(si);
        let n = 0;
        for (let i = 0; i < stripIdx; i++) {
            const st = strips[i];
            if (st && self._pinOfStrip(st) === pin) n++;
        }
        return n;
    };

ShapeEditor.prototype._nextFreePinId = function (this: ShapeEditor) {
    const self = this;

        const used = new Set(self.stripStore.getStrips().map(self._pinOfStrip));
        let n = 1;
        while (used.has(`pin${String(n)}`)) n++;
        return `pin${String(n)}`;
    };

ShapeEditor.prototype._defaultNewStripPin = function (this: ShapeEditor) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const sIdx = self.selection.getStripIdx();
        if (sIdx !== null && sIdx >= 0 && sIdx < strips.length) {
            const s = strips[sIdx];
            if (s) return self._pinOfStrip(s);
        }
        if (strips.length > 0) {
            const last = strips[strips.length - 1];
            if (last) return self._pinOfStrip(last);
        }
        return 'pin1';
    };

ShapeEditor.prototype._applyRepin = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        const a = action as Record<string, unknown>;
        const strips = self.stripStore.getStrips();
        const s = strips[a.stripIdx as number];
        if (!s) return;
        s.pin = a.newPin as string;
        s.videoOffsetOverride = false;
        // Target index: just after the last existing strip of newPin
        // (excluding the strip itself); append at end for a brand-new pin.
        let lastSame = -1;
        for (let i = 0; i < strips.length; i++) {
            if (i === (a.stripIdx as number)) continue;
            if (self._pinOfStrip(self.nn(strips[i])) === (a.newPin as string)) lastSame = i;
        }
        let target;
        if (lastSame < 0) target = strips.length - 1;
        else target = lastSame > (a.stripIdx as number) ? lastSame : lastSame + 1;
        if (target !== (a.stripIdx as number)) {
            self._reorderStripPoints(a.stripIdx as number, target);
            self.selection.onStripReorder(a.stripIdx as number, target);
        } else {
            self.stripStore.recomputeDerivedVideoOffsets();
        }
        a.newStripIdx = target;
    };

ShapeEditor.prototype._revertRepin = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        const a = action as Record<string, unknown>;
        const strips = self.stripStore.getStrips();
        const fromIdx = typeof a.newStripIdx === 'number' ? (a.newStripIdx) : (a.stripIdx as number);
        const s = strips[fromIdx];
        if (!s) return;
        s.pin = a.oldPin as string;
        s.videoOffsetOverride = a.oldOverride === true;
        if (fromIdx !== (a.stripIdx as number)) {
            self._reorderStripPoints(fromIdx, a.stripIdx as number);
            self.selection.onStripReorder(fromIdx, a.stripIdx as number);
        } else {
            self.stripStore.recomputeDerivedVideoOffsets();
        }
        if (a.oldOverride === true && typeof a.oldVideoOffset === 'number') {
            self.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.oldVideoOffset });
        }
    };

ShapeEditor.prototype._applyPinOrder = function (this: ShapeEditor, order: string[]) {
    const self = this;

        const info = self.stripStore.get();
        if (!info) return;
        const strips = info.strips;
        const selStrip = (() => {
            const i = self.selection.getStripIdx();
            return (i !== null && i >= 0 && i < strips.length) ? (strips[i] ?? null) : null;
        })();
        const groups = new Map<string, number[]>();
        for (let i = 0; i < strips.length; i++) {
            const st = strips[i];
            if (!st) continue;
            const p = self._pinOfStrip(st);
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
                newScreen.push(self.screenmap_pts[k] ?? ([0, 0] as [number, number]));
                newRaw.push(self.rawPts[k] ?? ([0, 0] as [number, number]));
            }
            newStrips.push(st);
        }
        self.screenmap_pts.length = 0;
        self.screenmap_pts.push(...newScreen);
        self.rawPts.length = 0;
        self.rawPts.push(...newRaw);
        strips.length = 0;
        strips.push(...(newStrips));
        self.stripStore._recomputeOffsetsAndAllPoints();
        // Re-select the same strip object at its new index.
        if (selStrip) {
            const newIdx = strips.indexOf(selStrip);
            if (newIdx >= 0) self.selection.selectStrip(newIdx);
        }
    };

ShapeEditor.prototype._applyPinRename = function (this: ShapeEditor, fromId: string, toId: string) {
    const self = this;

        const strips = self.stripStore.getStrips();
        for (const s of strips) {
            if (self._pinOfStrip(s) === fromId) s.pin = toId;
        }
    };
