// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Constructor body, start(), and destroy() installed on ShapeEditor prototype.

import { ShapeEditor } from './shapeeditor-class';
import { type Material } from 'three';

import type { PanelOpts } from './panel-catalog';
import { stripStartEndLabels } from '../common';

import { createLabelRenderer } from '../label-render';
import { resetAndOpenFilePicker, wireFileDropTarget, wireFileSource } from '../drag-drop';
import { safeStorage } from '../services/storage';
import { gfxColors } from '../ui/theme';
import { errorDialog, getSwal } from '../ui/dialogs';
import { getBackup, promoteToBackup } from '../screenmap-store';

import { createCircleTexture } from '../three-utils';
import { StripStore } from './strips-model';
import { Selection } from './selection';
import { DirectionArrowTransition } from './direction-arrow-transition';
import { PANEL_CATALOG } from './panel-catalog';

import templateHtml from './template.html?raw';
import type { InsertDialogOpts } from './shapeeditor-types';
import type { ShapeeditorDebugHooks } from '../types/domain';
import { registerDebugState, unregisterDebugState } from '../debug-registry';
import { emptyStripSnapTargetSet } from './strip-snap-targets';

ShapeEditor.prototype._construct = function (this: ShapeEditor): void {
this.container.innerHTML = templateHtml;
this.container.classList.add('shapeeditor-root');
        this.qei = (sel: string) => this.qe<HTMLInputElement>(sel);
        this.qeb = (sel: string) => this.qe<HTMLButtonElement>(sel);
        this.mainEl = this.qe<HTMLElement>('#main');
this.mainEl.classList.add('shapeeditor-main');
        this.dom_btn_new = this.qeb('#btn_new');
        this.dom_btn_upload_screenmap = this.qei('#btn_upload_screenmap');
        this.dom_btn_load_screenmap = this.qeb('#btn_load_screenmap');
        this.dom_sel_preset_mount = this.qe<HTMLElement>('#sel_preset_mount');
        this.presetPicker = null;
        this.dom_txt_scale = this.qei('#txt_scale');
        this.dom_txt_scale_x = this.qei('#txt_scale_x');
        this.dom_txt_scale_y = this.qei('#txt_scale_y');
        this.dom_txt_rotate = this.qei('#txt_rotate');
        this.dom_txt_translate_x = this.qei('#txt_translate_x');
        this.dom_txt_translate_y = this.qei('#txt_translate_y');
        this.dom_txt_diameter = this.qei('#txt_diameter');
        this.dom_chk_snap_back = this.qei('#chk_snap_back');
        this.dom_rng_snap_back_px = this.qei('#rng_snap_back_px');
        this.dom_rng_snap_back_px_val = this.qe<HTMLElement>('#rng_snap_back_px_val');
        // Restore snap settings from localStorage (best-effort). The
        // persisted values use '1'/'0' for the boolean and a stringified
        // int for the px; preserve that exact format on write so users
        // who don't get migrated still read them on downgrade.
        {
            const v = safeStorage.get('shapeeditor.snapBackEnabled');
            this.snapBackEnabled = v === null ? true : v === '1';
            const raw = safeStorage.get('shapeeditor.snapBackPx');
            const n = raw === null ? 12 : parseInt(raw, 10);
            this.snapBackPx = Number.isFinite(n) ? Math.max(2, Math.min(40, n)) : 12;
        }
        this.dom_chk_snap_back.checked = this.snapBackEnabled;
        this.dom_rng_snap_back_px.value = String(this.snapBackPx);
        this.dom_rng_snap_back_px_val.textContent = `${String(this.snapBackPx)} px`;
        this.dom_chk_snap_back.addEventListener('change', () => {
            this.snapBackEnabled = this.dom_chk_snap_back.checked;
            safeStorage.set('shapeeditor.snapBackEnabled', this.snapBackEnabled ? '1' : '0');
        }, { signal: this.signal });
        this.dom_rng_snap_back_px.addEventListener('input', () => {
            const n = parseInt(this.dom_rng_snap_back_px.value, 10);
            if (Number.isFinite(n)) {
                this.snapBackPx = Math.max(2, Math.min(40, n));
                this.dom_rng_snap_back_px_val.textContent = `${String(this.snapBackPx)} px`;
                safeStorage.set('shapeeditor.snapBackPx', String(this.snapBackPx));
            }
        }, { signal: this.signal });
        // ── Overlay panel collapse/expand button ────────────────────
        this.dom_transform_overlay = this.qe<HTMLElement>('#transform-overlay');
        this.dom_btn_overlay_collapse = this.qeb('#btn_overlay_collapse');
        this.dom_btn_overlay_expand = this.qeb('#btn_overlay_expand');
        this.overlayCollapsed = safeStorage.get('shapeeditor.overlayCollapsed') === '1';
        this._setOverlayCollapsed(this.overlayCollapsed);
        this.dom_btn_overlay_collapse.addEventListener('click', () => {
            this._setOverlayCollapsed(true);
            this.dom_btn_overlay_expand.focus();
        }, { signal: this.signal });
        this.dom_btn_overlay_expand.addEventListener('click', () => {
            this._setOverlayCollapsed(false);
            this.dom_btn_overlay_collapse.focus();
        }, { signal: this.signal });
        this.dom_btn_save = this.qeb('#btn_save_as');
        this.dom_btn_reset = this.qeb('#btn_reset');
        this.dom_btn_undo = this.qeb('#btn_undo');
        this.dom_btn_redo = this.qeb('#btn_redo');
        this.dom_bg_accordion = this.qe('#bg_image_accordion');
        this.dom_btn_upload_image = this.qei('#btn_upload_image');
        this.dom_txt_image_opacity = this.qei('#txt_image_opacity');
        this.dom_txt_image_scale = this.qei('#txt_image_scale');
        this.dom_txt_image_rotate = this.qei('#txt_image_rotate');
        this.dom_txt_image_tx = this.qei('#txt_image_tx');
        this.dom_txt_image_ty = this.qei('#txt_image_ty');
        this.dom_btn_remove_image = this.qeb('#btn_remove_image');
        this.ac = new AbortController();
        this.signal = this.ac.signal;
        this.dom_btn_load_screenmap.addEventListener('click', () => {
            resetAndOpenFilePicker(this.dom_btn_upload_screenmap);
        }, { signal: this.signal });
        // Mobile canvas-first chrome (issue #412). The existing controls and
        // transform panel are reused as bottom sheets so desktop behavior and
        // every established control binding stay intact.
        {
            const mapSheet = this.qe<HTMLElement>('#controls');
            const mapButton = this.qeb('#btn_mobile_map');
            const mapCloseButton = this.qeb('#btn_mobile_map_close');
            const toolsButton = this.qeb('#btn_mobile_tools');
            const helpButton = this.qeb('#btn_mobile_help');
            const mobileResetButton = this.qeb('#btn_mobile_reset');
            const helpTarget = this.qeb('#hint_strip_help');

            const setMapOpen = (open: boolean) => {
                mapSheet.classList.toggle('mobile-sheet-open', open);
                mapButton.setAttribute('aria-expanded', String(open));
                if (open) mapCloseButton.focus();
                else mapButton.focus();
            };
            const setToolsOpen = (open: boolean) => {
                this.dom_transform_overlay.classList.toggle('mobile-sheet-open', open);
                toolsButton.setAttribute('aria-expanded', String(open));
                if (open) {
                    this._setOverlayCollapsed(false);
                    this.dom_btn_overlay_collapse.focus();
                } else {
                    toolsButton.focus();
                }
            };

            mapButton.addEventListener('click', () => {
                setToolsOpen(false);
                setMapOpen(true);
            }, { signal: this.signal });
            mapCloseButton.addEventListener('click', () => { setMapOpen(false); }, { signal: this.signal });
            toolsButton.addEventListener('click', () => {
                setMapOpen(false);
                setToolsOpen(true);
            }, { signal: this.signal });
            this.dom_btn_overlay_collapse.addEventListener('click', () => { setToolsOpen(false); }, { signal: this.signal });
            helpButton.addEventListener('click', () => { helpTarget.click(); }, { signal: this.signal });
            mobileResetButton.addEventListener('click', () => { this.dom_btn_reset.click(); }, { signal: this.signal });
            mapSheet.addEventListener('click', (event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (target?.closest('.preset-btn') || target?.closest('#btn_new')) {
                    setMapOpen(false);
                }
            }, { signal: this.signal });
            this.dom_btn_upload_screenmap.addEventListener('change', () => { setMapOpen(false); }, { signal: this.signal });
            this.dom_btn_upload_image.addEventListener('change', () => { setMapOpen(false); }, { signal: this.signal });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                if (mapSheet.classList.contains('mobile-sheet-open')) setMapOpen(false);
                if (this.dom_transform_overlay.classList.contains('mobile-sheet-open')) setToolsOpen(false);
            }, { signal: this.signal });
        }
