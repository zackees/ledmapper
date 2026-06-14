// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 3/8).

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

ShapeEditor.prototype.doSetVideoOffset = function (this: ShapeEditor, stripIdx: number, rawValue: string | number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const v = parseInt(String(rawValue), 10);
        if (!Number.isFinite(v) || v < 0) {
            self.renderStripsPanel();
            return;
        }
        const oldValue = typeof self.nn(strips[stripIdx]).video_offset === 'number'
            ? self.nn(strips[stripIdx]).video_offset
            : self.nn(strips[stripIdx]).offset;
        if (oldValue === v) return;
        self.stripStore.updateStrip(stripIdx, { video_offset: v });
        self.pushUndo({ type: 'strip-offset', stripIdx, oldValue, newValue: v });
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsRender();
    };

ShapeEditor.prototype._maybeShowRepinToast = function (this: ShapeEditor, stripName: string, newPin: string) {
    const self = this;

        try {
            if (localStorage.getItem('lm:shapeeditor-repinToastShown')) return;
            localStorage.setItem('lm:shapeeditor-repinToastShown', '1');
        } catch { /* private mode */ }
        void self._toastInfo(`Moved "${stripName}" to ${newPin}. vo: was reset; Undo to restore.`);
    };

ShapeEditor.prototype.doRepinStrip = function (this: ShapeEditor, stripIdx: number, newPinRaw: string) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return false;
        const newPin = typeof newPinRaw === 'string' ? newPinRaw.trim() : '';
        if (!newPin) return false;
        const s = self.nn(strips[stripIdx]);
        const oldPin = self._pinOfStrip(s);
        if (newPin === oldPin) return false;
        const action = {
            type: 'strip-repin',
            stripIdx,
            oldPin,
            newPin,
            oldWithinPinIdx: self._withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st) => self._pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride,
        };
        self._applyRepin(action);
        self.pushUndo(action);
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
        self._maybeShowRepinToast(s.name, newPin);
        return true;
    };

ShapeEditor.prototype.doToggleVoLock = function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const s = self.nn(strips[stripIdx]);
        const oldOverride = s.videoOffsetOverride;
        const newOverride = !oldOverride;
        const oldValue = typeof s.video_offset === 'number' ? s.video_offset : s.offset;
        const newValue = newOverride ? oldValue : self.stripStore.getDerivedVideoOffset(stripIdx);
        self.stripStore.updateStrip(stripIdx, { videoOffsetOverride: newOverride, video_offset: newValue });
        self.pushUndo({ type: 'vo-override-toggle', stripIdx, oldOverride, newOverride, oldValue, newValue });
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsRender();
    };

ShapeEditor.prototype.doRenamePin = function (this: ShapeEditor, oldId: string, newIdRaw: string) {
    const self = this;

        const newId = typeof newIdRaw === 'string' ? newIdRaw.trim() : '';
        if (!newId || newId === oldId) return false;
        const pins = self.stripStore.getPinOrder();
        if (!pins.includes(oldId)) return false;
        if (pins.includes(newId)) return false;
        self._applyPinRename(oldId, newId);
        self.pushUndo({ type: 'pin-rename', oldId, newId });
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        return true;
    };

