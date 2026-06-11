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
} from 'three';
import { parse_screenmap_data, centerAndFitPoints, download_text_as_file, parseScreenmapMultiStrip, getStripColors, stripStartEndLabels } from '../common.js';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop.js';
import { saveScreenmap, saveScreenmapPoints, getScreenmap } from '../screenmap-store.js';
import { createCircleTexture, buildPointsMesh } from '../three-utils.js';
import templateHtml from './template.html?raw';
export { default as css } from './shapeeditor.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    // Make the container a flex column so #main fills the remaining viewport
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100vh';
    container.style.overflow = 'hidden';

    const mainEl = container.querySelector('#main');
    mainEl.style.flex = '1';
    mainEl.style.minHeight = '0';
    mainEl.style.overflow = 'hidden';
    mainEl.style.position = 'relative';

    const dom_btn_new = container.querySelector("#btn_new");
    const dom_btn_upload_screenmap = container.querySelector("#btn_upload_screenmap");
    const dom_sel_preset = container.querySelector("#sel_preset");
    const dom_txt_scale = container.querySelector("#txt_scale");
    const dom_txt_scale_x = container.querySelector("#txt_scale_x");
    const dom_txt_scale_y = container.querySelector("#txt_scale_y");
    const dom_txt_rotate = container.querySelector("#txt_rotate");
    const dom_txt_translate_x = container.querySelector("#txt_translate_x");
    const dom_txt_translate_y = container.querySelector("#txt_translate_y");
    const dom_txt_diameter = container.querySelector("#txt_diameter");
    const dom_btn_save = container.querySelector("#btn_save_as");
    const dom_btn_reset = container.querySelector("#btn_reset");
    const dom_btn_undo = container.querySelector("#btn_undo");
    const dom_btn_redo = container.querySelector("#btn_redo");
    const dom_bg_accordion = container.querySelector("#bg_image_accordion");
    const dom_btn_upload_image = container.querySelector("#btn_upload_image");
    const dom_txt_image_opacity = container.querySelector("#txt_image_opacity");
    const dom_txt_image_scale = container.querySelector("#txt_image_scale");
    const dom_txt_image_rotate = container.querySelector("#txt_image_rotate");
    const dom_txt_image_tx = container.querySelector("#txt_image_tx");
    const dom_txt_image_ty = container.querySelector("#txt_image_ty");
    const dom_btn_remove_image = container.querySelector("#btn_remove_image");

    const ac = new AbortController();
    const { signal } = ac;

    // ── Dirty tracking (enable Save As only when something changed) ─────

    function markDirty() {
        dom_btn_save.disabled = false;
        dom_btn_reset.disabled = false;
    }

    function clearDirty() {
        dom_btn_save.disabled = true;
        dom_btn_reset.disabled = true;
    }

    // Wire all transform controls to mark dirty (save button + geometry rebuild)
    function markDirtyAndGeometry() { markDirty(); setNeedsGeometryUpdate(); }
    for (const el of [dom_txt_scale, dom_txt_scale_x, dom_txt_scale_y,
        dom_txt_rotate, dom_txt_translate_x, dom_txt_translate_y, dom_txt_diameter]) {
        el.addEventListener('input', markDirtyAndGeometry, { signal });
    }

    // ── Reset ───────────────────────────────────────────────────────────────

    function resetTransforms() {
        writeScale(dom_txt_scale, 1);
        writeScale(dom_txt_scale_x, 1);
        writeScale(dom_txt_scale_y, 1);
        setRotate(0);
        setTranslate(0, 0);
        dom_txt_diameter.value = origDiameter;
        committedTransform.scale = 1;
        committedTransform.scaleX = 1;
        committedTransform.scaleY = 1;
        committedTransform.rotate = 0;
        committedTransform.translateX = 0;
        committedTransform.translateY = 0;
        clearDirty();
        setNeedsGeometryUpdate();
    }

    dom_btn_reset.addEventListener('click', resetTransforms, { signal });

    // ── Save As ────────────────────────────────────────────────────────────

    function saveAs() {
        if (rawPts.length === 0) return;

        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);
        // Translation is in world-pixel space; convert to cm for export
        const txCm = (parseFloat(dom_txt_translate_x.value) || 0) / fitScale;
        const tyCm = (parseFloat(dom_txt_translate_y.value) || 0) / fitScale;
        const fallbackDiameter = parseFloat(dom_txt_diameter.value) || 0.25;

        const transformPoint = ([x, y]) => {
            const rx = x * sX;
            const ry = y * sY;
            return [
                +(rx * cosR - ry * sinR + txCm).toFixed(4),
                +(rx * sinR + ry * cosR + tyCm).toFixed(4),
            ];
        };

        const map = {};
        if (stripInfo && stripInfo.strips.length > 1
            && stripInfo.totalCount === rawPts.length) {
            // Preserve multi-strip structure on save
            for (const strip of stripInfo.strips) {
                const xArr = [];
                const yArr = [];
                for (let i = strip.offset; i < strip.offset + strip.count; i++) {
                    const [tx, ty] = transformPoint(rawPts[i]);
                    xArr.push(tx);
                    yArr.push(ty);
                }
                const entry = { x: xArr, y: yArr };
                const d = typeof strip.diameter === 'number' ? strip.diameter : fallbackDiameter;
                if (typeof d === 'number') entry.diameter = d;
                map[strip.name] = entry;
            }
        } else {
            const xArr = [];
            const yArr = [];
            for (const pt of rawPts) {
                const [tx, ty] = transformPoint(pt);
                xArr.push(tx);
                yArr.push(ty);
            }
            map.strip1 = { x: xArr, y: yArr, diameter: fallbackDiameter };
        }

        const json = JSON.stringify({ map }, null, 2);

        saveScreenmap(json);
        download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
        clearDirty();
    }

    dom_btn_save.addEventListener('click', saveAs, { signal });

    // ── Quadratic slider mapping ─────────────────────────────────────────

    const SCALE_MIN = 0.1;
    const SCALE_MAX = 10;

    function clampScale(v) {
        v = parseFloat(v);
        if (isNaN(v)) return 1;
        const abs = Math.abs(v);
        const sign = v < 0 ? -1 : 1;
        return sign * Math.max(SCALE_MIN, Math.min(SCALE_MAX, abs));
    }

    function writeScale(txt, val) {
        txt.value = clampScale(val).toFixed(2);
    }

    dom_txt_scale.addEventListener('change', () => writeScale(dom_txt_scale, dom_txt_scale.value), { signal });
    dom_txt_scale_x.addEventListener('change', () => writeScale(dom_txt_scale_x, dom_txt_scale_x.value), { signal });
    dom_txt_scale_y.addEventListener('change', () => writeScale(dom_txt_scale_y, dom_txt_scale_y.value), { signal });

    // ── Rotate ───────────────────────────────────────────────────────────────

    function clampRotate(v) {
        v = parseInt(v);
        return isNaN(v) ? 0 : Math.max(-180, Math.min(180, v));
    }

    function setRotate(rawVal) {
        dom_txt_rotate.value = clampRotate(rawVal);
    }

    dom_txt_rotate.addEventListener('change', () => setRotate(dom_txt_rotate.value), { signal });

    // ── Translate ─────────────────────────────────────────────────────────────

    function clampTranslate(v) {
        v = parseFloat(v);
        return isNaN(v) ? 0 : Math.max(-500, Math.min(500, Math.round(v)));
    }

    function setTranslate(x, y) {
        dom_txt_translate_x.value = clampTranslate(x);
        dom_txt_translate_y.value = clampTranslate(y);
    }

    dom_txt_translate_x.addEventListener('change', () => {
        dom_txt_translate_x.value = clampTranslate(dom_txt_translate_x.value);
    }, { signal });
    dom_txt_translate_y.addEventListener('change', () => {
        dom_txt_translate_y.value = clampTranslate(dom_txt_translate_y.value);
    }, { signal });

    // ── Transform undo on input release ──────────────────────────────────
    function wireTransformUndo(controlName, ...elements) {
        for (const el of elements) {
            el.addEventListener('change', () => {
                const newVal = getTransformValue(controlName);
                const oldVal = committedTransform[controlName];
                if (oldVal !== newVal) {
                    pushUndo({ type: 'transform', control: controlName, oldValue: oldVal, newValue: newVal });
                    committedTransform[controlName] = newVal;
                }
            }, { signal });
        }
    }

    wireTransformUndo('scale', dom_txt_scale);
    wireTransformUndo('scaleX', dom_txt_scale_x);
    wireTransformUndo('scaleY', dom_txt_scale_y);
    wireTransformUndo('rotate', dom_txt_rotate);
    wireTransformUndo('translateX', dom_txt_translate_x);
    wireTransformUndo('translateY', dom_txt_translate_y);

    // ── Screenmap state ──────────────────────────────────────────────────────

    let screenmap_pts = [];
    let rawPts = [];
    let origWidth = 0, origHeight = 0;
    let fitScale = 1; // cm-to-pixel scale from centerAndFitPoints
    let origDiameter = 0.5;
    let stripInfo = null; // multi-strip parse result (null until screenmap loaded)

    // Test/debug hook: expose strip state and computed Start/End labels so
    // E2E tests can assert on canvas-drawn labels that have no DOM presence.
    window.__shapeeditorDebug = {
        getStripCount: () => (stripInfo ? stripInfo.strips.length : 0),
        getStripLabels: () => (stripInfo
            ? stripInfo.strips.map((s, i) => stripStartEndLabels(s, i))
            : null),
    };

    /** Convert an HSL color string like "hsl(120, 80%, 60%)" to [r, g, b] floats 0-1. */
    function hslStringToRgb(hslStr) {
        const m = hslStr.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
        if (!m) return [1, 1, 1];
        const h = parseFloat(m[1]) / 360;
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        if (s === 0) return [l, l, l];
        const hue2rgb = (p, q, t) => {
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
    }

    // Cached canvas dimensions — kept in sync with renderer/camera/overlay.
    // Always use these instead of reading mainEl dimensions directly.
    let canvasW = 0, canvasH = 0;

    // Three.js objects
    let renderer, scene, camera;
    let wrapper;
    let pointsMesh, pointsGeometry, pointsMaterial;
    const circleTexture = createCircleTexture(64);

    // Grid line objects
    let gridLines;
    // Background image
    let bgImageMesh = null;
    let bgImageTexture = null;
    // Screenmap outline
    let screenmapOutline;

    // DOM-based labels
    let infoDiv, placeholderDiv;

    // Overlay state
    let overlayCanvas, overlayCtx;
    let tooltipLedIdx = -1;
    let tooltip;
    let lastTransformedPts = [];
    let isHovering = false;
    let overlayAlpha = 1; // 0..1 for rainbow fade (1 = visible by default)
    let ptsBBox = null;   // oriented bounding box { cx, cy, hw, hh, cos, sin } in canvas space

    // ── Dirty flags (skip work when nothing changed) ─────────────────────
    let geometryDirty = true;  // transforms/points changed → rebuild buffers
    let frameDirty = true;     // anything visual changed → redraw overlay + render
    let lastBuiltPointCount = -1; // track point count for in-place vs full rebuild
    let pointsColorAttr = null;   // cached ref to color attribute

    function setNeedsGeometryUpdate() { geometryDirty = true; frameDirty = true; }
    function setNeedsRender() { frameDirty = true; }

    // ── Editing state ─────────────────────────────────────────────────────
    let selectedIdx = -1;
    let isDragging = false;
    let dragStartCanvasX = 0, dragStartCanvasY = 0;
    let dragStartScreenmapPt = null, dragStartRawPt = null;
    let ctxMenu, ctxMenuIdx = -1;
    let ctxBtnSave, ctxBtnLoadScreenmap, ctxLoadSubmenu;
    let ctxLoadImageInput;
    let ctxFileOps, ctxFileOpsSep;
    let ctxBtnDelete, ctxBtnInsertBetween, ctxBtnInsertFwd, ctxBtnInsertBack;
    let highlightedEdgeIdx = -1; // edge index highlighted for "insert between"
    let loadedPresets = []; // populated by manifest fetch

    const ctxBtnStyle =
        'display:block;width:100%;padding:8px 16px;background:none;border:none;' +
        'color:#eee;font:14px/1.4 "Outfit",system-ui,sans-serif;text-align:left;cursor:pointer;';
    function makeCtxBtn(label, action, parent) {
        const container = parent || ctxMenu;
        const btn = document.createElement('button');
        btn.dataset.action = action;
        btn.textContent = label;
        btn.style.cssText = ctxBtnStyle;
        btn.addEventListener('mouseenter', () => { btn.style.background = '#3b82f6'; btn.style.color = '#fff'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; btn.style.color = '#eee'; });
        container.appendChild(btn);
        return btn;
    }
    function makeCtxSeparator() {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:#444;margin:4px 0;';
        ctxMenu.appendChild(sep);
        return sep;
    }

    // ── Camera pan/zoom state (view-only, not an edit) ───────────────────
    let camPanX = 0, camPanY = 0;
    let camZoom = 1;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let panStartCamX = 0, panStartCamY = 0;
    let rightButtonDown = false;
    let rightClickMoved = false;
    let zoomStartY = 0;
    let zoomStartLevel = 1;

    // ── Gizmo interaction state ────────────────────────────────────────
    let gizmoActive = null;    // null | handle id string
    let gizmoHover = null;     // null | handle id string
    let gizmoDragStart = null; // snapshot of transform values at drag start
    let shiftHeld = false;     // for rotation snapping

    // ── Image gizmo state ─────────────────────────────────────────────
    let bgImageFitW = 0, bgImageFitH = 0;
    let bgImageBBox = null;
    let bgGizmoActive = null;
    let bgGizmoHover = null;
    let bgGizmoDragStart = null;

    // ── Transform committed values (for undo tracking) ─────────────────
    const committedTransform = { scale: 1, scaleX: 1, scaleY: 1, rotate: 0, translateX: 0, translateY: 0 };

    function getTransformValue(control) {
        switch (control) {
            case 'scale': return parseFloat(dom_txt_scale.value) || 1;
            case 'scaleX': return parseFloat(dom_txt_scale_x.value) || 1;
            case 'scaleY': return parseFloat(dom_txt_scale_y.value) || 1;
            case 'rotate': return parseInt(dom_txt_rotate.value) || 0;
            case 'translateX': return parseInt(dom_txt_translate_x.value) || 0;
            case 'translateY': return parseInt(dom_txt_translate_y.value) || 0;
        }
    }

    function setTransformValue(control, value) {
        switch (control) {
            case 'scale': writeScale(dom_txt_scale, value); break;
            case 'scaleX': writeScale(dom_txt_scale_x, value); break;
            case 'scaleY': writeScale(dom_txt_scale_y, value); break;
            case 'rotate': setRotate(value); break;
            case 'translateX': setTranslate(value, parseInt(dom_txt_translate_y.value) || 0); break;
            case 'translateY': setTranslate(parseInt(dom_txt_translate_x.value) || 0, value); break;
        }
    }

    // ── Undo / Redo ───────────────────────────────────────────────────────
    const undoStack = [];
    const redoStack = [];

    function pushUndo(action) {
        undoStack.push(action);
        redoStack.length = 0;
        updateUndoRedoButtons();
        markDirty();
    }

    function applyAction(action) {
        if (action.type === 'move') {
            screenmap_pts[action.idx] = [...action.newScreenmapPt];
            rawPts[action.idx] = [...action.newRawPt];
        } else if (action.type === 'delete') {
            screenmap_pts.splice(action.idx, 1);
            rawPts.splice(action.idx, 1);
            _stripInfoOnDelete(action.idx);
            if (selectedIdx === action.idx) selectedIdx = -1;
            else if (selectedIdx > action.idx) selectedIdx--;
        } else if (action.type === 'insert') {
            screenmap_pts.splice(action.idx, 0, [...action.screenmapPt]);
            rawPts.splice(action.idx, 0, [...action.rawPt]);
            _stripInfoOnInsert(action.idx);
            selectedIdx = action.idx;
        } else if (action.type === 'transform') {
            setTransformValue(action.control, action.newValue);
            committedTransform[action.control] = action.newValue;
        }
    }

    function applyInverse(action) {
        if (action.type === 'move') {
            screenmap_pts[action.idx] = [...action.oldScreenmapPt];
            rawPts[action.idx] = [...action.oldRawPt];
        } else if (action.type === 'delete') {
            screenmap_pts.splice(action.idx, 0, action.screenmapPt);
            rawPts.splice(action.idx, 0, action.rawPt);
            // Restore stripInfo from snapshot taken before delete
            _restoreStripInfo(action.stripSnapshot);
            selectedIdx = action.idx;
        } else if (action.type === 'insert') {
            screenmap_pts.splice(action.idx, 1);
            rawPts.splice(action.idx, 1);
            // Restore stripInfo from snapshot taken before insert
            _restoreStripInfo(action.stripSnapshot);
            if (selectedIdx === action.idx) selectedIdx = -1;
            else if (selectedIdx > action.idx) selectedIdx--;
        } else if (action.type === 'transform') {
            setTransformValue(action.control, action.oldValue);
            committedTransform[action.control] = action.oldValue;
        }
    }

    function performUndo() {
        if (undoStack.length === 0) return;
        const action = undoStack.pop();
        applyInverse(action);
        redoStack.push(action);
        updateUndoRedoButtons();
        setNeedsGeometryUpdate();
        if (undoStack.length === 0) {
            clearDirty();
        } else {
            markDirty();
        }
    }

    function performRedo() {
        if (redoStack.length === 0) return;
        const action = redoStack.pop();
        applyAction(action);
        undoStack.push(action);
        updateUndoRedoButtons();
        setNeedsGeometryUpdate();
        markDirty();
    }

    function updateUndoRedoButtons() {
        dom_btn_undo.disabled = undoStack.length === 0;
        dom_btn_redo.disabled = redoStack.length === 0;
        dom_btn_reset.disabled = undoStack.length === 0 && redoStack.length === 0;
    }

    // ── Multi-strip metadata sync helpers ────────────────────────────────
    // Keep stripInfo.strips[].count/.offset/.totalCount in sync with edits.
    // Returns a snapshot suitable for restoration via _restoreStripInfo().
    function _snapshotStripInfo() {
        if (!stripInfo) return null;
        return {
            strips: stripInfo.strips.map(s => ({ ...s, points: undefined })),
            totalCount: stripInfo.totalCount,
        };
    }
    function _restoreStripInfo(snap) {
        if (!stripInfo || !snap) return;
        for (let i = 0; i < snap.strips.length && i < stripInfo.strips.length; i++) {
            stripInfo.strips[i].offset = snap.strips[i].offset;
            stripInfo.strips[i].count = snap.strips[i].count;
        }
        stripInfo.totalCount = snap.totalCount;
    }
    /** Find the strip index that owns the given flat point index. */
    function _findStripForIndex(idx) {
        if (!stripInfo) return -1;
        for (let s = 0; s < stripInfo.strips.length; s++) {
            const st = stripInfo.strips[s];
            if (idx >= st.offset && idx < st.offset + st.count) return s;
        }
        return -1;
    }
    function _stripInfoOnDelete(idx) {
        if (!stripInfo) return;
        const s = _findStripForIndex(idx);
        if (s < 0) return;
        stripInfo.strips[s].count--;
        for (let k = s + 1; k < stripInfo.strips.length; k++) {
            stripInfo.strips[k].offset--;
        }
        stripInfo.totalCount--;
    }
    function _stripInfoOnInsert(idx) {
        if (!stripInfo || stripInfo.strips.length === 0) return;
        // Insertion at idx places the new point at flat index idx.
        // Pick the strip whose range will contain idx after insertion.
        // If idx is exactly at a strip boundary (== strip.offset for s>0), we
        // assign it to the previous strip (extends the strip you inserted "after").
        let s = -1;
        for (let k = 0; k < stripInfo.strips.length; k++) {
            const st = stripInfo.strips[k];
            if (idx >= st.offset && idx <= st.offset + st.count) { s = k; break; }
        }
        if (s < 0) s = stripInfo.strips.length - 1; // append → last strip
        stripInfo.strips[s].count++;
        for (let k = s + 1; k < stripInfo.strips.length; k++) {
            stripInfo.strips[k].offset++;
        }
        stripInfo.totalCount++;
    }

    function deletePoint(idx) {
        if (idx < 0 || idx >= screenmap_pts.length) return;
        pushUndo({
            type: 'delete',
            idx,
            screenmapPt: [...screenmap_pts[idx]],
            rawPt: [...rawPts[idx]],
            stripSnapshot: _snapshotStripInfo(),
        });
        screenmap_pts.splice(idx, 1);
        rawPts.splice(idx, 1);
        _stripInfoOnDelete(idx);
        if (selectedIdx === idx) selectedIdx = -1;
        else if (selectedIdx > idx) selectedIdx--;
        setNeedsGeometryUpdate();
    }

    function insertPointAt(insertIdx, screenmapPt, rawPt) {
        pushUndo({
            type: 'insert',
            idx: insertIdx,
            screenmapPt: [...screenmapPt],
            rawPt: [...rawPt],
            stripSnapshot: _snapshotStripInfo(),
        });
        screenmap_pts.splice(insertIdx, 0, screenmapPt);
        rawPts.splice(insertIdx, 0, rawPt);
        _stripInfoOnInsert(insertIdx);
        selectedIdx = insertIdx;
        setNeedsGeometryUpdate();
    }

    function insertBetween(edgeIdx) {
        if (edgeIdx < 0 || edgeIdx >= screenmap_pts.length - 1) return;
        const a = edgeIdx, b = edgeIdx + 1;
        const newScreenmap = [
            (screenmap_pts[a][0] + screenmap_pts[b][0]) / 2,
            (screenmap_pts[a][1] + screenmap_pts[b][1]) / 2,
        ];
        const newRaw = [
            (rawPts[a][0] + rawPts[b][0]) / 2,
            (rawPts[a][1] + rawPts[b][1]) / 2,
        ];
        insertPointAt(a + 1, newScreenmap, newRaw);
    }

    function insertShiftForward() {
        const N = screenmap_pts.length;
        if (N < 2) return;
        const dx = screenmap_pts[N - 1][0] - screenmap_pts[N - 2][0];
        const dy = screenmap_pts[N - 1][1] - screenmap_pts[N - 2][1];
        const newScreenmap = [screenmap_pts[N - 1][0] + dx, screenmap_pts[N - 1][1] + dy];
        const rdx = rawPts[N - 1][0] - rawPts[N - 2][0];
        const rdy = rawPts[N - 1][1] - rawPts[N - 2][1];
        const newRaw = [rawPts[N - 1][0] + rdx, rawPts[N - 1][1] + rdy];
        insertPointAt(N, newScreenmap, newRaw);
    }

    function insertShiftBack() {
        const N = screenmap_pts.length;
        if (N < 2) return;
        const dx = screenmap_pts[0][0] - screenmap_pts[1][0];
        const dy = screenmap_pts[0][1] - screenmap_pts[1][1];
        const newScreenmap = [screenmap_pts[0][0] + dx, screenmap_pts[0][1] + dy];
        const rdx = rawPts[0][0] - rawPts[1][0];
        const rdy = rawPts[0][1] - rawPts[1][1];
        const newRaw = [rawPts[0][0] + rdx, rawPts[0][1] + rdy];
        insertPointAt(0, newScreenmap, newRaw);
    }

    function canvasToScreenmapCoords(canvasX, canvasY) {
        const { sX, sY, cosR, sinR, tx, ty } = getCurrentTransform();
        const wx = (canvasX - canvasW / 2) / camZoom - camPanX;
        const wy = (canvasY - canvasH / 2) / camZoom - camPanY;
        const dx = wx - tx, dy = wy - ty;
        return [(dx * cosR + dy * sinR) / sX, (-dx * sinR + dy * cosR) / sY];
    }

    function screenmapToRawCoords(sx, sy) {
        return [
            rawPts[0][0] + (sx - screenmap_pts[0][0]) / fitScale,
            rawPts[0][1] + (sy - screenmap_pts[0][1]) / fitScale,
        ];
    }

    function findNearestEdge(canvasX, canvasY) {
        if (lastTransformedPts.length < 2) return null;
        let bestDist = Infinity;
        let bestIdx = -1;
        let bestT = 0;

        for (let i = 0; i < lastTransformedPts.length - 1; i++) {
            const [ax, ay] = toCanvasCoords(lastTransformedPts[i][0], lastTransformedPts[i][1]);
            const [bx, by] = toCanvasCoords(lastTransformedPts[i + 1][0], lastTransformedPts[i + 1][1]);

            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? ((canvasX - ax) * dx + (canvasY - ay) * dy) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));

            const px = ax + t * dx, py = ay + t * dy;
            const distSq = (canvasX - px) * (canvasX - px) + (canvasY - py) * (canvasY - py);

            if (distSq < bestDist) {
                bestDist = distSq;
                bestIdx = i;
                bestT = t;
            }
        }

        return { idx: bestIdx, t: bestT, distSq: bestDist };
    }

    function clearEditingState() {
        selectedIdx = -1;
        isDragging = false;
        isPanning = false;
        rightButtonDown = false;
        rightClickMoved = false;
        gizmoActive = null;
        gizmoHover = null;
        gizmoDragStart = null;
        camPanX = 0;
        camPanY = 0;
        camZoom = 1;
        committedTransform.scale = 1;
        committedTransform.scaleX = 1;
        committedTransform.scaleY = 1;
        committedTransform.rotate = 0;
        committedTransform.translateX = 0;
        committedTransform.translateY = 0;
        undoStack.length = 0;
        redoStack.length = 0;
        updateUndoRedoButtons();
        hideContextMenu();
        lastBuiltPointCount = -1; // force full rebuild on next load
        setNeedsGeometryUpdate();
    }

    function showContextMenu(clientX, clientY, idx, edgeIdx, insideBBox) {
        ctxMenuIdx = idx;
        const onPointOrEdge = idx >= 0 || edgeIdx >= 0;
        // File ops: hide when on a point or edge
        ctxFileOps.style.display = onPointOrEdge ? 'none' : '';
        ctxFileOpsSep.style.display = onPointOrEdge ? 'none' : '';
        // Save enabled when dirty
        const canSave = !dom_btn_save.disabled;
        ctxBtnSave.disabled = !canSave;
        ctxBtnSave.style.opacity = canSave ? '1' : '0.4';
        // Show delete only when a point is targeted
        ctxBtnDelete.style.display = idx >= 0 ? 'block' : 'none';
        // Show insert-between only when an edge is targeted
        ctxBtnInsertBetween.style.display = edgeIdx >= 0 ? 'block' : 'none';
        // Shift insert: only when on a point/edge or inside the bbox
        const showShiftInsert = onPointOrEdge || insideBBox;
        const canInsert = screenmap_pts.length >= 2;
        ctxBtnInsertFwd.style.display = showShiftInsert ? 'block' : 'none';
        ctxBtnInsertFwd.disabled = !canInsert;
        ctxBtnInsertFwd.style.opacity = canInsert ? '1' : '0.4';
        ctxBtnInsertBack.style.display = showShiftInsert ? 'block' : 'none';
        ctxBtnInsertBack.disabled = !canInsert;
        ctxBtnInsertBack.style.opacity = canInsert ? '1' : '0.4';
        // Position — keep on screen
        ctxMenu.style.left = clientX + 'px';
        ctxMenu.style.top = clientY + 'px';
        ctxMenu.style.display = '';
    }

    function hideContextMenu() {
        if (ctxMenu) ctxMenu.style.display = 'none';
        if (ctxLoadSubmenu) ctxLoadSubmenu.style.display = 'none';
        ctxMenuIdx = -1;
        if (highlightedEdgeIdx >= 0) {
            highlightedEdgeIdx = -1;
            setNeedsRender();
        }
    }

    dom_btn_undo.addEventListener('click', performUndo, { signal });
    dom_btn_redo.addEventListener('click', performRedo, { signal });

    let rafId = null;

    function getCanvasSize() {
        return {
            width: mainEl.clientWidth || Math.floor(window.innerWidth),
            height: mainEl.clientHeight || Math.floor(window.innerHeight * 0.6),
        };
    }

    // Reference size for fitting screenmap points — keeps them at the same
    // pixel size as before even though the canvas is now much larger.
    function getFitSize() {
        return {
            width: Math.floor(window.innerWidth * 0.45),
            height: Math.floor(window.innerHeight * 0.4),
        };
    }

    // ── Transform helpers for inverse mapping ─────────────────────────────

    function getCurrentTransform() {
        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const tx = parseFloat(dom_txt_translate_x.value) || 0;
        const ty = parseFloat(dom_txt_translate_y.value) || 0;
        return { sX, sY, cosR: Math.cos(rotateRad), sinR: Math.sin(rotateRad), tx, ty };
    }

    function canvasDeltaToScreenmapDelta(dx, dy) {
        const { sX, sY, cosR, sinR } = getCurrentTransform();
        // Account for camera zoom, then inverse rotation and inverse scale
        const wdx = dx / camZoom;
        const wdy = dy / camZoom;
        const urx = wdx * cosR + wdy * sinR;
        const ury = -wdx * sinR + wdy * cosR;
        return [urx / sX, ury / sY];
    }

    function getCanvasCoords(e) {
        const rect = overlayCanvas.getBoundingClientRect();
        return [
            (e.clientX - rect.left) * (canvasW / rect.width),
            (e.clientY - rect.top) * (canvasH / rect.height),
        ];
    }

    function initRenderer() {
        const { width, height } = getCanvasSize();
        canvasW = width;
        canvasH = height;

        renderer = new WebGLRenderer({ antialias: false });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x121212, 1);

        scene = new Scene();

        const hw = width / 2, hh = height / 2;
        camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        camera.position.z = 1;

        wrapper = document.createElement('div');
        wrapper.style.position = 'absolute';
        wrapper.style.inset = '0';
        mainEl.appendChild(wrapper);

        renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
        wrapper.appendChild(renderer.domElement);

        // Overlay canvas for rainbow lines, arrows, and labels (always visible)
        overlayCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        overlayCanvas.width = width * dpr;
        overlayCanvas.height = height * dpr;
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        wrapper.appendChild(overlayCanvas);
        overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx.scale(dpr, dpr);

        // LED index tooltip
        tooltip = document.createElement('div');
        tooltip.style.cssText =
            'position:absolute;pointer-events:none;' +
            'background:rgba(0,0,0,0.85);color:#fff;' +
            'padding:4px 8px;border-radius:4px;font:12px monospace;white-space:nowrap;' +
            'opacity:0;transition:opacity 0.15s;';
        wrapper.appendChild(tooltip);

        // Right-click context menu (inline styles — lives on document.body, outside tool CSS scope)
        ctxMenu = document.createElement('div');
        ctxMenu.style.cssText =
            'position:fixed;display:none;z-index:9999;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:6px;' +
            'padding:6px 0;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:240px;';

        // ── File operations (wrapped for show/hide) ──
        ctxFileOps = document.createElement('div');
        ctxMenu.appendChild(ctxFileOps);
        makeCtxBtn('New', 'new', ctxFileOps);
        ctxBtnSave = makeCtxBtn('Save As\u2026', 'save', ctxFileOps);

        // Load Screenmap with submenu
        const ctxLoadWrapper = document.createElement('div');
        ctxLoadWrapper.style.cssText = 'position:relative;';
        ctxFileOps.appendChild(ctxLoadWrapper);
        ctxBtnLoadScreenmap = document.createElement('button');
        ctxBtnLoadScreenmap.textContent = 'Load Screenmap \u25B8';
        ctxBtnLoadScreenmap.style.cssText = ctxBtnStyle;
        ctxLoadWrapper.appendChild(ctxBtnLoadScreenmap);

        ctxLoadSubmenu = document.createElement('div');
        ctxLoadSubmenu.style.cssText =
            'position:absolute;left:100%;top:0;display:none;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:6px;' +
            'padding:6px 0;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:220px;white-space:nowrap;';
        ctxLoadWrapper.appendChild(ctxLoadSubmenu);

        // "Upload file…" always first in submenu
        makeCtxBtn('Upload file\u2026', 'upload-screenmap', ctxLoadSubmenu);

        ctxLoadWrapper.addEventListener('mouseenter', () => {
            ctxBtnLoadScreenmap.style.background = '#3b82f6';
            ctxBtnLoadScreenmap.style.color = '#fff';
            ctxLoadSubmenu.style.display = '';
        });
        ctxLoadWrapper.addEventListener('mouseleave', () => {
            ctxBtnLoadScreenmap.style.background = 'none';
            ctxBtnLoadScreenmap.style.color = '#eee';
            ctxLoadSubmenu.style.display = 'none';
        });

        // Load Image (triggers file picker)
        makeCtxBtn('Load Background Image\u2026', 'load-image', ctxFileOps);
        ctxLoadImageInput = document.createElement('input');
        ctxLoadImageInput.type = 'file';
        ctxLoadImageInput.accept = 'image/*';
        ctxLoadImageInput.style.display = 'none';
        ctxFileOps.appendChild(ctxLoadImageInput);

        ctxFileOpsSep = makeCtxSeparator();

        // ── Point operations ──
        ctxBtnDelete = makeCtxBtn('Delete Point', 'delete');
        ctxBtnInsertBetween = makeCtxBtn('Insert between', 'insert-between');
        ctxBtnInsertFwd = makeCtxBtn('Insert, shift forward', 'insert-forward');
        ctxBtnInsertBack = makeCtxBtn('Insert, shift back', 'insert-back');
        document.body.appendChild(ctxMenu);

        // Hidden file input for "Upload file…" submenu item
        const ctxUploadInput = document.createElement('input');
        ctxUploadInput.type = 'file';
        ctxUploadInput.accept = '.json';
        ctxUploadInput.style.display = 'none';
        document.body.appendChild(ctxUploadInput);
        ctxUploadInput.addEventListener('change', () => {
            if (ctxUploadInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => load_screenmap_data(ev.target.result);
                reader.readAsText(ctxUploadInput.files[0]);
            }
            ctxUploadInput.value = '';
        }, { signal });

        ctxLoadImageInput.addEventListener('change', () => {
            if (ctxLoadImageInput.files[0]) loadBackgroundImage(ctxLoadImageInput.files[0]);
            ctxLoadImageInput.value = '';
        }, { signal });

        ctxMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'new') {
                dom_btn_new.click();
            } else if (action === 'save') {
                saveAs();
            } else if (action === 'upload-screenmap') {
                ctxUploadInput.click();
            } else if (action && action.startsWith('load-preset:')) {
                const file = action.slice('load-preset:'.length);
                fetch(`/screenmaps/${file}`).then(r => r.text()).then(load_screenmap_data)
                    .catch(err => console.log('Failed to load preset:', err));
            } else if (action === 'load-image') {
                ctxLoadImageInput.click();
            } else if (action === 'delete' && ctxMenuIdx >= 0) {
                deletePoint(ctxMenuIdx);
            } else if (action === 'insert-between' && highlightedEdgeIdx >= 0) {
                insertBetween(highlightedEdgeIdx);
            } else if (action === 'insert-forward') {
                insertShiftForward();
            } else if (action === 'insert-back') {
                insertShiftBack();
            }
            hideContextMenu();
        }, { signal });

        // Dismiss on any click outside
        window.addEventListener('mousedown', (e) => {
            if (ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) {
                hideContextMenu();
            }
        }, { signal });

        // ── Mouse interaction ─────────────────────────────────────────────

        overlayCanvas.addEventListener('mousedown', onMouseDown, { signal });
        overlayCanvas.addEventListener('mousemove', onMouseMove, { signal });
        overlayCanvas.addEventListener('mouseup', onMouseUp, { signal });
        overlayCanvas.addEventListener('mouseleave', onMouseLeave, { signal });
        overlayCanvas.addEventListener('contextmenu', onContextMenu, { signal });
        overlayCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = Math.pow(2, -e.deltaY / 3000);
            camZoom = Math.max(0.1, Math.min(10, camZoom * zoomFactor));
            setNeedsRender();
        }, { passive: false, signal });

        overlayCanvas.addEventListener('touchmove', (e) => {
            if (e.touches.length) onMouseMove(e.touches[0]);
        }, { passive: true, signal });
        overlayCanvas.addEventListener('touchend', onMouseLeave, { passive: true, signal });
        overlayCanvas.addEventListener('touchcancel', onMouseLeave, { passive: true, signal });

        const labelStyle = 'position:absolute;pointer-events:none;color:#fff;font:bold 13px/1 "Outfit",system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 3px #000;';

        infoDiv = document.createElement('div');
        infoDiv.style.cssText = labelStyle + 'bottom:10px;left:10px;font-size:14px;line-height:1.6;';
        wrapper.appendChild(infoDiv);

        placeholderDiv = document.createElement('div');
        placeholderDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;color:#fff;font:24px sans-serif;';
        placeholderDiv.textContent = 'Upload a screenmap file to begin';
        wrapper.appendChild(placeholderDiv);

        buildGrid(width, height);
    }

    function buildGrid(width, height) {
        if (gridLines) {
            scene.remove(gridLines);
            gridLines.geometry.dispose();
            gridLines.material.dispose();
        }

        const extent = Math.max(width, height) * 5; // Large enough for pan/zoom
        const gridSize = 50;
        const vertices = [];

        for (let x = -extent; x <= extent; x += gridSize) {
            vertices.push(x, -extent, 0, x, extent, 0);
        }
        for (let y = -extent; y <= extent; y += gridSize) {
            vertices.push(-extent, y, 0, extent, y, 0);
        }

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        gridLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x323232, transparent: true }));
        scene.add(gridLines);
    }

    function center_and_fit(pts, canvasW, canvasH) {
        return centerAndFitPoints(pts, canvasW, canvasH, { margin: 0.95, center: 'origin' });
    }

    function load_screenmap_data(text) {
        clearEditingState();

        screenmap_pts = parse_screenmap_data(text);
        if (screenmap_pts.length === 0) return;
        saveScreenmap(text);

        // Parse multi-strip metadata for color-coded visualization
        try {
            stripInfo = parseScreenmapMultiStrip(text);
        } catch {
            stripInfo = null;
        }

        // Populate diameter from file if available
        if (typeof screenmap_pts.diameter === "number" && screenmap_pts.diameter > 0) {
            origDiameter = screenmap_pts.diameter;
        } else {
            origDiameter = 0.5;
        }
        dom_txt_diameter.value = origDiameter;

        rawPts = screenmap_pts.map(([x, y]) => [x, y]);

        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        screenmap_pts.forEach(([x, y]) => {
            xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
            ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        });
        origWidth = xmax - xmin;
        origHeight = ymax - ymin;

        // Use the smaller reference size so the screenmap stays the same pixel
        // size regardless of how large the canvas is (leaves room for pan/zoom).
        const { width: fitW, height: fitH } = getFitSize();
        const availW = 0.95 * fitW;
        const availH = 0.95 * fitH;
        fitScale = Math.min(
            origWidth > 0 ? availW / origWidth : availW,
            origHeight > 0 ? availH / origHeight : availH,
        );
        screenmap_pts = center_and_fit(screenmap_pts, fitW, fitH);
        positionRulerAboveBBox();
    }

    dom_btn_new.addEventListener('click', () => {
        clearEditingState();
        dom_sel_preset.value = '';
        screenmap_pts = [[0, 0]];
        rawPts = [[0, 0]];
        stripInfo = null;
        origDiameter = 0.5;
        dom_txt_diameter.value = origDiameter;
        origWidth = 0;
        origHeight = 0;
        fitScale = 1;
        resetTransforms();
        setNeedsGeometryUpdate();
        saveScreenmapPoints([[0, 0]], 0.5);
    }, { signal });

    function loadScreenmapFile(file) {
        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            alert('Please choose a .json screenmap file.');
            return;
        }
        dom_sel_preset.value = '';
        file.text().then(load_screenmap_data).catch((error) => {
            alert(`Error reading screenmap file: ${error}`);
        });
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        loadScreenmapFile(dom_btn_upload_screenmap.files[0]);
    }, { signal });

    wireFileDropTarget({
        target: container.querySelector('#screenmap_drop_target'),
        input: dom_btn_upload_screenmap,
        onFile: loadScreenmapFile,
        signal,
    });

    wireFileDropTarget({
        target: container.querySelector('#image_drop_target'),
        input: dom_btn_upload_image,
        onFile: (file) => {
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                alert('Please drop an image file.');
                return;
            }
            loadBackgroundImage(file);
        },
        signal,
    });

    dom_sel_preset.addEventListener('change', async () => {
        const file = dom_sel_preset.value;
        if (!file) return;
        try {
            const resp = await fetch(`/screenmaps/${file}`);
            const text = await resp.text();
            load_screenmap_data(text);
        } catch (e) {
            console.log("Failed to load preset:", e);
        }
    }, { signal });

    async function loadPresetsFromManifest() {
        try {
            const resp = await fetch('/screenmaps/manifest.json');
            const manifest = await resp.json();
            loadedPresets = manifest.presets || [];
            dom_sel_preset.innerHTML = '<option value="">-- Select preset --</option>';
            for (const preset of loadedPresets) {
                const opt = document.createElement('option');
                opt.value = preset.file;
                opt.textContent = preset.name;
                dom_sel_preset.appendChild(opt);
                // Also add to context menu submenu
                makeCtxBtn(preset.name, `load-preset:${preset.file}`, ctxLoadSubmenu);
            }
            // Restore stored screenmap, or fall back to first preset
            const storedScreenmap = getScreenmap();
            if (storedScreenmap) {
                load_screenmap_data(storedScreenmap);
            } else if (loadedPresets.length > 0) {
                dom_sel_preset.value = loadedPresets[0].file;
                dom_sel_preset.dispatchEvent(new Event('change'));
            }
        } catch (e) {
            console.log("Failed to load preset manifest:", e);
            dom_sel_preset.innerHTML = '<option value="">No presets available</option>';
        }
    }

    // ── Background image ───────────────────────────────────────────────

    let bgImageObjectURL = null;
    const bgImageControls = [dom_txt_image_opacity, dom_txt_image_scale,
        dom_txt_image_rotate, dom_txt_image_tx, dom_txt_image_ty,
        dom_btn_remove_image];

    function setBgControlsEnabled(enabled) {
        for (const el of bgImageControls) el.disabled = !enabled;
    }

    function resetBgControls() {
        dom_txt_image_opacity.value = 50;
        dom_txt_image_scale.value = '1.00';
        dom_txt_image_rotate.value = '0.00';
        dom_txt_image_tx.value = '0';
        dom_txt_image_ty.value = '0';
    }

    function applyBgImageTransform() {
        if (!bgImageMesh) return;
        const s = parseFloat(dom_txt_image_scale.value) || 1;
        const deg = parseFloat(dom_txt_image_rotate.value) || 0;
        const tx = parseFloat(dom_txt_image_tx.value) || 0;
        const ty = parseFloat(dom_txt_image_ty.value) || 0;
        bgImageMesh.scale.set(s, -s, 1); // negative y for y-down camera
        bgImageMesh.rotation.z = deg * Math.PI / 180;
        bgImageMesh.position.set(tx, ty, 0);
        setNeedsRender();
    }

    function clearBackgroundImage() {
        if (bgImageMesh) {
            scene.remove(bgImageMesh);
            bgImageMesh.geometry.dispose();
            bgImageMesh.material.dispose();
            bgImageMesh = null;
        }
        if (bgImageTexture) {
            bgImageTexture.dispose();
            bgImageTexture = null;
        }
        if (bgImageObjectURL) {
            URL.revokeObjectURL(bgImageObjectURL);
            bgImageObjectURL = null;
        }
        setBgControlsEnabled(false);
        bgImageFitW = 0;
        bgImageFitH = 0;
        bgImageBBox = null;
        bgGizmoActive = null;
        bgGizmoHover = null;
        bgGizmoDragStart = null;
    }

    function removeBackgroundImage() {
        clearBackgroundImage();
        resetBgControls();
        dom_btn_upload_image.value = '';
        dom_bg_accordion.removeAttribute('open');
        setNeedsRender();
    }

    let deleteBgConfirmEl = null;
    function showDeleteBgConfirm() {
        if (deleteBgConfirmEl) return; // already showing
        deleteBgConfirmEl = document.createElement('div');
        deleteBgConfirmEl.style.cssText =
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:8px;' +
            'padding:16px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;' +
            'font:14px/1.4 "Outfit",system-ui,sans-serif;color:#eee;';
        deleteBgConfirmEl.innerHTML =
            '<div style="margin-bottom:12px">Delete background image?</div>' +
            '<button data-bg-del="yes" style="padding:6px 16px;margin:0 6px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font:inherit">Delete</button>' +
            '<button data-bg-del="no" style="padding:6px 16px;margin:0 6px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>';
        deleteBgConfirmEl.addEventListener('click', (e) => {
            const val = e.target.dataset.bgDel;
            if (val === 'yes') removeBackgroundImage();
            if (val) dismissDeleteBgConfirm();
        });
        wrapper.appendChild(deleteBgConfirmEl);
    }
    function dismissDeleteBgConfirm() {
        if (deleteBgConfirmEl) {
            deleteBgConfirmEl.remove();
            deleteBgConfirmEl = null;
        }
    }

    function loadBackgroundImage(file) {
        clearBackgroundImage();
        resetBgControls();

        bgImageObjectURL = URL.createObjectURL(file);
        const loader = new TextureLoader();
        loader.load(bgImageObjectURL, (texture) => {
            bgImageTexture = texture;
            bgImageTexture.colorSpace = SRGBColorSpace;

            const img = texture.image;
            // Size to fill the canvas, maintaining aspect ratio
            const aspect = img.width / img.height;
            const canvasAspect = canvasW / canvasH;
            let fitW, fitH;
            if (aspect > canvasAspect) {
                fitW = canvasW;
                fitH = canvasW / aspect;
            } else {
                fitH = canvasH;
                fitW = canvasH * aspect;
            }

            bgImageFitW = fitW;
            bgImageFitH = fitH;

            const geometry = new PlaneGeometry(fitW, fitH);
            const material = new MeshBasicMaterial({
                map: bgImageTexture,
                transparent: true,
                opacity: (parseFloat(dom_txt_image_opacity.value) || 50) / 100,
                depthWrite: false,
                depthTest: false,
                side: DoubleSide,
            });

            bgImageMesh = new Mesh(geometry, material);
            bgImageMesh.renderOrder = 1;
            bgImageMesh.scale.y = -1;
            scene.add(bgImageMesh);

            setBgControlsEnabled(true);
            dom_bg_accordion.setAttribute('open', '');
        });
    }

    // ── Background image event listeners ─────────────────────────────

    dom_btn_upload_image.addEventListener('change', () => {
        const file = dom_btn_upload_image.files[0];
        if (file) loadBackgroundImage(file);
    }, { signal });

    dom_txt_image_opacity.addEventListener('input', () => {
        const val = Math.max(0, Math.min(100, parseFloat(dom_txt_image_opacity.value) || 50));
        if (bgImageMesh) { bgImageMesh.material.opacity = val / 100; setNeedsRender(); }
    }, { signal });
    dom_txt_image_opacity.addEventListener('change', () => {
        dom_txt_image_opacity.value = Math.max(0, Math.min(100, Math.round(parseFloat(dom_txt_image_opacity.value) || 50)));
        if (bgImageMesh) { bgImageMesh.material.opacity = parseFloat(dom_txt_image_opacity.value) / 100; setNeedsRender(); }
    }, { signal });

    dom_txt_image_scale.addEventListener('input', () => {
        applyBgImageTransform();
    }, { signal });
    dom_txt_image_scale.addEventListener('change', () => {
        const v = Math.max(0.1, Math.min(5, parseFloat(dom_txt_image_scale.value) || 1));
        dom_txt_image_scale.value = v.toFixed(2);
        applyBgImageTransform();
    }, { signal });

    dom_txt_image_rotate.addEventListener('input', () => {
        applyBgImageTransform();
    }, { signal });
    dom_txt_image_rotate.addEventListener('change', () => {
        const v = Math.max(-180, Math.min(180, parseFloat(dom_txt_image_rotate.value) || 0));
        dom_txt_image_rotate.value = v.toFixed(2);
        applyBgImageTransform();
    }, { signal });

    dom_txt_image_tx.addEventListener('input', () => {
        applyBgImageTransform();
    }, { signal });
    dom_txt_image_tx.addEventListener('change', () => {
        dom_txt_image_tx.value = parseInt(dom_txt_image_tx.value) || 0;
        applyBgImageTransform();
    }, { signal });

    dom_txt_image_ty.addEventListener('input', () => {
        applyBgImageTransform();
    }, { signal });
    dom_txt_image_ty.addEventListener('change', () => {
        dom_txt_image_ty.value = parseInt(dom_txt_image_ty.value) || 0;
        applyBgImageTransform();
    }, { signal });

    dom_btn_remove_image.addEventListener('click', removeBackgroundImage, { signal });

    // --- Overlay drawing for LED connection visualization ---
    function toCanvasCoords(x, y) {
        return [
            (x + camPanX) * camZoom + canvasW / 2,
            (y + camPanY) * camZoom + canvasH / 2,
        ];
    }

    // ── Floating cm ruler ──────────────────────────────────────────────────
    // Two endpoints in world-space (pixels, same coordinate system as screenmap_pts).
    // The ruler is always visible — drag either handle to reposition/expand.
    const rulerA = { x: -80, y: -80 };  // left handle  (world px)
    const rulerB = { x: 80, y: -80 };   // right handle (world px)
    let rulerDrag = null;              // null | 'a' | 'b' | 'body'
    let rulerDragStart = null;
    const RULER_HANDLE_R = 7;          // hit radius in canvas px

    /** Reposition ruler to sit 5% above the screenmap bounding box. */
    function positionRulerAboveBBox() {
        if (screenmap_pts.length === 0) return;
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of screenmap_pts) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const bboxH = ymax - ymin;
        const gap = bboxH * 0.10;
        rulerA.x = xmin;
        rulerA.y = ymin - gap;
        rulerB.x = xmax;
        rulerB.y = ymin - gap;
    }

    function hitTestRuler(cx, cy) {
        const [ax, ay] = toCanvasCoords(rulerA.x, rulerA.y);
        const [bx, by] = toCanvasCoords(rulerB.x, rulerB.y);
        const r = RULER_HANDLE_R + 4;
        if (Math.hypot(cx - ax, cy - ay) <= r) return 'a';
        if (Math.hypot(cx - bx, cy - by) <= r) return 'b';
        // Body hit: anywhere inside the ruler band (bandHalf=10 + small margin)
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq > 0) {
            const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
            const px = ax + t * dx, py = ay + t * dy;
            if (Math.hypot(cx - px, cy - py) <= 14) return 'body';
        }
        return null;
    }

    function drawRuler() {
        if (!overlayCtx || fitScale <= 0) return;
        const ctx = overlayCtx;
        const pxPerCm = fitScale * camZoom;
        const [ax, ay] = toCanvasCoords(rulerA.x, rulerA.y);
        const [bx, by] = toCanvasCoords(rulerB.x, rulerB.y);
        const dx = bx - ax, dy = by - ay;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) return;
        const lenCm = lenPx / pxPerCm;

        // Unit vector along ruler
        const ux = dx / lenPx, uy = dy / lenPx;
        // Normal (perpendicular, pointing "up" relative to the ruler direction)
        const nx = -uy, ny = ux;

        ctx.save();

        // ── Ruler body (dark band) ──
        const bandHalf = 10; // half-height of the ruler band
        ctx.beginPath();
        ctx.moveTo(ax + nx * bandHalf, ay + ny * bandHalf);
        ctx.lineTo(bx + nx * bandHalf, by + ny * bandHalf);
        ctx.lineTo(bx - nx * bandHalf, by - ny * bandHalf);
        ctx.lineTo(ax - nx * bandHalf, ay - ny * bandHalf);
        ctx.closePath();
        ctx.fillStyle = 'rgba(20, 20, 20, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Tick marks ──
        const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        let stepCm = 1;
        for (const s of niceSteps) {
            if (s * pxPerCm >= 8) { stepCm = s; break; }
        }
        const majorEvery = stepCm < 1 ? Math.round(1 / stepCm) : (stepCm < 10 ? Math.round(10 / stepCm) : 1);
        const nTicks = Math.floor(lenCm / stepCm);

        for (let i = 0; i <= nTicks; i++) {
            const d = i * stepCm * pxPerCm; // distance in px from A
            const tx = ax + ux * d;
            const ty = ay + uy * d;
            const isMajor = (i % majorEvery === 0);
            const tickLen = isMajor ? 8 : 4;

            ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
            ctx.lineWidth = isMajor ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(tx - nx * bandHalf, ty - ny * bandHalf);
            ctx.lineTo(tx - nx * (bandHalf - tickLen), ty - ny * (bandHalf - tickLen));
            ctx.stroke();
            // Mirror tick on the other side
            ctx.beginPath();
            ctx.moveTo(tx + nx * bandHalf, ty + ny * bandHalf);
            ctx.lineTo(tx + nx * (bandHalf - tickLen), ty + ny * (bandHalf - tickLen));
            ctx.stroke();

            // Labels on major ticks (above the ruler)
            if (isMajor && i > 0) {
                const cm = i * stepCm;
                const label = Number.isInteger(cm) ? cm.toString() : cm.toFixed(1);
                ctx.save();
                ctx.translate(tx + nx * (bandHalf + 10), ty + ny * (bandHalf + 10));
                ctx.rotate(Math.atan2(dy, dx));
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }

        // ── Total length label (centered, below ruler) ──
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.save();
        ctx.translate(mx - nx * (bandHalf + 12), my - ny * (bandHalf + 12));
        const angle = Math.atan2(dy, dx);
        // Flip text if ruler is angled so text would be upside-down
        const flipText = angle > Math.PI / 2 || angle < -Math.PI / 2;
        ctx.rotate(flipText ? angle + Math.PI : angle);
        ctx.font = 'bold 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lenCm.toFixed(2) + ' cm', 0, 0);
        ctx.restore();

        // ── Handle circles ──
        for (const [hx, hy] of [[ax, ay], [bx, by]]) {
            ctx.beginPath();
            ctx.arc(hx, hy, RULER_HANDLE_R, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(59,130,246,0.85)';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // "0" label at A handle
        ctx.save();
        ctx.translate(ax + nx * (bandHalf + 10), ay + ny * (bandHalf + 10));
        ctx.rotate(Math.atan2(dy, dx));
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0', 0, 0);
        ctx.restore();

        ctx.restore();
    }

    function drawOverlay() {
        if (!overlayCtx) return;
        overlayCtx.clearRect(0, 0, canvasW, canvasH);

        // Lerp overlayAlpha: 1 = rainbow visible (default), 0 = faded out (hovering inside bbox)
        const target = isHovering ? 0 : 1;
        const speed = 1 / (0.2 * 60); // step per frame for 0.2s
        if (overlayAlpha < target) overlayAlpha = Math.min(target, overlayAlpha + speed);
        else if (overlayAlpha > target) overlayAlpha = Math.max(target, overlayAlpha - speed);

        // Compute background image bounding box
        if (bgImageMesh && bgImageFitW > 0) {
            const s = parseFloat(dom_txt_image_scale.value) || 1;
            const deg = parseFloat(dom_txt_image_rotate.value) || 0;
            const rad = deg * Math.PI / 180;
            const bgCos = Math.cos(rad);
            const bgSin = Math.sin(rad);
            const imgTx = parseFloat(dom_txt_image_tx.value) || 0;
            const imgTy = parseFloat(dom_txt_image_ty.value) || 0;
            const [bgCx, bgCy] = toCanvasCoords(imgTx, imgTy);
            const bgHw = bgImageFitW / 2 * s * camZoom;
            const bgHh = bgImageFitH / 2 * s * camZoom;
            bgImageBBox = { cx: bgCx, cy: bgCy, hw: bgHw, hh: bgHh, cos: bgCos, sin: bgSin };
        } else {
            bgImageBBox = null;
        }

        if (lastTransformedPts.length === 0) { ptsBBox = null; drawBgGizmoHandles(); drawRuler(); return; }

        const pts = lastTransformedPts.map(([x, y]) => toCanvasCoords(x, y));

        // Compute an oriented bounding box (OBB) that stays fixed as rotation changes.
        // We find the bbox of the *scaled-only* points (before rotation), then rotate
        // that rectangle so it tracks the content without growing/shrinking.
        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const scaleX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal;
        const scaleY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const bboxCos = Math.cos(rotateRad);
        const bboxSin = Math.sin(rotateRad);
        const tx = parseFloat(dom_txt_translate_x.value) || 0;
        const ty = parseFloat(dom_txt_translate_y.value) || 0;

        // Bbox of scaled-only points (no rotation, no translation)
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const [x, y] of screenmap_pts) {
            const sx = x * scaleX;
            const sy = y * scaleY;
            if (sx < bx1) bx1 = sx;
            if (sy < by1) by1 = sy;
            if (sx > bx2) bx2 = sx;
            if (sy > by2) by2 = sy;
        }
        const pad = 20 / camZoom; // pad in world space
        bx1 -= pad; by1 -= pad; bx2 += pad; by2 += pad;

        // Center of the unrotated bbox in world space, then rotate + translate
        const wcx = (bx1 + bx2) / 2;
        const wcy = (by1 + by2) / 2;
        const rwcx = wcx * bboxCos - wcy * bboxSin + tx;
        const rwcy = wcx * bboxSin + wcy * bboxCos + ty;

        // Half-extents in world space, scaled to canvas pixels
        const hw = (bx2 - bx1) / 2 * camZoom;
        const hh = (by2 - by1) / 2 * camZoom;

        // Center in canvas coords
        const [ccx, ccy] = toCanvasCoords(rwcx, rwcy);

        ptsBBox = { cx: ccx, cy: ccy, hw, hh, cos: bboxCos, sin: bboxSin };

        // Draw oriented bounding box outline
        if (gizmoHover === 'translate' || gizmoActive === 'translate') {
            overlayCtx.globalAlpha = gizmoActive === 'translate' ? 0.8 : 0.5;
            overlayCtx.strokeStyle = '#3b82f6';
        } else {
            overlayCtx.globalAlpha = 0.3;
            overlayCtx.strokeStyle = '#888';
        }
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([6, 4]);
        overlayCtx.save();
        overlayCtx.translate(ccx, ccy);
        overlayCtx.rotate(rotateRad);
        overlayCtx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        overlayCtx.restore();
        overlayCtx.setLineDash([]);

        // Draw gizmo handles (scale, rotate, translate affordances)
        drawGizmoHandles();

        // Rainbow lines and arrows fade with hover
        if (overlayAlpha > 0) {
            overlayCtx.globalAlpha = overlayAlpha;
            overlayCtx.lineWidth = 2;
            const hasMultiStrip = stripInfo && stripInfo.strips.length > 1;
            const stripColors = hasMultiStrip ? getStripColors(stripInfo.strips.length) : null;
            // Build a set of boundary indices (last point of each non-empty strip) to skip
            // cross-strip lines, plus a precomputed index→strip lookup table.
            const stripBoundaries = new Set();
            let idxToStrip = null;
            if (hasMultiStrip) {
                for (const strip of stripInfo.strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                idxToStrip = new Int32Array(pts.length).fill(-1);
                for (let s = 0; s < stripInfo.strips.length; s++) {
                    const st = stripInfo.strips[s];
                    const lo = Math.max(0, st.offset);
                    const hi = Math.min(pts.length, st.offset + st.count);
                    for (let i = lo; i < hi; i++) idxToStrip[i] = s;
                }
            }
            for (let i = 0; i < pts.length - 1; i++) {
                // Skip line between last point of one strip and first point of the next
                if (hasMultiStrip && stripBoundaries.has(i)) continue;

                const [x1, y1] = pts[i];
                const [x2, y2] = pts[i + 1];
                if (hasMultiStrip) {
                    const stripIdx = idxToStrip[i] >= 0 ? idxToStrip[i] : 0;
                    overlayCtx.strokeStyle = stripColors[stripIdx];
                } else {
                    const hue = (120 + i * 2) % 360;
                    overlayCtx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
                }
                overlayCtx.beginPath();
                overlayCtx.moveTo(x1, y1);
                overlayCtx.lineTo(x2, y2);
                overlayCtx.stroke();

                if (i % 5 === 1 || i === pts.length - 2) {
                    const dx = x2 - x1, dy = y2 - y1;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 2) {
                        const angle = Math.atan2(dy, dx);
                        const t = 0.5;
                        const ax = x1 + dx * t, ay = y1 + dy * t;
                        const arrowLen = 12;
                        const arrowHalf = 0.45;
                        overlayCtx.fillStyle = overlayCtx.strokeStyle;
                        overlayCtx.beginPath();
                        overlayCtx.moveTo(ax, ay);
                        overlayCtx.lineTo(ax - arrowLen * Math.cos(angle - arrowHalf), ay - arrowLen * Math.sin(angle - arrowHalf));
                        overlayCtx.lineTo(ax - arrowLen * Math.cos(angle + arrowHalf), ay - arrowLen * Math.sin(angle + arrowHalf));
                        overlayCtx.closePath();
                        overlayCtx.fill();
                    }
                }
            }
            for (let i = 2; i < pts.length - 1; i++) {
                fillCircle(pts[i][0], pts[i][1], 4, 'rgba(255,255,255,0.5)');
            }
        }

        // Highlighted edge for "insert between"
        if (highlightedEdgeIdx >= 0 && highlightedEdgeIdx < pts.length - 1) {
            overlayCtx.globalAlpha = 1;
            overlayCtx.strokeStyle = '#00ffff';
            overlayCtx.lineWidth = 4;
            overlayCtx.beginPath();
            overlayCtx.moveTo(pts[highlightedEdgeIdx][0], pts[highlightedEdgeIdx][1]);
            overlayCtx.lineTo(pts[highlightedEdgeIdx + 1][0], pts[highlightedEdgeIdx + 1][1]);
            overlayCtx.stroke();
            // Midpoint marker
            const mx = (pts[highlightedEdgeIdx][0] + pts[highlightedEdgeIdx + 1][0]) / 2;
            const my = (pts[highlightedEdgeIdx][1] + pts[highlightedEdgeIdx + 1][1]) / 2;
            overlayCtx.fillStyle = '#00ffff';
            overlayCtx.beginPath();
            overlayCtx.arc(mx, my, 5, 0, Math.PI * 2);
            overlayCtx.fill();
        }

        // Start and end LEDs always visible (per strip when multi-strip)
        overlayCtx.globalAlpha = 1;
        const hasMultiStripLabels = stripInfo && stripInfo.strips.length > 1;
        if (hasMultiStripLabels) {
            for (let s = 0; s < stripInfo.strips.length; s++) {
                const st = stripInfo.strips[s];
                if (st.count <= 0) continue;
                const startIdx = st.offset;
                const endIdx = st.offset + st.count - 1;
                if (startIdx < 0 || endIdx >= pts.length) continue;
                const labels = stripStartEndLabels(st, s);
                fillCircle(pts[startIdx][0], pts[startIdx][1], 8, 'rgba(0,255,0,1)');
                drawOutlinedLabel(labels.start, pts[startIdx][0] + 4, pts[startIdx][1]);
                if (labels.end !== null) {
                    fillCircle(pts[endIdx][0], pts[endIdx][1], 8, 'rgba(255,0,0,1)');
                    drawOutlinedLabel(labels.end, pts[endIdx][0] + 4, pts[endIdx][1]);
                }
            }
        } else {
            fillCircle(pts[0][0], pts[0][1], 8, 'rgba(0,255,0,1)');
            if (pts.length > 1) fillCircle(pts[1][0], pts[1][1], 6, 'rgba(0,255,0,0.5)');
            const singleStrip = (stripInfo && stripInfo.strips.length === 1)
                ? { name: stripInfo.strips[0].name, count: pts.length }
                : { name: '', count: pts.length };
            const labels = stripStartEndLabels(singleStrip, 0);
            drawOutlinedLabel(labels.start, pts[0][0] + 4, pts[0][1]);
            if (labels.end !== null) {
                fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 8, 'rgba(255,0,0,1)');
                drawOutlinedLabel(labels.end, pts[pts.length - 1][0] + 4, pts[pts.length - 1][1]);
            }
        }

        // Selection indicator
        if (selectedIdx >= 0 && selectedIdx < pts.length) {
            const [sx, sy] = pts[selectedIdx];
            overlayCtx.globalAlpha = 1;
            overlayCtx.strokeStyle = '#00ffff';
            overlayCtx.lineWidth = 2;
            overlayCtx.beginPath();
            overlayCtx.arc(sx, sy, 10, 0, Math.PI * 2);
            overlayCtx.stroke();
            // Pulsing inner glow
            overlayCtx.strokeStyle = 'rgba(0,255,255,0.4)';
            overlayCtx.lineWidth = 4;
            overlayCtx.beginPath();
            overlayCtx.arc(sx, sy, 14, 0, Math.PI * 2);
            overlayCtx.stroke();
        }

        drawBgGizmoHandles();
        drawRuler();
    }

    function fillCircle(x, y, diameter, color) {
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, diameter / 2, 0, Math.PI * 2);
        overlayCtx.fill();
    }

    function drawOutlinedLabel(text, x, y) {
        overlayCtx.font = 'bold 13px "Outfit", system-ui, sans-serif';
        overlayCtx.textBaseline = 'middle';
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeStyle = 'rgba(0,0,0,0.9)';
        overlayCtx.lineJoin = 'round';
        overlayCtx.strokeText(text, x, y);
        overlayCtx.fillStyle = '#fff';
        overlayCtx.fillText(text, x, y);
    }

    // ── Gizmo: geometry, hit-testing, drawing ─────────────────────────

    // Rotate a local-space point (relative to bbox center) into canvas space
    function obbToCanvas(bbox, lx, ly) {
        const { cx, cy, cos, sin } = bbox;
        return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    }

    function computeGizmoHandles(bbox) {
        if (!bbox) return null;
        let { hw, hh } = bbox;
        // Enforce minimum 60px bbox so handles don't overlap on tiny screenmaps
        const minDim = 30; // half of 60
        if (hw < minDim) hw = minDim;
        if (hh < minDim) hh = minDim;
        const rotLineLen = 30;

        return {
            hw, hh,
            corners: {
                tl: obbToCanvas(bbox, -hw, -hh),
                tr: obbToCanvas(bbox, hw, -hh),
                bl: obbToCanvas(bbox, -hw, hh),
                br: obbToCanvas(bbox, hw, hh),
            },
            edges: {
                top:    obbToCanvas(bbox, 0, -hh),
                bottom: obbToCanvas(bbox, 0, hh),
                left:   obbToCanvas(bbox, -hw, 0),
                right:  obbToCanvas(bbox, hw, 0),
            },
            rotate: obbToCanvas(bbox, 0, -hh - rotLineLen),
            center: { x: bbox.cx, y: bbox.cy },
        };
    }

    // Transform canvas coords into OBB local space (relative to bbox center, unrotated)
    function canvasToObbLocal(bbox, canvasX, canvasY) {
        if (!bbox) return [0, 0];
        const dx = canvasX - bbox.cx;
        const dy = canvasY - bbox.cy;
        // Inverse rotation
        return [dx * bbox.cos + dy * bbox.sin,
               -dx * bbox.sin + dy * bbox.cos];
    }

    function hitTestGizmo(canvasX, canvasY) {
        const handles = computeGizmoHandles(ptsBBox);
        if (!handles) return null;
        const threshold = 14;

        // Rotation handle (above bbox)
        const rh = handles.rotate;
        if (Math.abs(canvasX - rh.x) < threshold && Math.abs(canvasY - rh.y) < threshold) return 'rotate';

        // Corner handles
        for (const [key, h] of Object.entries(handles.corners)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'corner-' + key;
        }

        // Edge midpoint handles
        for (const [key, h] of Object.entries(handles.edges)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'edge-' + key;
        }

        // Inside oriented bounding box → translate (only if not on an LED)
        const [lx, ly] = canvasToObbLocal(ptsBBox, canvasX, canvasY);
        if (Math.abs(lx) <= handles.hw && Math.abs(ly) <= handles.hh) {
            if (hitTestLED(canvasX, canvasY) < 0) return 'translate';
        }

        return null;
    }

    function getCursorForGizmo(handleId) {
        if (!handleId) return 'default';
        if (handleId === 'rotate') return 'grab';
        if (handleId === 'translate') return 'move';
        if (handleId === 'edge-top' || handleId === 'edge-bottom') return 'ns-resize';
        if (handleId === 'edge-left' || handleId === 'edge-right') return 'ew-resize';
        if (handleId === 'corner-tl' || handleId === 'corner-br') return 'nwse-resize';
        if (handleId === 'corner-tr' || handleId === 'corner-bl') return 'nesw-resize';
        return 'default';
    }

    function drawGizmoHandles() {
        const handles = computeGizmoHandles(ptsBBox);
        if (!handles) return;

        // Hide handles if bbox is too small on screen (very zoomed out)
        if (handles.hw < 8 || handles.hh < 8) return;

        // Fade in as rainbow fades out (inverse of overlayAlpha)
        const gizmoAlpha = 1 - overlayAlpha;
        if (gizmoAlpha < 0.01) return;

        const rotRad = Math.atan2(ptsBBox.sin, ptsBBox.cos);

        overlayCtx.save();
        overlayCtx.globalAlpha = gizmoAlpha;

        // Draw rotation connecting line (dashed)
        const topCenter = handles.edges.top;
        overlayCtx.strokeStyle = '#3b82f6';
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([4, 3]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(topCenter.x, topCenter.y);
        overlayCtx.lineTo(handles.rotate.x, handles.rotate.y);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        // Draw rotation handle (arc with arrowhead)
        const isRotHover = gizmoHover === 'rotate' || gizmoActive === 'rotate';
        const rotColor = isRotHover ? '#60a5fa' : '#3b82f6';
        const rx = handles.rotate.x;
        const ry = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        const arcStart = -Math.PI * 1.25;
        const arcEnd = Math.PI * 0.05;

        // Arc stroke
        overlayCtx.strokeStyle = rotColor;
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.arc(rx, ry, arcR, arcStart, arcEnd);
        overlayCtx.stroke();

        // Arrowhead at arc end
        const ax = rx + arcR * Math.cos(arcEnd);
        const ay = ry + arcR * Math.sin(arcEnd);
        const tangent = arcEnd + Math.PI / 2; // tangent direction (perpendicular to radius)
        const arrowLen = 5;
        const arrowHalf = 0.55;
        overlayCtx.fillStyle = rotColor;
        overlayCtx.beginPath();
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - arrowLen * Math.cos(tangent - arrowHalf), ay - arrowLen * Math.sin(tangent - arrowHalf));
        overlayCtx.lineTo(ax - arrowLen * Math.cos(tangent + arrowHalf), ay - arrowLen * Math.sin(tangent + arrowHalf));
        overlayCtx.closePath();
        overlayCtx.fill();

        // Helper: draw a rotated rect centered at (h.x, h.y)
        function drawHandle(h, w, ht, color) {
            overlayCtx.save();
            overlayCtx.translate(h.x, h.y);
            overlayCtx.rotate(rotRad);
            overlayCtx.fillStyle = color;
            overlayCtx.fillRect(-w / 2, -ht / 2, w, ht);
            overlayCtx.strokeStyle = '#fff';
            overlayCtx.lineWidth = 1;
            overlayCtx.strokeRect(-w / 2, -ht / 2, w, ht);
            overlayCtx.restore();
        }

        // Draw corner handles (squares)
        for (const [key, h] of Object.entries(handles.corners)) {
            const id = 'corner-' + key;
            const active = gizmoHover === id || gizmoActive === id;
            const size = active ? 12 : 10;
            const color = active ? '#60a5fa' : '#3b82f6';
            drawHandle(h, size, size, color);
        }

        // Draw edge handles (oriented rectangles)
        for (const [key, h] of Object.entries(handles.edges)) {
            const id = 'edge-' + key;
            const active = gizmoHover === id || gizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            const color = active ? '#60a5fa' : '#3b82f6';
            drawHandle(h, w, ht, color);
        }

        overlayCtx.restore();
    }

    function hitTestLED(canvasX, canvasY) {
        if (lastTransformedPts.length === 0) return -1;
        const threshold = 10;
        const threshSq = threshold * threshold;
        let bestIdx = -1, bestDist = threshSq;
        for (let i = 0; i < lastTransformedPts.length; i++) {
            const [cx, cy] = toCanvasCoords(lastTransformedPts[i][0], lastTransformedPts[i][1]);
            const dx = canvasX - cx;
            const dy = canvasY - cy;
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        return bestIdx;
    }

    // ── Background image gizmo ────────────────────────────────────────

    function hitTestBgGizmo(canvasX, canvasY) {
        if (!bgImageBBox) return null;
        const handles = computeGizmoHandles(bgImageBBox);
        if (!handles) return null;
        const threshold = 14;

        const rh = handles.rotate;
        if (Math.abs(canvasX - rh.x) < threshold && Math.abs(canvasY - rh.y) < threshold) return 'rotate';

        for (const [key, h] of Object.entries(handles.corners)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'corner-' + key;
        }

        for (const [key, h] of Object.entries(handles.edges)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'edge-' + key;
        }

        const [lx, ly] = canvasToObbLocal(bgImageBBox, canvasX, canvasY);
        if (Math.abs(lx) <= handles.hw && Math.abs(ly) <= handles.hh) {
            return 'translate';
        }

        return null;
    }

    function drawBgGizmoHandles() {
        if (!bgImageBBox || !overlayCtx) return;
        const handles = computeGizmoHandles(bgImageBBox);
        if (!handles) return;
        if (handles.hw < 8 || handles.hh < 8) return;

        const rotRad = Math.atan2(bgImageBBox.sin, bgImageBBox.cos);

        overlayCtx.save();

        // Draw oriented bounding box outline
        const isTranslating = bgGizmoHover === 'translate' || bgGizmoActive === 'translate';
        if (isTranslating) {
            overlayCtx.globalAlpha = bgGizmoActive === 'translate' ? 0.8 : 0.5;
            overlayCtx.strokeStyle = '#f59e0b';
        } else {
            overlayCtx.globalAlpha = 0.3;
            overlayCtx.strokeStyle = '#888';
        }
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([6, 4]);
        overlayCtx.save();
        overlayCtx.translate(bgImageBBox.cx, bgImageBBox.cy);
        overlayCtx.rotate(rotRad);
        overlayCtx.strokeRect(-handles.hw, -handles.hh, handles.hw * 2, handles.hh * 2);
        overlayCtx.restore();
        overlayCtx.setLineDash([]);

        overlayCtx.globalAlpha = 0.7;

        // Rotation connecting line
        const topCenter = handles.edges.top;
        overlayCtx.strokeStyle = '#f59e0b';
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([4, 3]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(topCenter.x, topCenter.y);
        overlayCtx.lineTo(handles.rotate.x, handles.rotate.y);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        // Rotation handle
        const isRotHover = bgGizmoHover === 'rotate' || bgGizmoActive === 'rotate';
        const rotColor = isRotHover ? '#fbbf24' : '#f59e0b';
        const rx = handles.rotate.x, ry = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        overlayCtx.strokeStyle = rotColor;
        overlayCtx.lineWidth = 2;
        overlayCtx.beginPath();
        overlayCtx.arc(rx, ry, arcR, -Math.PI * 1.25, Math.PI * 0.05);
        overlayCtx.stroke();

        const ax = rx + arcR * Math.cos(Math.PI * 0.05);
        const ay = ry + arcR * Math.sin(Math.PI * 0.05);
        const tangent = Math.PI * 0.05 + Math.PI / 2;
        overlayCtx.fillStyle = rotColor;
        overlayCtx.beginPath();
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - 5 * Math.cos(tangent - 0.55), ay - 5 * Math.sin(tangent - 0.55));
        overlayCtx.lineTo(ax - 5 * Math.cos(tangent + 0.55), ay - 5 * Math.sin(tangent + 0.55));
        overlayCtx.closePath();
        overlayCtx.fill();

        // Corner and edge handles
        function drawHandle(h, w, ht, color) {
            overlayCtx.save();
            overlayCtx.translate(h.x, h.y);
            overlayCtx.rotate(rotRad);
            overlayCtx.fillStyle = color;
            overlayCtx.fillRect(-w / 2, -ht / 2, w, ht);
            overlayCtx.strokeStyle = '#fff';
            overlayCtx.lineWidth = 1;
            overlayCtx.strokeRect(-w / 2, -ht / 2, w, ht);
            overlayCtx.restore();
        }

        for (const [key, h] of Object.entries(handles.corners)) {
            const id = 'corner-' + key;
            const active = bgGizmoHover === id || bgGizmoActive === id;
            const size = active ? 12 : 10;
            drawHandle(h, size, size, active ? '#fbbf24' : '#f59e0b');
        }

        for (const [key, h] of Object.entries(handles.edges)) {
            const id = 'edge-' + key;
            const active = bgGizmoHover === id || bgGizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            drawHandle(h, w, ht, active ? '#fbbf24' : '#f59e0b');
        }

        overlayCtx.restore();
    }

    function handleBgGizmoDrag(cx, cy) {
        const dx = cx - bgGizmoDragStart.canvasX;
        const dy = cy - bgGizmoDragStart.canvasY;

        if (bgGizmoActive === 'translate') {
            const wdx = dx / camZoom;
            const wdy = dy / camZoom;
            const newTx = Math.round(bgGizmoDragStart.tx + wdx);
            const newTy = Math.round(bgGizmoDragStart.ty + wdy);
            dom_txt_image_tx.value = newTx;
            dom_txt_image_ty.value = newTy;
            applyBgImageTransform();
            return;
        }

        if (bgGizmoActive === 'rotate') {
            const center = bgGizmoDragStart.bboxCenter;
            const startAngle = Math.atan2(
                bgGizmoDragStart.canvasY - center.y,
                bgGizmoDragStart.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = bgGizmoDragStart.rotate + deltaDeg;
            if (shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            newRotate = Math.max(-180, Math.min(180, newRotate));
            dom_txt_image_rotate.value = newRotate.toFixed(2);
            applyBgImageTransform();
            return;
        }

        // Corner or edge: uniform scale (image has single scale)
        if (bgGizmoActive.startsWith('corner-') || bgGizmoActive.startsWith('edge-')) {
            const center = bgGizmoDragStart.bboxCenter;
            const startDist = Math.hypot(
                bgGizmoDragStart.canvasX - center.x,
                bgGizmoDragStart.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                const newScale = Math.max(0.1, Math.min(5, bgGizmoDragStart.scale * ratio));
                dom_txt_image_scale.value = newScale.toFixed(2);
                applyBgImageTransform();
            }
            return;
        }
    }

    function startBgGizmoDrag(hit, cx, cy) {
        bgGizmoActive = hit;
        const handles = computeGizmoHandles(bgImageBBox);
        bgGizmoDragStart = {
            canvasX: cx, canvasY: cy,
            scale: parseFloat(dom_txt_image_scale.value) || 1,
            rotate: parseFloat(dom_txt_image_rotate.value) || 0,
            tx: parseFloat(dom_txt_image_tx.value) || 0,
            ty: parseFloat(dom_txt_image_ty.value) || 0,
            bboxCenter: handles ? handles.center : { x: bgImageBBox.cx, y: bgImageBBox.cy },
        };
    }

    // ── Gizmo drag logic ─────────────────────────────────────────────────

    function handleGizmoDrag(cx, cy) {
        const dx = cx - gizmoDragStart.canvasX;
        const dy = cy - gizmoDragStart.canvasY;

        if (gizmoActive === 'translate') {
            const wdx = dx / camZoom;
            const wdy = dy / camZoom;
            setTranslate(gizmoDragStart.translateX + wdx, gizmoDragStart.translateY + wdy);
            markDirtyAndGeometry();
            return;
        }

        if (gizmoActive === 'rotate') {
            const center = gizmoDragStart.bboxCenter;
            const startAngle = Math.atan2(
                gizmoDragStart.canvasY - center.y,
                gizmoDragStart.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = gizmoDragStart.rotate + Math.round(deltaDeg);
            // Snap to 15-degree increments when shift held
            if (shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            setRotate(clampRotate(newRotate));
            markDirtyAndGeometry();
            return;
        }

        if (gizmoActive.startsWith('corner-')) {
            const center = gizmoDragStart.bboxCenter;
            const startDist = Math.hypot(
                gizmoDragStart.canvasX - center.x,
                gizmoDragStart.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                writeScale(dom_txt_scale, clampScale(gizmoDragStart.scale * ratio));
                markDirtyAndGeometry();
            }
            return;
        }

        if (gizmoActive.startsWith('edge-')) {
            const edge = gizmoActive.split('-')[1];
            // Project mouse positions onto OBB local axes for signed distance
            const [startLx, startLy] = canvasToObbLocal(ptsBBox, gizmoDragStart.canvasX, gizmoDragStart.canvasY);
            const [curLx, curLy] = canvasToObbLocal(ptsBBox, cx, cy);

            if (edge === 'left' || edge === 'right') {
                if (Math.abs(startLx) > 1) {
                    const ratio = curLx / startLx; // signed: crossing center negates
                    writeScale(dom_txt_scale_x, clampScale(gizmoDragStart.scaleX * ratio));
                    markDirtyAndGeometry();
                }
            } else {
                if (Math.abs(startLy) > 1) {
                    const ratio = curLy / startLy; // signed: crossing center negates
                    writeScale(dom_txt_scale_y, clampScale(gizmoDragStart.scaleY * ratio));
                    markDirtyAndGeometry();
                }
            }
            return;
        }
    }

    function commitGizmoDrag() {
        if (!gizmoDragStart) return;
        const checks = [
            ['scale', gizmoDragStart.scale, getTransformValue('scale')],
            ['scaleX', gizmoDragStart.scaleX, getTransformValue('scaleX')],
            ['scaleY', gizmoDragStart.scaleY, getTransformValue('scaleY')],
            ['rotate', gizmoDragStart.rotate, getTransformValue('rotate')],
            ['translateX', gizmoDragStart.translateX, getTransformValue('translateX')],
            ['translateY', gizmoDragStart.translateY, getTransformValue('translateY')],
        ];
        for (const [control, oldVal, newVal] of checks) {
            if (oldVal !== newVal) {
                pushUndo({ type: 'transform', control, oldValue: oldVal, newValue: newVal });
                committedTransform[control] = newVal;
            }
        }
    }

    // ── Mouse / pointer handlers ──────────────────────────────────────────

    function onContextMenu(e) {
        e.preventDefault();
        // If right-click was used for zoom dragging, skip the context menu
        const wasMoved = rightClickMoved;
        rightClickMoved = false;
        if (wasMoved) return;
        if (screenmap_pts.length === 0) return;
        const [cx, cy] = getCanvasCoords(e);
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            selectedIdx = idx;
            highlightedEdgeIdx = -1;
            setNeedsGeometryUpdate();
            showContextMenu(e.clientX, e.clientY, idx, -1);
            return;
        }
        // No point hit — check for edge hit
        const edge = findNearestEdge(cx, cy);
        if (edge && edge.distSq < 20 * 20) {
            highlightedEdgeIdx = edge.idx;
            setNeedsRender();
            showContextMenu(e.clientX, e.clientY, -1, edge.idx);
            return;
        }
        highlightedEdgeIdx = -1;
        let insideBBox = false;
        if (ptsBBox) {
            const [lx, ly] = canvasToObbLocal(ptsBBox, cx, cy);
            insideBBox = Math.abs(lx) <= ptsBBox.hw && Math.abs(ly) <= ptsBBox.hh;
        }
        showContextMenu(e.clientX, e.clientY, -1, -1, insideBBox);
    }

    function onMouseDown(e) {
        // Dismiss context menu on any click
        hideContextMenu();

        if (screenmap_pts.length === 0 && !bgImageMesh) return;

        if (e.button === 2) {
            // Right-click: start potential zoom drag
            rightButtonDown = true;
            rightClickMoved = false;
            const [, cy] = getCanvasCoords(e);
            zoomStartY = cy;
            zoomStartLevel = camZoom;
            return;
        }

        if (e.button !== 0) return;
        const [cx, cy] = getCanvasCoords(e);

        // Shift+Left-click: insert a new point between two existing points
        if (e.shiftKey && screenmap_pts.length >= 2) {
            const edge = findNearestEdge(cx, cy);
            if (edge) {
                const { idx, t } = edge;
                const newScreenmapPt = [
                    screenmap_pts[idx][0] + t * (screenmap_pts[idx + 1][0] - screenmap_pts[idx][0]),
                    screenmap_pts[idx][1] + t * (screenmap_pts[idx + 1][1] - screenmap_pts[idx][1]),
                ];
                const newRawPt = [
                    rawPts[idx][0] + t * (rawPts[idx + 1][0] - rawPts[idx][0]),
                    rawPts[idx][1] + t * (rawPts[idx + 1][1] - rawPts[idx][1]),
                ];
                insertPointAt(idx + 1, newScreenmapPt, newRawPt);
                return;
            }
        }

        // Ctrl+Left-click: extend — append a new point at the click location
        if ((e.ctrlKey || e.metaKey) && screenmap_pts.length > 0) {
            const newScreenmapPt = canvasToScreenmapCoords(cx, cy);
            const newRawPt = screenmapToRawCoords(newScreenmapPt[0], newScreenmapPt[1]);
            insertPointAt(screenmap_pts.length, newScreenmapPt, newRawPt);
            return;
        }

        // Priority 0: Ruler handle / body
        const rulerHit = hitTestRuler(cx, cy);
        if (rulerHit) {
            rulerDrag = rulerHit;
            rulerDragStart = {
                cx, cy,
                ax: rulerA.x, ay: rulerA.y,
                bx: rulerB.x, by: rulerB.y,
            };
            overlayCanvas.style.cursor = rulerHit === 'body' ? 'move' : 'grab';
            return;
        }

        // Priority 1: Gizmo handle (corner/edge/rotation)
        const gizmoHit = hitTestGizmo(cx, cy);
        if (gizmoHit && gizmoHit !== 'translate') {
            gizmoActive = gizmoHit;
            const handles = computeGizmoHandles(ptsBBox);
            gizmoDragStart = {
                canvasX: cx, canvasY: cy,
                scale: parseFloat(dom_txt_scale.value) || 1,
                scaleX: parseFloat(dom_txt_scale_x.value) || 1,
                scaleY: parseFloat(dom_txt_scale_y.value) || 1,
                rotate: parseInt(dom_txt_rotate.value) || 0,
                translateX: parseInt(dom_txt_translate_x.value) || 0,
                translateY: parseInt(dom_txt_translate_y.value) || 0,
                bboxCenter: handles.center,
            };
            overlayCanvas.style.cursor = gizmoHit === 'rotate' ? 'grabbing' : getCursorForGizmo(gizmoHit);
            return;
        }

        // Priority 2: LED point hit test
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            selectedIdx = idx;
            highlightedEdgeIdx = -1;
            setNeedsGeometryUpdate(); // color update for selection
            isDragging = true;
            dragStartCanvasX = cx;
            dragStartCanvasY = cy;
            dragStartScreenmapPt = [...screenmap_pts[idx]];
            dragStartRawPt = [...rawPts[idx]];
            overlayCanvas.style.cursor = 'grabbing';
            return;
        }

        // Priority 3: Edge selection (click near a line segment)
        if (screenmap_pts.length >= 2) {
            const edge = findNearestEdge(cx, cy);
            if (edge && edge.distSq < 20 * 20) {
                highlightedEdgeIdx = edge.idx;
                selectedIdx = -1;
                setNeedsRender();
                return;
            }
        }
        if (highlightedEdgeIdx >= 0) { highlightedEdgeIdx = -1; setNeedsRender(); }

        // Priority 4: Translate (inside bbox, no LED hit)
        if (gizmoHit === 'translate') {
            gizmoActive = 'translate';
            gizmoDragStart = {
                canvasX: cx, canvasY: cy,
                scale: parseFloat(dom_txt_scale.value) || 1,
                scaleX: parseFloat(dom_txt_scale_x.value) || 1,
                scaleY: parseFloat(dom_txt_scale_y.value) || 1,
                rotate: parseInt(dom_txt_rotate.value) || 0,
                translateX: parseInt(dom_txt_translate_x.value) || 0,
                translateY: parseInt(dom_txt_translate_y.value) || 0,
                bboxCenter: null,
            };
            overlayCanvas.style.cursor = 'move';
            return;
        }

        // Priority 4: Background image gizmo (mouse is outside screenmap bbox)
        if (bgImageMesh) {
            const bgHit = hitTestBgGizmo(cx, cy);
            if (bgHit && bgHit !== 'translate') {
                startBgGizmoDrag(bgHit, cx, cy);
                overlayCanvas.style.cursor = bgHit === 'rotate' ? 'grabbing' : getCursorForGizmo(bgHit);
                return;
            }
            if (bgHit === 'translate') {
                startBgGizmoDrag('translate', cx, cy);
                overlayCanvas.style.cursor = 'move';
                return;
            }
        }

        // Priority 5: Pan camera (outside bbox)
        if (selectedIdx >= 0) { selectedIdx = -1; setNeedsGeometryUpdate(); }
        isPanning = true;
        panStartX = cx;
        panStartY = cy;
        panStartCamX = camPanX;
        panStartCamY = camPanY;
        overlayCanvas.style.cursor = 'move';
    }

    function onMouseMove(e) {
        if (screenmap_pts.length === 0 && !bgImageMesh) return;
        const [cx, cy] = getCanvasCoords(e);

        // Track shift key for rotation snapping
        shiftHeld = e.shiftKey;

        // Right-click drag: zoom
        if (rightButtonDown) {
            const dy = cy - zoomStartY;
            if (Math.abs(dy) > 3) rightClickMoved = true;
            if (rightClickMoved) {
                camZoom = Math.max(0.1, Math.min(10, zoomStartLevel * Math.pow(2, -dy / 200)));
                overlayCanvas.style.cursor = 'ns-resize';
                setNeedsRender();
            }
            return;
        }

        // Ruler drag in progress
        if (rulerDrag) {
            const wdx = (cx - rulerDragStart.cx) / camZoom;
            const wdy = (cy - rulerDragStart.cy) / camZoom;
            if (rulerDrag === 'a') {
                rulerA.x = rulerDragStart.ax + wdx;
                rulerA.y = rulerDragStart.ay + wdy;
            } else if (rulerDrag === 'b') {
                rulerB.x = rulerDragStart.bx + wdx;
                rulerB.y = rulerDragStart.by + wdy;
            } else {
                // body — move both handles
                rulerA.x = rulerDragStart.ax + wdx;
                rulerA.y = rulerDragStart.ay + wdy;
                rulerB.x = rulerDragStart.bx + wdx;
                rulerB.y = rulerDragStart.by + wdy;
            }
            setNeedsRender();
            return;
        }

        // Gizmo drag in progress
        if (gizmoActive) {
            handleGizmoDrag(cx, cy);
            return;
        }

        // Background image gizmo drag in progress
        if (bgGizmoActive) {
            handleBgGizmoDrag(cx, cy);
            return;
        }

        // Left-click drag on empty space: pan
        if (isPanning) {
            const dx = cx - panStartX;
            const dy = cy - panStartY;
            camPanX = panStartCamX + dx / camZoom;
            camPanY = panStartCamY + dy / camZoom;
            setNeedsRender();
            return;
        }

        if (isDragging && selectedIdx >= 0) {
            // Move the point
            const dx = cx - dragStartCanvasX;
            const dy = cy - dragStartCanvasY;
            const [sdx, sdy] = canvasDeltaToScreenmapDelta(dx, dy);
            screenmap_pts[selectedIdx] = [
                dragStartScreenmapPt[0] + sdx,
                dragStartScreenmapPt[1] + sdy,
            ];
            rawPts[selectedIdx] = [
                dragStartRawPt[0] + sdx / fitScale,
                dragStartRawPt[1] + sdy / fitScale,
            ];
            setNeedsGeometryUpdate();
            return;
        }

        // Ruler hover cursor
        const rulerHoverHit = hitTestRuler(cx, cy);
        if (rulerHoverHit) {
            overlayCanvas.style.cursor = rulerHoverHit === 'body' ? 'move' : 'grab';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
            // still update gizmo/bbox hover state below so rendering stays correct
        }

        // Gizmo hover detection
        const prevGizmoHover = gizmoHover;
        gizmoHover = hitTestGizmo(cx, cy);
        if (gizmoHover !== prevGizmoHover) setNeedsRender();

        // Check if mouse is inside the points bounding box (controls rainbow fade)
        const wasHovering = isHovering;
        if (ptsBBox) {
            const [lx, ly] = canvasToObbLocal(ptsBBox, cx, cy);
            const inObb = Math.abs(lx) <= ptsBBox.hw && Math.abs(ly) <= ptsBBox.hh;
            isHovering = inObb || !!gizmoHover;
        } else {
            isHovering = false;
        }
        if (isHovering !== wasHovering) setNeedsRender();

        // Background image gizmo hover (only when not hovering screenmap gizmo)
        const prevBgGizmoHover = bgGizmoHover;
        if (!gizmoHover && bgImageMesh) {
            bgGizmoHover = hitTestBgGizmo(cx, cy);
        } else {
            bgGizmoHover = null;
        }
        if (bgGizmoHover !== prevBgGizmoHover) setNeedsRender();

        // Ruler hover takes top cursor priority
        if (rulerHoverHit) return;

        // Gizmo handle hover takes cursor priority
        if (gizmoHover && gizmoHover !== 'translate') {
            overlayCanvas.style.cursor = getCursorForGizmo(gizmoHover);
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
            return;
        }

        // Shift held: crosshair (insert between)
        // Ctrl held: copy cursor (extend/append)
        if (screenmap_pts.length > 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) {
            overlayCanvas.style.cursor = e.shiftKey ? 'crosshair' : 'copy';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
            return;
        }

        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            overlayCanvas.style.cursor = 'grab';
            if (idx !== tooltipLedIdx) {
                tooltipLedIdx = idx;
                const [ox, oy] = rawPts[idx];
                tooltip.textContent = `LED #${idx}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const tx = Math.min(cx + 14, canvasW - tooltip.offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
            tooltip.style.opacity = '1';
        } else if (gizmoHover === 'translate') {
            overlayCanvas.style.cursor = 'move';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        } else if (bgGizmoHover && bgGizmoHover !== 'translate') {
            overlayCanvas.style.cursor = getCursorForGizmo(bgGizmoHover);
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        } else if (bgGizmoHover === 'translate') {
            overlayCanvas.style.cursor = 'move';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        } else {
            overlayCanvas.style.cursor = 'default';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        }
    }

    function onMouseUp(e) {
        if (e && e.button === 2) {
            rightButtonDown = false;
            // rightClickMoved is consumed by onContextMenu
            overlayCanvas.style.cursor = 'default';
            return;
        }

        if (rulerDrag) {
            rulerDrag = null;
            rulerDragStart = null;
            overlayCanvas.style.cursor = 'default';
            return;
        }

        if (gizmoActive) {
            commitGizmoDrag();
            gizmoActive = null;
            gizmoDragStart = null;
            overlayCanvas.style.cursor = 'default';
            return;
        }

        if (bgGizmoActive) {
            bgGizmoActive = null;
            bgGizmoDragStart = null;
            overlayCanvas.style.cursor = 'default';
            return;
        }

        if (isPanning) {
            isPanning = false;
            overlayCanvas.style.cursor = 'default';
            return;
        }

        if (isDragging && selectedIdx >= 0) {
            const newScreenmapPt = [...screenmap_pts[selectedIdx]];
            const newRawPt = [...rawPts[selectedIdx]];
            // Only record undo if the point actually moved
            if (newScreenmapPt[0] !== dragStartScreenmapPt[0] ||
                newScreenmapPt[1] !== dragStartScreenmapPt[1]) {
                pushUndo({
                    type: 'move',
                    idx: selectedIdx,
                    oldScreenmapPt: dragStartScreenmapPt,
                    newScreenmapPt,
                    oldRawPt: dragStartRawPt,
                    newRawPt,
                });
            }
            isDragging = false;
            overlayCanvas.style.cursor = 'grab';
        }
    }

    function onMouseLeave() {
        if (gizmoActive) {
            commitGizmoDrag();
            gizmoActive = null;
            gizmoDragStart = null;
        }
        gizmoHover = null;
        if (bgGizmoActive) {
            bgGizmoActive = null;
            bgGizmoDragStart = null;
        }
        bgGizmoHover = null;
        if (isPanning) {
            isPanning = false;
        }
        if (rightButtonDown) {
            rightButtonDown = false;
            rightClickMoved = false;
        }
        if (isDragging && selectedIdx >= 0) {
            // Finalize drag on leave
            const newScreenmapPt = [...screenmap_pts[selectedIdx]];
            const newRawPt = [...rawPts[selectedIdx]];
            if (newScreenmapPt[0] !== dragStartScreenmapPt[0] ||
                newScreenmapPt[1] !== dragStartScreenmapPt[1]) {
                pushUndo({
                    type: 'move',
                    idx: selectedIdx,
                    oldScreenmapPt: dragStartScreenmapPt,
                    newScreenmapPt,
                    oldRawPt: dragStartRawPt,
                    newRawPt,
                });
            }
            isDragging = false;
        }
        isHovering = false;
        tooltipLedIdx = -1;
        tooltip.style.opacity = '0';
        overlayCanvas.style.cursor = 'default';
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────

    window.addEventListener('keydown', (e) => {
        // Delete selected point
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx >= 0 && !isDragging) {
            deletePoint(selectedIdx);
            e.preventDefault();
            return;
        }
        // Delete background image (when no point selected)
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx < 0 && bgImageMesh && !isDragging) {
            showDeleteBgConfirm();
            e.preventDefault();
            return;
        }
        // Undo: Ctrl+Z / Cmd+Z
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            performUndo();
            e.preventDefault();
            return;
        }
        // Redo: Ctrl+Shift+Z / Ctrl+Y
        if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
            (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
            performRedo();
            e.preventDefault();
            return;
        }
        // Escape: dismiss bg delete confirm or deselect
        if (e.key === 'Escape') {
            if (deleteBgConfirmEl) { dismissDeleteBgConfirm(); e.preventDefault(); return; }
            if (selectedIdx >= 0) { selectedIdx = -1; setNeedsGeometryUpdate(); }
        }
    }, { signal });

    function buildScreenmap(transformedPts) {
        const count = transformedPts.length;

        if (count !== lastBuiltPointCount) {
            // Point count changed — full rebuild required
            if (screenmapOutline) {
                scene.remove(screenmapOutline);
                screenmapOutline.geometry.dispose();
                screenmapOutline.material.dispose();
            }
            if (pointsMesh) {
                scene.remove(pointsMesh);
                pointsGeometry.dispose();
                pointsMaterial.dispose();
            }

            const hasMultiStrip = stripInfo && stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Build LineSegments pairs, skipping cross-strip boundaries.
                // Skip empty strips (count <= 0) so we don't introduce bogus boundaries.
                const stripColors = getStripColors(stripInfo.strips.length);
                const stripRgbs = stripColors.map(hslStringToRgb);
                const stripBoundaries = new Set();
                for (const strip of stripInfo.strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                // Per-index strip lookup table — O(N) once, instead of O(N*S) inside the loop.
                const idxToStrip = new Int32Array(count).fill(-1);
                for (let s = 0; s < stripInfo.strips.length; s++) {
                    const st = stripInfo.strips[s];
                    const lo = Math.max(0, st.offset);
                    const hi = Math.min(count, st.offset + st.count);
                    for (let i = lo; i < hi; i++) idxToStrip[i] = s;
                }
                // Count valid segments (skip boundaries)
                let segCount = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (!stripBoundaries.has(i)) segCount++;
                }
                const lineVerts = new Float32Array(segCount * 2 * 3);
                const lineColors = new Float32Array(segCount * 2 * 3);
                let seg = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (stripBoundaries.has(i)) continue;
                    const stripIdx = idxToStrip[i] >= 0 ? idxToStrip[i] : 0;
                    const [sr, sg, sb] = stripRgbs[stripIdx];
                    const v = seg * 6;
                    lineVerts[v] = transformedPts[i][0]; lineVerts[v + 1] = transformedPts[i][1]; lineVerts[v + 2] = 0;
                    lineVerts[v + 3] = transformedPts[i + 1][0]; lineVerts[v + 4] = transformedPts[i + 1][1]; lineVerts[v + 5] = 0;
                    lineColors[v] = sr; lineColors[v + 1] = sg; lineColors[v + 2] = sb;
                    lineColors[v + 3] = sr; lineColors[v + 4] = sg; lineColors[v + 5] = sb;
                    seg++;
                }
                const lineGeom = new BufferGeometry();
                lineGeom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
                lineGeom.setAttribute('color', new Float32BufferAttribute(lineColors, 3));
                screenmapOutline = new LineSegments(lineGeom, new LineBasicMaterial({ vertexColors: true, transparent: true }));
            } else {
                const lineVerts = new Float32Array(count * 3);
                for (let i = 0; i < count; i++) {
                    lineVerts[i * 3] = transformedPts[i][0];
                    lineVerts[i * 3 + 1] = transformedPts[i][1];
                    lineVerts[i * 3 + 2] = 0;
                }
                const lineGeom = new BufferGeometry();
                const linePosAttr = new Float32BufferAttribute(lineVerts, 3);
                linePosAttr.setUsage(DynamicDrawUsage);
                lineGeom.setAttribute('position', linePosAttr);
                screenmapOutline = new Line(lineGeom, new LineBasicMaterial({ color: 0x2196F3, transparent: true }));
            }
            screenmapOutline.renderOrder = 2;
            scene.add(screenmapOutline);

            const diameterCm = parseFloat(dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
            const pixelDiameter = Math.max(2, diameterCm * fitScale * scaleGlobal);

            const result = buildPointsMesh({
                points: transformedPts,
                circleTexture,
                diameter: pixelDiameter,
                defaultColor: [244 / 255, 67 / 255, 54 / 255],
            });
            result.geometry.getAttribute('position').setUsage(DynamicDrawUsage);

            pointsGeometry = result.geometry;
            pointsMaterial = result.material;
            pointsMesh = result.mesh;
            pointsColorAttr = result.colorAttribute;
            pointsMesh.renderOrder = 3;
            scene.add(pointsMesh);

            lastBuiltPointCount = count;
        } else {
            // Same point count — update buffers in place (no allocation)
            const hasMultiStrip = stripInfo && stripInfo.strips.length > 1;
            const outlinePos = screenmapOutline.geometry.getAttribute('position');
            const pointsPos = pointsGeometry.getAttribute('position');

            if (hasMultiStrip) {
                // LineSegments layout: pairs of vertices, skipping cross-strip boundaries.
                // Skip empty strips so we don't introduce bogus boundary indices.
                const stripBoundaries = new Set();
                for (const strip of stripInfo.strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                let seg = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (stripBoundaries.has(i)) continue;
                    const v = seg * 2;
                    outlinePos.setXY(v, transformedPts[i][0], transformedPts[i][1]);
                    outlinePos.setXY(v + 1, transformedPts[i + 1][0], transformedPts[i + 1][1]);
                    seg++;
                }
            } else {
                for (let i = 0; i < count; i++) {
                    outlinePos.setXY(i, transformedPts[i][0], transformedPts[i][1]);
                }
            }
            for (let i = 0; i < count; i++) {
                pointsPos.setXY(i, transformedPts[i][0], transformedPts[i][1]);
            }
            outlinePos.needsUpdate = true;
            pointsPos.needsUpdate = true;

            // Update point size
            const diameterCm = parseFloat(dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
            pointsMaterial.size = Math.max(2, diameterCm * fitScale * scaleGlobal);
        }

        // Update colors (selection highlight, first/last LED markers)
        if (pointsColorAttr) {
            const colors = pointsColorAttr.array;
            const hasMultiStrip = stripInfo && stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Per-strip coloring
                const stripColors = getStripColors(stripInfo.strips.length);
                const stripRgbs = stripColors.map(hslStringToRgb);
                for (let s = 0; s < stripInfo.strips.length; s++) {
                    const strip = stripInfo.strips[s];
                    const [sr, sg, sb] = stripRgbs[s];
                    for (let i = strip.offset; i < strip.offset + strip.count && i < count; i++) {
                        const ci = i * 3;
                        colors[ci] = sr; colors[ci + 1] = sg; colors[ci + 2] = sb;
                    }
                }
            } else {
                // Single-strip: default red
                const r = 244 / 255, g = 67 / 255, b = 54 / 255;
                for (let i = 0; i < count; i++) {
                    const ci = i * 3;
                    colors[ci] = r; colors[ci + 1] = g; colors[ci + 2] = b;
                }
            }
            // First LED green
            colors[0] = 76 / 255; colors[1] = 175 / 255; colors[2] = 80 / 255;
            // Selected LED cyan
            if (selectedIdx > 0 && selectedIdx < count) {
                const ci = selectedIdx * 3;
                colors[ci] = 0; colors[ci + 1] = 1; colors[ci + 2] = 1;
            }
            pointsColorAttr.needsUpdate = true;
        }
    }

    function updateLabels(transformedPts) {
        if (transformedPts.length === 0) {
            placeholderDiv.style.display = '';
            infoDiv.textContent = '';
            return;
        }

        placeholderDiv.style.display = 'none';

        const scaleG = parseFloat(dom_txt_scale.value) || 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleG;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleG;
        const physW = (origWidth * sX).toFixed(2);
        const physH = (origHeight * sY).toFixed(2);

        infoDiv.innerHTML =
            `Points: ${screenmap_pts.length}<br>Size: ${physW} &times; ${physH} cm` +
            `<br><span style="opacity:0.5;font-size:12px">Shift+click: insert between &nbsp; Ctrl+click: extend end</span>`;
    }

    function handleResize() {
        const { width, height } = getCanvasSize();
        canvasW = width;
        canvasH = height;
        renderer.setSize(width, height);

        const hw = width / 2, hh = height / 2;
        camera.left = -hw;
        camera.right = hw;
        camera.top = -hh;
        camera.bottom = hh;
        camera.zoom = camZoom;
        camera.updateProjectionMatrix();

        const dpr = window.devicePixelRatio || 1;
        overlayCanvas.width = width * dpr;
        overlayCanvas.height = height * dpr;
        overlayCtx.scale(dpr, dpr);

        buildGrid(width, height);
        drawOverlay();
    }

    window.addEventListener('resize', handleResize, { signal });

    function animate() {
        rafId = requestAnimationFrame(animate);

        // Auto-sync canvas/camera/overlay if mainEl dimensions changed
        const { width: curW, height: curH } = getCanvasSize();
        if (curW !== canvasW || curH !== canvasH) {
            handleResize();
            geometryDirty = true;
            frameDirty = true;
        }

        // Keep animating while overlayAlpha is mid-transition
        const targetAlpha = isHovering ? 0 : 1;
        if (Math.abs(overlayAlpha - targetAlpha) > 0.001) frameDirty = true;

        // Nothing to do — skip all work this frame
        if (!geometryDirty && !frameDirty) return;

        if (screenmap_pts.length > 0) {
            if (geometryDirty) {
                const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
                const scaleX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal;
                const scaleY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal;
                const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
                const rotateRad = rotateDeg * Math.PI / 180;
                const cosR = Math.cos(rotateRad);
                const sinR = Math.sin(rotateRad);
                const tx = parseFloat(dom_txt_translate_x.value) || 0;
                const ty = parseFloat(dom_txt_translate_y.value) || 0;

                const transformedPts = screenmap_pts.map(([x, y]) => {
                    const sx = x * scaleX;
                    const sy = y * scaleY;
                    return [
                        sx * cosR - sy * sinR + tx,
                        sx * sinR + sy * cosR + ty,
                    ];
                });
                lastTransformedPts = transformedPts;
                buildScreenmap(transformedPts);
                updateLabels(transformedPts);
            }
            drawOverlay();
        } else {
            if (screenmapOutline) {
                scene.remove(screenmapOutline);
                screenmapOutline.geometry.dispose();
                screenmapOutline.material.dispose();
                screenmapOutline = null;
            }
            if (pointsMesh) {
                scene.remove(pointsMesh);
                pointsGeometry.dispose();
                pointsMaterial.dispose();
                pointsMesh = null;
                lastBuiltPointCount = -1;
            }
            updateLabels([]);
        }

        // Apply camera pan/zoom (view-only, not an edit)
        camera.position.x = -camPanX;
        camera.position.y = -camPanY;
        camera.zoom = camZoom;
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);

        geometryDirty = false;
        frameDirty = false;
    }

    // --- Initialize ---
    initRenderer();
    loadPresetsFromManifest();
    rafId = requestAnimationFrame(animate);

    return function destroy() {
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        if (screenmapOutline) {
            scene.remove(screenmapOutline);
            screenmapOutline.geometry.dispose();
            screenmapOutline.material.dispose();
        }
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry.dispose();
            pointsMaterial.dispose();
        }
        if (gridLines) {
            scene.remove(gridLines);
            gridLines.geometry.dispose();
            gridLines.material.dispose();
        }
        removeBackgroundImage();
        circleTexture.dispose();
        renderer.dispose();
        if (ctxMenu && ctxMenu.parentNode) ctxMenu.parentNode.removeChild(ctxMenu);
        // Clean up container layout styles
        container.style.display = '';
        container.style.flexDirection = '';
        container.style.height = '';
        container.style.overflow = '';
    };
}
