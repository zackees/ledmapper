// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 3/8).

import { ShapeEditor } from './shapeeditor-class';
import { WebGLRenderer, Scene, OrthographicCamera } from 'three';

import { notePinMutation, savePresetScreenmap } from '../screenmap-store';
import { safeStorage } from '../services/storage';
import { fireDialog } from '../ui/dialogs';
import { gfxColors } from '../ui/theme';

import { hintTextFor } from './hints';

import type { UndoAction } from './shapeeditor-types';

ShapeEditor.prototype.doSetVideoOffset = function (this: ShapeEditor, stripIdx: number, rawValue: string | number) {

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
    };

ShapeEditor.prototype._maybeShowRepinToast = function (this: ShapeEditor, stripName: string, newPin: string) {

        if (safeStorage.get('lm:shapeeditor-repinToastShown')) return;
        safeStorage.set('lm:shapeeditor-repinToastShown', '1');
        void this._toastInfo(`Moved "${stripName}" to ${newPin}. vo: was reset; Undo to restore.`);
    };

ShapeEditor.prototype.doRepinStrip = function (this: ShapeEditor, stripIdx: number, newPinRaw: string) {

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
    };

ShapeEditor.prototype.doToggleVoLock = function (this: ShapeEditor, stripIdx: number) {

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
    };

ShapeEditor.prototype.doRenamePin = function (this: ShapeEditor, oldId: string, newIdRaw: string) {

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
    };

ShapeEditor.prototype.doRenamePinPrompt = async function (this: ShapeEditor, pinId: string) {

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
    };

ShapeEditor.prototype.doReorderPin = function (this: ShapeEditor, pinId: string, toIdx: number) {

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
    };

ShapeEditor.prototype.doAddPin = function (this: ShapeEditor) {

        const sIdx = this.selection.getStripIdx();
        const strips = this.stripStore.getStrips();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            void this._toastInfo('Select a strip first — [+ Pin] moves it to a new pin');
            return null;
        }
        const newPin = this._nextFreePinId();
        this.doRepinStrip(sIdx, newPin);
        return newPin;
    };

ShapeEditor.prototype._makeRepinAction = function (this: ShapeEditor, stripIdx: number, newPin: string) {

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
    };

ShapeEditor.prototype._commitComposite = function (this: ShapeEditor, subActions: UndoAction[], crossPin: boolean, toastStripName: string, toastPin: string) {

        if (subActions.length === 0) return false;
        this.pushUndo({ type: 'connector-retarget', subActions });
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        if (crossPin) this._maybeShowRepinToast(toastStripName, toastPin);
        return true;
    };

ShapeEditor.prototype.doConnectorRetarget = function (this: ShapeEditor, upIdx: number, tgtIdx: number) {

        const strips = this.stripStore.getStrips();
        if (upIdx < 0 || upIdx >= strips.length) return false;
        if (tgtIdx < 0 || tgtIdx >= strips.length) return false;
        if (upIdx === tgtIdx) return false;
        const upStrip = this.nn(strips[upIdx]);
        const tgtStrip = this.nn(strips[tgtIdx]);
        const upPin = this._pinOfStrip(upStrip);
        const tgtPin = this._pinOfStrip(tgtStrip);
        const subActions = [];
        let crossPin = false;
        if (tgtPin !== upPin) {
            const repin = this._makeRepinAction(tgtIdx, upPin);
            this.applyAction(repin);
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
            this.applyAction(reorder);
            subActions.push(reorder);
        }
        return this._commitComposite(subActions, crossPin, tgtStrip.name, upPin);
    };