for (const el of [this.dom_txt_scale, this.dom_txt_scale_x, this.dom_txt_scale_y,
        this.dom_txt_rotate, this.dom_txt_translate_x, this.dom_txt_translate_y, this.dom_txt_diameter]) {
        el.addEventListener('input', () => { this.markDirtyAndGeometry(); }, { signal: this.signal });
    }
this.dom_btn_reset.addEventListener('click', () => { this.resetTransforms(); }, { signal: this.signal });
this.dom_btn_save.addEventListener('click', () => { this.saveAs(); }, { signal: this.signal });
        this.SCALE_MIN = 0.1;
        this.SCALE_MAX = 10;
this.dom_txt_scale.addEventListener('change', () => { this.writeScale(this.dom_txt_scale, this.dom_txt_scale.value); }, { signal: this.signal });
this.dom_txt_scale_x.addEventListener('change', () => { this.writeScale(this.dom_txt_scale_x, this.dom_txt_scale_x.value); }, { signal: this.signal });
this.dom_txt_scale_y.addEventListener('change', () => { this.writeScale(this.dom_txt_scale_y, this.dom_txt_scale_y.value); }, { signal: this.signal });
this.dom_txt_rotate.addEventListener('change', () => { this.setRotate(this.dom_txt_rotate.value); }, { signal: this.signal });
this.dom_txt_translate_x.addEventListener('change', () => {
        this.dom_txt_translate_x.value = String(this.clampTranslate(this.dom_txt_translate_x.value));
    }, { signal: this.signal });
this.dom_txt_translate_y.addEventListener('change', () => {
        this.dom_txt_translate_y.value = String(this.clampTranslate(this.dom_txt_translate_y.value));
    }, { signal: this.signal });
this.wireTransformUndo('scale', this.dom_txt_scale);
this.wireTransformUndo('scaleX', this.dom_txt_scale_x);
this.wireTransformUndo('scaleY', this.dom_txt_scale_y);
this.wireTransformUndo('rotate', this.dom_txt_rotate);
this.wireTransformUndo('translateX', this.dom_txt_translate_x);
this.wireTransformUndo('translateY', this.dom_txt_translate_y);
        this.screenmap_pts = [];
        this.rawPts = [];
        this.origWidth = 0;
        this.origHeight = 0;
        this.fitScale = 1;
        this.origDiameter = 0.5;
        this.stripStore = new StripStore();
        this.stripInfo = null;
        this.selection = new Selection();
this.selection.setOnChange(() => {
        this.setNeedsGeometryUpdate();
        this.renderStripsPanel();
        this._updateHintStrip();
        this._maybeShowGestureNotice();
    });
        this.editorMode = 'select';
        this.connectorDrag = null;
        this.startHandleDrag = null;
        this._chainGeom = { connectors: [], starts: [], ends: [], crossBadges: [] };
;
        this.labelRenderer = createLabelRenderer();