ShapeEditor.prototype.doRenamePinPrompt = async function (this: ShapeEditor, pinId: string) {
    const self = this;

        const pins = self.stripStore.getPinOrder();
        if (!pins.includes(pinId)) return;
        const Swal = (await import('sweetalert2')).default;
        if (self.signal.aborted) return;
        const swalResult1 = await Swal.fire({
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
        self.doRenamePin(pinId, value1);
    };

ShapeEditor.prototype.doReorderPin = function (this: ShapeEditor, pinId: string, toIdx: number) {
    const self = this;

        const oldOrder = self.stripStore.getPinOrder();
        const fromIdx = oldOrder.indexOf(pinId);
        if (fromIdx < 0) return false;
        const clamped = Math.max(0, Math.min(oldOrder.length - 1, toIdx));
        if (clamped === fromIdx) return false;
        const newOrder = [...oldOrder];
        newOrder.splice(fromIdx, 1);
        newOrder.splice(clamped, 0, pinId);
        self._applyPinOrder(newOrder);
        self.pushUndo({ type: 'pin-reorder', oldOrder, newOrder });
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
        return true;
    };

ShapeEditor.prototype.doAddPin = function (this: ShapeEditor) {
    const self = this;

        const sIdx = self.selection.getStripIdx();
        const strips = self.stripStore.getStrips();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            void self._toastInfo('Select a strip first — [+ Pin] moves it to a new pin');
            return null;
        }
        const newPin = self._nextFreePinId();
        self.doRepinStrip(sIdx, newPin);
        return newPin;
    };

ShapeEditor.prototype._makeRepinAction = function (this: ShapeEditor, stripIdx: number, newPin: string) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const s = self.nn(strips[stripIdx]);
        return {
            type: 'strip-repin',
            stripIdx,
            oldPin: self._pinOfStrip(s),
            newPin,
            oldWithinPinIdx: self._withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st) => self._pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride,
        };
    };

ShapeEditor.prototype._commitComposite = function (this: ShapeEditor, subActions: UndoAction[], crossPin: boolean, toastStripName: string, toastPin: string) {
    const self = this;

        if (subActions.length === 0) return false;
        self.pushUndo({ type: 'connector-retarget', subActions });
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
        if (crossPin) self._maybeShowRepinToast(toastStripName, toastPin);
        return true;
    };

ShapeEditor.prototype.doConnectorRetarget = function (this: ShapeEditor, upIdx: number, tgtIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (upIdx < 0 || upIdx >= strips.length) return false;
        if (tgtIdx < 0 || tgtIdx >= strips.length) return false;
        if (upIdx === tgtIdx) return false;
        const upStrip = self.nn(strips[upIdx]);
        const tgtStrip = self.nn(strips[tgtIdx]);
        const upPin = self._pinOfStrip(upStrip);
        const tgtPin = self._pinOfStrip(tgtStrip);
        const subActions = [];
        let crossPin = false;
        if (tgtPin !== upPin) {
            const repin = self._makeRepinAction(tgtIdx, upPin);
            self.applyAction(repin);
            subActions.push(repin);
            crossPin = true;
        }
        // Indices may have shifted after the repin — locate by object.
        const curIdx = strips.indexOf(tgtStrip);
        const upIdxNow = strips.indexOf(upStrip);
        if (curIdx < 0 || upIdxNow < 0) return false;
        const toIdx = curIdx < upIdxNow ? upIdxNow : upIdxNow + 1;
        if (toIdx !== curIdx) {
            const reorder = { type: 'strip-reorder', fromIdx: curIdx, toIdx };
            self.applyAction(reorder);
            subActions.push(reorder);
        }
        return self._commitComposite(subActions, crossPin, tgtStrip.name, upPin);
    };

ShapeEditor.prototype.doSplitPinAt = function (this: ShapeEditor, downIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return false;
        const pin = self._pinOfStrip(s);
        const moving = [];
        for (let i = downIdx; i < strips.length; i++) {
            if (self._pinOfStrip(self.nn(strips[i])) === pin) moving.push(self.nn(strips[i]));
            else break;
        }
        if (moving.length === 0) return false;
        const newPin = self._nextFreePinId();
        const subActions = [];
        for (const obj of moving) {
            const idx = strips.indexOf(obj);
            if (idx < 0) continue;
            const repin = self._makeRepinAction(idx, newPin);
            self.applyAction(repin);
            subActions.push(repin);
        }
        return self._commitComposite(subActions, true, s.name, newPin);
    };