ShapeEditor.prototype.doSplitPinAt = function (this: ShapeEditor, downIdx: number) {

        const strips = this.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return false;
        const pin = this._pinOfStrip(s);
        const moving = [];
        for (let i = downIdx; i < strips.length; i++) {
            if (this._pinOfStrip(this.nn(strips[i])) === pin) moving.push(this.nn(strips[i]));
            else break;
        }
        if (moving.length === 0) return false;
        const newPin = this._nextFreePinId();
        const subActions = [];
        for (const obj of moving) {
            const idx = strips.indexOf(obj);
            if (idx < 0) continue;
            const repin = this._makeRepinAction(idx, newPin);
            this.applyAction(repin);
            subActions.push(repin);
        }
        return this._commitComposite(subActions, true, s.name, newPin);
    };

ShapeEditor.prototype._moveDownstreamToPinPrompt = async function (this: ShapeEditor, downIdx: number) {

        const strips = this.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return;
        const curPin = this._pinOfStrip(s);
        const options: Record<string, unknown> = {};
        for (const p of this.stripStore.getPinOrder()) {
            if (p !== curPin) options[p] = p;
        }
        options.__new__ = 'New pin…';
        if (this.signal.aborted) return;
        const swalResult2 = await fireDialog({
            title: `Move "${s.name}" to pin`,
            input: 'select',
            inputOptions: options,
            showCancelButton: true,
        });
        const value2: unknown = swalResult2.value;
        if (typeof value2 !== 'string' || !value2) return;
        this.doRepinStrip(downIdx, value2 === '__new__' ? this._nextFreePinId() : value2);
    };

ShapeEditor.prototype._hideConnectorMenu = function (this: ShapeEditor) {

        if (this.connectorMenuEl) {
            this.connectorMenuEl.remove();
            this.connectorMenuEl = null;
        }
    };

ShapeEditor.prototype._openConnectorMenu = function (this: ShapeEditor, upIdx: number, downIdx: number, clientX: number, clientY: number) {

        this._hideConnectorMenu();
        const menu = document.createElement('div');
        menu.className = 'connector-menu';
        const mk = (label: string, fn: () => void) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', () => { this._hideConnectorMenu(); fn(); }, { signal: this.signal });
            menu.appendChild(b);
        };
        mk('Swap upstream', () => { this.doReorderStrip(downIdx, upIdx); });
        mk('Split pin here', () => { this.doSplitPinAt(downIdx); });
        mk('Move downstream to pin…', () => { void this._moveDownstreamToPinPrompt(downIdx); });
        menu.style.left = `${String(Math.min(clientX, window.innerWidth - 200))}px`;
        menu.style.top = `${String(Math.min(clientY, window.innerHeight - 110))}px`;
        document.body.appendChild(menu);
        this.connectorMenuEl = menu;
    };

ShapeEditor.prototype._hitChainArrowhead = function (this: ShapeEditor, cx: number, cy: number) {

        for (const c of this._chainGeom.connectors) {
            if (c.hx === undefined || c.hy === undefined) continue;
            const dx = cx - c.hx, dy = cy - c.hy;
            if (dx * dx + dy * dy <= 14 * 14) return c;
        }
        return null;
    };