window.__labelLayoutDebug = () => this.labelRenderer.debugDump();
const shapeeditorDebug: ShapeeditorDebugHooks = {
        getStripCount: () => (this.stripInfo ? this.stripInfo.strips.length : 0),
        getStripLabels: () => (this.stripInfo
            ? this.stripInfo.strips.map((s, i) => stripStartEndLabels(s, i))
            : null),
        getSelectedStrip: () => this.selection.getStripIdx(),
        getSelectedStrips: () => [...this.selection.getSelectedStripIdxs()],
        getPrimarySelectedStrip: () => this.selection.getPrimaryStripIdx(),
        getStripNames: () => (this.stripInfo ? this.stripInfo.strips.map((s) => s.name) : []),
        getSelectionOutlineColor: () => {
            const selected = this._selectedStripObbCanvas();
            if (!selected) return null;
            return this.pointEditStripIdx === selected.idx ? gfxColors.accentRed() : gfxColors.accentBlue();
        },
        selectStrip: (i: number) => { this.selection.selectStrip(i); this.setNeedsGeometryUpdate(); },
        selectStrips: (indices: number[]) => {
            this.selection.selectOnlyStrip(null);
            for (const idx of indices) this.selection.addStrip(idx);
            this.setNeedsGeometryUpdate();
        },
        placePanel: (catalogId: string, worldX: number, worldY: number, opts: PanelOpts) => this._debugPlacePanel(catalogId, worldX, worldY, opts),
        getPlacingMode: () => (this.placingState ? this.placingState.entry.id : null),
        cancelPlacing: () => { this._cancelPlacing(); },
        getChainArrowCount: () => this._chainArrowCount(),
        reverseStrip: (i: number) => { this.doReverseStrip(i); },
        getBackupInfo: () => {
            const b = getBackup();
            if (!b) return null;
            return { meta: b.meta, hasJson: typeof b.json === 'string' && b.json.length > 0 };
        },
        getHintText: () => (this.hintStripTextEl ? this.hintStripTextEl.textContent : ''),
        openHelp: () => { void this._openHelpOverlay(); },
        getPointEditMode: () => this.pointEditStripIdx,
        enterPointEditMode: (i: number) => {
            if (typeof i !== 'number' || i < 0) return;
            const strips = this.stripStore.getStrips();
            if (i >= strips.length) return;
            this.selection.selectStrip(i);
            this.pointEditStripIdx = i;
            this._updateHintStrip();
        },
        exitPointEditMode: () => { this.pointEditStripIdx = null; this._updateHintStrip(); },
        // Get the per-LED screenmap coords of a strip (debug for group-drag tests)
        getStripPoints: (i: number) => {
            const strips = this.stripStore.getStrips();
            if (i < 0 || i >= strips.length) return null;
            const s = strips[i];
            if (!s) return null;
            const out = [];
            for (let k = s.offset; k < s.offset + s.count; k++) {
                const pt = this.screenmap_pts[k];
                out.push([pt?.[0] ?? 0, pt?.[1] ?? 0]);
            }
            return out;
        },
        // Get a flat LED's transformed canvas coords (for synthetic drag tests).
        getLedCanvasPos: (flatIdx: number) => {
            if (flatIdx < 0 || flatIdx >= this.lastTransformedPts.length) return null;
            const ltp = this.lastTransformedPts[flatIdx];
            if (!ltp) return null;
            const [x, y] = ltp;
            const [cx, cy] = this.toCanvasCoords(x, y);
            if (!this.overlayCanvas) return null;
            const rect = this.overlayCanvas.getBoundingClientRect();
            // Convert internal canvas px → client px
            const clientX = rect.left + (cx / this.canvasW) * rect.width;
            const clientY = rect.top + (cy / this.canvasH) * rect.height;
            return { clientX, clientY, canvasX: cx, canvasY: cy };
        },
        getStripRotateHandlePos: () => {
            const handle = this._stripRotateHandlePos();
            if (!handle || !this.overlayCanvas) return null;
            const rect = this.overlayCanvas.getBoundingClientRect();
            const toClient = (canvasX: number, canvasY: number) => ({
                x: rect.left + (canvasX / this.canvasW) * rect.width,
                y: rect.top + (canvasY / this.canvasH) * rect.height,
            });
            const anchor = toClient(handle.anchorX, handle.anchorY);
            const button = toClient(handle.handleX, handle.handleY);
            const center = toClient(handle.centerX, handle.centerY);
            return {
                anchorX: handle.anchorX,
                anchorY: handle.anchorY,
                handleX: handle.handleX,
                handleY: handle.handleY,
                centerX: handle.centerX,
                centerY: handle.centerY,
                clientAnchorX: anchor.x,
                clientAnchorY: anchor.y,
                clientHandleX: button.x,
                clientHandleY: button.y,
                clientCenterX: center.x,
                clientCenterY: center.y,
            };
        },
        getStripRotateVisualState: () => {
            const visual = this.stripRotateLastDrawnVisual;
            if (!this.overlayCanvas || !visual) {
                return {
                    active: this.stripRotateActive,
                    deltaDeg: this.stripRotateLastDeg,
                    drawRevision: this.stripRotateDrawRevision,
                    obb: visual?.obb ?? null,
                    handle: null,
                };
            }
            const rect = this.overlayCanvas.getBoundingClientRect();
            const toClient = (canvasX: number, canvasY: number) => ({
                x: rect.left + (canvasX / this.canvasW) * rect.width,
                y: rect.top + (canvasY / this.canvasH) * rect.height,
            });
            const h = visual.handle;
            const anchor = toClient(h.anchorX, h.anchorY);
            const button = toClient(h.handleX, h.handleY);
            const center = toClient(h.centerX, h.centerY);
            return {
                active: this.stripRotateActive,
                deltaDeg: this.stripRotateLastDeg,
                drawRevision: this.stripRotateDrawRevision,
                obb: { ...visual.obb },
                handle: {
                    ...h,
                    clientAnchorX: anchor.x,
                    clientAnchorY: anchor.y,
                    clientHandleX: button.x,
                    clientHandleY: button.y,
                    clientCenterX: center.x,
                    clientCenterY: center.y,
                },
            };
        },
        // Paste flow hooks (Phase 3)
        pasteScreenmapText: (text: string) => this._enterPasteFromText(text || ''),
        getPasteState: () => (this.pasteState
            ? { count: this.pasteState.strips.length, names: this.pasteState.strips.map((s) => s.name) }
            : null),
        commitPasteAt: (canvasX: number, canvasY: number) => { this._commitPasteAt(canvasX, canvasY); },
        cancelPaste: () => { this._cancelPaste(); },
        copySelectedStrip: () => { this._copySelectedStripToClipboard(); },
        // Insert dialog hooks (Phase 4)
        openInsertDialog: () => this._openInsertDialog(),
        submitInsertDialog: (opts: Record<string, unknown>) => this._submitInsertDialog(opts as unknown as InsertDialogOpts),
        // Touch (Phase 5) — synchronously execute the long-press action at
        // the given canvas-internal coords without waiting 600ms in tests.
        simulateLongPress: (canvasX: number, canvasY: number) => {
            if (!this.overlayCanvas) return false;
            const rect = this.overlayCanvas.getBoundingClientRect();
            const clientX = rect.left + (canvasX / this.canvasW) * rect.width;
            const clientY = rect.top + (canvasY / this.canvasH) * rect.height;
            this._doLongPress(canvasX, canvasY, clientX, clientY);
            return true;
        },
        getCamZoom: () => this.camZoom,
        getCamPan: () => ({ x: this.camPanX, y: this.camPanY }),
        getStripSnapState: () => ({
            active: this.stripDragActive,
            targetCounts: {
                x: this.stripSnapTargets.x.length,
                y: this.stripSnapTargets.y.length,
                rulerBodies: this.stripSnapTargets.rulerBodies.length,
            },
            targetKinds: {
                x: this.stripSnapTargets.x.map((target) => target.kind),
                y: this.stripSnapTargets.y.map((target) => target.kind),
            },
            engagement: this.stripSnapEngagement,
        }),
        getPointerGestureState: () => ({
            rightButtonDown: this.rightButtonDown,
            pending: this.pendingGroupGesture ? { ...this.pendingGroupGesture } : null,
            stripDragActive: this.stripDragActive,
        }),
        // Drive a synthetic drag from (flatIdx) by (dxClient, dyClient) client px.
        simulateLedDrag: (flatIdx: number, dxClient: number, dyClient: number, opts: Record<string, unknown> | null | undefined) => {
            const pos = window.__shapeeditorDebug?.getLedCanvasPos?.(flatIdx) ?? null;
            if (!pos) return false;
            const altKey = Boolean(opts?.altKey);
            const shiftKey = Boolean(opts?.shiftKey);
            const button = typeof opts?.button === 'number' ? opts.button : 0;
            // Drive the same handlers directly because modern browsers route
            // canvas input through PointerEvents (there is no mouse listener
            // to receive a synthetic MouseEvent in that mode).
            this._synth('mousedown', pos.clientX, pos.clientY, { altKey, shiftKey, button });
            this._synth('mousemove', pos.clientX + dxClient, pos.clientY + dyClient, { altKey, shiftKey, button });
            this._synth('mouseup', pos.clientX + dxClient, pos.clientY + dyClient, { altKey, shiftKey, button });
            return true;
        },
        // Synthetic per-strip rotation drag: select strip `i`, then drive
        // mousedown → mousemove (at +deltaDeg around the handle anchor)
        // → mouseup. Mirrors the production wiring so tests cover real
        // event flow rather than calling `_applyStripRotate` directly.
        simulateStripRotateDrag: (i: number, deltaDeg: number) => {
            const strips = this.stripStore.getStrips();
            if (i < 0 || i >= strips.length) return false;
            this.selection.selectStrip(i);
            const handle = this._stripRotateHandlePos();
            if (!handle || !this.overlayCanvas) return false;
            // The OBB center is the rotation pivot in canvas pixels.
            const anchorX = handle.centerX;
            const anchorY = handle.centerY;
            const rect = this.overlayCanvas.getBoundingClientRect();
            const toClient = (cx: number, cy: number) => ({
                clientX: rect.left + (cx / this.canvasW) * rect.width,
                clientY: rect.top + (cy / this.canvasH) * rect.height,
            });
            // Mousedown at the handle itself (so the hit-test fires).
            const start = toClient(handle.handleX, handle.handleY);
            // The angle from the handle to the anchor is -90° (handle is
            // 30px above the bbox top). Rotate that vector by deltaDeg to
            // pick a mousemove point at the same radius but rotated.
            const dxStart = handle.handleX - anchorX;
            const dyStart = handle.handleY - anchorY;
            const rad = deltaDeg * Math.PI / 180;
            const dxEnd = dxStart * Math.cos(rad) - dyStart * Math.sin(rad);
            const dyEnd = dxStart * Math.sin(rad) + dyStart * Math.cos(rad);
            const end = toClient(anchorX + dxEnd, anchorY + dyEnd);
            this._synth('mousedown', start.clientX, start.clientY);
            this._synth('mousemove', end.clientX, end.clientY);
            this._synth('mouseup', end.clientX, end.clientY);
            return true;
        },
        // Pins / chain hooks (issue #24, Phases 1-2)
        getPinSummary: () => {
            const strips = this.stripStore.getStrips();
            const order = this.stripStore.getPinOrder();
            return order.map((pinId) => {
                const stripIndices: number[] = [];
                let totalCount = 0;
                strips.forEach((s, i) => {
                    if (StripStore.pinOf(s) === pinId) {
                        stripIndices.push(i);
                        totalCount += s.count;
                    }
                });
                return { pinId, stripIndices, totalCount };
            });
        },
        getStripPins: () => this.stripStore.getStrips().map((s) => StripStore.pinOf(s)),
        getVideoOffsets: () => this.stripStore.getStrips().map((s) => ({
            video_offset: s.video_offset,
            override: s.videoOffsetOverride,
        })),
        repinStrip: (stripIdx: number, newPinId: string) => this.doRepinStrip(stripIdx, newPinId),
        getDerivedVideoOffset: (stripIdx: number) => this.stripStore.getDerivedVideoOffset(stripIdx),
        setVideoOffsetOverride: (stripIdx: number, value: boolean) => {
            const strips = this.stripStore.getStrips();
            const s = strips[stripIdx];
            if (!s) return false;
            if (s.videoOffsetOverride !== value) this.doToggleVoLock(stripIdx);
            return true;
        },
        addPin: () => this.doAddPin(),
        renamePin: (oldId: string, newId: string) => this.doRenamePin(oldId, newId),
        // Chain / Reorder modes (issue #24, Phase 3)
        getMode: () => this.editorMode,
        setMode: (m: string | null) => { this.setEditorMode(m); return this.editorMode; },
        simulateConnectorDrag: (stripIdx: number, targetStripIdx: number) => {
            this.doConnectorRetarget(stripIdx, targetStripIdx);
        },
        getCrossPinBadgeCount: () => this._crossPinBadgeCount(),
        getChainGeom: () => ({
            connectors: this._chainGeom.connectors.map((c) => ({ up: c.up, down: c.down, x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 })),
            starts: this._chainGeom.starts.map((s) => ({ strip: s.strip, x: s.x, y: s.y })),
            ends: this._chainGeom.ends.map((s) => ({ strip: s.strip, x: s.x, y: s.y })),
            crossBadges: this._chainGeom.crossBadges.map((b) => ({ up: b.up, down: b.down })),
        }),
        getUndoStack: () => (this.undoStack).map((a) => a.type),
        getInteractionState: () => ({
            pendingGroupGesture: this.pendingGroupGesture?.kind ?? null,
            stripDragActive: this.stripDragActive,
            groupMarqueeActive: this.groupMarqueeActive,
            isPanning: this.isPanning,
            connectorDragActive: this.connectorDrag !== null || this.startHandleDrag !== null,
        }),
        // Dispatch a real contextmenu event at canvas-internal coords so the
        // connector right-click hit-test path is exercised end-to-end.
        simulateCanvasContextMenu: (canvasX: number, canvasY: number) => {
            if (!this.overlayCanvas) return false;
            const rect = this.overlayCanvas.getBoundingClientRect();
            const clientX = rect.left + (canvasX / this.canvasW) * rect.width;
            const clientY = rect.top + (canvasY / this.canvasH) * rect.height;
            this.overlayCanvas.dispatchEvent(new MouseEvent('contextmenu', {
                clientX, clientY, button: 2, bubbles: true, cancelable: true,
            }));
            return true;
        },
    };
