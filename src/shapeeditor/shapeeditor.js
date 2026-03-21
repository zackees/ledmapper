import {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    BufferGeometry,
    Float32BufferAttribute,
    LineSegments,
    LineBasicMaterial,
    Line,
} from 'three';
import { parse_screenmap_data, centerAndFitPoints, readFileAsText, download_text_as_file } from '../common.js';
import { createCircleTexture, buildPointsMesh } from '../three-utils.js';
import templateHtml from './template.html?raw';
export { default as css } from './shapeeditor.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    const dom_btn_upload_screenmap = container.querySelector("#btn_upload_screenmap");
    const dom_sel_preset = container.querySelector("#sel_preset");
    const dom_rng_scale = container.querySelector("#rng_scale");
    const dom_txt_scale = container.querySelector("#txt_scale");
    const dom_rng_scale_x = container.querySelector("#rng_scale_x");
    const dom_txt_scale_x = container.querySelector("#txt_scale_x");
    const dom_rng_scale_y = container.querySelector("#rng_scale_y");
    const dom_txt_scale_y = container.querySelector("#txt_scale_y");
    const dom_rng_rotate = container.querySelector("#rng_rotate");
    const dom_txt_rotate = container.querySelector("#txt_rotate");
    const dom_chk_flip_h = container.querySelector("#chk_flip_h");
    const dom_chk_flip_v = container.querySelector("#chk_flip_v");
    const dom_txt_diameter = container.querySelector("#txt_diameter");
    const dom_btn_save = container.querySelector("#btn_save_as");
    const dom_btn_reset = container.querySelector("#btn_reset");
    const dom_btn_undo = container.querySelector("#btn_undo");
    const dom_btn_redo = container.querySelector("#btn_redo");

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

    // Wire all transform controls to mark dirty
    for (const el of [dom_rng_scale, dom_txt_scale, dom_rng_scale_x, dom_txt_scale_x,
        dom_rng_scale_y, dom_txt_scale_y, dom_rng_rotate, dom_txt_rotate]) {
        el.addEventListener('input', markDirty, { signal });
    }
    for (const el of [dom_chk_flip_h, dom_chk_flip_v]) {
        el.addEventListener('change', markDirty, { signal });
    }
    dom_txt_diameter.addEventListener('input', markDirty, { signal });

    // ── Reset ───────────────────────────────────────────────────────────────

    function resetTransforms() {
        writeScale(dom_rng_scale, dom_txt_scale, 1);
        writeScale(dom_rng_scale_x, dom_txt_scale_x, 1);
        writeScale(dom_rng_scale_y, dom_txt_scale_y, 1);
        setRotate(0);
        dom_chk_flip_h.checked = false;
        dom_chk_flip_v.checked = false;
        dom_txt_diameter.value = origDiameter;
        clearDirty();
    }

    dom_btn_reset.addEventListener('click', resetTransforms, { signal });

    // ── Save As ────────────────────────────────────────────────────────────

    function saveAs() {
        if (rawPts.length === 0) return;

        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const flipH = dom_chk_flip_h.checked ? -1 : 1;
        const flipV = dom_chk_flip_v.checked ? -1 : 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal * flipH;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal * flipV;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);

        const xArr = [];
        const yArr = [];
        rawPts.forEach(([x, y]) => {
            const rx = x * sX;
            const ry = y * sY;
            xArr.push(+(rx * cosR - ry * sinR).toFixed(4));
            yArr.push(+(rx * sinR + ry * cosR).toFixed(4));
        });

        const diameter = parseFloat(dom_txt_diameter.value) || 0.25;

        const json = JSON.stringify({
            map: { strip1: { x: xArr, y: yArr, diameter } }
        }, null, 2);

        download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
        clearDirty();
    }

    dom_btn_save.addEventListener('click', saveAs, { signal });

    // ── Quadratic slider mapping ─────────────────────────────────────────

    const SCALE_MIN = 0.1;
    const SCALE_MAX = 10;
    const SLIDER_MAX = 1000;

    function sliderToScale(sliderVal) {
        const t = sliderVal / SLIDER_MAX;
        return SCALE_MIN + t * t * (SCALE_MAX - SCALE_MIN);
    }

    function scaleToSlider(scale) {
        const t = Math.sqrt((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN));
        return Math.round(t * SLIDER_MAX);
    }

    function clampScale(v) {
        v = parseFloat(v);
        return isNaN(v) ? 1 : Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
    }

    // ── Scale helpers ────────────────────────────────────────────────────

    function writeScale(rng, txt, val) {
        val = clampScale(val);
        rng.value = scaleToSlider(val);
        txt.value = val.toFixed(2);
    }

    function wireScale(rng, txt) {
        rng.addEventListener('input', () => {
            txt.value = sliderToScale(parseInt(rng.value)).toFixed(2);
        }, { signal });
        txt.addEventListener('input', () => writeScale(rng, txt, clampScale(txt.value)), { signal });
        txt.addEventListener('change', () => writeScale(rng, txt, clampScale(txt.value)), { signal });
    }

    wireScale(dom_rng_scale, dom_txt_scale);
    wireScale(dom_rng_scale_x, dom_txt_scale_x);
    wireScale(dom_rng_scale_y, dom_txt_scale_y);

    // ── Rotate ───────────────────────────────────────────────────────────────

    function clampRotate(v) {
        v = parseInt(v);
        return isNaN(v) ? 0 : Math.max(-180, Math.min(180, v));
    }

    function setRotate(rawVal) {
        const val = clampRotate(rawVal);
        dom_rng_rotate.value = val;
        dom_txt_rotate.value = val;
    }

    dom_rng_rotate.addEventListener('input', () => setRotate(dom_rng_rotate.value), { signal });
    dom_txt_rotate.addEventListener('input', () => setRotate(dom_txt_rotate.value), { signal });
    dom_txt_rotate.addEventListener('change', () => setRotate(dom_txt_rotate.value), { signal });

    // ── Screenmap state ──────────────────────────────────────────────────────

    let screenmap_pts = [];
    let rawPts = [];
    let origWidth = 0, origHeight = 0;
    let fitScale = 1; // cm-to-pixel scale from centerAndFitPoints
    let origDiameter = 0.5;

    // Three.js objects
    let renderer, scene, camera;
    let wrapper;
    let pointsMesh, pointsGeometry, pointsMaterial;
    const circleTexture = createCircleTexture(64);

    // Grid line objects
    let gridLines;
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
    let overlayAlpha = 0; // 0..1 for fade transition

    // ── Editing state ─────────────────────────────────────────────────────
    let selectedIdx = -1;
    let isDragging = false;
    let dragStartCanvasX = 0, dragStartCanvasY = 0;
    let dragStartScreenmapPt = null, dragStartRawPt = null;
    let ctxMenu, ctxMenuIdx = -1;

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
            if (selectedIdx === action.idx) selectedIdx = -1;
            else if (selectedIdx > action.idx) selectedIdx--;
        }
    }

    function applyInverse(action) {
        if (action.type === 'move') {
            screenmap_pts[action.idx] = [...action.oldScreenmapPt];
            rawPts[action.idx] = [...action.oldRawPt];
        } else if (action.type === 'delete') {
            screenmap_pts.splice(action.idx, 0, action.screenmapPt);
            rawPts.splice(action.idx, 0, action.rawPt);
            selectedIdx = action.idx;
        }
    }

    function performUndo() {
        if (undoStack.length === 0) return;
        const action = undoStack.pop();
        applyInverse(action);
        redoStack.push(action);
        updateUndoRedoButtons();
        markDirty();
    }

    function performRedo() {
        if (redoStack.length === 0) return;
        const action = redoStack.pop();
        applyAction(action);
        undoStack.push(action);
        updateUndoRedoButtons();
        markDirty();
    }

    function updateUndoRedoButtons() {
        dom_btn_undo.disabled = undoStack.length === 0;
        dom_btn_redo.disabled = redoStack.length === 0;
    }

    function deletePoint(idx) {
        if (idx < 0 || idx >= screenmap_pts.length) return;
        pushUndo({
            type: 'delete',
            idx,
            screenmapPt: [...screenmap_pts[idx]],
            rawPt: [...rawPts[idx]],
        });
        screenmap_pts.splice(idx, 1);
        rawPts.splice(idx, 1);
        if (selectedIdx === idx) selectedIdx = -1;
        else if (selectedIdx > idx) selectedIdx--;
    }

    function clearEditingState() {
        selectedIdx = -1;
        isDragging = false;
        undoStack.length = 0;
        redoStack.length = 0;
        updateUndoRedoButtons();
        hideContextMenu();
    }

    function showContextMenu(clientX, clientY, idx) {
        ctxMenuIdx = idx;
        ctxMenu.style.left = clientX + 'px';
        ctxMenu.style.top = clientY + 'px';
        ctxMenu.style.display = '';
    }

    function hideContextMenu() {
        if (ctxMenu) ctxMenu.style.display = 'none';
        ctxMenuIdx = -1;
    }

    dom_btn_undo.addEventListener('click', performUndo, { signal });
    dom_btn_redo.addEventListener('click', performRedo, { signal });

    let rafId = null;

    function getCanvasSize() {
        return {
            width: Math.floor(window.innerWidth * 0.45),
            height: Math.floor(window.innerHeight * 0.4),
        };
    }

    // ── Transform helpers for inverse mapping ─────────────────────────────

    function getCurrentTransform() {
        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const flipH = dom_chk_flip_h.checked ? -1 : 1;
        const flipV = dom_chk_flip_v.checked ? -1 : 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal * flipH;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal * flipV;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        return { sX, sY, cosR: Math.cos(rotateRad), sinR: Math.sin(rotateRad) };
    }

    function canvasDeltaToScreenmapDelta(dx, dy) {
        const { sX, sY, cosR, sinR } = getCurrentTransform();
        // Inverse rotation then inverse scale
        const urx = dx * cosR + dy * sinR;
        const ury = -dx * sinR + dy * cosR;
        return [urx / sX, ury / sY];
    }

    function getCanvasCoords(e) {
        const rect = overlayCanvas.getBoundingClientRect();
        const { width, height } = getCanvasSize();
        return [
            (e.clientX - rect.left) * (width / rect.width),
            (e.clientY - rect.top) * (height / rect.height),
        ];
    }

    function initRenderer() {
        const { width, height } = getCanvasSize();

        renderer = new WebGLRenderer({ antialias: false });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x121212, 1);

        scene = new Scene();

        const hw = width / 2, hh = height / 2;
        camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        camera.position.z = 1;

        const main = container.querySelector('#main');
        wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = width + 'px';
        wrapper.style.margin = '0 auto';
        main.appendChild(wrapper);

        renderer.domElement.style.display = 'block';
        wrapper.appendChild(renderer.domElement);

        // Overlay canvas for rainbow lines, arrows, and labels (always visible)
        overlayCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        overlayCanvas.width = width * dpr;
        overlayCanvas.height = height * dpr;
        overlayCanvas.style.cssText = `position:absolute;top:0;left:0;width:${width}px;height:${height}px;`;
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
            'padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:140px;';
        const ctxBtn = document.createElement('button');
        ctxBtn.dataset.action = 'delete';
        ctxBtn.textContent = 'Delete Point';
        ctxBtn.style.cssText =
            'display:block;width:100%;padding:6px 14px;background:none;border:none;' +
            'color:#eee;font:13px/1.4 "Outfit",system-ui,sans-serif;text-align:left;cursor:pointer;';
        ctxBtn.addEventListener('mouseenter', () => { ctxBtn.style.background = '#3b82f6'; ctxBtn.style.color = '#fff'; });
        ctxBtn.addEventListener('mouseleave', () => { ctxBtn.style.background = 'none'; ctxBtn.style.color = '#eee'; });
        ctxMenu.appendChild(ctxBtn);
        document.body.appendChild(ctxMenu);

        ctxMenu.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'delete' && ctxMenuIdx >= 0) {
                deletePoint(ctxMenuIdx);
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

        overlayCanvas.addEventListener('touchmove', (e) => {
            if (e.touches.length) onMouseMove(e.touches[0]);
        }, { passive: true, signal });
        overlayCanvas.addEventListener('touchend', onMouseLeave, { passive: true, signal });
        overlayCanvas.addEventListener('touchcancel', onMouseLeave, { passive: true, signal });

        const labelStyle = 'position:absolute;pointer-events:none;color:#fff;font:bold 13px/1 "Outfit",system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 3px #000;';

        infoDiv = document.createElement('div');
        infoDiv.style.cssText = labelStyle + 'top:10px;left:10px;font-size:14px;line-height:1.6;';
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

        const hw = width / 2, hh = height / 2;
        const gridSize = 50;
        const vertices = [];

        for (let x = -Math.ceil(hw / gridSize) * gridSize; x <= hw; x += gridSize) {
            vertices.push(x, -hh, 0, x, hh, 0);
        }
        for (let y = -Math.ceil(hh / gridSize) * gridSize; y <= hh; y += gridSize) {
            vertices.push(-hw, y, 0, hw, y, 0);
        }

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        gridLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x323232 }));
        scene.add(gridLines);
    }

    function center_and_fit(pts, canvasW, canvasH) {
        return centerAndFitPoints(pts, canvasW, canvasH, { margin: 0.95, center: 'origin' });
    }

    function load_screenmap_data(text) {
        clearEditingState();

        screenmap_pts = parse_screenmap_data(text);
        if (screenmap_pts.length === 0) return;

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

        const { width, height } = getCanvasSize();
        const availW = 0.95 * width;
        const availH = 0.95 * height;
        fitScale = Math.min(
            origWidth > 0 ? availW / origWidth : availW,
            origHeight > 0 ? availH / origHeight : availH,
        );
        screenmap_pts = center_and_fit(screenmap_pts, width, height);
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        dom_sel_preset.value = '';
        readFileAsText(dom_btn_upload_screenmap, load_screenmap_data);
    }, { signal });

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
            dom_sel_preset.innerHTML = '<option value="">-- Select preset --</option>';
            for (const preset of manifest.presets) {
                const opt = document.createElement('option');
                opt.value = preset.file;
                opt.textContent = preset.name;
                dom_sel_preset.appendChild(opt);
            }
            // Auto-select the first preset
            if (manifest.presets.length > 0) {
                dom_sel_preset.value = manifest.presets[0].file;
                dom_sel_preset.dispatchEvent(new Event('change'));
            }
        } catch (e) {
            console.log("Failed to load preset manifest:", e);
            dom_sel_preset.innerHTML = '<option value="">No presets available</option>';
        }
    }

    // --- Overlay drawing for LED connection visualization ---
    function toCanvasCoords(x, y) {
        const { width, height } = getCanvasSize();
        return [x + width / 2, y + height / 2];
    }

    function drawOverlay() {
        if (!overlayCtx) return;
        const { width, height } = getCanvasSize();
        overlayCtx.clearRect(0, 0, width, height);

        // Lerp overlayAlpha toward target (0.2s fade at ~60fps)
        const target = isHovering ? 1 : 0;
        const speed = 1 / (0.2 * 60); // step per frame for 0.2s
        if (overlayAlpha < target) overlayAlpha = Math.min(target, overlayAlpha + speed);
        else if (overlayAlpha > target) overlayAlpha = Math.max(target, overlayAlpha - speed);

        if (lastTransformedPts.length === 0) return;

        const pts = lastTransformedPts.map(([x, y]) => toCanvasCoords(x, y));

        // Rainbow lines and arrows fade with hover
        if (overlayAlpha > 0) {
            overlayCtx.globalAlpha = overlayAlpha;
            overlayCtx.lineWidth = 2;
            for (let i = 0; i < pts.length - 1; i++) {
                const [x1, y1] = pts[i];
                const [x2, y2] = pts[i + 1];
                const hue = (120 + i * 2) % 360;
                overlayCtx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
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

        // Start and end LEDs always visible
        overlayCtx.globalAlpha = 1;
        fillCircle(pts[0][0], pts[0][1], 8, 'rgba(0,255,0,1)');
        if (pts.length > 1) fillCircle(pts[1][0], pts[1][1], 6, 'rgba(0,255,0,0.5)');
        fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 8, 'rgba(255,0,0,1)');

        drawOutlinedLabel("Start LED", pts[0][0] + 4, pts[0][1]);
        drawOutlinedLabel("End LED", pts[pts.length - 1][0] + 4, pts[pts.length - 1][1]);

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

    // ── Mouse / pointer handlers ──────────────────────────────────────────

    function onContextMenu(e) {
        e.preventDefault();
        if (screenmap_pts.length === 0) return;
        const [cx, cy] = getCanvasCoords(e);
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            selectedIdx = idx;
            showContextMenu(e.clientX, e.clientY, idx);
        }
    }

    function onMouseDown(e) {
        if (screenmap_pts.length === 0) return;

        // Dismiss context menu on any click
        hideContextMenu();

        if (e.button !== 0) return;
        const [cx, cy] = getCanvasCoords(e);

        {
            // Left-click: select and start potential drag
            const idx = hitTestLED(cx, cy);
            selectedIdx = idx;
            if (idx >= 0) {
                isDragging = true;
                dragStartCanvasX = cx;
                dragStartCanvasY = cy;
                dragStartScreenmapPt = [...screenmap_pts[idx]];
                dragStartRawPt = [...rawPts[idx]];
                overlayCanvas.style.cursor = 'grabbing';
            }
        }
    }

    function onMouseMove(e) {
        if (screenmap_pts.length === 0) return;
        const [cx, cy] = getCanvasCoords(e);

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
            return;
        }

        // Hover detection for tooltip and cursor
        isHovering = true;
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            overlayCanvas.style.cursor = 'grab';
            if (idx !== tooltipLedIdx) {
                tooltipLedIdx = idx;
                const [ox, oy] = rawPts[idx];
                tooltip.textContent = `LED #${idx}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const { width } = getCanvasSize();
            const tx = Math.min(cx + 14, width - tooltip.offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
            tooltip.style.opacity = '1';
        } else {
            overlayCanvas.style.cursor = 'default';
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        }
    }

    function onMouseUp() {
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
        // Escape: deselect
        if (e.key === 'Escape') {
            selectedIdx = -1;
        }
    }, { signal });

    function buildScreenmap(transformedPts) {
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

        const lineVerts = [];
        transformedPts.forEach(([x, y]) => lineVerts.push(x, y, 0));
        const lineGeom = new BufferGeometry();
        lineGeom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
        screenmapOutline = new Line(lineGeom, new LineBasicMaterial({ color: 0x2196F3 }));
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

        const colorArr = result.colorAttribute.array;
        // First LED green
        colorArr[0] = 76 / 255;
        colorArr[1] = 175 / 255;
        colorArr[2] = 80 / 255;
        // Selected LED cyan
        if (selectedIdx > 0 && selectedIdx < transformedPts.length) {
            const ci = selectedIdx * 3;
            colorArr[ci] = 0;
            colorArr[ci + 1] = 1;
            colorArr[ci + 2] = 1;
        }
        result.colorAttribute.needsUpdate = true;

        pointsGeometry = result.geometry;
        pointsMaterial = result.material;
        pointsMesh = result.mesh;
        scene.add(pointsMesh);
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

        infoDiv.innerHTML = `Points: ${screenmap_pts.length}<br>Size: ${physW} &times; ${physH} cm`;
    }

    function handleResize() {
        const { width, height } = getCanvasSize();
        renderer.setSize(width, height);

        const hw = width / 2, hh = height / 2;
        camera.left = -hw;
        camera.right = hw;
        camera.top = -hh;
        camera.bottom = hh;
        camera.updateProjectionMatrix();

        wrapper.style.width = width + 'px';
        const dpr = window.devicePixelRatio || 1;
        overlayCanvas.width = width * dpr;
        overlayCanvas.height = height * dpr;
        overlayCanvas.style.width = width + 'px';
        overlayCanvas.style.height = height + 'px';
        overlayCtx.scale(dpr, dpr);

        buildGrid(width, height);
        drawOverlay();
    }

    window.addEventListener('resize', handleResize, { signal });

    function animate() {
        rafId = requestAnimationFrame(animate);

        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const flipH = dom_chk_flip_h.checked ? -1 : 1;
        const flipV = dom_chk_flip_v.checked ? -1 : 1;
        const scaleX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal * flipH;
        const scaleY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal * flipV;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);

        if (screenmap_pts.length > 0) {
            const transformedPts = screenmap_pts.map(([x, y]) => {
                const sx = x * scaleX;
                const sy = y * scaleY;
                return [
                    sx * cosR - sy * sinR,
                    sx * sinR + sy * cosR,
                ];
            });
            lastTransformedPts = transformedPts;
            buildScreenmap(transformedPts);
            updateLabels(transformedPts);
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
            }
            updateLabels([]);
        }

        renderer.render(scene, camera);
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
        circleTexture.dispose();
        renderer.dispose();
        if (ctxMenu && ctxMenu.parentNode) ctxMenu.parentNode.removeChild(ctxMenu);
    };
}