ShapeEditor.prototype._hitStartHandle = function (this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null {

        for (const st of this._chainGeom.starts) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    };

ShapeEditor.prototype._hitEndHandle = function (this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null {

        for (const st of this._chainGeom.ends) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    };

ShapeEditor.prototype._hitConnectorBody = function (this: ShapeEditor, cx: number, cy: number) {

        for (const c of this._chainGeom.connectors) {
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

        this.renderStripsPanel();
        if (targetIdx === null) return;
        const upRow = this.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(upIdx)}"]`);
        const tgtRow = this.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(targetIdx)}"]`);
        if (upRow && tgtRow && upRow !== tgtRow) {
            upRow.after(tgtRow);
            tgtRow.classList.add('preview-move');
        }
    };

ShapeEditor.prototype._cancelConnectorDrag = function (this: ShapeEditor) {

        if (!this.connectorDrag && !this.startHandleDrag) return;
        this.connectorDrag = null;
        this.startHandleDrag = null;
        this.renderStripsPanel();
        this.setNeedsRender();
    };

ShapeEditor.prototype.doReorderStrip = function (this: ShapeEditor, fromIdx: number, toIdx: number) {

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
    };

ShapeEditor.prototype.doRenameStripPrompt = async function (this: ShapeEditor, stripIdx: number) {

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
    };

ShapeEditor.prototype.doDeleteStripPrompt = async function (this: ShapeEditor, stripIdx: number) {

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
    };

ShapeEditor.prototype.getCanvasSize = function (this: ShapeEditor) {

        return {
            width: this.mainEl.clientWidth || Math.floor(window.innerWidth),
            height: this.mainEl.clientHeight || Math.floor(window.innerHeight * 0.6),
        };
    };

ShapeEditor.prototype.getFitSize = function (this: ShapeEditor) {

        return {
            width: Math.floor(window.innerWidth * 0.45),
            height: Math.floor(window.innerHeight * 0.4),
        };
    };

ShapeEditor.prototype.getCurrentTransform = function (this: ShapeEditor): { sX: number; sY: number; cosR: number; sinR: number; tx: number; ty: number } {

        const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
        const sX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(this.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const tx = parseFloat(this.dom_txt_translate_x.value) || 0;
        const ty = parseFloat(this.dom_txt_translate_y.value) || 0;
        return { sX, sY, cosR: Math.cos(rotateRad), sinR: Math.sin(rotateRad), tx, ty };
    };

ShapeEditor.prototype.canvasDeltaToScreenmapDelta = function (this: ShapeEditor, dx: number, dy: number): [number, number] {

        const { sX, sY, cosR, sinR } = this.getCurrentTransform();
        // Account for camera zoom, then inverse rotation and inverse scale
        const wdx = dx / this.camZoom;
        const wdy = dy / this.camZoom;
        const urx = wdx * cosR + wdy * sinR;
        const ury = -wdx * sinR + wdy * cosR;
        return [urx / sX, ury / sY];
    };

ShapeEditor.prototype.getCanvasCoords = function (this: ShapeEditor, e: { clientX: number; clientY: number }): [number, number] {

        const rect = this._oc().getBoundingClientRect();
        return [
            (e.clientX - rect.left) * (this.canvasW / rect.width),
            (e.clientY - rect.top) * (this.canvasH / rect.height),
        ];
    };

ShapeEditor.prototype.initRenderer = function (this: ShapeEditor) {

        const { width, height } = this.getCanvasSize();
        this.canvasW = width;
        this.canvasH = height;

        this.renderer = new WebGLRenderer({ antialias: false });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x121212, 1);

        this.scene = new Scene();

        const hw = width / 2, hh = height / 2;
        this.camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        this.camera.position.z = 1;

        this.wrapper = document.createElement('div');
        this.wrapper.style.position = 'absolute';
        this.wrapper.style.inset = '0';
        this.mainEl.appendChild(this.wrapper);

        this.renderer.domElement.className = 'shapeeditor-three-canvas';
        this.wrapper.appendChild(this.renderer.domElement);

        // Overlay canvas for rainbow lines, arrows, and labels (always visible)
        this.overlayCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        this.overlayCanvas.width = width * dpr;
        this.overlayCanvas.height = height * dpr;
        this.overlayCanvas.className = 'shapeeditor-overlay-canvas';
        this.wrapper.appendChild(this.overlayCanvas);
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        this._octx().scale(dpr, dpr);

        // LED index tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'shapeeditor-tooltip';
        this.wrapper.appendChild(this.tooltip);

        // Right-click context menu. Lives on document.body but the
        // shapeeditor CSS classes are unscoped so they still apply.
        this.ctxMenu = document.createElement('div');
        this.ctxMenu.className = 'shapeeditor-ctx-menu';

        // ── File operations (wrapped for show/hide) ──
        this.ctxFileOps = document.createElement('div');
        this.ctxMenu.appendChild(this.ctxFileOps);
        this.makeCtxBtn('New', 'new', this.ctxFileOps);
        this.ctxBtnSave = this.makeCtxBtn('Save As\u2026', 'save', this.ctxFileOps);

        // Load Screenmap with submenu
        const ctxLoadWrapper = document.createElement('div');
        ctxLoadWrapper.className = 'shapeeditor-ctx-load-wrapper';
        this.ctxFileOps.appendChild(ctxLoadWrapper);
        this.ctxBtnLoadScreenmap = document.createElement('button');
        this.ctxBtnLoadScreenmap.textContent = 'Load Screenmap \u25B8';
        this.ctxBtnLoadScreenmap.className = `${this.ctxBtnClass} shapeeditor-ctx-load-trigger`;
        ctxLoadWrapper.appendChild(this.ctxBtnLoadScreenmap);

        this.ctxLoadSubmenu = document.createElement('div');
        this.ctxLoadSubmenu.className = 'shapeeditor-ctx-submenu';
        ctxLoadWrapper.appendChild(this.ctxLoadSubmenu);

        // "Upload file…" always first in submenu
        this.makeCtxBtn('Upload file\u2026', 'upload-screenmap', this.ctxLoadSubmenu);

        ctxLoadWrapper.addEventListener('mouseenter', () => {
            if (this.ctxBtnLoadScreenmap) this.ctxBtnLoadScreenmap.classList.add('is-active');
            // Explicit 'block': the .shapeeditor-ctx-submenu class carries
            // `display: none` (#170), so '' would fall back to hidden.
            if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'block';
        });
        ctxLoadWrapper.addEventListener('mouseleave', () => {
            if (this.ctxBtnLoadScreenmap) this.ctxBtnLoadScreenmap.classList.remove('is-active');
            if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'none';
        });

        // Load Image (triggers file picker)
        this.makeCtxBtn('Load Background Image\u2026', 'load-image', this.ctxFileOps);
        this.ctxLoadImageInput = document.createElement('input');
        this.ctxLoadImageInput.type = 'file';
        this.ctxLoadImageInput.accept = 'image/*';
        this.ctxLoadImageInput.style.display = 'none';
        this.ctxFileOps.appendChild(this.ctxLoadImageInput);

        this.ctxFileOpsSep = this.makeCtxSeparator();

        // ── Discoverability entry points ──
        this.makeCtxBtn('Insert panel…', 'insert-panel');
        this.makeCtxBtn('Paste screenmap', 'paste-screenmap');
        this.ctxBtnCopyStrip = this.makeCtxBtn('Copy strip', 'copy-strip');

        // ── Point operations ──
        this.ctxBtnDelete = this.makeCtxBtn('Delete Point', 'delete');
        this.ctxBtnInsertBetween = this.makeCtxBtn('Insert between', 'insert-between');
        this.ctxBtnInsertFwd = this.makeCtxBtn('Insert, shift forward', 'insert-forward');
        this.ctxBtnInsertBack = this.makeCtxBtn('Insert, shift back', 'insert-back');

        // Ruler operations
        this.ctxRulerSep = this.makeCtxSeparator();
        this.ctxBtnInsertRuler = this.makeCtxBtn('Insert ruler (60 cm)', 'insert-ruler');
        this.ctxBtnDuplicateRuler = this.makeCtxBtn('Duplicate ruler', 'duplicate-ruler');
        this.ctxBtnDeleteRuler = this.makeCtxBtn('Delete ruler', 'delete-ruler');

        // Inspector
        this.makeCtxSeparator();
        this.makeCtxBtn('Inspect JSON…', 'inspect-json');

        // Trailing help entry
        this.makeCtxSeparator();
        this.makeCtxBtn('Keyboard help', 'kbd-help');

        document.body.appendChild(this.ctxMenu);

        // Hidden file input for "Upload file…" submenu item
        const ctxUploadInput = document.createElement('input');
        ctxUploadInput.type = 'file';
        ctxUploadInput.accept = '.json';
        ctxUploadInput.style.display = 'none';
        document.body.appendChild(ctxUploadInput);
        ctxUploadInput.addEventListener('change', () => {
            if (ctxUploadInput.files?.[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => { if (ev.target) this.load_screenmap_data(ev.target.result as string); };
                reader.readAsText(ctxUploadInput.files[0]);
            }
            ctxUploadInput.value = '';
        }, { signal: this.signal });

        this.ctxLoadImageInput.addEventListener('change', () => {
            if (this.ctxLoadImageInput?.files?.[0]) this.loadBackgroundImage(this.ctxLoadImageInput.files[0]);
            if (this.ctxLoadImageInput) this.ctxLoadImageInput.value = '';
        }, { signal: this.signal });

        this.ctxMenu.addEventListener('click', (e: MouseEvent) => {
            const cm_tgt = e.target instanceof HTMLElement ? e.target : null;
            const action = cm_tgt?.dataset.action ?? null;
            if (action === 'new') {
                this.dom_btn_new.click();
            } else if (action === 'save') {
                this.saveAs();
            } else if (action === 'upload-screenmap') {
                ctxUploadInput.click();
            } else if (action?.startsWith('load-preset:')) {
                const file = action.slice('load-preset:'.length);
                const generation = ++this.layoutLoadGeneration;
                fetch(`/screenmaps/${file}`, { signal: this.signal }).then(r => r.text()).then((text) => {
                    if (this.signal.aborted || generation !== this.layoutLoadGeneration) return;
                    if (!savePresetScreenmap(text, file)) throw new Error(`Could not persist preset ${file}`);
                    this.load_screenmap_data(text, false);
                    this.presetPicker?.setActive(file);
                })
                    .catch((err: unknown) => { console.warn('Failed to load preset:', err); });
            } else if (action === 'load-image') {
                this.ctxLoadImageInput?.click();
            } else if (action === 'delete' && this.ctxMenuIdx >= 0) {
                this.deletePoint(this.ctxMenuIdx);
            } else if (action === 'insert-between' && this.highlightedEdgeIdx >= 0) {
                this.insertBetween(this.highlightedEdgeIdx);
            } else if (action === 'insert-forward') {
                this.insertShiftForward();
            } else if (action === 'insert-back') {
                this.insertShiftBack();
            } else if (action === 'insert-panel') {
                void this._openInsertDialog();
            } else if (action === 'paste-screenmap') {
                void this._pasteFromClipboardAPI();
            } else if (action === 'copy-strip') {
                this._copySelectedStripToClipboard();
            } else if (action === 'inspect-json') {
                void this._openInspectJsonDialog();
            } else if (action === 'insert-ruler') {
                this._insertRulerAt(this.ctxMenuClickX, this.ctxMenuClickY);
            } else if (action === 'duplicate-ruler' && this.ctxMenuRulerIdx >= 0) {
                this._duplicateRuler(this.ctxMenuRulerIdx);
            } else if (action === 'delete-ruler' && this.ctxMenuRulerIdx >= 0) {
                this._deleteRuler(this.ctxMenuRulerIdx);
            } else if (action === 'kbd-help') {
                void this._openHelpOverlay();
            }
            this.hideContextMenu();
        }, { signal: this.signal });

        // Dismiss on any click outside
        window.addEventListener('mousedown', (e) => {
            if (this.ctxMenu?.style.display !== 'none' && !this.ctxMenu?.contains(e.target as Node | null)) {
                this.hideContextMenu();
            }
        }, { signal: this.signal });

        // ── Mouse interaction ─────────────────────────────────────────────

        // Pointer Events cover mouse, touch, and stylus with one interaction
        // path. PointerEvent extends MouseEvent, so the existing handlers can
        // consume these events without an unsafe cast.
        const overlayCanvas = this._oc();
        if ('PointerEvent' in window) {
            overlayCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
                overlayCanvas.setPointerCapture(e.pointerId);
                this.onMouseDown(e);
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointermove', (e: PointerEvent) => { this.onMouseMove(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('pointerup', (e: PointerEvent) => {
                if (overlayCanvas.hasPointerCapture(e.pointerId)) overlayCanvas.releasePointerCapture(e.pointerId);
                this.onMouseUp(e);
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointercancel', (e: PointerEvent) => { this.onMouseUp(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('pointerleave', () => { this.onMouseLeave(); }, { signal: this.signal });
        } else {
            overlayCanvas.addEventListener('mousedown', (e: MouseEvent) => { this.onMouseDown(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mousemove', (e: MouseEvent) => { this.onMouseMove(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mouseup', (e: MouseEvent) => { this.onMouseUp(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mouseleave', () => { this.onMouseLeave(); }, { signal: this.signal });
            this._wireTouchHandlers(this.signal);
        }
        overlayCanvas.addEventListener('contextmenu', (e: MouseEvent) => { this.onContextMenu(e); }, { signal: this.signal });
        overlayCanvas.addEventListener('dblclick', (e: MouseEvent) => { this.onDoubleClick(e); }, { signal: this.signal });
        overlayCanvas.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const zoomFactor = Math.pow(2, -e.deltaY / 3000);
            this.applyInteractiveZoom(this.camZoom * zoomFactor);
        }, { passive: false, signal: this.signal });

        this.infoDiv = document.createElement('div');
        this.infoDiv.className = 'shapeeditor-canvas-label shapeeditor-info-div';
        this.wrapper.appendChild(this.infoDiv);

        this.placeholderDiv = document.createElement('div');
        this.placeholderDiv.className = 'shapeeditor-placeholder';
        this.placeholderDiv.textContent = 'Upload a screenmap file to begin';
        this.wrapper.appendChild(this.placeholderDiv);

        // ── Hint strip (lives inside #main, outside the renderer wrapper so
        // it sits above the canvas and is part of the tool's DOM) ──
        this.hintStripTextEl = this.container.querySelector<HTMLElement>('#hint_strip_text');
        this.hintStripHelpBtn = this.container.querySelector<HTMLButtonElement>('#hint_strip_help');
        if (this.hintStripHelpBtn) {
            this.hintStripHelpBtn.addEventListener('click', () => {
                void this._openHelpOverlay();
            }, { signal: this.signal });
        }
        this._updateHintStrip();

        this.buildGrid(width, height);
    };

ShapeEditor.prototype._currentHintState = function (this: ShapeEditor) {

        const selStripIdx = this.selection.getStripIdx();
        const strips = this.stripStore.getStrips();
        let selectedStripName = null;
        if (selStripIdx !== null && selStripIdx >= 0 && selStripIdx < strips.length) {
            selectedStripName = this.nn(strips[selStripIdx]).name;
        }
        let pointEditStripName = '';
        if (this.pointEditStripIdx !== null && this.pointEditStripIdx >= 0 && this.pointEditStripIdx < strips.length) {
            pointEditStripName = this.nn(strips[this.pointEditStripIdx]).name;
        }
        return {
            empty: !this.stripInfo || this.stripInfo.strips.length === 0
                || (this.stripInfo.strips.length === 1 && (this.stripInfo.strips[0]?.count ?? 0) <= 1
                    && this.stripInfo.totalCount <= 1),
            placing: !!this.placingState,
            placingLabel: this.placingState?.entry.label ?? '',
            pasting: !!this.pasteState,
            pastingCount: this.pasteState ? this.pasteState.strips.length : 0,
            pointEditMode: this.pointEditStripIdx !== null,
            pointEditStripName,
            selectedStripName,
            chainMode: this.editorMode === 'chain',
            reorderMode: this.editorMode === 'reorder',
        };
    };

ShapeEditor.prototype._updateHintStrip = function (this: ShapeEditor) {

        if (!this.hintStripTextEl) return;
        this.hintStripTextEl.textContent = hintTextFor(this._currentHintState());
    };