window.__shapeeditorDebug = shapeeditorDebug;
// Live per-tool debug state on window.__lmDebug, ships always-on (prod
// included) — the existing __shapeeditorDebug object is kept as-is (16
// existing specs depend on it) and additionally exposed here alongside a
// getState() summary, per #225.
registerDebugState('shapeeditor', {
    getState: () => ({
        stripCount: this.stripStore.getStrips().length,
        totalPoints: this.screenmap_pts.length,
        // Reset stays dirty-gated, so its enabled state is the dirty flag now
        // that Save As… is existence-gated instead (#292).
        dirty: !this.dom_btn_reset.disabled,
        directionArrowCount: this.directionArrowCount,
        directionArrowAlpha: this.overlayAlpha,
        directionArrowLayers: this.directionArrowLayers,
        directionArrowTransitionPhase: this.directionArrowTransitionPhase,
    }),
    debug: shapeeditorDebug,
});
        this.canvasW = 0;
        this.canvasH = 0;
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.wrapper = null;
        this.pointsMesh = null;
        this.pointsGeometry = null;
        this.pointsMaterial = null;
        this.circleTexture = createCircleTexture(64);
        this.gridLines = null;
        this.bgImageMesh = null;
        this.bgImageTexture = null;
        this.screenmapOutline = null;
        this.infoDiv = null;
        this.placeholderDiv = null;
        this.overlayCanvas = null;
        this.overlayCtx = null;
        this.tooltipLedIdx = -1;
        this.tooltip = null;
        this.lastTransformedPts = [];
        this.isHovering = false;
        this.overlayAlpha = 0;
        this.directionArrowCount = 0;
        this.directionArrowLayers = [];
        this.directionArrowTransitionPhase = 'idle';
        this.directionArrowTransition = new DirectionArrowTransition();
        this.ptsBBox = null;
        this.geometryDirty = true;
        this.frameDirty = true;
        this.lastBuiltPointCount = -1;
        this.layoutLoadGeneration = 0;
        this.pointsColorAttr = null;
        this.selectedIdx = -1;
        this.isDragging = false;
        this.dragStartCanvasX = 0;
        this.dragStartCanvasY = 0;
        this.dragStartScreenmapPt = null;
        this.dragStartRawPt = null;
        this.pointEditStripIdx = null;
        this.stripDragActive = false;
        this.stripDragIdx = -1;
        this.stripDragIdxs = [];
        this.stripDragPointIdxs = [];
        this.stripDragStartScreenmapByIdx = new Map();
        this.stripDragStartRawByIdx = new Map();
        this.pendingGroupGesture = null;
        this.groupMarqueeActive = false;
        this.groupMarqueeBaseSelection = new Set();
        this.groupMarqueeMode = 'replace';
        this.groupGestureSelectionSnapshot = null;
        this.stripDragStartScreenmap = null;
        this.stripDragStartRaw = null;
        this.stripDragLastSdx = 0;
        this.stripDragLastSdy = 0;
        this.stripDragFreeTranslate = false;
        this.stripSnapStartGeometry = null;
        this.stripSnapTransform = null;
        this.stripSnapTargets = emptyStripSnapTargetSet();
        this.stripSnapEngagement = { mode: 'none' };
        this.stripRotateActive = false;
        this.stripRotateIdx = -1;
        this.stripRotateIdxs = [];
        this.stripRotatePointIdxs = [];
        this.stripRotateStartScreenmap = null;
        this.stripRotateStartRaw = null;
        this.stripRotateCenterSm = null;
        this.stripRotateCenterRaw = null;
        this.stripRotateStartAngle = 0;
        this.stripRotateLastDeg = 0;
        this.stripRotateHover = false;
        this.stripRotateObbSnapshot = null;
        this.stripRotateDrawRevision = 0;
        this.stripRotateLastDrawnVisual = null;
        this.altQuasimode = false;
        this.ctxMenu = null;
        this.ctxMenuIdx = -1;
        this.ctxBtnSave = null;
        this.ctxBtnLoadScreenmap = null;
        this.ctxLoadSubmenu = null;
        this.ctxLoadImageInput = null;
        this.ctxFileOps = null;
        this.ctxFileOpsSep = null;
        this.ctxBtnDelete = null;
        this.ctxBtnInsertBetween = null;
        this.ctxBtnInsertFwd = null;
        this.ctxBtnInsertBack = null;
        this.ctxBtnCopyStrip = null;
        this.ctxRulerSep = null;
        this.ctxBtnInsertRuler = null;
        this.ctxBtnDuplicateRuler = null;
        this.ctxBtnDeleteRuler = null;
        this.hintStripTextEl = null;
        this.hintStripHelpBtn = null;
        this._autoOpenHelpScheduled = false;
        this.highlightedEdgeIdx = -1;
        this.loadedPresets = [];
        this.ctxBtnClass = 'shapeeditor-context-menu-button';
        this.camPanX = 0;
        this.camPanY = 0;
        this.camZoom = 1;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panStartCamX = 0;
        this.panStartCamY = 0;
        this.rightButtonDown = false;
        this.rightClickMoved = false;
        this.rightStartClientX = 0;
        this.rightStartClientY = 0;
        this.spacePanHeld = false;
        this.gizmoActive = null;
        this.gizmoHover = null;
        this.gizmoDragStart = null;
        this._dragPreviewActive = false;
        this.multiSelectedIdxs = new Set<number>();
        this.marqueeActive = false;
        this.marqueeStartCx = 0;
        this.marqueeStartCy = 0;
        this.marqueeCurCx = 0;
        this.marqueeCurCy = 0;
        this.marqueeMode = 'replace';
        this._marqueeBaseSelection = new Set<number>();
        this._pendingMarquee = null;
        this.multiDragActive = false;
        this.multiDragStartCanvasX = 0;
        this.multiDragStartCanvasY = 0;
        this.multiDragStartScreenmap = new Map<number, [number, number]>();
        this.multiDragStartRaw = new Map<number, [number, number]>();
        this.multiDragLastSdx = 0;
        this.multiDragLastSdy = 0;
        this.shiftHeld = false;
        this.bgImageFitW = 0;
        this.bgImageFitH = 0;
        this.bgImageBBox = null;
        this.bgGizmoActive = null;
        this.bgGizmoHover = null;
        this.bgGizmoDragStart = null;
        this.committedTransform = { scale: 1, scaleX: 1, scaleY: 1, rotate: 0, translateX: 0, translateY: 0 };
