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
import { parse_screenmap_data, centerAndFitPoints, download_text_as_file, parseScreenmapMultiStrip, getStripColors, getPinColors, stripStartEndLabels } from '../common';
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
import { createCircleTexture, buildPointsMesh } from '../three-utils';
import { StripStore } from './strips-model';
import { Selection } from './selection';
import { PANEL_CATALOG, getCatalogEntry, generatePanelPoints } from './panel-catalog';
import { snapToGrid } from './grid-snap';
import { hintTextFor } from './hints';
import { parsePastedScreenmap, planPasteMerge } from './paste-parse';
import templateHtml from './template.html?raw';
export { default as css } from './shapeeditor.css?url';

export function init(container: any) {
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

        const transformPoint = ([x, y]: [any, any]) => {
            const rx = x * sX;
            const ry = y * sY;
            return [
                +(rx * cosR - ry * sinR + txCm).toFixed(4),
                +(rx * sinR + ry * cosR + tyCm).toFixed(4),
            ];
        };

        let json;
        if (stripInfo && stripInfo.strips.length >= 1
            && stripInfo.totalCount === rawPts.length) {
            // Preserve multi-strip structure (including non-sequential video_offset)
            // via the shared builder.
            const stripsOut = stripInfo.strips.map((strip: any) => {
                const pts = [];
                for (let i = strip.offset; i < strip.offset + strip.count; i++) {
                    pts.push(transformPoint(rawPts[i]));
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
                    videoOffsetOverride: strip.videoOffsetOverride === true,
                };
            });
            json = buildScreenmapMultiStripJson(stripsOut);
        } else {
            const xArr = [];
            const yArr = [];
            for (const pt of rawPts) {
                const [tx, ty] = transformPoint(pt);
                xArr.push(tx);
                yArr.push(ty);
            }
            const map = { strip1: { x: xArr, y: yArr, diameter: fallbackDiameter } };
            json = JSON.stringify({ map }, null, 2);
        }

        saveScreenmap(json);
        download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
        clearDirty();
        try { renderBackupRow(); } catch { /* render is best-effort */ }
    }

    dom_btn_save.addEventListener('click', saveAs, { signal });

    // ── Quadratic slider mapping ─────────────────────────────────────────

    const SCALE_MIN = 0.1;
    const SCALE_MAX = 10;

    function clampScale(v: any) {
        v = parseFloat(v);
        if (isNaN(v)) return 1;
        const abs = Math.abs(v);
        const sign = v < 0 ? -1 : 1;
        return sign * Math.max(SCALE_MIN, Math.min(SCALE_MAX, abs));
    }

    function writeScale(txt: any, val: any) {
        txt.value = clampScale(val).toFixed(2);
    }

    dom_txt_scale.addEventListener('change', () => writeScale(dom_txt_scale, dom_txt_scale.value), { signal });
    dom_txt_scale_x.addEventListener('change', () => writeScale(dom_txt_scale_x, dom_txt_scale_x.value), { signal });
    dom_txt_scale_y.addEventListener('change', () => writeScale(dom_txt_scale_y, dom_txt_scale_y.value), { signal });

    // ── Rotate ───────────────────────────────────────────────────────────────

    function clampRotate(v: any) {
        v = parseInt(v);
        return isNaN(v) ? 0 : Math.max(-180, Math.min(180, v));
    }

    function setRotate(rawVal: any) {
        dom_txt_rotate.value = clampRotate(rawVal);
    }

    dom_txt_rotate.addEventListener('change', () => setRotate(dom_txt_rotate.value), { signal });

    // ── Translate ─────────────────────────────────────────────────────────────

    function clampTranslate(v: any) {
        v = parseFloat(v);
        return isNaN(v) ? 0 : Math.max(-500, Math.min(500, Math.round(v)));
    }

    function setTranslate(x: any, y: any) {
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
    function wireTransformUndo(controlName: any, ...elements: any[]) {
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

    let screenmap_pts: any = [];
    let rawPts: any = [];
    let origWidth = 0, origHeight = 0;
    let fitScale = 1; // cm-to-pixel scale from centerAndFitPoints
    let origDiameter = 0.5;
    // Multi-strip metadata model. The store owns mutations; `stripInfo` is
    // kept as a local mirror of `stripStore.get()` so existing read paths
    // (`stripInfo.strips`, `stripInfo.totalCount`, ...) work unchanged.
    const stripStore = new StripStore();
    let stripInfo: any = null; // multi-strip parse result (null until screenmap loaded)
    const selection = new Selection();
    selection.setOnChange(() => {
        setNeedsGeometryUpdate();
        renderStripsPanel();
        _updateHintStrip();
        _maybeShowGestureNotice();
    });

    // ── Toolbar modes (issue #24 §1.6): null | 'chain' | 'reorder' ──────
    let editorMode: any = null;
    // In-flight canvas connector drag (Chain mode):
    //   { upIdx, x, y, targetIdx } — arrowhead drag, drop on a Start handle
    let connectorDrag: any = null;
    //   { stripIdx, x, y, targetIdx } — Start-handle drag, drop on an End handle
    let startHandleDrag: any = null;
    // Canvas-space geometry captured by drawChainArrows for hit-testing.
    const _chainGeom: { connectors: any[]; starts: any[]; ends: any[]; crossBadges: any[] } = { connectors: [], starts: [], ends: [], crossBadges: [] };

    // Greedy non-overlapping placement for Start/End labels (issue #28).
    const labelRenderer = createLabelRenderer();
    window.__labelLayoutDebug = () => labelRenderer.debugDump();

    // Test/debug hook: expose strip state and computed Start/End labels so
    // E2E tests can assert on canvas-drawn labels that have no DOM presence.
    window.__shapeeditorDebug = {
        getStripCount: () => (stripInfo ? stripInfo.strips.length : 0),
        getStripLabels: () => (stripInfo
            ? stripInfo.strips.map((s: any, i: any) => stripStartEndLabels(s, i))
            : null),
        getSelectedStrip: () => selection.getStripIdx(),
        getStripNames: () => (stripInfo ? stripInfo.strips.map((s: any) => s.name) : []),
        selectStrip: (i: any) => { selection.selectStrip(i); },
        placePanel: (catalogId: any, worldX: any, worldY: any, opts: any) => _debugPlacePanel(catalogId, worldX, worldY, opts || {}),
        getPlacingMode: () => (placingState ? placingState.entry.id : null),
        cancelPlacing: () => { _cancelPlacing(); },
        getChainArrowCount: () => _chainArrowCount(),
        reverseStrip: (i: any) => { doReverseStrip(i); },
        getBackupInfo: () => {
            const b = getBackup();
            if (!b) return null;
            return { meta: b.meta, hasJson: typeof b.json === 'string' && b.json.length > 0 };
        },
        getHintText: () => (hintStripTextEl ? hintStripTextEl.textContent : ''),
        openHelp: () => { _openHelpOverlay(); },
        getPointEditMode: () => pointEditStripIdx,
        enterPointEditMode: (i: any) => {
            if (typeof i !== 'number' || i < 0) return;
            const strips = stripStore.getStrips();
            if (i >= strips.length) return;
            selection.selectStrip(i);
            pointEditStripIdx = i;
            _updateHintStrip();
        },
        exitPointEditMode: () => { pointEditStripIdx = null; _updateHintStrip(); },
        // Get the per-LED screenmap coords of a strip (debug for group-drag tests)
        getStripPoints: (i: any) => {
            const strips = stripStore.getStrips();
            if (i < 0 || i >= strips.length) return null;
            const s = strips[i];
            const out = [];
            for (let k = s.offset; k < s.offset + s.count; k++) {
                out.push([screenmap_pts[k][0], screenmap_pts[k][1]]);
            }
            return out;
        },
        // Get a flat LED's transformed canvas coords (for synthetic drag tests).
        getLedCanvasPos: (flatIdx: any) => {
            if (flatIdx < 0 || flatIdx >= lastTransformedPts.length) return null;
            const [x, y] = lastTransformedPts[flatIdx];
            const [cx, cy] = toCanvasCoords(x, y);
            const rect = overlayCanvas.getBoundingClientRect();
            // Convert internal canvas px → client px
            const clientX = rect.left + (cx / canvasW) * rect.width;
            const clientY = rect.top + (cy / canvasH) * rect.height;
            return { clientX, clientY, canvasX: cx, canvasY: cy };
        },
        // Paste flow hooks (Phase 3)
        pasteScreenmapText: (text: any) => _enterPasteFromText(text || ''),
        getPasteState: () => (pasteState
            ? { count: pasteState.strips.length, names: pasteState.strips.map((s: any) => s.name) }
            : null),
        commitPasteAt: (canvasX: any, canvasY: any) => _commitPasteAt(canvasX, canvasY),
        cancelPaste: () => _cancelPaste(),
        copySelectedStrip: () => _copySelectedStripToClipboard(),
        // Insert dialog hooks (Phase 4)
        openInsertDialog: () => _openInsertDialog(),
        submitInsertDialog: (opts: any) => _submitInsertDialog(opts),
        // Touch (Phase 5) — synchronously execute the long-press action at
        // the given canvas-internal coords without waiting 600ms in tests.
        simulateLongPress: (canvasX: any, canvasY: any) => {
            const rect = overlayCanvas.getBoundingClientRect();
            const clientX = rect.left + (canvasX / canvasW) * rect.width;
            const clientY = rect.top + (canvasY / canvasH) * rect.height;
            _doLongPress(canvasX, canvasY, clientX, clientY);
            return true;
        },
        getCamZoom: () => camZoom,
        getCamPan: () => ({ x: camPanX, y: camPanY }),
        // Drive a synthetic L-drag from (flatIdx) by (dxClient, dyClient) client px.
        simulateLedDrag: (flatIdx: any, dxClient: any, dyClient: any, opts: any) => {
            const pos = window.__shapeeditorDebug.getLedCanvasPos(flatIdx);
            if (!pos) return false;
            const altKey = !!(opts && opts.altKey);
            const evtOpts = (x: any, y: any) => ({ clientX: x, clientY: y, button: 0, bubbles: true, altKey });
            overlayCanvas.dispatchEvent(new MouseEvent('mousedown', evtOpts(pos.clientX, pos.clientY)));
            overlayCanvas.dispatchEvent(new MouseEvent('mousemove', evtOpts(pos.clientX + dxClient, pos.clientY + dyClient)));
            overlayCanvas.dispatchEvent(new MouseEvent('mouseup', evtOpts(pos.clientX + dxClient, pos.clientY + dyClient)));
            return true;
        },
        // Pins / chain hooks (issue #24, Phases 1-2)
        getPinSummary: () => {
            const strips = stripStore.getStrips();
            const order = stripStore.getPinOrder();
            return order.map((pinId) => {
                const stripIndices: any = [];
                let totalCount = 0;
                strips.forEach((s: any, i: any) => {
                    if (StripStore.pinOf(s) === pinId) {
                        stripIndices.push(i);
                        totalCount += s.count;
                    }
                });
                return { pinId, stripIndices, totalCount };
            });
        },
        getStripPins: () => stripStore.getStrips().map((s: any) => StripStore.pinOf(s)),
        getVideoOffsets: () => stripStore.getStrips().map((s: any) => ({
            video_offset: s.video_offset,
            override: !!s.videoOffsetOverride,
        })),
        repinStrip: (stripIdx: any, newPinId: any) => doRepinStrip(stripIdx, newPinId),
        getDerivedVideoOffset: (stripIdx: any) => stripStore.getDerivedVideoOffset(stripIdx),
        setVideoOffsetOverride: (stripIdx: any, value: any) => {
            const strips = stripStore.getStrips();
            const s = strips[stripIdx];
            if (!s) return false;
            if (!!s.videoOffsetOverride !== !!value) doToggleVoLock(stripIdx);
            return true;
        },
        addPin: () => doAddPin(),
        renamePin: (oldId: any, newId: any) => doRenamePin(oldId, newId),
        // Chain / Reorder modes (issue #24, Phase 3)
        getMode: () => editorMode,
        setMode: (m: any) => { setEditorMode(m); return editorMode; },
        simulateConnectorDrag: (stripIdx: any, targetStripIdx: any) => doConnectorRetarget(stripIdx, targetStripIdx),
        getCrossPinBadgeCount: () => _crossPinBadgeCount(),
        getChainGeom: () => ({
            connectors: _chainGeom.connectors.map((c) => ({ up: c.up, down: c.down, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 })),
            starts: _chainGeom.starts.map((s) => ({ strip: s.strip, x: s.x, y: s.y })),
            ends: _chainGeom.ends.map((s) => ({ strip: s.strip, x: s.x, y: s.y })),
            crossBadges: _chainGeom.crossBadges.map((b) => ({ up: b.up, down: b.down })),
        }),
        getUndoStack: () => undoStack.map((a: any) => a.type),
        // Dispatch a real contextmenu event at canvas-internal coords so the
        // connector right-click hit-test path is exercised end-to-end.
        simulateCanvasContextMenu: (canvasX: any, canvasY: any) => {
            const rect = overlayCanvas.getBoundingClientRect();
            const clientX = rect.left + (canvasX / canvasW) * rect.width;
            const clientY = rect.top + (canvasY / canvasH) * rect.height;
            overlayCanvas.dispatchEvent(new MouseEvent('contextmenu', {
                clientX, clientY, button: 2, bubbles: true, cancelable: true,
            }));
            return true;
        },
    };

    // ── Autosave / backup helpers ────────────────────────────────────────

    /** "just now", "5 min ago", "2 h ago", "3 d ago". */
    function _relativeTime(savedAt: any) {
        const ms = Math.max(0, Date.now() - savedAt);
        const sec = Math.floor(ms / 1000);
        if (sec < 45) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} h ago`;
        const day = Math.floor(hr / 24);
        return `${day} d ago`;
    }

    async function _toast(opts: any) {
        try {
            const Swal = (await import('sweetalert2')).default;
            if (signal.aborted) return null;
            return Swal.fire({
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
    }

    function _toastInfo(text: any) {
        return _toast({ icon: 'info', title: text });
    }

    function _toastSuccess(text: any) {
        return _toast({ icon: 'success', title: text });
    }

    /** Show a non-blocking "looks like an empty edit" banner-toast with
     *  Restore + Dismiss buttons. */
    async function _toastFreshDegenerate(backupMeta: any) {
        const ledCount = (backupMeta && typeof backupMeta.ledCount === 'number')
            ? backupMeta.ledCount : 0;
        try {
            const Swal = (await import('sweetalert2')).default;
            if (signal.aborted) return;
            const res = await Swal.fire({
                toast: true,
                position: 'top',
                icon: 'info',
                title: 'Looks like an empty edit',
                html: `Your last good layout had <b>${ledCount} LED${ledCount === 1 ? '' : 's'}</b>.`,
                showConfirmButton: true,
                showCancelButton: true,
                confirmButtonText: 'Restore previous layout',
                cancelButtonText: 'Dismiss',
                background: '#1a1a1a',
                color: '#e5e7eb',
                timer: 12000,
                timerProgressBar: true,
            });
            if (res && res.isConfirmed) {
                const json = restoreBackup();
                if (json) {
                    load_screenmap_data(json);
                    renderBackupRow();
                }
            }
        } catch { /* ignore */ }
    }

    /** Show "restored your last good layout" toast with an [Undo] action that
     *  puts the degenerate copy back and reloads it. */
    async function _toastSilentRestored(restoredMeta: any, degenerateJson: any) {
        const ledCount = (restoredMeta && typeof restoredMeta.ledCount === 'number')
            ? restoredMeta.ledCount : 0;
        const when = (restoredMeta && typeof restoredMeta.savedAt === 'number')
            ? _relativeTime(restoredMeta.savedAt) : 'recently';
        try {
            const Swal = (await import('sweetalert2')).default;
            if (signal.aborted) return;
            const res = await Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: 'Restored your last good layout',
                html: `${ledCount} LED${ledCount === 1 ? '' : 's'}, saved ${when}`,
                showConfirmButton: true,
                confirmButtonText: 'Undo',
                showCancelButton: false,
                background: '#1a1a1a',
                color: '#e5e7eb',
                timer: 8000,
                timerProgressBar: true,
            });
            if (res && res.isConfirmed && typeof degenerateJson === 'string') {
                // Put the degenerate copy back as the working copy. We bypass
                // the save gate by writing directly to the store keys.
                try {
                    localStorage.setItem('lm:screenmap', degenerateJson);
                    localStorage.removeItem('lm:screenmap-meta');
                } catch { /* ignore */ }
                load_screenmap_data(degenerateJson);
                renderBackupRow();
            }
        } catch { /* ignore */ }
    }

    /** Implements the launch-time autosave behavior matrix. Returns true
     *  when this function loaded a screenmap (caller skips fallback). */
    function _autoloadOnLaunch() {
        backfillMeta();
        const stored = getScreenmap();
        const meta = getScreenmapMeta();
        const backup = getBackup();
        const STALE_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        if (stored && !isDegenerate(stored)) {
            // Valid working copy — load it; if stale, show passive toast.
            load_screenmap_data(stored);
            if (meta && typeof meta.savedAt === 'number'
                && (now - meta.savedAt) > STALE_MS) {
                _toastInfo(`Loaded layout from ${_relativeTime(meta.savedAt)}`);
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
                    load_screenmap_data(restored);
                    _toastSilentRestored(backup.meta, stored);
                    return true;
                }
            } else if (!stale && backup) {
                // Fresh degenerate — load the degenerate copy and show banner.
                load_screenmap_data(stored);
                _toastFreshDegenerate(backup.meta);
                return true;
            }
            // Degenerate, no backup — fall through to default behavior.
            return false;
        }

        // Missing/corrupt JSON — try backup, otherwise fall through.
        if (backup) {
            const restored = restoreBackup();
            if (restored) {
                load_screenmap_data(restored);
                _toastSuccess('Restored your last good layout');
                return true;
            }
        }
        return false;
    }

    /** Convert an HSL color string like "hsl(120, 80%, 60%)" to [r, g, b] floats 0-1. */
    function hslStringToRgb(hslStr: any) {
        const m = hslStr.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
        if (!m) return [1, 1, 1];
        const h = parseFloat(m[1]) / 360;
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        if (s === 0) return [l, l, l];
        const hue2rgb = (p: any, q: any, t: any) => {
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
    let renderer: any, scene: any, camera: any;
    let wrapper: any;
    let pointsMesh: any, pointsGeometry: any, pointsMaterial: any;
    const circleTexture = createCircleTexture(64);

    // Grid line objects
    let gridLines: any;
    // Background image
    let bgImageMesh: any = null;
    let bgImageTexture: any = null;
    // Screenmap outline
    let screenmapOutline: any;

    // DOM-based labels
    let infoDiv: any, placeholderDiv: any;

    // Overlay state
    let overlayCanvas: any, overlayCtx: any;
    let tooltipLedIdx = -1;
    let tooltip: any;
    let lastTransformedPts: any = [];
    let isHovering = false;
    let overlayAlpha = 1; // 0..1 for rainbow fade (1 = visible by default)
    let ptsBBox: any = null;   // oriented bounding box { cx, cy, hw, hh, cos, sin } in canvas space

    // ── Dirty flags (skip work when nothing changed) ─────────────────────
    let geometryDirty = true;  // transforms/points changed → rebuild buffers
    let frameDirty = true;     // anything visual changed → redraw overlay + render
    let lastBuiltPointCount = -1; // track point count for in-place vs full rebuild
    let pointsColorAttr: any = null;   // cached ref to color attribute

    function setNeedsGeometryUpdate() { geometryDirty = true; frameDirty = true; }
    function setNeedsRender() { frameDirty = true; }

    // ── Editing state ─────────────────────────────────────────────────────
    let selectedIdx = -1;
    function syncPointSelection(idx: any) {
        if (idx >= 0) {
            const sIdx = stripStore.findStripForIndex(idx);
            selection.selectPoint(idx, sIdx);
        } else if (selection.getPointIdx() !== null) {
            // Clear point but keep strip selection if explicit
            selection.selectPoint(null, selection.getStripIdx());
        }
    }
    let isDragging = false;
    let dragStartCanvasX = 0, dragStartCanvasY = 0;
    let dragStartScreenmapPt: any = null, dragStartRawPt: any = null;

    // ── Point-edit mode + strip group-drag state ───────────────────────
    // pointEditMode tracks the strip the user double-clicked into; while
    // active, a plain LED drag moves only that single LED (per the plan).
    let pointEditStripIdx: any = null;
    // Group drag for the selected strip (plain L-drag on an LED in non-point-edit mode)
    let stripDragActive = false;
    let stripDragIdx = -1;
    let stripDragStartScreenmap: any = null; // array of [x,y] for that strip
    let stripDragStartRaw: any = null;       // array of [x,y] for that strip
    let stripDragLastSdx = 0, stripDragLastSdy = 0;
    // Alt-drag quasimode: force single-point move regardless of mode
    let altQuasimode = false;
    let ctxMenu: any, ctxMenuIdx = -1;
    let ctxBtnSave: any, ctxBtnLoadScreenmap: any, ctxLoadSubmenu: any;
    let ctxLoadImageInput: any;
    let ctxFileOps: any, ctxFileOpsSep: any;
    let ctxBtnDelete: any, ctxBtnInsertBetween: any, ctxBtnInsertFwd: any, ctxBtnInsertBack: any;
    let ctxBtnCopyStrip: any;
    let hintStripTextEl: any, hintStripHelpBtn;
    let _autoOpenHelpScheduled = false;
    let highlightedEdgeIdx = -1; // edge index highlighted for "insert between"
    let loadedPresets = []; // populated by manifest fetch

    const ctxBtnStyle =
        'display:block;width:100%;padding:8px 16px;background:none;border:none;' +
        'color:#eee;font:14px/1.4 "Outfit",system-ui,sans-serif;text-align:left;cursor:pointer;';
    function makeCtxBtn(label: any, action: any, parent?: any) {
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
    let gizmoActive: any = null;    // null | handle id string
    let gizmoHover: any = null;     // null | handle id string
    let gizmoDragStart: any = null; // snapshot of transform values at drag start
    let shiftHeld = false;     // for rotation snapping

    // ── Image gizmo state ─────────────────────────────────────────────
    let bgImageFitW = 0, bgImageFitH = 0;
    let bgImageBBox: any = null;
    let bgGizmoActive: any = null;
    let bgGizmoHover: any = null;
    let bgGizmoDragStart: any = null;

    // ── Transform committed values (for undo tracking) ─────────────────
    const committedTransform: any = { scale: 1, scaleX: 1, scaleY: 1, rotate: 0, translateX: 0, translateY: 0 };

    function getTransformValue(control: any) {
        switch (control) {
            case 'scale': return parseFloat(dom_txt_scale.value) || 1;
            case 'scaleX': return parseFloat(dom_txt_scale_x.value) || 1;
            case 'scaleY': return parseFloat(dom_txt_scale_y.value) || 1;
            case 'rotate': return parseInt(dom_txt_rotate.value) || 0;
            case 'translateX': return parseInt(dom_txt_translate_x.value) || 0;
            case 'translateY': return parseInt(dom_txt_translate_y.value) || 0;
        }
    }

    function setTransformValue(control: any, value: any) {
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
    const undoStack: any = [];
    const redoStack: any = [];

    function pushUndo(action: any) {
        undoStack.push(action);
        redoStack.length = 0;
        updateUndoRedoButtons();
        markDirty();
    }

    function _persistMultiStrip() {
        if (!stripInfo || stripInfo.strips.length === 0) return;
        try {
            const fallbackDiameter = parseFloat(dom_txt_diameter.value) || 0.25;
            const strips = stripInfo.strips.map((s: any) => {
                const pts = [];
                for (let i = s.offset; i < s.offset + s.count; i++) {
                    pts.push([rawPts[i][0], rawPts[i][1]]);
                }
                return {
                    name: s.name,
                    points: pts,
                    diameter: typeof s.diameter === 'number' ? s.diameter : fallbackDiameter,
                    offset: s.offset,
                    count: s.count,
                    video_offset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
                    pin: typeof s.pin === 'string' ? s.pin : 'pin1',
                    videoOffsetOverride: s.videoOffsetOverride === true,
                };
            });
            saveScreenmapMultiStrip(strips);
        } catch { /* persistence is best-effort */ }
        try { renderBackupRow(); } catch { /* render is best-effort */ }
    }

    function _spliceArray(arr: any, idx: any, count: any) {
        return arr.splice(idx, count);
    }

    function _removeStripPoints(stripIdx: any) {
        const strip = stripInfo.strips[stripIdx];
        const removedScreenmap = _spliceArray(screenmap_pts, strip.offset, strip.count);
        const removedRaw = _spliceArray(rawPts, strip.offset, strip.count);
        const removedStrip = { ...strip, points: strip.points ? strip.points.map((p: any) => [p[0], p[1]]) : null };
        stripStore.removeStrip(stripIdx);
        return { removedStrip, removedScreenmap, removedRaw };
    }

    function _insertStripPoints(stripIdx: any, removed: any) {
        const { removedStrip, removedScreenmap, removedRaw } = removed;
        // Compute the flat insertion point for screenmap_pts/rawPts:
        // the strip will be placed at stripIdx; its starting offset equals
        // sum of counts of strips [0..stripIdx).
        let insertAt = 0;
        for (let k = 0; k < stripIdx && k < stripInfo.strips.length; k++) {
            insertAt += stripInfo.strips[k].count;
        }
        screenmap_pts.splice(insertAt, 0, ...removedScreenmap);
        rawPts.splice(insertAt, 0, ...removedRaw);
        // Reinsert in StripStore
        const info = stripStore.get();
        const stripObj = {
            name: removedStrip.name,
            points: removedStrip.points || [],
            diameter: removedStrip.diameter,
            offset: 0, // recomputed
            count: removedStrip.count,
            video_offset: typeof removedStrip.video_offset === 'number' ? removedStrip.video_offset : 0,
            pin: typeof removedStrip.pin === 'string' ? removedStrip.pin : 'pin1',
            videoOffsetOverride: removedStrip.videoOffsetOverride === true,
        };
        info.strips.splice(stripIdx, 0, stripObj);
        // Recompute offsets/allPoints
        stripStore._recomputeOffsetsAndAllPoints();
    }

    function _reorderStripPoints(fromIdx: any, toIdx: any) {
        // Splice screenmap_pts/rawPts to mirror the strip move.
        const fromStrip = stripInfo.strips[fromIdx];
        const fromOff = fromStrip.offset;
        const fromCnt = fromStrip.count;
        const movedScreenmap = screenmap_pts.splice(fromOff, fromCnt);
        const movedRaw = rawPts.splice(fromOff, fromCnt);
        stripStore.reorderStrip(fromIdx, toIdx);
        // After reorder, the moved strip is at toIdx; compute its new offset
        const newOffset = stripInfo.strips[toIdx].offset;
        screenmap_pts.splice(newOffset, 0, ...movedScreenmap);
        rawPts.splice(newOffset, 0, ...movedRaw);
    }

    // ── Pin helpers (issue #24) ──────────────────────────────────────────

    function _pinOfStrip(s: any) {
        return StripStore.pinOf(s);
    }

    /** Zero-based position of stripIdx among the strips sharing its pin. */
    function _withinPinIdx(stripIdx: any) {
        const strips = stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const pin = _pinOfStrip(strips[stripIdx]);
        let n = 0;
        for (let i = 0; i < stripIdx; i++) {
            if (_pinOfStrip(strips[i]) === pin) n++;
        }
        return n;
    }

    /** Next free auto pin id: pin1, pin2, ... */
    function _nextFreePinId() {
        const used = new Set(stripStore.getStrips().map(_pinOfStrip));
        let n = 1;
        while (used.has(`pin${n}`)) n++;
        return `pin${n}`;
    }

    /** Pin a newly created strip should default to (B8: focused pin →
     *  last pin → pin1). */
    function _defaultNewStripPin() {
        const strips = stripStore.getStrips();
        const sIdx = selection.getStripIdx();
        if (sIdx !== null && sIdx >= 0 && sIdx < strips.length) {
            return _pinOfStrip(strips[sIdx]);
        }
        if (strips.length > 0) return _pinOfStrip(strips[strips.length - 1]);
        return 'pin1';
    }

    /**
     * Apply a strip-repin action: set the strip's pin, clear the
     * videoOffsetOverride (§1.4 — repin re-derives), and move the strip to
     * the end of the destination pin's block so pins stay contiguous.
     * Records `action.newStripIdx` for the inverse.
     */
    function _applyRepin(action: any) {
        const strips = stripStore.getStrips();
        const s = strips[action.stripIdx];
        if (!s) return;
        s.pin = action.newPin;
        s.videoOffsetOverride = false;
        // Target index: just after the last existing strip of newPin
        // (excluding the strip itself); append at end for a brand-new pin.
        let lastSame = -1;
        for (let i = 0; i < strips.length; i++) {
            if (i === action.stripIdx) continue;
            if (_pinOfStrip(strips[i]) === action.newPin) lastSame = i;
        }
        let target;
        if (lastSame < 0) target = strips.length - 1;
        else target = lastSame > action.stripIdx ? lastSame : lastSame + 1;
        if (target !== action.stripIdx) {
            _reorderStripPoints(action.stripIdx, target);
            selection.onStripReorder(action.stripIdx, target);
        } else {
            stripStore.recomputeDerivedVideoOffsets();
        }
        action.newStripIdx = target;
    }

    /** Inverse of _applyRepin: restore pin, position, override and value. */
    function _revertRepin(action: any) {
        const strips = stripStore.getStrips();
        const fromIdx = typeof action.newStripIdx === 'number' ? action.newStripIdx : action.stripIdx;
        const s = strips[fromIdx];
        if (!s) return;
        s.pin = action.oldPin;
        s.videoOffsetOverride = action.oldOverride === true;
        if (fromIdx !== action.stripIdx) {
            _reorderStripPoints(fromIdx, action.stripIdx);
            selection.onStripReorder(fromIdx, action.stripIdx);
        } else {
            stripStore.recomputeDerivedVideoOffsets();
        }
        if (action.oldOverride === true && typeof action.oldVideoOffset === 'number') {
            stripStore.updateStrip(action.stripIdx, { video_offset: action.oldVideoOffset });
        }
    }

    /**
     * Rearrange strips[] (and the flat point arrays) so pins appear in
     * `order`, preserving within-pin order. Pins missing from `order` are
     * appended in their current first-appearance order.
     */
    function _applyPinOrder(order: any) {
        const info = stripStore.get();
        if (!info) return;
        const strips = info.strips;
        const selStrip = (() => {
            const i = selection.getStripIdx();
            return (i !== null && i >= 0 && i < strips.length) ? strips[i] : null;
        })();
        const groups = new Map();
        for (let i = 0; i < strips.length; i++) {
            const p = _pinOfStrip(strips[i]);
            if (!groups.has(p)) groups.set(p, []);
            groups.get(p).push(i);
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
        const newScreen = [];
        const newRaw = [];
        const newStrips = [];
        for (const idx of newIdxOrder) {
            const st = strips[idx];
            for (let k = st.offset; k < st.offset + st.count; k++) {
                newScreen.push(screenmap_pts[k]);
                newRaw.push(rawPts[k]);
            }
            newStrips.push(st);
        }
        screenmap_pts.length = 0;
        screenmap_pts.push(...newScreen);
        rawPts.length = 0;
        rawPts.push(...newRaw);
        strips.length = 0;
        strips.push(...newStrips);
        stripStore._recomputeOffsetsAndAllPoints();
        // Re-select the same strip object at its new index.
        if (selStrip) {
            const newIdx = strips.indexOf(selStrip);
            if (newIdx >= 0) selection.selectStrip(newIdx);
        }
    }

    /** Rename pin `fromId` to `toId` on every strip that uses it. */
    function _applyPinRename(fromId: any, toId: any) {
        const strips = stripStore.getStrips();
        for (const s of strips) {
            if (_pinOfStrip(s) === fromId) s.pin = toId;
        }
    }

    function applyAction(action: any) {
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
        } else if (action.type === 'strip-rename') {
            stripStore.renameStrip(action.stripIdx, action.newName);
        } else if (action.type === 'strip-reorder') {
            _reorderStripPoints(action.fromIdx, action.toIdx);
            selection.onStripReorder(action.fromIdx, action.toIdx);
        } else if (action.type === 'strip-delete') {
            const removed = _removeStripPoints(action.stripIdx);
            action.removed = removed; // ensure restore data is captured
            selection.onStripRemove(action.stripIdx);
            selectedIdx = -1;
        } else if (action.type === 'panel-place') {
            _redoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            _reverseStripInPlace(action.stripIdx);
        } else if (action.type === 'strip-offset') {
            stripStore.updateStrip(action.stripIdx, { video_offset: action.newValue });
        } else if (action.type === 'strip-repin') {
            _applyRepin(action);
        } else if (action.type === 'connector-retarget') {
            for (const sub of action.subActions) applyAction(sub);
        } else if (action.type === 'pin-reorder') {
            _applyPinOrder(action.newOrder);
        } else if (action.type === 'pin-rename') {
            _applyPinRename(action.oldId, action.newId);
        } else if (action.type === 'vo-override-toggle') {
            stripStore.updateStrip(action.stripIdx, {
                videoOffsetOverride: action.newOverride,
                video_offset: action.newValue,
            });
        } else if (action.type === 'strip-translate') {
            _applyStripTranslate(action.stripIdx, action.sdx, action.sdy);
        } else if (action.type === 'paste-strips') {
            _doPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof action.afterJson === 'string') {
                load_screenmap_data(action.afterJson);
            }
        }
    }

    function applyInverse(action: any) {
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
        } else if (action.type === 'strip-rename') {
            stripStore.renameStrip(action.stripIdx, action.oldName);
        } else if (action.type === 'strip-reorder') {
            _reorderStripPoints(action.toIdx, action.fromIdx);
            selection.onStripReorder(action.toIdx, action.fromIdx);
        } else if (action.type === 'strip-delete') {
            _insertStripPoints(action.stripIdx, action.removed);
        } else if (action.type === 'panel-place') {
            _undoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            // self-inverse
            _reverseStripInPlace(action.stripIdx);
        } else if (action.type === 'strip-offset') {
            stripStore.updateStrip(action.stripIdx, { video_offset: action.oldValue });
        } else if (action.type === 'strip-repin') {
            _revertRepin(action);
        } else if (action.type === 'connector-retarget') {
            for (let i = action.subActions.length - 1; i >= 0; i--) {
                applyInverse(action.subActions[i]);
            }
        } else if (action.type === 'pin-reorder') {
            _applyPinOrder(action.oldOrder);
        } else if (action.type === 'pin-rename') {
            _applyPinRename(action.newId, action.oldId);
        } else if (action.type === 'vo-override-toggle') {
            stripStore.updateStrip(action.stripIdx, {
                videoOffsetOverride: action.oldOverride,
                video_offset: action.oldValue,
            });
        } else if (action.type === 'strip-translate') {
            _applyStripTranslate(action.stripIdx, -action.sdx, -action.sdy);
        } else if (action.type === 'paste-strips') {
            _undoPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof action.beforeJson === 'string' && action.beforeJson.length > 0) {
                load_screenmap_data(action.beforeJson);
            } else {
                // No prior working copy — clear back to a fresh empty state.
                try {
                    localStorage.removeItem('lm:screenmap');
                    localStorage.removeItem('lm:screenmap-meta');
                } catch { /* ignore */ }
                stripStore.load(null);
                screenmap_pts = [[0, 0]];
                rawPts = [[0, 0]];
                stripInfo = null;
                renderStripsPanel();
                setNeedsGeometryUpdate();
            }
        }
    }

    function isStripAction(action: any) {
        return action && (
            action.type === 'strip-rename'
            || action.type === 'strip-reorder'
            || action.type === 'strip-delete'
            || action.type === 'panel-place'
            || action.type === 'strip-reverse'
            || action.type === 'strip-offset'
            || action.type === 'strip-repin'
            || action.type === 'connector-retarget'
            || action.type === 'pin-reorder'
            || action.type === 'pin-rename'
            || action.type === 'vo-override-toggle'
            || action.type === 'strip-translate'
            || action.type === 'paste-strips'
        );
    }

    /** Actions whose undo/redo can legitimately change the distinct pin
     *  count — the persistence guard must be told before saving. */
    function isPinMutationAction(action: any) {
        return action && (
            action.type === 'strip-repin'
            || action.type === 'connector-retarget'
            || action.type === 'strip-delete'
            || action.type === 'pin-reorder'
            || action.type === 'pin-rename'
            || action.type === 'panel-place'
            || action.type === 'paste-strips'
            || action.type === 'restore-backup'
        );
    }

    function performUndo() {
        if (undoStack.length === 0) return;
        const action = undoStack.pop();
        applyInverse(action);
        redoStack.push(action);
        updateUndoRedoButtons();
        setNeedsGeometryUpdate();
        if (isPinMutationAction(action)) notePinMutation();
        if (isStripAction(action)) {
            _persistMultiStrip();
            renderStripsPanel();
        }
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
        if (isPinMutationAction(action)) notePinMutation();
        if (isStripAction(action)) {
            _persistMultiStrip();
            renderStripsPanel();
        }
        markDirty();
    }

    function updateUndoRedoButtons() {
        dom_btn_undo.disabled = undoStack.length === 0;
        dom_btn_redo.disabled = redoStack.length === 0;
        dom_btn_reset.disabled = undoStack.length === 0 && redoStack.length === 0;
    }

    // ── Multi-strip metadata sync helpers ────────────────────────────────
    // Thin wrappers around the StripStore. All mutation logic lives in
    // strips-model.js; these exist so the existing call sites read the
    // same as before. The store operates on whatever `stripInfo` is
    // currently loaded (kept in sync via stripStore.load(...) below).
    function _snapshotStripInfo() { return stripStore.snapshot(); }
    function _restoreStripInfo(snap: any) { stripStore.restore(snap); }
    function _stripInfoOnDelete(idx: any) { stripStore.onDelete(idx); }
    function _stripInfoOnInsert(idx: any) { stripStore.onInsert(idx); }

    function deletePoint(idx: any) {
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
        selection.onPointDelete(idx);
        setNeedsGeometryUpdate();
    }

    function insertPointAt(insertIdx: any, screenmapPt: any, rawPt: any) {
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
        selection.onPointInsert(insertIdx);
        selectedIdx = insertIdx;
        syncPointSelection(insertIdx);
        setNeedsGeometryUpdate();
    }

    function insertBetween(edgeIdx: any) {
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

    function canvasToScreenmapCoords(canvasX: any, canvasY: any) {
        const { sX, sY, cosR, sinR, tx, ty } = getCurrentTransform();
        const wx = (canvasX - canvasW / 2) / camZoom - camPanX;
        const wy = (canvasY - canvasH / 2) / camZoom - camPanY;
        const dx = wx - tx, dy = wy - ty;
        return [(dx * cosR + dy * sinR) / sX, (-dx * sinR + dy * cosR) / sY];
    }

    function screenmapToRawCoords(sx: any, sy: any) {
        return [
            rawPts[0][0] + (sx - screenmap_pts[0][0]) / fitScale,
            rawPts[0][1] + (sy - screenmap_pts[0][1]) / fitScale,
        ];
    }

    function findNearestEdge(canvasX: any, canvasY: any) {
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
        selection.clear();
        pointEditStripIdx = null;
        stripDragActive = false;
        stripDragIdx = -1;
        stripDragStartScreenmap = null;
        stripDragStartRaw = null;
        altQuasimode = false;
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

    function showContextMenu(clientX: any, clientY: any, idx: any, edgeIdx: any, insideBBox?: any) {
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
        // Copy strip only when a strip is selected
        if (ctxBtnCopyStrip) {
            const sIdx = selection.getStripIdx();
            ctxBtnCopyStrip.style.display = (sIdx !== null && sIdx >= 0) ? 'block' : 'none';
        }
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

    // ── Strips inspector panel ───────────────────────────────────────────
    const dom_strips_panel = container.querySelector('#strips_panel');
    const dom_strips_list = container.querySelector('#strips_list');

    function hslAccentForStrip(s: any, total: any) {
        if (total <= 1) return '#3b82f6';
        const colors = getStripColors(total);
        return colors[s];
    }

    // Pins the user has collapsed in the panel (survives re-renders).
    const collapsedPins = new Set();

    /** Previous / next strip index sharing the same pin, or -1. */
    function _withinPinNeighbor(stripIdx: any, dir: any) {
        const strips = stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const pin = _pinOfStrip(strips[stripIdx]);
        let i = stripIdx + dir;
        while (i >= 0 && i < strips.length) {
            if (_pinOfStrip(strips[i]) === pin) return i;
            i += dir;
        }
        return -1;
    }

    function renderStripsPanel() {
        if (!dom_strips_list) return;
        const strips = stripStore.getStrips();
        dom_strips_list.innerHTML = '';
        // Keep the panel visible whenever we have a backup to surface — even
        // when no strips are currently loaded — so the user can find "Restore
        // backup…" after pressing New.
        const haveBackup = !!getBackup();
        if (strips.length === 0) {
            dom_strips_panel.style.display = haveBackup ? '' : 'none';
            renderSelectedStripRow();
            return;
        }
        dom_strips_panel.style.display = '';
        dom_strips_list.classList.toggle('chain-mode', editorMode === 'chain');
        dom_strips_list.classList.toggle('reorder-mode', editorMode === 'reorder');
        const selStripIdx = selection.getStripIdx();
        const total = strips.length;

        // Group strip indices under pins in first-appearance order (§1.1).
        const pinOrder = [];
        const groups = new Map();
        for (let i = 0; i < strips.length; i++) {
            const p = _pinOfStrip(strips[i]);
            if (!groups.has(p)) { groups.set(p, []); pinOrder.push(p); }
            groups.get(p).push(i);
        }

        const buildStripRow = (i: any) => {
            const s = strips[i];
            const row = document.createElement('div');
            row.className = 'strip-row' + (i === selStripIdx ? ' active' : '');
            row.dataset.stripIdx = String(i);
            row.dataset.pinId = _pinOfStrip(s);

            const grip = document.createElement('span');
            grip.className = 'strip-grip';
            grip.textContent = '⠿';
            grip.title = 'Drag within pin to reorder | drag onto a pin header to repin';
            grip.draggable = true;
            grip.dataset.stripIdx = String(i);
            row.appendChild(grip);

            const swatch = document.createElement('span');
            swatch.className = 'strip-swatch';
            swatch.style.background = hslAccentForStrip(i, total);
            row.appendChild(swatch);

            const name = document.createElement('span');
            name.className = 'strip-name';
            name.textContent = s.name;
            row.appendChild(name);

            const count = document.createElement('span');
            count.className = 'strip-count';
            count.textContent = `${s.count} LED${s.count === 1 ? '' : 's'}`;
            row.appendChild(count);

            const mkBtn = (label: any, title: any, action: any, disabled: any) => {
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

            row.appendChild(mkBtn('▲', 'Move up within pin', 'up', _withinPinNeighbor(i, -1) < 0));
            row.appendChild(mkBtn('▼', 'Move down within pin', 'down', _withinPinNeighbor(i, +1) < 0));
            row.appendChild(mkBtn('Rev', 'Reverse LED order', 'reverse', s.count < 2));
            row.appendChild(mkBtn('Rename', 'Rename strip', 'rename', false));
            row.appendChild(mkBtn('×', 'Delete strip', 'delete', strips.length <= 1));

            // video_offset display: read-only unless this strip's LOCK
            // (videoOffsetOverride) is engaged (§1.4).
            const overridden = s.videoOffsetOverride === true;
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
            const idxs = groups.get(pin);
            const ledTotal = idxs.reduce((a: any, i: any) => a + strips[i].count, 0);
            const det = document.createElement('details');
            det.className = 'pin-group';
            det.dataset.pinId = pin;
            det.open = !collapsedPins.has(pin);
            det.addEventListener('toggle', () => {
                if (det.open) collapsedPins.delete(pin);
                else collapsedPins.add(pin);
            }, { signal });

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
            pinMeta.textContent = `${idxs.length} strip${idxs.length === 1 ? '' : 's'} · ${ledTotal} LED${ledTotal === 1 ? '' : 's'}`;
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
                body.appendChild(buildStripRow(idxs[k]));
                // Connector rows between same-pin strips — visible only in
                // Chain mode (§1.6); click opens the inline connector menu.
                if (editorMode === 'chain' && k < idxs.length - 1) {
                    connectorN++;
                    const cr = document.createElement('div');
                    cr.className = 'connector-row';
                    cr.dataset.upIdx = String(idxs[k]);
                    cr.dataset.downIdx = String(idxs[k + 1]);
                    cr.textContent = `──(${connectorN})──▶`;
                    cr.title = 'Connector — click for Swap / Split / Move options';
                    body.appendChild(cr);
                }
            }
            det.appendChild(body);

            dom_strips_list.appendChild(det);
        }
        renderSelectedStripRow();
    }

    // ── Backup row inside #strips_panel ─────────────────────────────────
    const dom_strips_backup_row = container.querySelector('#strips_backup_row');
    const dom_strips_backup_summary = container.querySelector('#strips_backup_summary');
    const dom_strips_btn_restore_backup = container.querySelector('#strips_btn_restore_backup');

    function renderBackupRow() {
        if (!dom_strips_backup_row) return;
        const b = getBackup();
        if (!b || !b.meta) {
            dom_strips_backup_row.style.display = 'none';
            if (dom_strips_btn_restore_backup) dom_strips_btn_restore_backup.disabled = true;
            return;
        }
        const m = b.meta;
        const stripCount = typeof m.stripCount === 'number' ? m.stripCount : 0;
        const ledCount = typeof m.ledCount === 'number' ? m.ledCount : 0;
        const when = typeof m.savedAt === 'number' ? _relativeTime(m.savedAt) : '';
        const summary = `${stripCount} strip${stripCount === 1 ? '' : 's'} · ${ledCount} LED${ledCount === 1 ? '' : 's'} · ${when}`;
        if (dom_strips_backup_summary) dom_strips_backup_summary.textContent = summary;
        dom_strips_backup_row.style.display = '';
        if (dom_strips_btn_restore_backup) dom_strips_btn_restore_backup.disabled = false;
    }

    function doRestoreBackupFromButton() {
        const b = getBackup();
        if (!b) return;
        const beforeJson = getScreenmap();
        const restored = restoreBackup();
        if (!restored) return;
        pushUndo({
            type: 'restore-backup',
            beforeJson: typeof beforeJson === 'string' ? beforeJson : null,
            afterJson: restored,
        });
        load_screenmap_data(restored);
        renderBackupRow();
        _toastSuccess('Backup restored');
    }

    if (dom_strips_btn_restore_backup) {
        dom_strips_btn_restore_backup.addEventListener('click', doRestoreBackupFromButton, { signal });
    }

    if (dom_strips_list) {
        dom_strips_list.addEventListener('click', async (e: any) => {
            const btn = e.target.closest('button[data-action]');
            if (btn) {
                e.stopPropagation();
                e.preventDefault();
                const action = btn.dataset.action;
                if (action === 'add-strip') {
                    pendingNewStripPin = btn.dataset.pinId || null;
                    _openInsertDialog();
                    return;
                }
                const idx = parseInt(btn.dataset.stripIdx, 10);
                if (action === 'up') doReorderStrip(idx, _withinPinNeighbor(idx, -1));
                else if (action === 'down') doReorderStrip(idx, _withinPinNeighbor(idx, +1));
                else if (action === 'reverse') doReverseStrip(idx);
                else if (action === 'rename') await doRenameStripPrompt(idx);
                else if (action === 'delete') await doDeleteStripPrompt(idx);
                else if (action === 'lock') doToggleVoLock(idx);
                return;
            }
            // Pin name click → rename (don't toggle the <details>)
            const pinName = e.target.closest('.pin-name');
            if (pinName) {
                e.preventDefault();
                e.stopPropagation();
                await doRenamePinPrompt(pinName.dataset.pinId);
                return;
            }
            // Connector row click → inline menu (Chain mode, §1.6)
            const cRow = e.target.closest('.connector-row');
            if (cRow) {
                e.preventDefault();
                e.stopPropagation();
                _openConnectorMenu(
                    parseInt(cRow.dataset.upIdx, 10),
                    parseInt(cRow.dataset.downIdx, 10),
                    e.clientX, e.clientY,
                );
                return;
            }
            // Ignore clicks that target inputs (so they keep focus)
            if (e.target.closest('input')) return;
            const row = e.target.closest('.strip-row');
            if (row) {
                const idx = parseInt(row.dataset.stripIdx, 10);
                selection.selectStrip(idx);
            }
        }, { signal });

        dom_strips_list.addEventListener('change', (e: any) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.dataset.role === 'video-offset') {
                if (t.readOnly) return; // derived value — LOCK not engaged
                const idx = parseInt(t.dataset.stripIdx ?? '', 10);
                doSetVideoOffset(idx, t.value);
            }
        }, { signal });

        // ── Drag & drop: grip drag (reorder / repin) + pin header drag ──
        /** @type {null | {kind:'strip', idx:number} | {kind:'pin', pinId:string}} */
        let panelDragState: any = null;

        const clearDragOver = () => {
            for (const el of dom_strips_list.querySelectorAll('.drag-over')) {
                el.classList.remove('drag-over');
            }
        };

        dom_strips_list.addEventListener('dragstart', (e: any) => {
            const grip = e.target.closest ? e.target.closest('.strip-grip') : null;
            if (grip) {
                panelDragState = { kind: 'strip', idx: parseInt(grip.dataset.stripIdx, 10) };
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                return;
            }
            const header = e.target.closest ? e.target.closest('.pin-header') : null;
            if (header) {
                panelDragState = { kind: 'pin', pinId: header.dataset.pinId };
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }
        }, { signal });

        dom_strips_list.addEventListener('dragover', (e: any) => {
            if (!panelDragState) return;
            const target = e.target.closest
                ? (e.target.closest('.strip-row') || e.target.closest('.pin-header'))
                : null;
            if (!target) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            clearDragOver();
            target.classList.add('drag-over');
        }, { signal });

        dom_strips_list.addEventListener('drop', (e: any) => {
            if (!panelDragState) return;
            e.preventDefault();
            clearDragOver();
            const drag = panelDragState;
            panelDragState = null;
            const rowTarget = e.target.closest ? e.target.closest('.strip-row') : null;
            const headerTarget = e.target.closest ? e.target.closest('.pin-header') : null;
            if (drag.kind === 'strip') {
                if (rowTarget) {
                    const toIdx = parseInt(rowTarget.dataset.stripIdx, 10);
                    if (toIdx === drag.idx) return;
                    const strips = stripStore.getStrips();
                    const fromPin = strips[drag.idx] ? _pinOfStrip(strips[drag.idx]) : null;
                    const toPin = rowTarget.dataset.pinId;
                    if (fromPin === toPin) doReorderStrip(drag.idx, toIdx);
                    else doRepinStrip(drag.idx, toPin);
                } else if (headerTarget) {
                    doRepinStrip(drag.idx, headerTarget.dataset.pinId);
                }
            } else if (drag.kind === 'pin' && headerTarget) {
                const order = stripStore.getPinOrder();
                const toIdx = order.indexOf(headerTarget.dataset.pinId);
                if (toIdx >= 0) doReorderPin(drag.pinId, toIdx);
            }
        }, { signal });

        dom_strips_list.addEventListener('dragend', () => {
            panelDragState = null;
            clearDragOver();
        }, { signal });
    }

    // ── [+ Pin] button + selected-strip "Move to pin…" row ──────────────
    const dom_strips_btn_add_pin = container.querySelector('#strips_btn_add_pin');
    if (dom_strips_btn_add_pin) {
        dom_strips_btn_add_pin.addEventListener('click', () => { doAddPin(); }, { signal });
    }

    // ── [Chain] / [Reorder] toolbar modes (issue #24 §1.6, Phase 3) ─────
    const dom_strips_btn_chain = container.querySelector('#strips_btn_chain');
    const dom_strips_btn_reorder = container.querySelector('#strips_btn_reorder');

    /** Switch the editor mode: 'chain' | 'reorder' | null (toggles are
     *  mutually exclusive). Cancels any in-flight connector drag. */
    function setEditorMode(mode: any) {
        const m = (mode === 'chain' || mode === 'reorder') ? mode : null;
        if (m === editorMode) return;
        editorMode = m;
        connectorDrag = null;
        startHandleDrag = null;
        if (m && dom_strips_panel) dom_strips_panel.open = true;
        if (dom_strips_btn_chain) {
            dom_strips_btn_chain.classList.toggle('active', m === 'chain');
            dom_strips_btn_chain.setAttribute('aria-pressed', m === 'chain' ? 'true' : 'false');
        }
        if (dom_strips_btn_reorder) {
            dom_strips_btn_reorder.classList.toggle('active', m === 'reorder');
            dom_strips_btn_reorder.setAttribute('aria-pressed', m === 'reorder' ? 'true' : 'false');
        }
        // Reorder mode dims the canvas (§1.6); wrapper exists post-initRenderer.
        if (wrapper) wrapper.classList.toggle('canvas-dim', m === 'reorder');
        _hideConnectorMenu();
        renderStripsPanel();
        _updateHintStrip();
        setNeedsRender();
    }

    if (dom_strips_btn_chain) {
        dom_strips_btn_chain.addEventListener('click', () => {
            setEditorMode(editorMode === 'chain' ? null : 'chain');
        }, { signal });
        // Canvas Chain-mode interactions are desktop-only (§1.11): hide the
        // button on touch-only devices.
        try {
            if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
                dom_strips_btn_chain.style.display = 'none';
            }
        } catch { /* matchMedia unavailable */ }
    }
    if (dom_strips_btn_reorder) {
        dom_strips_btn_reorder.addEventListener('click', () => {
            setEditorMode(editorMode === 'reorder' ? null : 'reorder');
        }, { signal });
    }

    const dom_strips_selected_row = container.querySelector('#strips_selected_row');
    const dom_strips_selected_label = container.querySelector('#strips_selected_label');
    const dom_strips_move_pin = container.querySelector('#strips_move_pin');

    function renderSelectedStripRow() {
        if (!dom_strips_selected_row) return;
        const strips = stripStore.getStrips();
        const sIdx = selection.getStripIdx();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            dom_strips_selected_row.style.display = 'none';
            return;
        }
        const s = strips[sIdx];
        const pin = _pinOfStrip(s);
        dom_strips_selected_row.style.display = '';
        if (dom_strips_selected_label) {
            dom_strips_selected_label.textContent = `Selected: ${s.name} (${pin})`;
        }
        if (dom_strips_move_pin) {
            dom_strips_move_pin.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Move to pin…';
            placeholder.selected = true;
            placeholder.disabled = true;
            dom_strips_move_pin.appendChild(placeholder);
            for (const p of stripStore.getPinOrder()) {
                if (p === pin) continue;
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                dom_strips_move_pin.appendChild(opt);
            }
            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = 'New pin…';
            dom_strips_move_pin.appendChild(newOpt);
        }
    }

    if (dom_strips_move_pin) {
        dom_strips_move_pin.addEventListener('change', () => {
            const sIdx = selection.getStripIdx();
            const value = dom_strips_move_pin.value;
            if (sIdx === null || sIdx < 0 || !value) return;
            if (value === '__new__') doRepinStrip(sIdx, _nextFreePinId());
            else doRepinStrip(sIdx, value);
        }, { signal });
    }

    // ── Show chain checkbox ──────────────────────────────────────────────
    const dom_strips_show_chain = container.querySelector('#strips_show_chain');
    let showChainArrows = dom_strips_show_chain ? !!dom_strips_show_chain.checked : true;
    if (dom_strips_show_chain) {
        dom_strips_show_chain.addEventListener('change', () => {
            showChainArrows = !!dom_strips_show_chain.checked;
            setNeedsRender();
        }, { signal });
    }

    function _reverseStripInPlace(stripIdx: any) {
        const info = stripStore.get();
        if (!info) return false;
        const strip = info.strips[stripIdx];
        if (!strip || strip.count < 2) return false;
        const lo = strip.offset, hi = strip.offset + strip.count;
        // Reverse the flat slice in both screenmap_pts and rawPts.
        const sm = screenmap_pts.slice(lo, hi).reverse();
        const rw = rawPts.slice(lo, hi).reverse();
        for (let i = 0; i < sm.length; i++) {
            screenmap_pts[lo + i] = sm[i];
            rawPts[lo + i] = rw[i];
        }
        if (Array.isArray(strip.points)) strip.points.reverse();
        if (Array.isArray(info.allPoints)) {
            for (let i = 0; i < sm.length; i++) info.allPoints[lo + i] = [sm[i][0], sm[i][1]];
        }
        return true;
    }

    function doReverseStrip(stripIdx: any) {
        if (!_reverseStripInPlace(stripIdx)) return;
        pushUndo({ type: 'strip-reverse', stripIdx });
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
    }

    function doSetVideoOffset(stripIdx: any, rawValue: any) {
        const strips = stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const v = parseInt(rawValue, 10);
        if (!Number.isFinite(v) || v < 0) {
            renderStripsPanel();
            return;
        }
        const oldValue = typeof strips[stripIdx].video_offset === 'number'
            ? strips[stripIdx].video_offset
            : strips[stripIdx].offset;
        if (oldValue === v) return;
        stripStore.updateStrip(stripIdx, { video_offset: v });
        pushUndo({ type: 'strip-offset', stripIdx, oldValue, newValue: v });
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsRender();
    }

    // ── Pin operations (issue #24, Phase 2) ──────────────────────────────

    /** One-shot toast shown on the first cross-pin move (§1.10). */
    function _maybeShowRepinToast(stripName: any, newPin: any) {
        try {
            if (localStorage.getItem('lm:shapeeditor-repinToastShown')) return;
            localStorage.setItem('lm:shapeeditor-repinToastShown', '1');
        } catch { /* private mode */ }
        _toastInfo(`Moved "${stripName}" to ${newPin}. vo: was reset; Undo to restore.`);
    }

    /**
     * Move a strip to another pin. Clears its videoOffsetOverride and
     * re-derives video_offset (§1.4). Emits a `strip-repin` undo action.
     * Returns true when a move happened.
     */
    function doRepinStrip(stripIdx: any, newPinRaw: any) {
        const strips = stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return false;
        const newPin = typeof newPinRaw === 'string' ? newPinRaw.trim() : '';
        if (!newPin) return false;
        const s = strips[stripIdx];
        const oldPin = _pinOfStrip(s);
        if (newPin === oldPin) return false;
        const action = {
            type: 'strip-repin',
            stripIdx,
            oldPin,
            newPin,
            oldWithinPinIdx: _withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st: any) => _pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride === true,
        };
        _applyRepin(action);
        pushUndo(action);
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        _maybeShowRepinToast(s.name, newPin);
        return true;
    }

    /**
     * Toggle the per-strip [LOCK] (videoOffsetOverride). Locking keeps the
     * current value and makes vo: editable; unlocking re-derives.
     * Emits a `vo-override-toggle` undo action.
     */
    function doToggleVoLock(stripIdx: any) {
        const strips = stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return;
        const s = strips[stripIdx];
        const oldOverride = s.videoOffsetOverride === true;
        const newOverride = !oldOverride;
        const oldValue = typeof s.video_offset === 'number' ? s.video_offset : s.offset;
        const newValue = newOverride ? oldValue : stripStore.getDerivedVideoOffset(stripIdx);
        stripStore.updateStrip(stripIdx, { videoOffsetOverride: newOverride, video_offset: newValue });
        pushUndo({ type: 'vo-override-toggle', stripIdx, oldOverride, newOverride, oldValue, newValue });
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsRender();
    }

    /** Rename a pin (core, no prompt). Returns true when applied. */
    function doRenamePin(oldId: any, newIdRaw: any) {
        const newId = typeof newIdRaw === 'string' ? newIdRaw.trim() : '';
        if (!newId || newId === oldId) return false;
        const pins = stripStore.getPinOrder();
        if (!pins.includes(oldId)) return false;
        if (pins.includes(newId)) return false;
        _applyPinRename(oldId, newId);
        pushUndo({ type: 'pin-rename', oldId, newId });
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        return true;
    }

    async function doRenamePinPrompt(pinId: any) {
        const pins = stripStore.getPinOrder();
        if (!pins.includes(pinId)) return;
        const Swal = (await import('sweetalert2')).default;
        if (signal.aborted) return;
        const { value } = await Swal.fire({
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
        if (signal.aborted || typeof value !== 'string') return;
        doRenamePin(pinId, value);
    }

    /** Move pin `pinId` to position `toIdx` in the pin order. */
    function doReorderPin(pinId: any, toIdx: any) {
        const oldOrder = stripStore.getPinOrder();
        const fromIdx = oldOrder.indexOf(pinId);
        if (fromIdx < 0) return false;
        const clamped = Math.max(0, Math.min(oldOrder.length - 1, toIdx));
        if (clamped === fromIdx) return false;
        const newOrder = [...oldOrder];
        newOrder.splice(fromIdx, 1);
        newOrder.splice(clamped, 0, pinId);
        _applyPinOrder(newOrder);
        pushUndo({ type: 'pin-reorder', oldOrder, newOrder });
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        return true;
    }

    /**
     * [+ Pin]: pins exist only through strips (§1.1), so creating a pin
     * moves the SELECTED strip onto a fresh pinN. Returns the new pin id,
     * or null when no strip is selected.
     */
    function doAddPin() {
        const sIdx = selection.getStripIdx();
        const strips = stripStore.getStrips();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            _toastInfo('Select a strip first — [+ Pin] moves it to a new pin');
            return null;
        }
        const newPin = _nextFreePinId();
        doRepinStrip(sIdx, newPin);
        return newPin;
    }

    // ── Chain-mode connector operations (issue #24 §1.7, Phase 3) ───────

    /** Build a strip-repin action object for stripIdx → newPin (no apply). */
    function _makeRepinAction(stripIdx: any, newPin: any) {
        const strips = stripStore.getStrips();
        const s = strips[stripIdx];
        return {
            type: 'strip-repin',
            stripIdx,
            oldPin: _pinOfStrip(s),
            newPin,
            oldWithinPinIdx: _withinPinIdx(stripIdx),
            newWithinPinIdx: strips.filter((st: any) => _pinOfStrip(st) === newPin).length,
            oldVideoOffset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
            oldOverride: s.videoOffsetOverride === true,
        };
    }

    /** Finish a composite connector edit: push ONE undo entry + persist. */
    function _commitComposite(subActions: any, crossPin: any, toastStripName: any, toastPin: any) {
        if (subActions.length === 0) return false;
        pushUndo({ type: 'connector-retarget', subActions });
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        if (crossPin) _maybeShowRepinToast(toastStripName, toastPin);
        return true;
    }

    /**
     * Retarget the connector leaving `upIdx` so that strip feeds `tgtIdx`:
     * the target strip moves to immediately after the upstream strip, taking
     * the upstream strip's pin when they differ. Emits ONE composite
     * `connector-retarget` undo entry {subActions: [strip-repin?, strip-reorder?]}.
     */
    function doConnectorRetarget(upIdx: any, tgtIdx: any) {
        const strips = stripStore.getStrips();
        if (upIdx < 0 || upIdx >= strips.length) return false;
        if (tgtIdx < 0 || tgtIdx >= strips.length) return false;
        if (upIdx === tgtIdx) return false;
        const upStrip = strips[upIdx];
        const tgtStrip = strips[tgtIdx];
        const upPin = _pinOfStrip(upStrip);
        const tgtPin = _pinOfStrip(tgtStrip);
        const subActions = [];
        let crossPin = false;
        if (tgtPin !== upPin) {
            const repin = _makeRepinAction(tgtIdx, upPin);
            applyAction(repin);
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
            applyAction(reorder);
            subActions.push(reorder);
        }
        return _commitComposite(subActions, crossPin, tgtStrip.name, upPin);
    }

    /**
     * Split a pin at the connector ABOVE `downIdx`: that strip and every
     * following same-pin strip move onto a fresh pin, preserving order.
     * One composite undo entry.
     */
    function doSplitPinAt(downIdx: any) {
        const strips = stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return false;
        const pin = _pinOfStrip(s);
        const moving = [];
        for (let i = downIdx; i < strips.length; i++) {
            if (_pinOfStrip(strips[i]) === pin) moving.push(strips[i]);
            else break;
        }
        if (moving.length === 0) return false;
        const newPin = _nextFreePinId();
        const subActions = [];
        for (const obj of moving) {
            const idx = strips.indexOf(obj);
            if (idx < 0) continue;
            const repin = _makeRepinAction(idx, newPin);
            applyAction(repin);
            subActions.push(repin);
        }
        return _commitComposite(subActions, true, s.name, newPin);
    }

    /** "Move downstream to pin…" prompt for the strip below a connector. */
    async function _moveDownstreamToPinPrompt(downIdx: any) {
        const strips = stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return;
        const curPin = _pinOfStrip(s);
        const options: any = {};
        for (const p of stripStore.getPinOrder()) {
            if (p !== curPin) options[p] = p;
        }
        options.__new__ = 'New pin…';
        const Swal = (await import('sweetalert2')).default;
        if (signal.aborted) return;
        const { value } = await Swal.fire({
            title: `Move "${s.name}" to pin`,
            input: 'select',
            inputOptions: options,
            showCancelButton: true,
            background: '#1a1a1a',
            color: '#e5e7eb',
        });
        if (signal.aborted || typeof value !== 'string' || !value) return;
        doRepinStrip(downIdx, value === '__new__' ? _nextFreePinId() : value);
    }

    // ── Inline connector menu (shared by panel rows + canvas right-click) ─
    let connectorMenuEl: any = null;

    function _hideConnectorMenu() {
        if (connectorMenuEl) {
            connectorMenuEl.remove();
            connectorMenuEl = null;
        }
    }

    function _openConnectorMenu(upIdx: any, downIdx: any, clientX: any, clientY: any) {
        _hideConnectorMenu();
        const menu = document.createElement('div');
        menu.className = 'connector-menu';
        const mk = (label: any, fn: any) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', () => { _hideConnectorMenu(); fn(); }, { signal });
            menu.appendChild(b);
        };
        mk('Swap upstream', () => { doReorderStrip(downIdx, upIdx); });
        mk('Split pin here', () => { doSplitPinAt(downIdx); });
        mk('Move downstream to pin…', () => { _moveDownstreamToPinPrompt(downIdx); });
        menu.style.left = `${Math.min(clientX, window.innerWidth - 200)}px`;
        menu.style.top = `${Math.min(clientY, window.innerHeight - 110)}px`;
        document.body.appendChild(menu);
        connectorMenuEl = menu;
    }

    window.addEventListener('mousedown', (e) => {
        if (connectorMenuEl && !connectorMenuEl.contains(e.target)) {
            _hideConnectorMenu();
        }
    }, { signal });

    // ── Chain-mode canvas hit helpers (geometry from drawChainArrows) ────

    function _hitChainArrowhead(cx: any, cy: any) {
        for (const c of _chainGeom.connectors) {
            const dx = cx - c.hx, dy = cy - c.hy;
            if (dx * dx + dy * dy <= 14 * 14) return c;
        }
        return null;
    }

    function _hitStartHandle(cx: any, cy: any, excludeIdx: any) {
        for (const st of _chainGeom.starts) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip;
        }
        return null;
    }

    function _hitEndHandle(cx: any, cy: any, excludeIdx: any) {
        for (const st of _chainGeom.ends) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip;
        }
        return null;
    }

    /** Distance-to-segment hit test on connector arrow bodies. */
    function _hitConnectorBody(cx: any, cy: any) {
        for (const c of _chainGeom.connectors) {
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
    }

    /** Live strips-panel row-order preview during a connector drag: move the
     *  target row to just after the upstream row (DOM-only, no state). */
    function _previewConnectorTarget(upIdx: any, targetIdx: any) {
        renderStripsPanel();
        if (targetIdx === null || targetIdx === undefined || upIdx === null) return;
        if (!dom_strips_list) return;
        const upRow = dom_strips_list.querySelector(`.strip-row[data-strip-idx="${upIdx}"]`);
        const tgtRow = dom_strips_list.querySelector(`.strip-row[data-strip-idx="${targetIdx}"]`);
        if (upRow && tgtRow && upRow !== tgtRow) {
            upRow.after(tgtRow);
            tgtRow.classList.add('preview-move');
        }
    }

    function _cancelConnectorDrag() {
        if (!connectorDrag && !startHandleDrag) return;
        connectorDrag = null;
        startHandleDrag = null;
        renderStripsPanel();
        setNeedsRender();
    }

    function doReorderStrip(fromIdx: any, toIdx: any) {
        const strips = stripStore.getStrips();
        if (fromIdx < 0 || fromIdx >= strips.length) return;
        if (toIdx < 0 || toIdx >= strips.length) return;
        if (fromIdx === toIdx) return;
        _reorderStripPoints(fromIdx, toIdx);
        selection.onStripReorder(fromIdx, toIdx);
        pushUndo({ type: 'strip-reorder', fromIdx, toIdx });
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
    }

    async function doRenameStripPrompt(stripIdx: any) {
        const strips = stripStore.getStrips();
        const strip = strips[stripIdx];
        if (!strip) return;
        const oldName = strip.name;
        const Swal = (await import('sweetalert2')).default;
        if (signal.aborted) return;
        const { value } = await Swal.fire({
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
                        if (i !== stripIdx && strips[i].name === name) {
                            return `A strip named "${name}" already exists`;
                        }
                    }
                }
                return null;
            },
        });
        if (signal.aborted || typeof value !== 'string') return;
        const newName = value.trim();
        if (!newName || newName === oldName) return;
        stripStore.renameStrip(stripIdx, newName);
        pushUndo({ type: 'strip-rename', stripIdx, oldName, newName });
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
    }

    async function doDeleteStripPrompt(stripIdx: any) {
        const strips = stripStore.getStrips();
        if (strips.length <= 1) return;
        const strip = strips[stripIdx];
        if (!strip) return;
        const Swal = (await import('sweetalert2')).default;
        if (signal.aborted) return;
        const result = await Swal.fire({
            title: `Delete "${strip.name}"?`,
            text: `${strip.count} LED${strip.count === 1 ? '' : 's'} will be removed.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: '#ef4444',
        });
        if (signal.aborted || !result.isConfirmed) return;
        const removed = _removeStripPoints(stripIdx);
        selection.onStripRemove(stripIdx);
        selectedIdx = -1;
        pushUndo({ type: 'strip-delete', stripIdx, removed });
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
    }

    let rafId: any = null;

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

    function canvasDeltaToScreenmapDelta(dx: any, dy: any) {
        const { sX, sY, cosR, sinR } = getCurrentTransform();
        // Account for camera zoom, then inverse rotation and inverse scale
        const wdx = dx / camZoom;
        const wdy = dy / camZoom;
        const urx = wdx * cosR + wdy * sinR;
        const ury = -wdx * sinR + wdy * cosR;
        return [urx / sX, ury / sY];
    }

    function getCanvasCoords(e: any) {
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
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;';
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

        // ── Discoverability entry points ──
        makeCtxBtn('Insert panel…', 'insert-panel');
        makeCtxBtn('Paste screenmap', 'paste-screenmap');
        ctxBtnCopyStrip = makeCtxBtn('Copy strip', 'copy-strip');

        // ── Point operations ──
        ctxBtnDelete = makeCtxBtn('Delete Point', 'delete');
        ctxBtnInsertBetween = makeCtxBtn('Insert between', 'insert-between');
        ctxBtnInsertFwd = makeCtxBtn('Insert, shift forward', 'insert-forward');
        ctxBtnInsertBack = makeCtxBtn('Insert, shift back', 'insert-back');

        // Trailing help entry
        makeCtxSeparator();
        makeCtxBtn('Keyboard help', 'kbd-help');

        document.body.appendChild(ctxMenu);

        // Hidden file input for "Upload file…" submenu item
        const ctxUploadInput = document.createElement('input');
        ctxUploadInput.type = 'file';
        ctxUploadInput.accept = '.json';
        ctxUploadInput.style.display = 'none';
        document.body.appendChild(ctxUploadInput);
        ctxUploadInput.addEventListener('change', () => {
            if (ctxUploadInput.files && ctxUploadInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => load_screenmap_data((ev.target as any).result);
                reader.readAsText(ctxUploadInput.files[0]);
            }
            ctxUploadInput.value = '';
        }, { signal });

        ctxLoadImageInput.addEventListener('change', () => {
            if (ctxLoadImageInput.files[0]) loadBackgroundImage(ctxLoadImageInput.files[0]);
            ctxLoadImageInput.value = '';
        }, { signal });

        ctxMenu.addEventListener('click', (e: any) => {
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
            } else if (action === 'insert-panel') {
                _openInsertDialog();
            } else if (action === 'paste-screenmap') {
                _pasteFromClipboardAPI();
            } else if (action === 'copy-strip') {
                _copySelectedStripToClipboard();
            } else if (action === 'kbd-help') {
                _openHelpOverlay();
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
        overlayCanvas.addEventListener('dblclick', onDoubleClick, { signal });
        overlayCanvas.addEventListener('wheel', (e: any) => {
            e.preventDefault();
            const zoomFactor = Math.pow(2, -e.deltaY / 3000);
            camZoom = Math.max(0.1, Math.min(10, camZoom * zoomFactor));
            setNeedsRender();
        }, { passive: false, signal });

        _wireTouchHandlers(signal);

        const labelStyle = 'position:absolute;pointer-events:none;color:#fff;font:bold 13px/1 "Outfit",system-ui,sans-serif;text-shadow:0 0 3px #000,0 0 3px #000;';

        infoDiv = document.createElement('div');
        infoDiv.style.cssText = labelStyle + 'bottom:10px;left:10px;font-size:14px;line-height:1.6;';
        wrapper.appendChild(infoDiv);

        placeholderDiv = document.createElement('div');
        placeholderDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;color:#fff;font:24px sans-serif;';
        placeholderDiv.textContent = 'Upload a screenmap file to begin';
        wrapper.appendChild(placeholderDiv);

        // ── Hint strip (lives inside #main, outside the renderer wrapper so
        // it sits above the canvas and is part of the tool's DOM) ──
        hintStripTextEl = container.querySelector('#hint_strip_text');
        hintStripHelpBtn = container.querySelector('#hint_strip_help');
        if (hintStripHelpBtn) {
            hintStripHelpBtn.addEventListener('click', () => {
                _openHelpOverlay();
            }, { signal });
        }
        _updateHintStrip();

        buildGrid(width, height);
    }

    // ── Hint strip + help overlay ─────────────────────────────────────────

    function _currentHintState() {
        const selStripIdx = selection.getStripIdx();
        const strips = stripStore.getStrips();
        let selectedStripName = null;
        if (selStripIdx !== null && selStripIdx >= 0 && selStripIdx < strips.length) {
            selectedStripName = strips[selStripIdx].name;
        }
        let pointEditStripName = '';
        if (pointEditStripIdx !== null && pointEditStripIdx >= 0 && pointEditStripIdx < strips.length) {
            pointEditStripName = strips[pointEditStripIdx].name;
        }
        return {
            empty: !stripInfo || stripInfo.strips.length === 0
                || (stripInfo.strips.length === 1 && stripInfo.strips[0].count <= 1
                    && stripInfo.totalCount <= 1),
            placing: !!placingState,
            placingLabel: placingState && placingState.entry ? placingState.entry.label : '',
            pasting: !!pasteState,
            pastingCount: pasteState ? pasteState.strips.length : 0,
            pointEditMode: pointEditStripIdx !== null,
            pointEditStripName,
            selectedStripName,
            chainMode: editorMode === 'chain',
            reorderMode: editorMode === 'reorder',
        };
    }

    function _updateHintStrip() {
        if (!hintStripTextEl) return;
        hintStripTextEl.textContent = hintTextFor(_currentHintState());
    }

    async function _openHelpOverlay() {
        try {
            const Swal = (await import('sweetalert2')).default;
            if (signal.aborted) return;
            const dismissed = localStorage.getItem('lm:shapeeditor-helpDismissed') === '1';
            const html = `
                <div style="text-align:left;font:13px/1.45 'Outfit',system-ui,sans-serif;color:#e5e7eb;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
                    <div>
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Mouse</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li>Drag canvas: pan</li>
                            <li>R-drag: zoom</li>
                            <li>Click LED: select its strip</li>
                            <li>Drag LED: move whole strip</li>
                            <li>Alt + drag LED: move single point</li>
                            <li>Double-click LED: enter point-edit</li>
                            <li>Drag inside box: move selection</li>
                            <li>Corner/edge/rotate handles: scale &amp; rotate layout</li>
                            <li>Shift + click edge: insert between</li>
                            <li>Ctrl + click: extend (append LED)</li>
                            <li>Right-click: context menu</li>
                        </ul>
                    </div>
                    <div>
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Keyboard</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li><b>I</b> — Insert panel</li>
                            <li><b>Ctrl+V</b> — Paste screenmap</li>
                            <li><b>?</b> / <b>F1</b> — This help</li>
                            <li><b>Ctrl+Z</b> / <b>Ctrl+Y</b> — Undo / Redo</li>
                            <li><b>Delete</b> — Remove selection</li>
                            <li><b>Esc</b> — Cancel / exit point-edit</li>
                        </ul>
                        <h3 style="margin:12px 0 6px 0;font-size:14px;color:#93c5fd;">Touch</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li>Tap LED: select strip</li>
                            <li>Drag LED: move whole strip</li>
                            <li>Drag empty space: pan</li>
                            <li>Long-press LED: enter point-edit</li>
                            <li>Long-press empty: context menu</li>
                            <li>Two-finger drag: pan</li>
                            <li>Pinch: zoom</li>
                        </ul>
                    </div>
                </div>
                <div id="help_chains_pins" style="margin-top:14px;text-align:left;font:13px/1.45 'Outfit',system-ui,sans-serif;color:#e5e7eb;">
                    <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Chains and Pins</h3>
                    <ul style="margin:0;padding-left:18px;">
                        <li><b>Chain</b> mode: drag a connector arrowhead to rewire strips; right-click an arrow for Swap / Split / Move options</li>
                        <li><b>Reorder</b> mode: move strips within a pin with the ▲/▼ arrows; drag a grip across pin headers to repin</li>
                        <li><b>+ Pin</b>: move the selected strip onto a fresh pin</li>
                        <li><b>LOCK</b> (🔓/🔒) overrides a strip's <code>video_offset</code>; unlocked values re-derive from pin order</li>
                        <li>Pin names are labels; export order, not name, determines FastLED <code>addLeds</code> call order</li>
                    </ul>
                </div>
                <div style="margin-top:14px;text-align:left;">
                    <label style="font-size:12px;color:#9ca3af;display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                        <input id="help_dont_show" type="checkbox" ${dismissed ? 'checked' : ''}>
                        Don't show on launch
                    </label>
                </div>
            `;
            const res = await Swal.fire({
                title: 'ScreenMap Editor — Keyboard help',
                html,
                width: 640,
                background: '#1a1a1a',
                color: '#e5e7eb',
                confirmButtonText: 'Got it',
                showCloseButton: true,
                focusConfirm: false,
                // preConfirm returning false would block the popup from
                // closing, so wrap the checkbox state in an object.
                preConfirm: () => {
                    const cb = document.getElementById('help_dont_show');
                    return { dontShow: cb ? !!(cb as HTMLInputElement).checked : false };
                },
            });
            // Only the confirm button reports the checkbox; closing via the
            // × or Esc leaves the stored preference untouched.
            if (res && res.isConfirmed && res.value) {
                try {
                    if (res.value.dontShow === true) {
                        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
                    } else {
                        localStorage.removeItem('lm:shapeeditor-helpDismissed');
                    }
                } catch { /* persistence is best-effort */ }
            }
        } catch { /* swal may fail in headless edge cases */ }
    }

    let _gestureNoticeShown = false;
    function _maybeShowGestureNotice() {
        if (_gestureNoticeShown) return;
        const sIdx = selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        try {
            if (localStorage.getItem('lm:shapeeditor-gestureNotice') === '1') {
                _gestureNoticeShown = true;
                return;
            }
        } catch { return; }
        // Don't stack on top of the first-run help modal — skip if the
        // dismissal key is missing (help is about to auto-open or did).
        try {
            if (localStorage.getItem('lm:shapeeditor-helpDismissed') !== '1') return;
        } catch { return; }
        _gestureNoticeShown = true;
        try { localStorage.setItem('lm:shapeeditor-gestureNotice', '1'); } catch { /* ignore */ }
        _toastInfo('New: drag moves the strip — double-click to edit points');
    }

    function _maybeAutoOpenHelpOnLaunch() {
        if (_autoOpenHelpScheduled) return;
        _autoOpenHelpScheduled = true;
        try {
            if (localStorage.getItem('lm:shapeeditor-helpDismissed') === '1') return;
        } catch { return; }
        // Defer to next tick so any preset autoload finishes first
        setTimeout(() => {
            if (signal.aborted) return;
            _openHelpOverlay();
        }, 250);
    }

    function buildGrid(width: any, height: any) {
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

    function center_and_fit(pts: any, canvasW: any, canvasH: any) {
        return centerAndFitPoints(pts, canvasW, canvasH, { margin: 0.95, center: 'origin' });
    }

    function load_screenmap_data(text: any) {
        clearEditingState();

        screenmap_pts = parse_screenmap_data(text);
        if (screenmap_pts.length === 0) return;
        // Loading a new file is a user-initiated pin change — even if it has
        // fewer pins than the previous working copy (guard grace window).
        notePinMutation();
        saveScreenmap(text);
        try { renderBackupRow(); } catch { /* render is best-effort */ }

        // Parse multi-strip metadata for color-coded visualization
        try {
            stripInfo = parseScreenmapMultiStrip(text);
        } catch {
            stripInfo = null;
        }
        stripStore.load(stripInfo);
        renderStripsPanel();

        // Populate diameter from file if available
        if (typeof screenmap_pts.diameter === "number" && screenmap_pts.diameter > 0) {
            origDiameter = screenmap_pts.diameter;
        } else {
            origDiameter = 0.5;
        }
        dom_txt_diameter.value = origDiameter;

        rawPts = screenmap_pts.map(([x, y]: [any, any]) => [x, y]);

        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        screenmap_pts.forEach(([x, y]: [any, any]) => {
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
        // Promote current working copy (if any) into the backup slot BEFORE
        // we wipe it, so the prior layout stays restorable. Then drop the
        // working copy entirely instead of writing a degenerate
        // single-LED screenmap that would auto-load on next launch.
        const hadBackupPromote = promoteToBackup();
        clearEditingState();
        dom_sel_preset.value = '';
        screenmap_pts = [[0, 0]];
        rawPts = [[0, 0]];
        stripInfo = null;
        stripStore.load(null);
        renderStripsPanel();
        origDiameter = 0.5;
        dom_txt_diameter.value = origDiameter;
        origWidth = 0;
        origHeight = 0;
        fitScale = 1;
        resetTransforms();
        setNeedsGeometryUpdate();
        try {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-preset');
        } catch { /* quota / private mode */ }
        try { renderBackupRow(); } catch { /* render is best-effort */ }
        if (hadBackupPromote) {
            _toastInfo('New layout — previous layout kept as backup');
        }
    }, { signal });

    function loadScreenmapFile(file: any) {
        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            alert('Please choose a .json screenmap file.');
            return;
        }
        dom_sel_preset.value = '';
        file.text().then(load_screenmap_data).catch((error: any) => {
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
            // Restore stored screenmap (autosave/backup-aware), then fall
            // back to the first preset if nothing was auto-loaded.
            const autoLoaded = _autoloadOnLaunch();
            renderBackupRow();
            if (autoLoaded) {
                // already loaded
            } else if (loadedPresets.length > 0) {
                dom_sel_preset.value = loadedPresets[0].file;
                dom_sel_preset.dispatchEvent(new Event('change'));
            }
            _updateHintStrip();
            _maybeAutoOpenHelpOnLaunch();
        } catch (e) {
            console.log("Failed to load preset manifest:", e);
            dom_sel_preset.innerHTML = '<option value="">No presets available</option>';
            _maybeAutoOpenHelpOnLaunch();
        }
    }

    // ── Background image ───────────────────────────────────────────────

    let bgImageObjectURL: any = null;
    const bgImageControls = [dom_txt_image_opacity, dom_txt_image_scale,
        dom_txt_image_rotate, dom_txt_image_tx, dom_txt_image_ty,
        dom_btn_remove_image];

    function setBgControlsEnabled(enabled: any) {
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

    let deleteBgConfirmEl: any = null;
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
        deleteBgConfirmEl.addEventListener('click', (e: any) => {
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

    function loadBackgroundImage(file: any) {
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
    function toCanvasCoords(x: any, y: any) {
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
    let rulerDrag: any = null;              // null | 'a' | 'b' | 'body'
    let rulerDragStart: any = null;
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

    function hitTestRuler(cx: any, cy: any) {
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

    function _chainArrowCount() {
        if (!showChainArrows && editorMode !== 'chain') return 0;
        if (!stripInfo || stripInfo.strips.length <= 1) return 0;
        let drawable = 0;
        for (let s = 0; s < stripInfo.strips.length - 1; s++) {
            const a = stripInfo.strips[s];
            const b = stripInfo.strips[s + 1];
            if (a.count > 0 && b.count > 0 && _pinOfStrip(a) === _pinOfStrip(b)) drawable++;
        }
        return drawable;
    }

    /** Cross-pin boundaries get a pin-tinted badge instead of an arrow (§1.7). */
    function _crossPinBadgeCount() {
        if (!showChainArrows && editorMode !== 'chain') return 0;
        if (!stripInfo || stripInfo.strips.length <= 1) return 0;
        let n = 0;
        for (let s = 0; s < stripInfo.strips.length - 1; s++) {
            const a = stripInfo.strips[s];
            const b = stripInfo.strips[s + 1];
            if (a.count > 0 && b.count > 0 && _pinOfStrip(a) !== _pinOfStrip(b)) n++;
        }
        return n;
    }

    function drawChainArrows(pts: any) {
        const strips = stripInfo.strips;
        const ctx = overlayCtx;
        const pinOrder = stripStore.getPinOrder();
        const pinColors = getPinColors(pinOrder.length);
        const pinColorOf = (strip: any) => {
            const i = pinOrder.indexOf(_pinOfStrip(strip));
            return pinColors[i >= 0 ? i : 0] || '#3b82f6';
        };
        // Refresh canvas-space geometry used by Chain-mode hit-tests.
        _chainGeom.connectors.length = 0;
        _chainGeom.starts.length = 0;
        _chainGeom.ends.length = 0;
        _chainGeom.crossBadges.length = 0;
        for (let s = 0; s < strips.length; s++) {
            const st = strips[s];
            if (st.count <= 0) continue;
            const si = st.offset;
            const ei = st.offset + st.count - 1;
            if (si >= pts.length || ei >= pts.length) continue;
            _chainGeom.starts.push({ strip: s, x: pts[si][0], y: pts[si][1] });
            _chainGeom.ends.push({ strip: s, x: pts[ei][0], y: pts[ei][1] });
        }
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        let badgeN = 1;
        for (let s = 0; s < strips.length - 1; s++) {
            const a = strips[s], b = strips[s + 1];
            if (a.count <= 0 || b.count <= 0) continue;
            const aLast = a.offset + a.count - 1;
            const bFirst = b.offset;
            if (aLast >= pts.length || bFirst >= pts.length) continue;
            const [x1, y1] = pts[aLast];
            const [x2, y2] = pts[bFirst];
            if (_pinOfStrip(a) !== _pinOfStrip(b)) {
                // Cross-pin boundary: no arrow — pin-tinted dot near the next
                // strip's Start (§1.7).
                const tint = pinColorOf(b);
                ctx.setLineDash([]);
                ctx.fillStyle = tint;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = tint;
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(_pinOfStrip(b), x2 + 21, y2 - 12);
                ctx.strokeStyle = '#3b82f6';
                ctx.fillStyle = '#3b82f6';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                _chainGeom.crossBadges.push({ up: s, down: s + 1, x: x2 + 12, y: y2 - 12 });
                continue;
            }
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // arrowhead at target
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 4) {
                const ang = Math.atan2(dy, dx);
                const al = 10, ah = 0.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - al * Math.cos(ang - ah), y2 - al * Math.sin(ang - ah));
                ctx.lineTo(x2 - al * Math.cos(ang + ah), y2 - al * Math.sin(ang + ah));
                ctx.closePath();
                ctx.fill();
                ctx.setLineDash([6, 4]);
            }
            // numbered badge at midpoint
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.setLineDash([]);
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.arc(mx, my, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#3b82f6';
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(badgeN), mx, my);
            ctx.setLineDash([6, 4]);
            badgeN++;
            _chainGeom.connectors.push({ up: s, down: s + 1, x1, y1, x2, y2, hx: x2, hy: y2 });
        }
        ctx.restore();
    }

    /** Ghost arrow + drop-target highlight while a Chain-mode drag is live. */
    function _drawChainDragGhost() {
        const ctx = overlayCtx;
        if (!ctx) return;
        const drag = connectorDrag || startHandleDrag;
        if (!drag) return;
        let ax = null, ay = null;
        if (connectorDrag) {
            const end = _chainGeom.ends.find((e) => e.strip === connectorDrag.upIdx);
            if (end) { ax = end.x; ay = end.y; }
        } else {
            const start = _chainGeom.starts.find((e) => e.strip === startHandleDrag.stripIdx);
            if (start) { ax = start.x; ay = start.y; }
        }
        if (ax === null) return;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(drag.x, drag.y);
        ctx.stroke();
        if (drag.targetIdx !== null && drag.targetIdx !== undefined) {
            const handles = connectorDrag ? _chainGeom.starts : _chainGeom.ends;
            const h = handles.find((e) => e.strip === drag.targetIdx);
            if (h) {
                ctx.setLineDash([]);
                ctx.strokeStyle = '#22d3ee';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(h.x, h.y, 13, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
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

        if (lastTransformedPts.length === 0) { ptsBBox = null; drawBgGizmoHandles(); drawRuler(); _drawPlacingGhost(); _drawPasteGhost(); return; }

        const pts = lastTransformedPts.map(([x, y]: [any, any]) => toCanvasCoords(x, y));

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
                    const stripIdx = idxToStrip![i] >= 0 ? idxToStrip![i] : 0;
                    overlayCtx.strokeStyle = stripColors![stripIdx];
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

        // Chain-order arrows: from each strip's LAST LED to next strip's FIRST LED.
        if ((showChainArrows || editorMode === 'chain') && stripInfo && stripInfo.strips.length > 1) {
            drawChainArrows(pts);
        } else {
            _chainGeom.connectors.length = 0;
            _chainGeom.starts.length = 0;
            _chainGeom.ends.length = 0;
            _chainGeom.crossBadges.length = 0;
        }
        _drawChainDragGhost();

        // Start and end LEDs always visible (per strip when multi-strip).
        // Labels go through the layout engine so 16+ strip maps stay readable:
        // anchor dot at the LED, displaced label box, leader line when far.
        overlayCtx.globalAlpha = 1;
        const hasMultiStripLabels = stripInfo && stripInfo.strips.length > 1;
        const labelItems = [];
        const START_COLOR = 'rgba(0,255,0,1)';
        const END_COLOR = 'rgba(255,0,0,1)';
        if (hasMultiStripLabels) {
            for (let s = 0; s < stripInfo.strips.length; s++) {
                const st = stripInfo.strips[s];
                if (st.count <= 0) continue;
                const startIdx = st.offset;
                const endIdx = st.offset + st.count - 1;
                if (startIdx < 0 || endIdx >= pts.length) continue;
                const labels = stripStartEndLabels(st, s);
                labelItems.push({ id: 'start:' + s, text: labels.start, anchorX: pts[startIdx][0], anchorY: pts[startIdx][1], color: START_COLOR, dotRadius: 4 });
                if (labels.end !== null) {
                    labelItems.push({ id: 'end:' + s, text: labels.end, anchorX: pts[endIdx][0], anchorY: pts[endIdx][1], color: END_COLOR, dotRadius: 4 });
                }
            }
        } else {
            if (pts.length > 1) fillCircle(pts[1][0], pts[1][1], 6, 'rgba(0,255,0,0.5)');
            const singleStrip = (stripInfo && stripInfo.strips.length === 1)
                ? { name: stripInfo.strips[0].name, count: pts.length }
                : { name: '', count: pts.length };
            const labels = stripStartEndLabels(singleStrip, 0);
            labelItems.push({ id: 'start:0', text: labels.start, anchorX: pts[0][0], anchorY: pts[0][1], color: START_COLOR, dotRadius: 4 });
            if (labels.end !== null) {
                labelItems.push({ id: 'end:0', text: labels.end, anchorX: pts[pts.length - 1][0], anchorY: pts[pts.length - 1][1], color: END_COLOR, dotRadius: 4 });
            }
        }
        labelRenderer.draw(overlayCtx, labelItems, {
            font: 'bold 13px "Outfit", system-ui, sans-serif',
            textColor: '#fff',
            bounds: { x: 0, y: 0, w: canvasW, h: canvasH },
            obstacles: () => pts.map(([x, y]: [any, any]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });

        // Strip selection bounding box (axis-aligned in canvas space)
        const selStripIdx = selection.getStripIdx();
        if (selStripIdx !== null && stripInfo && selStripIdx < stripInfo.strips.length) {
            const st = stripInfo.strips[selStripIdx];
            if (st.count > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const lo = Math.max(0, st.offset);
                const hi = Math.min(pts.length, st.offset + st.count);
                for (let i = lo; i < hi; i++) {
                    const [px, py] = pts[i];
                    if (px < minX) minX = px;
                    if (py < minY) minY = py;
                    if (px > maxX) maxX = px;
                    if (py > maxY) maxY = py;
                }
                if (isFinite(minX)) {
                    const pad = 10;
                    overlayCtx.globalAlpha = 0.9;
                    overlayCtx.strokeStyle = '#3b82f6';
                    overlayCtx.lineWidth = 2;
                    overlayCtx.setLineDash([6, 4]);
                    overlayCtx.strokeRect(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
                    overlayCtx.setLineDash([]);
                }
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
        _drawPlacingGhost();
        _drawPasteGhost();
    }

    function fillCircle(x: any, y: any, diameter: any, color: any) {
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, diameter / 2, 0, Math.PI * 2);
        overlayCtx.fill();
    }

    // ── Gizmo: geometry, hit-testing, drawing ─────────────────────────

    // Rotate a local-space point (relative to bbox center) into canvas space
    function obbToCanvas(bbox: any, lx: any, ly: any) {
        const { cx, cy, cos, sin } = bbox;
        return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    }

    function computeGizmoHandles(bbox: any) {
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
    function canvasToObbLocal(bbox: any, canvasX: any, canvasY: any) {
        if (!bbox) return [0, 0];
        const dx = canvasX - bbox.cx;
        const dy = canvasY - bbox.cy;
        // Inverse rotation
        return [dx * bbox.cos + dy * bbox.sin,
               -dx * bbox.sin + dy * bbox.cos];
    }

    function hitTestGizmo(canvasX: any, canvasY: any) {
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

    function getCursorForGizmo(handleId: any) {
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
        function drawHandle(h: any, w: any, ht: any, color: any) {
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

    function hitTestLED(canvasX: any, canvasY: any) {
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

    function hitTestBgGizmo(canvasX: any, canvasY: any) {
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
        function drawHandle(h: any, w: any, ht: any, color: any) {
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

    function handleBgGizmoDrag(cx: any, cy: any) {
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

    function startBgGizmoDrag(hit: any, cx: any, cy: any) {
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

    function handleGizmoDrag(cx: any, cy: any) {
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

    function onContextMenu(e: any) {
        e.preventDefault();
        // Cancel panel placement on right-click
        if (placingState) {
            _cancelPlacing();
            return;
        }
        if (pasteState) {
            _cancelPaste();
            return;
        }
        // If right-click was used for zoom dragging, skip the context menu
        const wasMoved = rightClickMoved;
        rightClickMoved = false;
        if (wasMoved) return;
        if (screenmap_pts.length === 0) return;
        const [cx, cy] = getCanvasCoords(e);
        // Chain mode: right-click on a connector arrow opens the connector menu
        if (editorMode === 'chain') {
            const conn = _hitConnectorBody(cx, cy);
            if (conn) {
                _openConnectorMenu(conn.up, conn.down, e.clientX, e.clientY);
                return;
            }
        }
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            selectedIdx = idx;
            syncPointSelection(idx);
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

    function onMouseDown(e: any) {
        // Dismiss context menu on any click
        hideContextMenu();

        // Panel placement takes priority over every other handler
        if (placingState) {
            if (e.button === 2) {
                e.preventDefault();
                _cancelPlacing();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = getCanvasCoords(e);
                _commitPlacingAt(cx, cy);
                return;
            }
            return;
        }

        // Paste-pending ghost commit / cancel
        if (pasteState) {
            if (e.button === 2) {
                e.preventDefault();
                _cancelPaste();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = getCanvasCoords(e);
                _commitPasteAt(cx, cy);
                return;
            }
            return;
        }

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

        // Chain mode: arrowhead / Start-handle drags only; LED hit-test and
        // group-drag are suppressed (issue #24 §1.7). Everything else pans.
        if (editorMode === 'chain') {
            const conn = _hitChainArrowhead(cx, cy);
            if (conn) {
                connectorDrag = { upIdx: conn.up, x: cx, y: cy, targetIdx: null };
                overlayCanvas.style.cursor = 'grabbing';
                setNeedsRender();
                return;
            }
            const startIdx = _hitStartHandle(cx, cy, -1);
            if (startIdx !== null) {
                startHandleDrag = { stripIdx: startIdx, x: cx, y: cy, targetIdx: null };
                overlayCanvas.style.cursor = 'grabbing';
                setNeedsRender();
                return;
            }
            // Fall through to pan
            if (selectedIdx >= 0) { selectedIdx = -1; setNeedsGeometryUpdate(); }
            selection.clear();
            isPanning = true;
            panStartX = cx;
            panStartY = cy;
            panStartCamX = camPanX;
            panStartCamY = camPanY;
            overlayCanvas.style.cursor = 'move';
            return;
        }

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
                bboxCenter: handles!.center,
            };
            overlayCanvas.style.cursor = gizmoHit === 'rotate' ? 'grabbing' : getCursorForGizmo(gizmoHit);
            return;
        }

        // Priority 2: LED point hit test
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            selectedIdx = idx;
            syncPointSelection(idx);
            highlightedEdgeIdx = -1;
            setNeedsGeometryUpdate(); // color update for selection
            dragStartCanvasX = cx;
            dragStartCanvasY = cy;
            dragStartScreenmapPt = [...screenmap_pts[idx]];
            dragStartRawPt = [...rawPts[idx]];

            // Alt quasimode = single-point move regardless of mode.
            altQuasimode = !!e.altKey;
            const hitStripIdx = stripStore.findStripForIndex(idx);
            const inPointEdit = pointEditStripIdx !== null && pointEditStripIdx === hitStripIdx;

            if (altQuasimode || inPointEdit) {
                // Single-point drag (existing behavior)
                isDragging = true;
                overlayCanvas.style.cursor = 'grabbing';
            } else {
                // Group drag for the whole strip
                stripDragActive = true;
                stripDragIdx = hitStripIdx;
                const strip = stripInfo.strips[hitStripIdx];
                stripDragStartScreenmap = [];
                stripDragStartRaw = [];
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    stripDragStartScreenmap.push([screenmap_pts[k][0], screenmap_pts[k][1]]);
                    stripDragStartRaw.push([rawPts[k][0], rawPts[k][1]]);
                }
                stripDragLastSdx = 0;
                stripDragLastSdy = 0;
                overlayCanvas.style.cursor = 'grabbing';
            }
            return;
        }

        // Priority 3: Edge selection (click near a line segment)
        if (screenmap_pts.length >= 2) {
            const edge = findNearestEdge(cx, cy);
            if (edge && edge.distSq < 20 * 20) {
                highlightedEdgeIdx = edge.idx;
                selectedIdx = -1;
                selection.clear();
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
        if (pointEditStripIdx !== null) { pointEditStripIdx = null; _updateHintStrip(); }
        selection.clear();
        isPanning = true;
        panStartX = cx;
        panStartY = cy;
        panStartCamX = camPanX;
        panStartCamY = camPanY;
        overlayCanvas.style.cursor = 'move';
    }

    function onMouseMove(e: any) {
        if (placingState) {
            const [cx, cy] = getCanvasCoords(e);
            _updateGhostFromCanvas(cx, cy);
            overlayCanvas.style.cursor = 'crosshair';
            return;
        }
        if (pasteState) {
            const [cx, cy] = getCanvasCoords(e);
            _updatePasteGhostFromCanvas(cx, cy);
            overlayCanvas.style.cursor = 'crosshair';
            return;
        }
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

        // Chain-mode connector drag (arrowhead → new downstream target)
        if (connectorDrag) {
            connectorDrag.x = cx;
            connectorDrag.y = cy;
            const target = _hitStartHandle(cx, cy, connectorDrag.upIdx);
            if (target !== connectorDrag.targetIdx) {
                connectorDrag.targetIdx = target;
                if (target !== null) {
                    _previewConnectorTarget(connectorDrag.upIdx, target);
                } else {
                    renderStripsPanel();
                }
            }
            setNeedsRender();
            return;
        }

        // Chain-mode Start-handle drag (strip Start → upstream End target)
        if (startHandleDrag) {
            startHandleDrag.x = cx;
            startHandleDrag.y = cy;
            const target = _hitEndHandle(cx, cy, startHandleDrag.stripIdx);
            if (target !== startHandleDrag.targetIdx) {
                startHandleDrag.targetIdx = target;
                if (target !== null) {
                    _previewConnectorTarget(target, startHandleDrag.stripIdx);
                } else {
                    renderStripsPanel();
                }
            }
            setNeedsRender();
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

        if (stripDragActive && stripDragIdx >= 0 && stripInfo) {
            const dx = cx - dragStartCanvasX;
            const dy = cy - dragStartCanvasY;
            const [sdx, sdy] = canvasDeltaToScreenmapDelta(dx, dy);
            const strip = stripInfo.strips[stripDragIdx];
            for (let k = 0; k < strip.count; k++) {
                const base = strip.offset + k;
                screenmap_pts[base] = [
                    stripDragStartScreenmap[k][0] + sdx,
                    stripDragStartScreenmap[k][1] + sdy,
                ];
                rawPts[base] = [
                    stripDragStartRaw[k][0] + sdx / fitScale,
                    stripDragStartRaw[k][1] + sdy / fitScale,
                ];
            }
            stripDragLastSdx = sdx;
            stripDragLastSdy = sdy;
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

    function onMouseUp(e: any) {
        if (e && e.button === 2) {
            rightButtonDown = false;
            // rightClickMoved is consumed by onContextMenu
            overlayCanvas.style.cursor = 'default';
            return;
        }

        // Chain-mode drags: commit on a valid drop target, else cancel.
        if (connectorDrag) {
            const { upIdx, targetIdx } = connectorDrag;
            connectorDrag = null;
            overlayCanvas.style.cursor = 'default';
            if (targetIdx !== null && targetIdx !== undefined) {
                doConnectorRetarget(upIdx, targetIdx);
            } else {
                renderStripsPanel();
            }
            setNeedsRender();
            return;
        }
        if (startHandleDrag) {
            const { stripIdx, targetIdx } = startHandleDrag;
            startHandleDrag = null;
            overlayCanvas.style.cursor = 'default';
            if (targetIdx !== null && targetIdx !== undefined) {
                // Dropping a strip's Start on another strip's End wires that
                // strip downstream of the target: target ──▶ stripIdx.
                doConnectorRetarget(targetIdx, stripIdx);
            } else {
                renderStripsPanel();
            }
            setNeedsRender();
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
            altQuasimode = false;
            overlayCanvas.style.cursor = 'grab';
            return;
        }

        if (stripDragActive) {
            _finalizeStripDrag();
            overlayCanvas.style.cursor = 'grab';
            return;
        }
    }

    function _finalizeStripDrag() {
        if (!stripDragActive) return;
        const sdx = stripDragLastSdx;
        const sdy = stripDragLastSdy;
        if (sdx !== 0 || sdy !== 0) {
            pushUndo({
                type: 'strip-translate',
                stripIdx: stripDragIdx,
                sdx,
                sdy,
            });
            _persistMultiStrip();
        }
        stripDragActive = false;
        stripDragIdx = -1;
        stripDragStartScreenmap = null;
        stripDragStartRaw = null;
        stripDragLastSdx = 0;
        stripDragLastSdy = 0;
    }

    function _applyStripTranslate(stripIdx: any, sdx: any, sdy: any) {
        if (!stripInfo || stripIdx < 0 || stripIdx >= stripInfo.strips.length) return;
        const strip = stripInfo.strips[stripIdx];
        for (let k = strip.offset; k < strip.offset + strip.count; k++) {
            screenmap_pts[k] = [screenmap_pts[k][0] + sdx, screenmap_pts[k][1] + sdy];
            rawPts[k] = [rawPts[k][0] + sdx / fitScale, rawPts[k][1] + sdy / fitScale];
        }
    }

    function onDoubleClick(e: any) {
        if (placingState) return;
        if (e.button !== 0) return;
        if (screenmap_pts.length === 0) return;
        const [cx, cy] = getCanvasCoords(e);
        const idx = hitTestLED(cx, cy);
        if (idx < 0) return;
        const sIdx = stripStore.findStripForIndex(idx);
        if (sIdx < 0) return;
        if (pointEditStripIdx === sIdx) {
            // Double-click again exits point-edit
            pointEditStripIdx = null;
        } else {
            pointEditStripIdx = sIdx;
            selection.selectStrip(sIdx);
        }
        _updateHintStrip();
        setNeedsGeometryUpdate();
    }

    // ── Touch handling (Phase 5) ──────────────────────────────────────────
    // Single-touch is forwarded as a synthesized left-mouse gesture. A
    // long-press timer (600ms / 10px tolerance) consumes the gesture and
    // either enters point-edit mode on an LED or pops the context menu on
    // empty space. A second simultaneous touch cancels any single-touch
    // gesture in progress and takes over with two-finger pan/pinch.
    const LONG_PRESS_MS = 600;
    const LONG_PRESS_MOVE_TOL = 10; // client px
    let touchMode = 'idle'; // 'idle' | 'single' | 'multi' | 'longpress-fired'
    let touchStartClientX = 0, touchStartClientY = 0;
    let touchStartCanvasX = 0, touchStartCanvasY = 0;
    let longPressTimer: any = null;
    let multiPanStartCamPanX = 0, multiPanStartCamPanY = 0;
    let multiPinchStartZoom = 1;
    let multiStartCentroid: any = null; // [clientX, clientY]
    let multiStartDist = 0;

    function _clearLongPress() {
        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    function _synth(type: any, clientX: any, clientY: any, opts: any = {}) {
        const init = { clientX, clientY, button: opts.button || 0, bubbles: true };
        const evt = new MouseEvent(type, init);
        if (type === 'mousedown') onMouseDown(evt);
        else if (type === 'mousemove') onMouseMove(evt);
        else if (type === 'mouseup') onMouseUp(evt);
    }

    function _cancelSingleTouchGesture() {
        // Cancel any in-flight single-touch drag cleanly (no undo entry).
        if (stripDragActive) {
            stripDragActive = false;
            stripDragIdx = -1;
            stripDragStartScreenmap = null;
            stripDragStartRaw = null;
            stripDragLastSdx = 0;
            stripDragLastSdy = 0;
        }
        if (isDragging) {
            isDragging = false;
            altQuasimode = false;
        }
        if (isPanning) {
            isPanning = false;
        }
        if (gizmoActive) {
            gizmoActive = null;
            gizmoDragStart = null;
        }
        if (rulerDrag) {
            rulerDrag = null;
            rulerDragStart = null;
        }
        overlayCanvas.style.cursor = 'default';
    }

    function _doLongPress(canvasX: any, canvasY: any, clientX: any, clientY: any) {
        // Cancel the pending single-touch synth gesture so it does not also
        // commit a drag.
        _cancelSingleTouchGesture();
        if (screenmap_pts.length === 0) {
            // Empty: open context menu
            showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
            touchMode = 'longpress-fired';
            return;
        }
        const idx = hitTestLED(canvasX, canvasY);
        if (idx >= 0) {
            const sIdx = stripStore.findStripForIndex(idx);
            if (sIdx >= 0) {
                selection.selectStrip(sIdx);
                pointEditStripIdx = sIdx;
                _updateHintStrip();
                setNeedsGeometryUpdate();
                _toastInfo(`Editing points in "${stripStore.getStrips()[sIdx].name}"`);
            }
        } else {
            showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
        }
        touchMode = 'longpress-fired';
    }

    function _wireTouchHandlers(signal: any) {
        overlayCanvas.addEventListener('touchstart', (e: any) => {
            // Cancel scrolling/zooming on the page during canvas touches
            e.preventDefault();
            if (e.touches.length === 1) {
                const t = e.touches[0];
                touchMode = 'single';
                touchStartClientX = t.clientX;
                touchStartClientY = t.clientY;
                const [cx, cy] = getCanvasCoords(t);
                touchStartCanvasX = cx;
                touchStartCanvasY = cy;
                // Start long-press timer
                _clearLongPress();
                longPressTimer = setTimeout(() => {
                    longPressTimer = null;
                    if (touchMode !== 'single') return;
                    _doLongPress(touchStartCanvasX, touchStartCanvasY, touchStartClientX, touchStartClientY);
                }, LONG_PRESS_MS);
                // Forward as a synthesized mousedown for the drag/select path
                _synth('mousedown', t.clientX, t.clientY);
            } else if (e.touches.length >= 2) {
                // Cancel any single-touch state cleanly
                _clearLongPress();
                if (touchMode === 'single') {
                    _cancelSingleTouchGesture();
                }
                touchMode = 'multi';
                const t0 = e.touches[0], t1 = e.touches[1];
                multiStartCentroid = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                multiStartDist = Math.hypot(dxs, dys) || 1;
                multiPanStartCamPanX = camPanX;
                multiPanStartCamPanY = camPanY;
                multiPinchStartZoom = camZoom;
            }
        }, { passive: false, signal });

        overlayCanvas.addEventListener('touchmove', (e: any) => {
            e.preventDefault();
            if (touchMode === 'longpress-fired') return;
            if (touchMode === 'single' && e.touches.length === 1) {
                const t = e.touches[0];
                const ddx = t.clientX - touchStartClientX;
                const ddy = t.clientY - touchStartClientY;
                if (Math.hypot(ddx, ddy) > LONG_PRESS_MOVE_TOL) _clearLongPress();
                _synth('mousemove', t.clientX, t.clientY);
                return;
            }
            if (touchMode === 'multi' && e.touches.length >= 2) {
                const t0 = e.touches[0], t1 = e.touches[1];
                const cx = (t0.clientX + t1.clientX) / 2;
                const cy = (t0.clientY + t1.clientY) / 2;
                const dx = cx - multiStartCentroid[0];
                const dy = cy - multiStartCentroid[1];
                // Pan: centroid delta in client px -> canvas px -> world px
                const rect = overlayCanvas.getBoundingClientRect();
                const sx = canvasW / rect.width;
                const sy = canvasH / rect.height;
                camPanX = multiPanStartCamPanX + (dx * sx) / camZoom;
                camPanY = multiPanStartCamPanY + (dy * sy) / camZoom;
                // Pinch: distance ratio
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                const dist = Math.hypot(dxs, dys) || 1;
                const ratio = dist / multiStartDist;
                camZoom = Math.max(0.1, Math.min(10, multiPinchStartZoom * ratio));
                setNeedsRender();
            }
        }, { passive: false, signal });

        overlayCanvas.addEventListener('touchend', (e: any) => {
            e.preventDefault();
            _clearLongPress();
            if (touchMode === 'longpress-fired') {
                // Discard the residual touch — drag was already cancelled.
                if (e.touches.length === 0) {
                    touchMode = 'idle';
                }
                return;
            }
            if (touchMode === 'single') {
                // Forward as mouseup to commit / select
                const t = (e.changedTouches && e.changedTouches[0]);
                if (t) {
                    _synth('mouseup', t.clientX, t.clientY);
                }
                touchMode = 'idle';
                return;
            }
            if (touchMode === 'multi') {
                if (e.touches.length === 0) {
                    touchMode = 'idle';
                } else if (e.touches.length === 1) {
                    // Demote to single but don't restart drag — leave idle so
                    // the user can lift their second finger without surprises.
                    touchMode = 'idle';
                }
            }
        }, { passive: false, signal });

        overlayCanvas.addEventListener('touchcancel', () => {
            _clearLongPress();
            _cancelSingleTouchGesture();
            touchMode = 'idle';
        }, { passive: true, signal });
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
            altQuasimode = false;
        }
        if (stripDragActive) {
            _finalizeStripDrag();
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
        // Escape: cancel panel placement, dismiss bg delete confirm, exit point-edit, or deselect
        if (e.key === 'Escape') {
            if (connectorDrag || startHandleDrag) { _cancelConnectorDrag(); e.preventDefault(); return; }
            if (connectorMenuEl) { _hideConnectorMenu(); e.preventDefault(); return; }
            if (editorMode) { setEditorMode(null); e.preventDefault(); return; }
            if (placingState) { _cancelPlacing(); e.preventDefault(); return; }
            if (pasteState) { _cancelPaste(); e.preventDefault(); return; }
            if (deleteBgConfirmEl) { dismissDeleteBgConfirm(); e.preventDefault(); return; }
            if (pointEditStripIdx !== null) {
                pointEditStripIdx = null;
                _updateHintStrip();
                e.preventDefault();
                return;
            }
            if (selectedIdx >= 0) { selectedIdx = -1; setNeedsGeometryUpdate(); }
            selection.clear();
            _updateHintStrip();
        }
        // Discoverability shortcuts — skip when typing in an input/textarea
        const isTyping = e.target && ((e.target as any).tagName === 'INPUT' || (e.target as any).tagName === 'TEXTAREA' || (e.target as any).isContentEditable);
        if (isTyping) return;
        // ? or F1 → help
        if (e.key === '?' || e.key === 'F1') {
            _openHelpOverlay();
            e.preventDefault();
            return;
        }
        // I → insert panel dialog
        if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            _openInsertDialog();
            e.preventDefault();
            return;
        }
        // Ctrl+V → paste screenmap. The document-level 'paste' handler is the
        // primary path; we also try navigator.clipboard.readText() as a
        // best-effort fallback (works in secure contexts with permission).
        if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            _pasteFromClipboardAPI();
            e.preventDefault();
            return;
        }
        // Ctrl+C → copy selected strip
        if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            const sIdx = selection.getStripIdx();
            if (sIdx !== null && sIdx >= 0) {
                _copySelectedStripToClipboard();
                e.preventDefault();
                return;
            }
        }
    }, { signal });

    function buildScreenmap(transformedPts: any) {
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
            (result.geometry.getAttribute('position') as any).setUsage(DynamicDrawUsage);

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
                // Per-strip coloring (dim non-selected strips when one is selected)
                const stripColors = getStripColors(stripInfo.strips.length);
                const stripRgbs = stripColors.map(hslStringToRgb);
                const selStrip = selection.getStripIdx();
                const dim = 0.35;
                for (let s = 0; s < stripInfo.strips.length; s++) {
                    const strip = stripInfo.strips[s];
                    let [sr, sg, sb] = stripRgbs[s];
                    if (selStrip !== null && s !== selStrip) {
                        sr *= dim; sg *= dim; sb *= dim;
                    }
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

    function updateLabels(transformedPts: any) {
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

                const transformedPts = screenmap_pts.map(([x, y]: [any, any]) => {
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
            lastTransformedPts = [];
            drawOverlay();
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

    // ── Panel placement palette ─────────────────────────────────────────
    // Catalog: commodity panels. Clicking enters "placing" mode; a ghost
    // follows the cursor on the overlay canvas, snapped to the grid when
    // enabled. Clicking on canvas commits the placement as a new strip.
    /** @type {null | { entry:object, opts:object, localPts:Array<[number,number]>, ghostWorld:[number,number] | null }} */
    let placingState: any = null;

    // Pin id requested by a per-pin [+ strip] button; consumed by the next
    // placement commit (or cleared on cancel). Null = use default pin.
    /** @type {string|null} */
    let pendingNewStripPin: any = null;

    // Paste-pending state: parsed strips ghost together around their centroid
    // following the cursor; L-click commits, Esc/R-click cancels.
    /** @type {null | { strips:Array<{name:string,points:Array<[number,number]>,diameter?:number,video_offset:number,offsetsLocal:Array<[number,number]>}>, ghostWorld:[number,number]|null, totalCount:number }} */
    let pasteState: any = null;

    const dom_panel_buttons = container.querySelector('#panel_catalog_buttons');
    const dom_pp_wiring = container.querySelector('#pp_wiring');
    const dom_pp_corner = container.querySelector('#pp_corner');
    const dom_pp_rotation = container.querySelector('#pp_rotation');
    const dom_pp_flipH = container.querySelector('#pp_flipH');
    const dom_pp_flipV = container.querySelector('#pp_flipV');
    const dom_pp_spacing = container.querySelector('#pp_spacing');
    const dom_pp_snap = container.querySelector('#pp_snap');
    const dom_pp_grid = container.querySelector('#pp_grid');
    const dom_pp_status = container.querySelector('#pp_status');

    const dom_pp_open_dialog = container.querySelector('#pp_open_dialog');
    if (dom_pp_open_dialog) {
        dom_pp_open_dialog.addEventListener('click', () => { _openInsertDialog(); }, { signal });
    }

    if (dom_panel_buttons) {
        for (const entry of PANEL_CATALOG) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'panel-btn py-1 px-2 bg-lm-surface-1 text-lm-text border border-lm-border rounded cursor-pointer text-xs';
            btn.textContent = entry.label;
            btn.dataset.catalogId = entry.id;
            btn.addEventListener('click', () => _enterPlacing(entry.id), { signal });
            dom_panel_buttons.appendChild(btn);
        }
    }

    function _readPanelOpts() {
        return {
            wiring: dom_pp_wiring ? dom_pp_wiring.value : 'serpentine',
            dataInCorner: dom_pp_corner ? dom_pp_corner.value : 'TL',
            rotation: dom_pp_rotation ? parseInt(dom_pp_rotation.value, 10) || 0 : 0,
            flipH: dom_pp_flipH ? !!dom_pp_flipH.checked : false,
            flipV: dom_pp_flipV ? !!dom_pp_flipV.checked : false,
            spacing: dom_pp_spacing ? (parseFloat(dom_pp_spacing.value) || 1) : 1,
        };
    }

    function _enterPlacing(catalogId: any) {
        const entry = getCatalogEntry(catalogId);
        if (!entry) return;
        const opts = _readPanelOpts();
        const localPts = generatePanelPoints(entry, opts);
        placingState = { entry, opts, localPts, ghostWorld: null };
        _updateHintStrip();
        if (dom_pp_status) dom_pp_status.textContent = `Placing ${entry.label} — click canvas (Esc to cancel)`;
        overlayCanvas.style.cursor = 'crosshair';
        setNeedsRender();
    }

    function _cancelPlacing() {
        placingState = null;
        pendingNewStripPin = null;
        if (dom_pp_status) dom_pp_status.textContent = '';
        overlayCanvas.style.cursor = 'default';
        setNeedsRender();
        _updateHintStrip();
    }

    function _canvasToWorldPx(cx: any, cy: any) {
        return [
            (cx - canvasW / 2) / camZoom - camPanX,
            (cy - canvasH / 2) / camZoom - camPanY,
        ];
    }

    function _gridSizePx() {
        const grid = dom_pp_grid ? (parseFloat(dom_pp_grid.value) || 1) : 1;
        const fs = fitScale > 0 ? fitScale : 1;
        return grid * fs;
    }

    function _updateGhostFromCanvas(cx: any, cy: any) {
        if (!placingState) return;
        let [wx, wy] = _canvasToWorldPx(cx, cy);
        if (dom_pp_snap && dom_pp_snap.checked) {
            const gpx = _gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        placingState.ghostWorld = [wx, wy];
        setNeedsRender();
    }

    function _drawPlacingGhost() {
        if (!placingState || !placingState.ghostWorld) return;
        const ctx = overlayCtx;
        const [wx, wy] = placingState.ghostWorld;
        const fs = fitScale > 0 ? fitScale : 1;
        const pts = placingState.localPts;
        if (pts.length === 0) return;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(59,130,246,0.9)';
        ctx.fillStyle = 'rgba(59,130,246,0.4)';
        // Connecting polyline (wiring order)
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const [px, py] = pts[i];
            const [cx, cy] = toCanvasCoords(wx + px * fs, wy + py * fs);
            if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        const r = Math.max(2, 0.3 * fs * camZoom);
        for (const [px, py] of pts) {
            const [cx, cy] = toCanvasCoords(wx + px * fs, wy + py * fs);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Crosshair at origin
        const [ocx, ocy] = toCanvasCoords(wx, wy);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    }

    function _uniqueStripName(base: any) {
        const used = new Set();
        const strips = stripStore.getStrips();
        for (const s of strips) used.add(s.name);
        let i = 1;
        while (used.has(`${base}${i}`)) i++;
        return `${base}${i}`;
    }

    function _isEmptyScreenmap() {
        return !stripInfo || stripInfo.strips.length === 0
            || (stripInfo.strips.length === 1 && stripInfo.strips[0].count <= 1
                && stripInfo.totalCount <= 1);
    }

    function _initFreshScreenmapForPanel() {
        // Initialise transform + fitScale + storage for a brand-new screenmap
        // when the user places a panel onto an empty editor.
        screenmap_pts = [];
        rawPts = [];
        stripInfo = null;
        stripStore.load(null);
        origDiameter = 0.5;
        dom_txt_diameter.value = origDiameter;
        origWidth = 0;
        origHeight = 0;
        // Choose a fitScale that gives a reasonable initial pixel pitch.
        const { width: fitW, height: fitH } = getFitSize();
        fitScale = Math.min(fitW, fitH) / 40;
        if (!isFinite(fitScale) || fitScale <= 0) fitScale = 20;
        resetTransforms();
    }

    function _commitPlacingAt(cx: any, cy: any) {
        if (!placingState) return;
        const entry = placingState.entry;
        const opts = placingState.opts;
        let [wx, wy] = _canvasToWorldPx(cx, cy);
        if (dom_pp_snap && dom_pp_snap.checked) {
            const gpx = _gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        if (_isEmptyScreenmap()) {
            _initFreshScreenmapForPanel();
        }
        const name = _uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId: entry.id,
            opts: { ...opts },
            worldX: wx,
            worldY: wy,
            name,
            pin: pendingNewStripPin || _defaultNewStripPin(),
        };
        pendingNewStripPin = null;
        _doPanelPlace(action);
        pushUndo(action);
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        placingState = null;
        if (dom_pp_status) dom_pp_status.textContent = `Placed ${entry.label} as ${name}`;
        overlayCanvas.style.cursor = 'default';
        _updateHintStrip();
    }

    function _doPanelPlace(action: any) {
        const entry = getCatalogEntry(action.catalogId);
        if (!entry) return;
        const localPts = generatePanelPoints(entry, action.opts);
        const fs = fitScale > 0 ? fitScale : 1;
        // rawPts (cm-units): use worldX/worldY divided by fitScale to place
        // the panel origin at the click point. screenmap_pts = rawPts * fs
        // - offset (keeps consistency with existing screenmap_pts coords).
        // For a fresh map (rawPts empty) we set rawPts directly so
        // rawPts[i]*fitScale == screenmap_pts[i].
        const screenmapPts = [];
        const rawPtsAdd = [];
        // Determine current "raw->screenmap" offset using existing point 0
        let offX = 0, offY = 0;
        if (rawPts.length > 0) {
            offX = rawPts[0][0] * fs - screenmap_pts[0][0];
            offY = rawPts[0][1] * fs - screenmap_pts[0][1];
        }
        for (const [px, py] of localPts) {
            const sx = action.worldX + px * fs;
            const sy = action.worldY + py * fs;
            screenmapPts.push([sx, sy]);
            rawPtsAdd.push([(sx + offX) / fs, (sy + offY) / fs]);
        }
        // Append to flat arrays
        const insertAt = screenmap_pts.length;
        for (let i = 0; i < screenmapPts.length; i++) {
            screenmap_pts.push(screenmapPts[i]);
            rawPts.push(rawPtsAdd[i]);
        }
        const newIdx = stripStore.addStrip({
            name: action.name,
            points: rawPtsAdd,
            diameter: typeof origDiameter === 'number' ? origDiameter : 0.5,
            video_offset: insertAt,
            pin: (typeof action.pin === 'string' && action.pin) ? action.pin : 'pin1',
            videoOffsetOverride: false,
        });
        stripInfo = stripStore.get();
        // origWidth/Height may still be 0 for fresh maps — recompute from rawPts
        // so the cm size label is reasonable.
        if (origWidth === 0 && origHeight === 0 && rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            origWidth = xmax - xmin;
            origHeight = ymax - ymin;
        }
        selection.selectStrip(newIdx);
        action._insertAt = insertAt;
        action._count = screenmapPts.length;
    }

    function _redoPanelPlace(action: any) {
        _doPanelPlace(action);
    }

    function _undoPanelPlace(action: any) {
        if (!stripInfo) return;
        // Find the strip we added by name (most reliable after reordering).
        let stripIdx = -1;
        const strips = stripInfo.strips;
        for (let i = strips.length - 1; i >= 0; i--) {
            if (strips[i].name === action.name) { stripIdx = i; break; }
        }
        if (stripIdx < 0) return;
        const strip = strips[stripIdx];
        screenmap_pts.splice(strip.offset, strip.count);
        rawPts.splice(strip.offset, strip.count);
        stripStore.removeStrip(stripIdx);
        selection.onStripRemove(stripIdx);
        selectedIdx = -1;
        stripInfo = stripStore.get();
    }

    function _debugPlacePanel(catalogId: any, worldX: any, worldY: any, opts: any) {
        const entry = getCatalogEntry(catalogId);
        if (!entry) return null;
        const mergedOpts = { ..._readPanelOpts(), ...opts };
        if (_isEmptyScreenmap()) {
            _initFreshScreenmapForPanel();
        }
        const name = _uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId,
            opts: mergedOpts,
            worldX,
            worldY,
            name,
            pin: pendingNewStripPin || _defaultNewStripPin(),
        };
        pendingNewStripPin = null;
        _doPanelPlace(action);
        pushUndo(action);
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        return name;
    }

    // ── Paste-pending flow ────────────────────────────────────────────────

    function _enterPasteFromText(text: any) {
        const parsed = parsePastedScreenmap(text);
        if (!parsed) {
            _toastInfo("Clipboard didn't look like a screenmap");
            return false;
        }
        // Cancel any in-flight placing so the modes don't overlap
        if (placingState) _cancelPlacing();

        const existingNames = new Set(stripStore.getStrips().map((s: any) => s.name));
        const merged = planPasteMerge(parsed, existingNames, stripStore.getTotalCount());

        // Compute centroid of the source points (in raw cm space).
        let sx = 0, sy = 0, n = 0;
        for (const s of merged) {
            for (const p of s.points) { sx += p[0]; sy += p[1]; n++; }
        }
        if (n === 0) {
            _toastInfo("Clipboard didn't look like a screenmap");
            return false;
        }
        const cxRaw = sx / n, cyRaw = sy / n;

        // Determine the cm-to-pixel scale to apply. If we have an existing
        // screenmap, reuse its fitScale so pasted strips visually match.
        // For an empty editor, defer; we'll initialise fitScale on commit.
        const fs = (rawPts.length > 0 && fitScale > 0) ? fitScale : 1;
        // Offsets in screenmap-pixel space, centred around (0,0)
        const strips = merged.map((s) => {
            const offsetsLocal = s.points.map((p: any) => [(p[0] - cxRaw) * fs, (p[1] - cyRaw) * fs]);
            return { ...s, offsetsLocal };
        });
        const totalCount = merged.reduce((a, s) => a + s.points.length, 0);
        pasteState = { strips, ghostWorld: null, totalCount };
        overlayCanvas.style.cursor = 'crosshair';
        _updateHintStrip();
        setNeedsRender();
        return true;
    }

    function _cancelPaste() {
        if (!pasteState) return;
        pasteState = null;
        overlayCanvas.style.cursor = 'default';
        _updateHintStrip();
        setNeedsRender();
    }

    function _updatePasteGhostFromCanvas(cx: any, cy: any) {
        if (!pasteState) return;
        let [wx, wy] = _canvasToWorldPx(cx, cy);
        if (dom_pp_snap && dom_pp_snap.checked) {
            const gpx = _gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        pasteState.ghostWorld = [wx, wy];
        setNeedsRender();
    }

    function _drawPasteGhost() {
        if (!pasteState || !pasteState.ghostWorld) return;
        const ctx = overlayCtx;
        const [wx, wy] = pasteState.ghostWorld;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(168,85,247,0.9)';
        ctx.fillStyle = 'rgba(168,85,247,0.4)';
        for (const strip of pasteState.strips) {
            // Polyline of this strip
            ctx.beginPath();
            for (let i = 0; i < strip.offsetsLocal.length; i++) {
                const [ox, oy] = strip.offsetsLocal[i];
                const [px, py] = toCanvasCoords(wx + ox, wy + oy);
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
            const r = Math.max(2, 0.25 * (fitScale > 0 ? fitScale : 1) * camZoom);
            for (const [ox, oy] of strip.offsetsLocal) {
                const [px, py] = toCanvasCoords(wx + ox, wy + oy);
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        // Crosshair at drop centroid
        const [ocx, ocy] = toCanvasCoords(wx, wy);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    }

    function _commitPasteAt(cx: any, cy: any) {
        if (!pasteState) return;
        let [wx, wy] = _canvasToWorldPx(cx, cy);
        if (dom_pp_snap && dom_pp_snap.checked) {
            const gpx = _gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }

        if (_isEmptyScreenmap()) {
            _initFreshScreenmapForPanel();
            // After fresh init, fitScale is freshly chosen. Recompute the
            // strips' offsetsLocal in that new scale.
            const fs = fitScale > 0 ? fitScale : 1;
            // Find raw centroid again to keep ghost-centred layout consistent.
            let sxR = 0, syR = 0, n = 0;
            for (const s of pasteState.strips) {
                for (const p of s.points) { sxR += p[0]; syR += p[1]; n++; }
            }
            const cxRaw = n ? sxR / n : 0;
            const cyRaw = n ? syR / n : 0;
            for (const s of pasteState.strips) {
                s.offsetsLocal = s.points.map((p: any) => [(p[0] - cxRaw) * fs, (p[1] - cyRaw) * fs]);
            }
        }

        const fs = fitScale > 0 ? fitScale : 1;
        // raw -> screenmap conversion offset (matches _doPanelPlace's logic)
        let offX = 0, offY = 0;
        if (rawPts.length > 0) {
            offX = rawPts[0][0] * fs - screenmap_pts[0][0];
            offY = rawPts[0][1] * fs - screenmap_pts[0][1];
        }

        // Rebuild the "addedStrips" descriptor with screenmap-coord points.
        // Re-resolve unique names AGAIN here in case the editor changed
        // between parse-time and commit-time (e.g. an undo happened while
        // paste was pending).
        const existingNames = new Set(stripStore.getStrips().map((s: any) => s.name));
        const addedDescriptors = [];
        const base = stripStore.getTotalCount();
        let running = 0;
        const pastePin = _defaultNewStripPin();
        for (const s of pasteState.strips) {
            const name = _uniqueNameAgainst(s.name, existingNames);
            existingNames.add(name);
            const sm = s.offsetsLocal.map(([ox, oy]: [any, any]) => [wx + ox, wy + oy]);
            const raw = sm.map(([smx, smy]: [any, any]) => [(smx + offX) / fs, (smy + offY) / fs]);
            addedDescriptors.push({
                name,
                screenmapPts: sm,
                rawPts: raw,
                diameter: typeof s.diameter === 'number' ? s.diameter : (typeof origDiameter === 'number' ? origDiameter : 0.5),
                video_offset: base + running,
                pin: pastePin,
            });
            running += sm.length;
        }

        const action = { type: 'paste-strips', strips: addedDescriptors };
        _doPasteStrips(action);
        pushUndo(action);
        notePinMutation();
        _persistMultiStrip();
        renderStripsPanel();
        setNeedsGeometryUpdate();
        const pastedCount = action.strips.length;
        pasteState = null;
        overlayCanvas.style.cursor = 'default';
        _updateHintStrip();
        _toastSuccess(`Pasted ${pastedCount} strip${pastedCount === 1 ? '' : 's'}`);
        // Select the first pasted strip for discoverability
        if (action.strips.length > 0 && stripInfo) {
            for (let i = stripInfo.strips.length - 1; i >= 0; i--) {
                if (stripInfo.strips[i].name === action.strips[0].name) {
                    selection.selectStrip(i);
                    break;
                }
            }
        }
    }

    function _uniqueNameAgainst(baseName: any, used: any) {
        if (!used.has(baseName)) return baseName;
        let n = 2;
        while (used.has(`${baseName} (${n})`)) n++;
        return `${baseName} (${n})`;
    }

    function _doPasteStrips(action: any) {
        // Append every strip atomically. Identical scheme to _doPanelPlace
        // (append to flat arrays + stripStore.addStrip), but for many at once.
        for (const desc of action.strips) {
            const insertAt = screenmap_pts.length;
            for (let i = 0; i < desc.screenmapPts.length; i++) {
                screenmap_pts.push([desc.screenmapPts[i][0], desc.screenmapPts[i][1]]);
                rawPts.push([desc.rawPts[i][0], desc.rawPts[i][1]]);
            }
            stripStore.addStrip({
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
        stripInfo = stripStore.get();
        if (origWidth === 0 && origHeight === 0 && rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            origWidth = xmax - xmin;
            origHeight = ymax - ymin;
        }
    }

    function _undoPasteStrips(action: any) {
        if (!stripInfo) return;
        // Walk added strips in reverse order; locate each by name (most recent
        // additions are at the end) and remove from both flat arrays + store.
        for (let i = action.strips.length - 1; i >= 0; i--) {
            const desc = action.strips[i];
            const strips = stripInfo.strips;
            let stripIdx = -1;
            for (let k = strips.length - 1; k >= 0; k--) {
                if (strips[k].name === desc.name) { stripIdx = k; break; }
            }
            if (stripIdx < 0) continue;
            const strip = strips[stripIdx];
            screenmap_pts.splice(strip.offset, strip.count);
            rawPts.splice(strip.offset, strip.count);
            stripStore.removeStrip(stripIdx);
            selection.onStripRemove(stripIdx);
        }
        selectedIdx = -1;
        stripInfo = stripStore.get();
    }

    async function _pasteFromClipboardAPI() {
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                _toastInfo('Clipboard read unavailable — try Ctrl+V');
                return;
            }
            const text = await navigator.clipboard.readText();
            _enterPasteFromText(text || '');
        } catch {
            _toastInfo("Clipboard didn't look like a screenmap");
        }
    }

    function _copySelectedStripToClipboard() {
        const sIdx = selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        const strips = stripStore.getStrips();
        if (sIdx >= strips.length) return;
        const s = strips[sIdx];
        const x = [], y = [];
        for (let i = s.offset; i < s.offset + s.count; i++) {
            x.push(+rawPts[i][0].toFixed(4));
            y.push(+rawPts[i][1].toFixed(4));
        }
        const d = typeof s.diameter === 'number' ? s.diameter : (parseFloat(dom_txt_diameter.value) || 0.25);
        const json = JSON.stringify({ map: { [s.name]: { x, y, diameter: d } } }, null, 2);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(json).then(
                    () => _toastSuccess(`Copied "${s.name}" to clipboard`),
                    () => _toastInfo('Copy failed — clipboard unavailable'),
                );
            } else {
                _toastInfo('Copy failed — clipboard unavailable');
            }
        } catch {
            _toastInfo('Copy failed — clipboard unavailable');
        }
    }

    // Document-level paste handler — captures Ctrl+V across the page when
    // focus is anywhere except an editable element. Works without the
    // navigator.clipboard permission gate.
    document.addEventListener('paste', (e) => {
        const t = e.target;
        if (t && ((t as any).tagName === 'INPUT' || (t as any).tagName === 'TEXTAREA' || (t as any).isContentEditable)) return;
        const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
        if (!txt) return;
        if (_enterPasteFromText(txt)) {
            e.preventDefault();
        }
    }, { signal });

    // ── Insert Panel dialog (Phase 4) ─────────────────────────────────────

    async function _openInsertDialog() {
        try {
            const Swal = (await import('sweetalert2')).default;
            if (signal.aborted) return;

            // Snapshot current accordion values for initial form state
            const initial = {
                catalogId: PANEL_CATALOG[0] ? PANEL_CATALOG[0].id : '',
                wiring: dom_pp_wiring ? dom_pp_wiring.value : 'serpentine',
                corner: dom_pp_corner ? dom_pp_corner.value : 'TL',
                rotation: dom_pp_rotation ? dom_pp_rotation.value : '0',
                flipH: dom_pp_flipH ? !!dom_pp_flipH.checked : false,
                flipV: dom_pp_flipV ? !!dom_pp_flipV.checked : false,
                spacing: dom_pp_spacing ? dom_pp_spacing.value : '1',
                snap: dom_pp_snap ? !!dom_pp_snap.checked : true,
                grid: dom_pp_grid ? dom_pp_grid.value : '1',
            };

            const catalogOptions = PANEL_CATALOG.map((e) => `<option value="${e.id}">${e.label}</option>`).join('');
            const html = `
                <div style="text-align:left;font:13px/1.4 'Outfit',system-ui,sans-serif;color:#e5e7eb;display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;">
                    <label for="ins_catalog">Panel</label>
                    <select id="ins_catalog" style="padding:3px;">${catalogOptions}</select>
                    <label for="ins_wiring">Wiring</label>
                    <select id="ins_wiring" style="padding:3px;">
                        <option value="serpentine">Serpentine</option>
                        <option value="progressive">Progressive</option>
                    </select>
                    <label for="ins_corner">Data In</label>
                    <select id="ins_corner" style="padding:3px;">
                        <option value="TL">TL</option><option value="TR">TR</option>
                        <option value="BL">BL</option><option value="BR">BR</option>
                    </select>
                    <label for="ins_rotation">Rotate</label>
                    <select id="ins_rotation" style="padding:3px;">
                        <option value="0">0°</option><option value="90">90°</option>
                        <option value="180">180°</option><option value="270">270°</option>
                    </select>
                    <label>Flips</label>
                    <div>
                        <label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><input id="ins_flipH" type="checkbox"> H</label>
                        <label style="display:inline-flex;align-items:center;gap:4px;"><input id="ins_flipV" type="checkbox"> V</label>
                    </div>
                    <label for="ins_spacing">Spacing</label>
                    <input id="ins_spacing" type="number" step="0.1" min="0.01" style="padding:3px;">
                    <label>Snap / Grid</label>
                    <div>
                        <label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><input id="ins_snap" type="checkbox"> Snap</label>
                        <input id="ins_grid" type="number" step="0.1" min="0.01" style="padding:3px;width:80px;">
                    </div>
                </div>
                <div style="margin-top:12px;display:flex;justify-content:center;">
                    <canvas id="ins_preview" width="320" height="200" style="background:#0d0d0d;border:1px solid #333;border-radius:4px;"></canvas>
                </div>
            `;

            const res = await Swal.fire({
                title: 'Insert Panel',
                html,
                width: 480,
                background: '#1a1a1a',
                color: '#e5e7eb',
                showCancelButton: true,
                showDenyButton: true,
                cancelButtonText: 'Cancel',
                denyButtonText: 'Place…',
                confirmButtonText: 'Insert at center',
                focusConfirm: false,
                didOpen: () => {
                    const $ = (id: any): any => document.getElementById(id);
                    const catalog = $('ins_catalog');
                    const wiring = $('ins_wiring');
                    const corner = $('ins_corner');
                    const rotation = $('ins_rotation');
                    const flipH = $('ins_flipH');
                    const flipV = $('ins_flipV');
                    const spacing = $('ins_spacing');
                    const snap = $('ins_snap');
                    const grid = $('ins_grid');
                    const preview = $('ins_preview');

                    if (catalog) catalog.value = initial.catalogId;
                    if (wiring) wiring.value = initial.wiring;
                    if (corner) corner.value = initial.corner;
                    if (rotation) rotation.value = String(initial.rotation);
                    if (flipH) flipH.checked = initial.flipH;
                    if (flipV) flipV.checked = initial.flipV;
                    if (spacing) spacing.value = initial.spacing;
                    if (snap) snap.checked = initial.snap;
                    if (grid) grid.value = initial.grid;

                    function readForm() {
                        return {
                            catalogId: catalog ? catalog.value : initial.catalogId,
                            wiring: wiring ? wiring.value : 'serpentine',
                            corner: corner ? corner.value : 'TL',
                            rotation: rotation ? parseInt(rotation.value, 10) || 0 : 0,
                            flipH: flipH ? !!flipH.checked : false,
                            flipV: flipV ? !!flipV.checked : false,
                            spacing: spacing ? (parseFloat(spacing.value) || 1) : 1,
                            snap: snap ? !!snap.checked : true,
                            grid: grid ? (parseFloat(grid.value) || 1) : 1,
                        };
                    }

                    function redrawPreview() {
                        if (!preview) return;
                        const ctx = preview.getContext('2d');
                        ctx.clearRect(0, 0, preview.width, preview.height);
                        const opts = readForm();
                        const entry = getCatalogEntry(opts.catalogId);
                        if (!entry) return;
                        const pts = generatePanelPoints(entry, {
                            wiring: opts.wiring,
                            dataInCorner: opts.corner,
                            rotation: opts.rotation,
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
                        ctx.strokeStyle = '#3b82f6';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        for (let i = 0; i < pts.length; i++) {
                            const x = pts[i][0] * sc + cxOff;
                            const y = pts[i][1] * sc + cyOff;
                            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                        ctx.fillStyle = '#93c5fd';
                        for (const [px, py] of pts) {
                            const x = px * sc + cxOff;
                            const y = py * sc + cyOff;
                            ctx.beginPath();
                            ctx.arc(x, y, 2, 0, Math.PI * 2);
                            ctx.fill();
                        }
                        // First LED green
                        if (pts.length > 0) {
                            ctx.fillStyle = '#4caf50';
                            ctx.beginPath();
                            ctx.arc(pts[0][0] * sc + cxOff, pts[0][1] * sc + cyOff, 3, 0, Math.PI * 2);
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
                preConfirm: () => _readInsertDialog(),
                preDeny: () => _readInsertDialog(),
            });

            if (signal.aborted) return null;
            const action = res.isConfirmed ? 'center' : (res.isDenied ? 'ghost' : null);
            if (!action) { pendingNewStripPin = null; return null; }
            const opts = (res.isConfirmed ? res.value : res.value) || _readInsertDialog();
            return _submitInsertDialog({ ...opts, place: action });
        } catch {
            return null;
        }
    }

    function _readInsertDialog() {
        const $ = (id: any): any => document.getElementById(id);
        return {
            catalogId: $('ins_catalog') ? $('ins_catalog').value : '',
            wiring: $('ins_wiring') ? $('ins_wiring').value : 'serpentine',
            corner: $('ins_corner') ? $('ins_corner').value : 'TL',
            rotation: $('ins_rotation') ? parseInt($('ins_rotation').value, 10) || 0 : 0,
            flipH: $('ins_flipH') ? !!$('ins_flipH').checked : false,
            flipV: $('ins_flipV') ? !!$('ins_flipV').checked : false,
            spacing: $('ins_spacing') ? (parseFloat($('ins_spacing').value) || 1) : 1,
            snap: $('ins_snap') ? !!$('ins_snap').checked : true,
            grid: $('ins_grid') ? (parseFloat($('ins_grid').value) || 1) : 1,
        };
    }

    function _writeAccordionFromDialog(opts: any) {
        if (dom_pp_wiring && opts.wiring) dom_pp_wiring.value = opts.wiring;
        if (dom_pp_corner && opts.corner) dom_pp_corner.value = opts.corner;
        if (dom_pp_rotation && (opts.rotation || opts.rotation === 0)) dom_pp_rotation.value = String(opts.rotation);
        if (dom_pp_flipH) dom_pp_flipH.checked = !!opts.flipH;
        if (dom_pp_flipV) dom_pp_flipV.checked = !!opts.flipV;
        if (dom_pp_spacing && (opts.spacing || opts.spacing === 0)) dom_pp_spacing.value = String(opts.spacing);
        if (dom_pp_snap) dom_pp_snap.checked = !!opts.snap;
        if (dom_pp_grid && (opts.grid || opts.grid === 0)) dom_pp_grid.value = String(opts.grid);
    }

    function _submitInsertDialog(opts: any) {
        if (!opts || !opts.catalogId) return null;
        const entry = getCatalogEntry(opts.catalogId);
        if (!entry) return null;
        _writeAccordionFromDialog(opts);
        if (opts.place === 'center') {
            // Place at viewport center via existing commit path.
            // _commitPlacingAt uses canvas coords; canvas center is (canvasW/2, canvasH/2).
            // Use _enterPlacing then immediately commit at center, so undo is
            // a single panel-place action.
            _enterPlacing(opts.catalogId);
            _commitPlacingAt(canvasW / 2, canvasH / 2);
            return entry.label;
        }
        if (opts.place === 'ghost') {
            _enterPlacing(opts.catalogId);
            return entry.label;
        }
        return null;
    }

    // --- Initialize ---
    initRenderer();
    loadPresetsFromManifest();
    renderStripsPanel();
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