ShapeEditor.prototype._moveDownstreamToPinPrompt = async function (this: ShapeEditor, downIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return;
        const curPin = self._pinOfStrip(s);
        const options: Record<string, unknown> = {};
        for (const p of self.stripStore.getPinOrder()) {
            if (p !== curPin) options[p] = p;
        }
        options.__new__ = 'New pin…';
        const Swal = (await import('sweetalert2')).default;
        if (self.signal.aborted) return;
        const swalResult2 = await Swal.fire({
            title: `Move "${s.name}" to pin`,
            input: 'select',
            inputOptions: options,
            showCancelButton: true,
            background: '#1a1a1a',
            color: '#e5e7eb',
        });
        const value2: unknown = swalResult2.value;
        if (typeof value2 !== 'string' || !value2) return;
        self.doRepinStrip(downIdx, value2 === '__new__' ? self._nextFreePinId() : value2);
    };

ShapeEditor.prototype._hideConnectorMenu = function (this: ShapeEditor) {
    const self = this;

        if (self.connectorMenuEl) {
            self.connectorMenuEl.remove();
            self.connectorMenuEl = null;
        }
    };

ShapeEditor.prototype._openConnectorMenu = function (this: ShapeEditor, upIdx: number, downIdx: number, clientX: number, clientY: number) {
    const self = this;

        self._hideConnectorMenu();
        const menu = document.createElement('div');
        menu.className = 'connector-menu';
        const mk = (label: string, fn: () => void) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', () => { self._hideConnectorMenu(); fn(); }, { signal: self.signal });
            menu.appendChild(b);
        };
        mk('Swap upstream', () => { self.doReorderStrip(downIdx, upIdx); });
        mk('Split pin here', () => { self.doSplitPinAt(downIdx); });
        mk('Move downstream to pin…', () => { void self._moveDownstreamToPinPrompt(downIdx); });
        menu.style.left = `${String(Math.min(clientX, window.innerWidth - 200))}px`;
        menu.style.top = `${String(Math.min(clientY, window.innerHeight - 110))}px`;
        document.body.appendChild(menu);
        self.connectorMenuEl = menu;
    };

ShapeEditor.prototype._hitChainArrowhead = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        for (const c of self._chainGeom.connectors) {
            if (c.hx === undefined || c.hy === undefined) continue;
            const dx = cx - c.hx, dy = cy - c.hy;
            if (dx * dx + dy * dy <= 14 * 14) return c;
        }
        return null;
    };

ShapeEditor.prototype._hitStartHandle = function (this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null {
    const self = this;

        for (const st of self._chainGeom.starts) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    };

ShapeEditor.prototype._hitEndHandle = function (this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null {
    const self = this;

        for (const st of self._chainGeom.ends) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    };

ShapeEditor.prototype._hitConnectorBody = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        for (const c of self._chainGeom.connectors) {
            if (c.x1 === undefined || c.y1 === undefined || c.x2 === undefined || c.y2 === undefined) continue;
            const vx = c.x2 - c.x1, vy = c.y2 - c.y1;
            const lenSq = vx * vx + vy * vy;
            if (lenSq < 1) continue;
            let t = ((cx - c.x1) * vx + (cy - c.y1) * vy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const px = c.x1 + t * vx, py = c.y1 + t * vy;
            const dx = cx - px, dy = cy - py;
            if (dx * dx + dy * dy <= 8 * 8) return c;
        }
        return null;
    };

ShapeEditor.prototype._previewConnectorTarget = function (this: ShapeEditor, upIdx: number, targetIdx: number | null) {
    const self = this;

        self.renderStripsPanel();
        if (targetIdx === null) return;
        if (!self.dom_strips_list) return;
        const upRow = self.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(upIdx)}"]`);
        const tgtRow = self.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(targetIdx)}"]`);
        if (upRow && tgtRow && upRow !== tgtRow) {
            upRow.after(tgtRow);
            tgtRow.classList.add('preview-move');
        }
    };

ShapeEditor.prototype._cancelConnectorDrag = function (this: ShapeEditor) {
    const self = this;

        if (!self.connectorDrag && !self.startHandleDrag) return;
        self.connectorDrag = null;
        self.startHandleDrag = null;
        self.renderStripsPanel();
        self.setNeedsRender();
    };