;
        this.undoStack = [];
        this.redoStack = [];
this.dom_btn_undo.addEventListener('click', () => { this.performUndo(); }, { signal: this.signal });
this.dom_btn_redo.addEventListener('click', () => { this.performRedo(); }, { signal: this.signal });
        this.dom_strips_panel = this.qe<HTMLElement>('#strips_panel');
        this.dom_strips_list = this.qe<HTMLElement>('#strips_list');
        this.collapsedPins = new Set();
        this.dom_strips_backup_row = this.qe<HTMLElement>('#strips_backup_row');
        this.dom_strips_backup_summary = this.qe<HTMLElement>('#strips_backup_summary');
        this.dom_strips_btn_restore_backup = this.qeb('#strips_btn_restore_backup');
        this.dom_strips_btn_restore_backup.addEventListener('click', () => { this.doRestoreBackupFromButton(); }, { signal: this.signal });

        this.dom_strips_list.addEventListener('click', (e: MouseEvent) => { void (async () => {
            const tgt = e.target as Element | null;
            const btn = tgt?.closest('button[data-action]');
            if (btn) {
                e.stopPropagation();
                e.preventDefault();
                const action = (btn as HTMLElement).dataset.action;
                if (action === 'add-strip') {
                    this.pendingNewStripPin = (btn as HTMLElement).dataset.pinId ?? null;
                    void this._openInsertDialog();
                    return;
                }
                const idx = parseInt((btn as HTMLElement).dataset.stripIdx ?? '', 10);
                if (action === 'up') this.doReorderStrip(idx, this._withinPinNeighbor(idx, -1));
                else if (action === 'down') this.doReorderStrip(idx, this._withinPinNeighbor(idx, 1));
                else if (action === 'reverse') this.doReverseStrip(idx);
                else if (action === 'rename') await this.doRenameStripPrompt(idx);
                else if (action === 'delete') await this.doDeleteStripPrompt(idx);
                else if (action === 'lock') this.doToggleVoLock(idx);
                return;
            }
            // Pin name click → rename (don't toggle the <details>)
            const pinName = tgt?.closest('.pin-name');
            if (pinName) {
                e.preventDefault();
                e.stopPropagation();
                await this.doRenamePinPrompt((pinName as HTMLElement).dataset.pinId ?? '');
                return;
            }
            // Connector row click → inline menu (Chain mode, §1.6)
            const cRow = tgt?.closest('.connector-row');
            if (cRow) {
                e.preventDefault();
                e.stopPropagation();
                this._openConnectorMenu(
                    parseInt((cRow as HTMLElement).dataset.upIdx ?? '', 10),
                    parseInt((cRow as HTMLElement).dataset.downIdx ?? '', 10),
                    e.clientX, e.clientY,
                );
                return;
            }
            // Ignore clicks that target inputs (so they keep focus)
            if (tgt?.closest('input')) return;
            const row = tgt?.closest('.strip-row');
            if (row) {
                const idx = parseInt((row as HTMLElement).dataset.stripIdx ?? '', 10);
                if (e.shiftKey) this.selection.toggleStrip(idx);
                else this.selection.selectOnlyStrip(idx);
            }
        })(); }, { signal: this.signal });

        this.dom_strips_list.addEventListener('change', (e: Event) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.dataset.role === 'video-offset') {
                if (t.readOnly) return; // derived value — LOCK not engaged
                const idx = parseInt(t.dataset.stripIdx ?? '', 10);
                this.doSetVideoOffset(idx, t.value);
            }
        }, { signal: this.signal });

        // ── Drag & drop: grip drag (reorder / repin) + pin header drag ──
        /** @type {null | {kind:'strip', idx:number} | {kind:'pin', pinId:string}} */
        let panelDragState: { kind: 'strip'; idx: number } | { kind: 'pin'; pinId: string } | null = null;

        const clearDragOver = () => {
            for (const el of this.dom_strips_list.querySelectorAll('.drag-over')) {
                el.classList.remove('drag-over');
            }
        };

        this.dom_strips_list.addEventListener('dragstart', (e: DragEvent) => {
            const ds_tgt = e.target as Element | null;
            const grip = ds_tgt?.closest('.strip-grip') ?? null;
            if (grip) {
                panelDragState = { kind: 'strip', idx: parseInt((grip as HTMLElement).dataset.stripIdx ?? '', 10) };
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                return;
            }
            const header = ds_tgt?.closest('.pin-header') ?? null;
            if (header) {
                panelDragState = { kind: 'pin', pinId: (header as HTMLElement).dataset.pinId ?? '' };
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }
        }, { signal: this.signal });

        this.dom_strips_list.addEventListener('dragover', (e: DragEvent) => {
            if (!panelDragState) return;
            const dov_tgt = e.target as Element | null;
            const target = dov_tgt?.closest('.strip-row') ?? dov_tgt?.closest('.pin-header') ?? null;
            if (!target) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            clearDragOver();
            target.classList.add('drag-over');
        }, { signal: this.signal });

        this.dom_strips_list.addEventListener('drop', (e: DragEvent) => {
            if (!panelDragState) return;
            e.preventDefault();
            clearDragOver();
            const drag = panelDragState;
            panelDragState = null;
            const drop_tgt = e.target as Element | null;
            const rowTarget = drop_tgt?.closest('.strip-row') ?? null;
            const headerTarget = drop_tgt?.closest('.pin-header') ?? null;
            if (drag.kind === 'strip') {
                if (rowTarget) {
                    const toIdx = parseInt((rowTarget as HTMLElement).dataset.stripIdx ?? '', 10);
                    if (toIdx === drag.idx) return;
                    const strips = this.stripStore.getStrips();
                    const dragStrip = strips[drag.idx];
                    const fromPin = dragStrip ? this._pinOfStrip(dragStrip) : null;
                    const toPin = (rowTarget as HTMLElement).dataset.pinId;
                    if (fromPin === toPin) this.doReorderStrip(drag.idx, toIdx);
                    else if (toPin !== undefined) this.doRepinStrip(drag.idx, toPin);
                } else if (headerTarget) {
                    const htPinId = (headerTarget as HTMLElement).dataset.pinId;
                    if (htPinId !== undefined) this.doRepinStrip(drag.idx, htPinId);
                }
            } else if (headerTarget) {
                const order = this.stripStore.getPinOrder();
                const toIdx = order.indexOf((headerTarget as HTMLElement).dataset.pinId ?? '');
                if (toIdx >= 0) this.doReorderPin(drag.pinId, toIdx);
            }
        }, { signal: this.signal });

        this.dom_strips_list.addEventListener('dragend', () => {
            panelDragState = null;
            clearDragOver();
        }, { signal: this.signal });

        this.dom_strips_btn_add_pin = this.qe<HTMLElement>('#strips_btn_add_pin');
        this.dom_strips_btn_add_pin.addEventListener('click', () => { this.doAddPin(); }, { signal: this.signal });

        this.dom_strips_btn_select = this.qe<HTMLElement>('#strips_btn_select');
        this.dom_strips_btn_chain = this.qe<HTMLElement>('#strips_btn_chain');
        this.dom_strips_btn_reorder = this.qe<HTMLElement>('#strips_btn_reorder');
        this.dom_strips_btn_select.addEventListener('click', () => {
            this.setEditorMode('select');
        }, { signal: this.signal });
        this.dom_strips_btn_chain.addEventListener('click', () => {
            this.setEditorMode(this.editorMode === 'chain' ? 'select' : 'chain');
        }, { signal: this.signal });
        // Canvas Chain-mode interactions are desktop-only (§1.11): hide the
        // button on touch-only devices.
        try {
            if (window.matchMedia('(hover: none)').matches) {
                this.dom_strips_btn_chain.hidden = true;
            }
        } catch { /* matchMedia unavailable */ }
        this.dom_strips_btn_reorder.addEventListener('click', () => {
            this.setEditorMode(this.editorMode === 'reorder' ? 'select' : 'reorder');
        }, { signal: this.signal });

        this.dom_strips_selected_row = this.qe<HTMLElement>('#strips_selected_row');
        this.dom_strips_selected_label = this.qe<HTMLElement>('#strips_selected_label');
        this.dom_strips_move_pin = this.qe<HTMLSelectElement>('#strips_move_pin');
        this.dom_strips_rotate_left = this.qeb('#strips_rotate_left');
        this.dom_strips_rotate_right = this.qeb('#strips_rotate_right');
        this.dom_strips_rotate_degrees = this.qei('#strips_rotate_degrees');
        this.dom_strips_rotate_apply = this.qeb('#strips_rotate_apply');
        this.dom_strips_rotate_left.addEventListener('click', () => { this.doRotateSelectedStripByDegrees(-90); }, { signal: this.signal });
        this.dom_strips_rotate_right.addEventListener('click', () => { this.doRotateSelectedStripByDegrees(90); }, { signal: this.signal });
        this.dom_strips_rotate_apply.addEventListener('click', () => {
            this.doRotateSelectedStripByDegrees(parseFloat(this.dom_strips_rotate_degrees.value));
        }, { signal: this.signal });
        this.dom_strips_move_pin.addEventListener('change', () => {
            const sIdx = this.selection.getStripIdx();
            const value = this.dom_strips_move_pin.value;
            if (sIdx === null || sIdx < 0 || !value) return;
            if (value === '__new__') this.doRepinStrip(sIdx, this._nextFreePinId());
            else this.doRepinStrip(sIdx, value);
        }, { signal: this.signal });
        this.dom_strips_show_chain = this.qei('#strips_show_chain');
        this.showChainArrows = this.dom_strips_show_chain.checked;
        this.dom_strips_show_chain.addEventListener('change', () => {
            this.showChainArrows = this.dom_strips_show_chain.checked;
            this.setNeedsRender();
        }, { signal: this.signal });

        this.connectorMenuEl = null;
window.addEventListener('mousedown', (e) => {
        if (this.connectorMenuEl && !this.connectorMenuEl.contains(e.target as Node | null)) {
            this._hideConnectorMenu();
        }
    }, { signal: this.signal });
        this.rafId = null;
        this._gestureNoticeShown = false;
this.dom_btn_new.addEventListener('click', () => {
        // Promote current working copy (if any) into the backup slot BEFORE
        // we wipe it, so the prior layout stays restorable. Then drop the
        // working copy entirely instead of writing a degenerate
        // single-LED screenmap that would auto-load on next launch.
        const hadBackupPromote = promoteToBackup();
        this.clearEditingState();
        this.presetPicker?.setActive('');
        this.screenmap_pts = [[0, 0]];
        this.rawPts = [[0, 0]];
        this.stripInfo = null;
        this.stripStore.load(null);
        this.renderStripsPanel();
        this.origDiameter = 0.5;
        this.dom_txt_diameter.value = String(this.origDiameter);
        this.origWidth = 0;
        this.origHeight = 0;
        this.fitScale = 1;
        this.resetTransforms();
        this.setNeedsGeometryUpdate();
        safeStorage.remove('lm:screenmap');
        safeStorage.remove('lm:screenmap-meta');
        safeStorage.remove('lm:screenmap-preset');
        try { this.renderBackupRow(); } catch { /* render is best-effort */ }
        if (hadBackupPromote) {
            void this._toastInfo('New layout — previous layout kept as backup').catch(() => { /* toast is best effort */ });
        }
    }, { signal: this.signal });
        this.screenmapDropTarget = this.qe<HTMLElement>('#screenmap_drop_target');
        wireFileSource({
            input: this.dom_btn_upload_screenmap,
            target: this.screenmapDropTarget,
            onFile: (file: File | null | undefined) => {
                this.loadScreenmapFile(file);
            },
            signal: this.signal,
        });
        this.imageDropTarget = this.qe<HTMLElement>('#image_drop_target');
        wireFileDropTarget({
            target: this.imageDropTarget,
            input: this.dom_btn_upload_image,
            onFile: (file) => {
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                    void errorDialog('Wrong file type', 'Please drop an image file.');
                    return;
                }
                this.loadBackgroundImage(file);
            },
            signal: this.signal,
        });
        // Preset-load click handling is wired through the shared picker
        // mounted in `loadPresetsFromManifest`; no select-change listener
        // needed here anymore (issue #206).
        this.bgImageObjectURL = null;
        this.bgImageControls = [this.dom_txt_image_opacity, this.dom_txt_image_scale,
        this.dom_txt_image_rotate, this.dom_txt_image_tx, this.dom_txt_image_ty,
        this.dom_btn_remove_image];
        this.deleteBgConfirmEl = null;