ShapeEditor.prototype.doReorderStrip = function (this: ShapeEditor, fromIdx: number, toIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (fromIdx < 0 || fromIdx >= strips.length) return;
        if (toIdx < 0 || toIdx >= strips.length) return;
        if (fromIdx === toIdx) return;
        self._reorderStripPoints(fromIdx, toIdx);
        self.selection.onStripReorder(fromIdx, toIdx);
        self.pushUndo({ type: 'strip-reorder', fromIdx, toIdx });
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.doRenameStripPrompt = async function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const strip = strips[stripIdx];
        if (!strip) return;
        const oldName = strip.name;
        const Swal = (await import('sweetalert2')).default;
        if (self.signal.aborted) return;
        const swalResult3 = await Swal.fire({
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
                        if (i !== stripIdx && self.nn(strips[i]).name === name) {
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
        self.stripStore.renameStrip(stripIdx, newName);
        self.pushUndo({ type: 'strip-rename', stripIdx, oldName, newName });
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.doDeleteStripPrompt = async function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (strips.length <= 1) return;
        const strip = strips[stripIdx];
        if (!strip) return;
        const Swal = (await import('sweetalert2')).default;
        if (self.signal.aborted) return;
        const result = await Swal.fire({
            title: `Delete "${strip.name}"?`,
            text: `${String(strip.count)} LED${strip.count === 1 ? '' : 's'} will be removed.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: '#ef4444',
        });
        if (!result.isConfirmed) return;
        const removed = self._removeStripPoints(stripIdx);
        self.selection.onStripRemove(stripIdx);
        self.selectedIdx = -1;
        self.pushUndo({ type: 'strip-delete', stripIdx, removed });
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.getCanvasSize = function (this: ShapeEditor) {
    const self = this;

        return {
            width: self.mainEl.clientWidth || Math.floor(window.innerWidth),
            height: self.mainEl.clientHeight || Math.floor(window.innerHeight * 0.6),
        };
    };

ShapeEditor.prototype.getFitSize = function (this: ShapeEditor) {
    const self = this;

        return {
            width: Math.floor(window.innerWidth * 0.45),
            height: Math.floor(window.innerHeight * 0.4),
        };
    };

ShapeEditor.prototype.getCurrentTransform = function (this: ShapeEditor): { sX: number; sY: number; cosR: number; sinR: number; tx: number; ty: number } {
    const self = this;

        const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
        const sX = (parseFloat(self.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(self.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(self.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const tx = parseFloat(self.dom_txt_translate_x.value) || 0;
        const ty = parseFloat(self.dom_txt_translate_y.value) || 0;
        return { sX, sY, cosR: Math.cos(rotateRad), sinR: Math.sin(rotateRad), tx, ty };
    };

ShapeEditor.prototype.canvasDeltaToScreenmapDelta = function (this: ShapeEditor, dx: number, dy: number): [number, number] {
    const self = this;

        const { sX, sY, cosR, sinR } = self.getCurrentTransform();
        // Account for camera zoom, then inverse rotation and inverse scale
        const wdx = dx / self.camZoom;
        const wdy = dy / self.camZoom;
        const urx = wdx * cosR + wdy * sinR;
        const ury = -wdx * sinR + wdy * cosR;
        return [urx / sX, ury / sY];
    };

ShapeEditor.prototype.getCanvasCoords = function (this: ShapeEditor, e: { clientX: number; clientY: number }): [number, number] {
    const self = this;

        const rect = self._oc().getBoundingClientRect();
        return [
            (e.clientX - rect.left) * (self.canvasW / rect.width),
            (e.clientY - rect.top) * (self.canvasH / rect.height),
        ];
    };

ShapeEditor.prototype.initRenderer = function (this: ShapeEditor) {
    const self = this;

        const { width, height } = self.getCanvasSize();
        self.canvasW = width;
        self.canvasH = height;

        self.renderer = new WebGLRenderer({ antialias: false });
        self.renderer.setSize(width, height);
        self.renderer.setPixelRatio(window.devicePixelRatio);
        self.renderer.setClearColor(0x121212, 1);

        self.scene = new Scene();

        const hw = width / 2, hh = height / 2;
        self.camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        self.camera.position.z = 1;

        self.wrapper = document.createElement('div');
        self.wrapper.style.position = 'absolute';
        self.wrapper.style.inset = '0';
        self.mainEl.appendChild(self.wrapper);

        self.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
        self.wrapper.appendChild(self.renderer.domElement);

        // Overlay canvas for rainbow lines, arrows, and labels (always visible)
        self.overlayCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        self.overlayCanvas.width = width * dpr;
        self.overlayCanvas.height = height * dpr;
        self.overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;';
        self.wrapper.appendChild(self.overlayCanvas);
        self.overlayCtx = self.overlayCanvas.getContext('2d');
        self._octx().scale(dpr, dpr);

        // LED index tooltip
        self.tooltip = document.createElement('div');
        self.tooltip.style.cssText =
            'position:absolute;pointer-events:none;' +
            'background:rgba(0,0,0,0.85);color:#fff;' +
            'padding:4px 8px;border-radius:4px;font:12px monospace;white-space:nowrap;' +
            'opacity:0;transition:opacity 0.15s;';
        self.wrapper.appendChild(self.tooltip);

        // Right-click context menu (inline styles — lives on document.body, outside tool CSS scope)
        self.ctxMenu = document.createElement('div');
        self.ctxMenu.style.cssText =
            'position:fixed;display:none;z-index:9999;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:6px;' +
            'padding:6px 0;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:240px;';

        // ── File operations (wrapped for show/hide) ──
        self.ctxFileOps = document.createElement('div');
        self.ctxMenu.appendChild(self.ctxFileOps);
        self.makeCtxBtn('New', 'new', self.ctxFileOps);
        self.ctxBtnSave = self.makeCtxBtn('Save As\u2026', 'save', self.ctxFileOps);

        // Load Screenmap with submenu
        const ctxLoadWrapper = document.createElement('div');
        ctxLoadWrapper.style.cssText = 'position:relative;';
        self.ctxFileOps.appendChild(ctxLoadWrapper);
        self.ctxBtnLoadScreenmap = document.createElement('button');
        self.ctxBtnLoadScreenmap.textContent = 'Load Screenmap \u25B8';
        self.ctxBtnLoadScreenmap.style.cssText = self.ctxBtnStyle;
        ctxLoadWrapper.appendChild(self.ctxBtnLoadScreenmap);

        self.ctxLoadSubmenu = document.createElement('div');
        self.ctxLoadSubmenu.style.cssText =
            'position:absolute;left:100%;top:0;display:none;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:6px;' +
            'padding:6px 0;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:220px;white-space:nowrap;';
        ctxLoadWrapper.appendChild(self.ctxLoadSubmenu);

        // "Upload file…" always first in submenu
        self.makeCtxBtn('Upload file\u2026', 'upload-screenmap', self.ctxLoadSubmenu);

        ctxLoadWrapper.addEventListener('mouseenter', () => {
            if (self.ctxBtnLoadScreenmap) { self.ctxBtnLoadScreenmap.style.background = '#3b82f6'; self.ctxBtnLoadScreenmap.style.color = '#fff'; }
            if (self.ctxLoadSubmenu) self.ctxLoadSubmenu.style.display = '';
        });
        ctxLoadWrapper.addEventListener('mouseleave', () => {
            if (self.ctxBtnLoadScreenmap) { self.ctxBtnLoadScreenmap.style.background = 'none'; self.ctxBtnLoadScreenmap.style.color = '#eee'; }
            if (self.ctxLoadSubmenu) self.ctxLoadSubmenu.style.display = 'none';
        });

        // Load Image (triggers file picker)
        self.makeCtxBtn('Load Background Image\u2026', 'load-image', self.ctxFileOps);
        self.ctxLoadImageInput = document.createElement('input');
        self.ctxLoadImageInput.type = 'file';
        self.ctxLoadImageInput.accept = 'image/*';
        self.ctxLoadImageInput.style.display = 'none';
        self.ctxFileOps.appendChild(self.ctxLoadImageInput);

        self.ctxFileOpsSep = self.makeCtxSeparator();

        // ── Discoverability entry points ──
        self.makeCtxBtn('Insert panel…', 'insert-panel');
        self.makeCtxBtn('Paste screenmap', 'paste-screenmap');
        self.ctxBtnCopyStrip = self.makeCtxBtn('Copy strip', 'copy-strip');

        // ── Point operations ──
        self.ctxBtnDelete = self.makeCtxBtn('Delete Point', 'delete');
        self.ctxBtnInsertBetween = self.makeCtxBtn('Insert between', 'insert-between');
        self.ctxBtnInsertFwd = self.makeCtxBtn('Insert, shift forward', 'insert-forward');
        self.ctxBtnInsertBack = self.makeCtxBtn('Insert, shift back', 'insert-back');

        // Trailing help entry
        self.makeCtxSeparator();
        self.makeCtxBtn('Keyboard help', 'kbd-help');

        document.body.appendChild(self.ctxMenu);

        // Hidden file input for "Upload file…" submenu item
        const ctxUploadInput = document.createElement('input');
        ctxUploadInput.type = 'file';
        ctxUploadInput.accept = '.json';
        ctxUploadInput.style.display = 'none';
        document.body.appendChild(ctxUploadInput);
        ctxUploadInput.addEventListener('change', () => {
            if (ctxUploadInput.files?.[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => { if (ev.target) self.load_screenmap_data(ev.target.result as string); };
                reader.readAsText(ctxUploadInput.files[0]);
            }
            ctxUploadInput.value = '';
        }, { signal: self.signal });

        self.ctxLoadImageInput.addEventListener('change', () => {
            if (self.ctxLoadImageInput?.files?.[0]) self.loadBackgroundImage(self.ctxLoadImageInput.files[0]);
            if (self.ctxLoadImageInput) self.ctxLoadImageInput.value = '';
        }, { signal: self.signal });

        self.ctxMenu.addEventListener('click', (e: MouseEvent) => {
            const cm_tgt = e.target as HTMLElement | null;
            const action = cm_tgt?.dataset.action ?? null;
            if (action === 'new') {
                self.dom_btn_new.click();
            } else if (action === 'save') {
                self.saveAs();
            } else if (action === 'upload-screenmap') {
                ctxUploadInput.click();
            } else if (action?.startsWith('load-preset:')) {
                const file = action.slice('load-preset:'.length);
                fetch(`/screenmaps/${file}`).then(r => r.text()).then((arg: any) => self.load_screenmap_data(arg))
                    .catch((err: unknown) => { console.warn('Failed to load preset:', err); });
            } else if (action === 'load-image') {
                self.ctxLoadImageInput?.click();
            } else if (action === 'delete' && self.ctxMenuIdx >= 0) {
                self.deletePoint(self.ctxMenuIdx);
            } else if (action === 'insert-between' && self.highlightedEdgeIdx >= 0) {
                self.insertBetween(self.highlightedEdgeIdx);
            } else if (action === 'insert-forward') {
                self.insertShiftForward();
            } else if (action === 'insert-back') {
                self.insertShiftBack();
            } else if (action === 'insert-panel') {
                void self._openInsertDialog();
            } else if (action === 'paste-screenmap') {
                void self._pasteFromClipboardAPI();
            } else if (action === 'copy-strip') {
                self._copySelectedStripToClipboard();
            } else if (action === 'kbd-help') {
                void self._openHelpOverlay();
            }
            self.hideContextMenu();
        }, { signal: self.signal });

        // Dismiss on any click outside
        window.addEventListener('mousedown', (e) => {
            if (self.ctxMenu?.style.display !== 'none' && !self.ctxMenu?.contains(e.target as Node | null)) {
                self.hideContextMenu();
            }
        }, { signal: self.signal });

        // ── Mouse interaction ─────────────────────────────────────────────

        self.overlayCanvas.addEventListener('mousedown', (...args: any[]) => (self.onMouseDown as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('mousemove', (...args: any[]) => (self.onMouseMove as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('mouseup', (...args: any[]) => (self.onMouseUp as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('mouseleave', (...args: any[]) => (self.onMouseLeave as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('contextmenu', (...args: any[]) => (self.onContextMenu as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('dblclick', (...args: any[]) => (self.onDoubleClick as any)(...args), { signal: self.signal });
        self.overlayCanvas.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const zoomFactor = Math.pow(2, -e.deltaY / 3000);
            self.camZoom = Math.max(0.1, Math.min(10, self.camZoom * zoomFactor));
            self.setNeedsRender();
        }, { passive: false, signal: self.signal });

        self._wireTouchHandlers(self.signal);

        const labelStyle = 'position:absolute;pointer-events:none;color:#fff;font:bold 13px/1 "Outfit",system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 3px #000;';

        self.infoDiv = document.createElement('div');
        self.infoDiv.style.cssText = labelStyle + 'bottom:10px;left:10px;font-size:14px;line-height:1.6;';
        self.wrapper.appendChild(self.infoDiv);

        self.placeholderDiv = document.createElement('div');
        self.placeholderDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;color:#fff;font:24px sans-serif;';
        self.placeholderDiv.textContent = 'Upload a screenmap file to begin';
        self.wrapper.appendChild(self.placeholderDiv);

        // ── Hint strip (lives inside #main, outside the renderer wrapper so
        // it sits above the canvas and is part of the tool's DOM) ──
        self.hintStripTextEl = self.container.querySelector<HTMLElement>('#hint_strip_text');
        self.hintStripHelpBtn = self.container.querySelector<HTMLButtonElement>('#hint_strip_help');
        if (self.hintStripHelpBtn) {
            self.hintStripHelpBtn.addEventListener('click', () => {
                void self._openHelpOverlay();
            }, { signal: self.signal });
        }
        self._updateHintStrip();

        self.buildGrid(width, height);
    };

ShapeEditor.prototype._currentHintState = function (this: ShapeEditor) {
    const self = this;

        const selStripIdx = self.selection.getStripIdx();
        const strips = self.stripStore.getStrips();
        let selectedStripName = null;
        if (selStripIdx !== null && selStripIdx >= 0 && selStripIdx < strips.length) {
            selectedStripName = self.nn(strips[selStripIdx]).name;
        }
        let pointEditStripName = '';
        if (self.pointEditStripIdx !== null && self.pointEditStripIdx >= 0 && self.pointEditStripIdx < strips.length) {
            pointEditStripName = self.nn(strips[self.pointEditStripIdx]).name;
        }
        return {
            empty: !self.stripInfo || self.stripInfo.strips.length === 0
                || (self.stripInfo.strips.length === 1 && (self.stripInfo.strips[0]?.count ?? 0) <= 1
                    && self.stripInfo.totalCount <= 1),
            placing: !!self.placingState,
            placingLabel: self.placingState?.entry.label ?? '',
            pasting: !!self.pasteState,
            pastingCount: self.pasteState ? self.pasteState.strips.length : 0,
            pointEditMode: self.pointEditStripIdx !== null,
            pointEditStripName,
            selectedStripName,
            chainMode: self.editorMode === 'chain',
            reorderMode: self.editorMode === 'reorder',
        };
    };

ShapeEditor.prototype._updateHintStrip = function (this: ShapeEditor) {
    const self = this;

        if (!self.hintStripTextEl) return;
        self.hintStripTextEl.textContent = hintTextFor(self._currentHintState());
    };