this.dom_btn_upload_image.addEventListener('change', () => {
        const file = this.dom_btn_upload_image.files?.[0];
        if (file) this.loadBackgroundImage(file);
    }, { signal: this.signal });
this.dom_txt_image_opacity.addEventListener('input', () => {
        const val = Math.max(0, Math.min(100, parseFloat(this.dom_txt_image_opacity.value) || 50));
        if (this.bgImageMesh) { ((this.bgImageMesh.material as Material)).opacity = val / 100; this.setNeedsRender(); }
    }, { signal: this.signal });
this.dom_txt_image_opacity.addEventListener('change', () => {
        this.dom_txt_image_opacity.value = String(Math.max(0, Math.min(100, Math.round(parseFloat(this.dom_txt_image_opacity.value) || 50))));
        if (this.bgImageMesh) { ((this.bgImageMesh.material as Material)).opacity = parseFloat(this.dom_txt_image_opacity.value) / 100; this.setNeedsRender(); }
    }, { signal: this.signal });
this.dom_txt_image_scale.addEventListener('input', () => {
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_scale.addEventListener('change', () => {
        const v = Math.max(0.1, Math.min(5, parseFloat(this.dom_txt_image_scale.value) || 1));
        this.dom_txt_image_scale.value = v.toFixed(2);
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_rotate.addEventListener('input', () => {
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_rotate.addEventListener('change', () => {
        const v = Math.max(-180, Math.min(180, parseFloat(this.dom_txt_image_rotate.value) || 0));
        this.dom_txt_image_rotate.value = v.toFixed(2);
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_tx.addEventListener('input', () => {
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_tx.addEventListener('change', () => {
        this.dom_txt_image_tx.value = String(parseInt(this.dom_txt_image_tx.value) || 0);
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_ty.addEventListener('input', () => {
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_txt_image_ty.addEventListener('change', () => {
        this.dom_txt_image_ty.value = String(parseInt(this.dom_txt_image_ty.value) || 0);
        this.applyBgImageTransform();
    }, { signal: this.signal });
this.dom_btn_remove_image.addEventListener('click', () => { this.removeBackgroundImage(); }, { signal: this.signal });
        this.rulers = [];
        this.rulerDrag = null;
        this.rulerDragStart = null;
        this.ctxMenuRulerIdx = -1;
        this.ctxMenuClickX = 0;
        this.ctxMenuClickY = 0;
        this.RULER_HANDLE_R = 7;
        this.LONG_PRESS_MS = 600;
        this.LONG_PRESS_MOVE_TOL = 10;
        this.touchMode = 'idle';
        this.touchStartClientX = 0;
        this.touchStartClientY = 0;
        this.touchStartCanvasX = 0;
        this.touchStartCanvasY = 0;
        this.longPressTimer = null;
        this.multiPanStartCamPanX = 0;
        this.multiPanStartCamPanY = 0;
        this.multiPinchStartZoom = 1;
        this.multiStartCentroid = null;
        this.multiStartDist = 0;
window.addEventListener('keydown', (e) => {
        // Delete selected point
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIdx >= 0 && !this.isDragging) {
            this.deletePoint(this.selectedIdx);
            e.preventDefault();
            return;
        }
        // Delete background image (when no point selected)
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIdx < 0 && this.bgImageMesh && !this.isDragging) {
            this.showDeleteBgConfirm();
            e.preventDefault();
            return;
        }
        // Undo: Ctrl+Z / Cmd+Z
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            this.performUndo();
            e.preventDefault();
            return;
        }
        // Redo: Ctrl+Shift+Z / Ctrl+Y
        if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
            (e.key === 'y' && (e.ctrlKey || e.metaKey))) {
            this.performRedo();
            e.preventDefault();
            return;
        }
        // Escape: cancel panel placement, dismiss bg delete confirm, exit point-edit, or deselect
        if (e.key === 'Escape') {
            const hasActiveCanvasGesture = this.pendingGroupGesture !== null ||
                this.groupMarqueeActive || this.stripDragActive || this.stripRotateActive ||
                this.isPanning || this.isDragging || this.multiDragActive ||
                this.marqueeActive || this._pendingMarquee !== null ||
                this.gizmoActive !== null || this.bgGizmoActive !== null ||
                this.rulerDrag !== null;
            if (hasActiveCanvasGesture) {
                this._cancelSingleTouchGesture();
                e.preventDefault();
                return;
            }
            if (this.ctxMenu && getComputedStyle(this.ctxMenu).display !== 'none') { this.hideContextMenu(); e.preventDefault(); return; }
            if (this.connectorDrag || this.startHandleDrag) { this._cancelConnectorDrag(); e.preventDefault(); return; }
            if (this.connectorMenuEl) { this._hideConnectorMenu(); e.preventDefault(); return; }
            if (this.editorMode !== 'select') { this.setEditorMode('select'); e.preventDefault(); return; }
            if (this.placingState) { this._cancelPlacing(); e.preventDefault(); return; }
            if (this.pasteState) { this._cancelPaste(); e.preventDefault(); return; }
            if (this.deleteBgConfirmEl) { this.dismissDeleteBgConfirm(); e.preventDefault(); return; }
            if (this.pointEditStripIdx !== null) {
                this.pointEditStripIdx = null;
                this._updateHintStrip();
                e.preventDefault();
                return;
            }
            if (this.selectedIdx >= 0) { this.selectedIdx = -1; this.setNeedsGeometryUpdate(); }
            this.selection.clear();
            this._updateHintStrip();
        }
        // Discoverability shortcuts — skip when typing in an input/textarea
        const isTyping = e.target && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable);
        if (isTyping) return;
        if (e.code === 'Space') {
            this.spacePanHeld = true;
            e.preventDefault();
            return;
        }
        if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            this.setEditorMode('select');
            e.preventDefault();
            return;
        }
        // ? or F1 → help
        if (e.key === '?' || e.key === 'F1') {
            void this._openHelpOverlay();
            e.preventDefault();
            return;
        }
        // I → insert panel dialog
        if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            void this._openInsertDialog();
            e.preventDefault();
            return;
        }
        // Ctrl+V → paste screenmap. The document-level 'paste' handler is the
        // primary path; we also try navigator.clipboard.readText() as a
        // best-effort fallback (works in secure contexts with permission).
        if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            void this._pasteFromClipboardAPI();
            e.preventDefault();
            return;
        }
        // Ctrl+C → copy selected strip
        if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
            const sIdx = this.selection.getStripIdx();
            if (sIdx !== null && sIdx >= 0) {
                this._copySelectedStripToClipboard();
                e.preventDefault();
                return;
            }
        }
    }, { signal: this.signal });
window.addEventListener('resize', () => { this.handleResize(); }, { signal: this.signal });
window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') this.spacePanHeld = false;
    }, { signal: this.signal });
window.addEventListener('blur', () => { this.spacePanHeld = false; }, { signal: this.signal });
        this.placingState = null;
        this.pendingNewStripPin = null;
        this.pasteState = null;
        this.dom_panel_buttons = this.qe<HTMLElement>('#panel_catalog_buttons');
        this.dom_pp_wiring = this.qe<HTMLSelectElement>('#pp_wiring');
        this.dom_pp_corner = this.qe<HTMLSelectElement>('#pp_corner');
        this.dom_pp_rotation = this.qe<HTMLSelectElement>('#pp_rotation');
        this.dom_pp_flipH = this.qei('#pp_flipH');
        this.dom_pp_flipV = this.qei('#pp_flipV');
        this.dom_pp_spacing = this.qei('#pp_spacing');
        this.dom_pp_snap = this.qei('#pp_snap');
        this.dom_pp_grid = this.qei('#pp_grid');
        this.dom_pp_status = this.qe<HTMLElement>('#pp_status');
        this.dom_pp_open_dialog = this.qe<HTMLElement>('#pp_open_dialog');
        this.dom_pp_open_dialog.addEventListener('click', () => { void this._openInsertDialog(); }, { signal: this.signal });
        for (const entry of PANEL_CATALOG) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'panel-btn py-1 px-2 bg-lm-surface-1 text-lm-text border border-lm-border rounded cursor-pointer text-xs';
            btn.textContent = entry.label;
            btn.dataset.catalogId = entry.id;
            btn.addEventListener('click', () => { this._enterPlacing(entry.id); }, { signal: this.signal });
            this.dom_panel_buttons.appendChild(btn);
        }
document.addEventListener('paste', (e) => {
        const t = e.target;
        if (t && ((t as HTMLElement).tagName === 'INPUT' || (t as HTMLElement).tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)) return;
        const txt = e.clipboardData?.getData('text') ?? '';
        if (!txt) return;
        if (this._enterPasteFromText(txt)) {
            e.preventDefault();
        }
    }, { signal: this.signal });
;
};

ShapeEditor.prototype.start = function (this: ShapeEditor): void {
    this.initRenderer();
    void this.loadPresetsFromManifest();
    this.renderStripsPanel();
    this.rafId = requestAnimationFrame(() => {
        this.animate();
    });
};

ShapeEditor.prototype.destroy = function (this: ShapeEditor): void {

        unregisterDebugState('shapeeditor');
        this._cancelSingleTouchGesture();
        this.ac.abort();
        // Toasts/dialogs this editor spawned (e.g. the first-run hint toast)
        // live on document.body, outside our container, so they outlive the
        // view — leaving the "Click an LED · drag to move" toast stuck over
        // Play after a Create → Play switch. Dismiss any open popup on teardown
        // (a no-op when nothing is showing).
        void getSwal().then((s) => { s.close(); }).catch(() => { /* swal unavailable */ });
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.screenmapOutline) {
            this._scene().remove(this.screenmapOutline);
            this.screenmapOutline.geometry.dispose();
            ((this.screenmapOutline.material as Material)).dispose();
        }
        if (this.pointsMesh) {
            this._scene().remove(this.pointsMesh);
            this.pointsGeometry?.dispose();
            this.pointsMaterial?.dispose();
        }
        if (this.gridLines) {
            this._scene().remove(this.gridLines);
            this.gridLines.geometry.dispose();
            ((this.gridLines.material as Material)).dispose();
        }
        this.removeBackgroundImage();
        this.circleTexture.dispose();
        this._renderer().dispose();
        this.ctxMenu?.parentNode?.removeChild(this.ctxMenu);
        this.container.classList.remove('shapeeditor-root');
        this.mainEl.classList.remove('shapeeditor-main');
    
};
