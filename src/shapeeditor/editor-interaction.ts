// Named ShapeEditor method bundle: interaction.
import type { ShapeEditor } from './shapeeditor-class';
import {
    computeStripSnapGeometry,
    computeStripSnapTargets,
    emptyStripSnapTargetSet,
    resolveStripDragSnap,
    transformPointForSnap,
    inverseTransformSnapDelta,
    type SnapDocumentTransform,
} from "./strip-snap-targets";
import { rotatePointsAround } from "./strip-rotate";
import { flatPointIndicesForStrips, stripsIntersectingCanvasRect } from "./group-selection";
import { safeStorage } from "../services/storage";

const STRIP_STROKE_HIT_PX = 10;

export interface EditorInteractionMethods {
    _clearStripSnapState: () => void;
    _resolveCoarseStripHit: (canvasX: number, canvasY: number) => { stripIdx: number; edgeIdx: number } | null;
    _startStripDrag: (stripIdx: number, canvasX: number, canvasY: number) => boolean;
    _ledIdxsInCanvasRect: (c1x: number, c1y: number, c2x: number, c2y: number) => Set<number>;
    _updateMarqueeSelection: () => void;
    _updateGroupMarqueeSelection: () => void;
    _commitMarquee: () => void;
    _cancelMarquee: () => void;
    _startMultiDrag: (cx: number, cy: number) => void;
    _finalizeMultiDrag: () => void;
    _applyMultiTranslate: (idxs: number[], sdx: number, sdy: number) => void;
    onContextMenu: (e: MouseEvent) => void;
    onMouseDown: (e: MouseEvent) => void;
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
    onPointerCancel: () => void;
    onDoubleClick: (e: MouseEvent) => void;
    _clearLongPress: () => void;
    _synth: (type: string, clientX: number, clientY: number, opts?: Record<string, unknown>) => void;
    _cancelSingleTouchGesture: () => void;
    _doLongPress: (canvasX: number, canvasY: number, clientX: number, clientY: number) => void;
    _wireTouchHandlers: (signal: AbortSignal) => void;
    onMouseLeave: () => void;
}

export const editorInteractionMethods: EditorInteractionMethods & ThisType<ShapeEditor> = {
    _clearStripSnapState(this: ShapeEditor){
        this.stripSnapStartGeometry = null;
        this.stripSnapTransform = null;
        this.stripSnapTargets = emptyStripSnapTargetSet();
        this.stripSnapEngagement = { mode: 'none' };
    },
    _resolveCoarseStripHit(this: ShapeEditor, canvasX: number, canvasY: number){
        const candidates = this.hitTestLEDCandidates(canvasX, canvasY);
        const candidateStrips = [...new Set(candidates.map((candidate) => candidate.stripIdx))];
        const primary = this.selection.getPrimaryStripIdx();
        const hitStripIdx = candidateStrips.find((idx) => this.selection.isStripSelected(idx))
            ?? (primary !== null && candidateStrips.includes(primary) ? primary : candidateStrips[candidateStrips.length - 1]);
        if (hitStripIdx !== undefined && hitStripIdx >= 0) return { stripIdx: hitStripIdx, edgeIdx: -1 };
        if (this.screenmap_pts.length < 2) return null;
        const edge = this.findNearestEdge(canvasX, canvasY);
        if (!edge || edge.distSq > STRIP_STROKE_HIT_PX * STRIP_STROKE_HIT_PX) return null;
        return { stripIdx: edge.stripIdx, edgeIdx: edge.idx };
    },
    onContextMenu(this: ShapeEditor, e: MouseEvent){

        e.preventDefault();
        // Cancel panel placement on right-click
        if (this.placingState) {
            this._cancelPlacing();
            return;
        }
        if (this.pasteState) {
            this._cancelPaste();
            return;
        }
        // A right-button pan owns the gesture and suppresses context.
        const wasMoved = this.rightClickMoved;
        this.rightClickMoved = false;
        if (wasMoved) return;
        if (this.screenmap_pts.length === 0) return;
        const [cx, cy] = this.getCanvasCoords(e);
        // Ruler hit-test: stash the index so the context menu can show
        // "Duplicate ruler" / "Delete ruler" wired to this specific ruler.
        // -1 means "no ruler under the cursor at right-click time".
        this.ctxMenuRulerIdx = this._findRulerAtCanvasPoint(cx, cy);
        // Stash the screenmap (world) coordinates so "Insert ruler" can place
        // the new 60 cm ruler centered at the click location.
        const worldClick = this.canvasToScreenmapCoords(cx, cy);
        this.ctxMenuClickX = worldClick[0];
        this.ctxMenuClickY = worldClick[1];
        // Chain mode: right-click on a connector arrow opens the connector menu
        if (this.editorMode === 'chain') {
            const conn = this._hitConnectorBody(cx, cy);
            if (conn) {
                if (conn.up !== undefined && conn.down !== undefined) this._openConnectorMenu(conn.up, conn.down, e.clientX, e.clientY);
                return;
            }
        }
        const idx = this.hitTestLED(cx, cy);
        if (idx >= 0) {
            this.selectedIdx = idx;
            this.syncPointSelection(idx);
            this.highlightedEdgeIdx = -1;
            this.setNeedsGeometryUpdate();
            this.showContextMenu(e.clientX, e.clientY, idx, -1);
            return;
        }
        // No point hit — check for edge hit
        const edge = this.findNearestEdge(cx, cy);
        if (edge && edge.distSq <= STRIP_STROKE_HIT_PX * STRIP_STROKE_HIT_PX) {
            this.highlightedEdgeIdx = edge.idx;
            this.setNeedsRender();
            this.showContextMenu(e.clientX, e.clientY, -1, edge.idx);
            return;
        }
        this.highlightedEdgeIdx = -1;
        let insideBBox = false;
        if (this.ptsBBox) {
            const [lx, ly] = this.canvasToObbLocal(this.ptsBBox, cx, cy);
            insideBBox = Math.abs(lx) <= this.ptsBBox.hw && Math.abs(ly) <= this.ptsBBox.hh;
        }
        this.showContextMenu(e.clientX, e.clientY, -1, -1, insideBBox);
    },
    _startStripDrag(this: ShapeEditor, stripIdx: number, canvasX: number, canvasY: number){
    if (!this.stripInfo || stripIdx < 0 || stripIdx >= this.stripInfo.strips.length) return false;
    const selected = this.selection.getSelectedStripIdxs();
    const stripCount = this.stripInfo.strips.length;
    const stripIdxs = selected.has(stripIdx) ? [...selected].filter((idx) => idx >= 0 && idx < stripCount) : [stripIdx];
    const pointIdxs = flatPointIndicesForStrips(this.stripInfo.strips, stripIdxs);
    if (pointIdxs.length === 0) return false;
    this.dragStartCanvasX = canvasX;
    this.dragStartCanvasY = canvasY;
    this.stripDragActive = true;
    this.stripDragIdx = stripIdx;
    this.stripDragIdxs = stripIdxs;
    this.stripDragPointIdxs = pointIdxs;
    this.stripDragStartScreenmapByIdx = new Map();
    this.stripDragStartRawByIdx = new Map();
    this.stripDragStartScreenmap = [];
    this.stripDragStartRaw = [];
    for (const k of pointIdxs) {
        const sm: [number, number] = [this.nn(this.screenmap_pts[k])[0], this.nn(this.screenmap_pts[k])[1]];
        const rw: [number, number] = [this.nn(this.rawPts[k])[0], this.nn(this.rawPts[k])[1]];
        this.stripDragStartScreenmap.push(sm);
        this.stripDragStartRaw.push(rw);
        this.stripDragStartScreenmapByIdx.set(k, sm);
        this.stripDragStartRawByIdx.set(k, rw);
    }
    this.stripDragLastSdx = 0;
    this.stripDragLastSdy = 0;

    const transform = this.getCurrentTransform();
    const snapTransform: SnapDocumentTransform = {
        scaleX: transform.sX,
        scaleY: transform.sY,
        cos: transform.cosR,
        sin: transform.sinR,
        translateX: transform.tx,
        translateY: transform.ty,
    };
    this.stripSnapTransform = snapTransform;
    const renderedPoints = this.screenmap_pts.map((point) => transformPointForSnap(point, snapTransform));
    this.stripSnapStartGeometry = computeStripSnapGeometry(
        pointIdxs.map((idx) => renderedPoints[idx] ?? [0, 0]),
    );
    this.stripSnapTargets = computeStripSnapTargets({
        strips: this.stripInfo.strips,
        excludedStripIdxs: new Set(stripIdxs),
        points: renderedPoints,
        rulers: this.rulers,
        toleranceWorld: this.camZoom > 0 ? this.snapBackPx / this.camZoom : this.snapBackPx,
    });
    this.stripSnapEngagement = { mode: 'none' };
    this._oc().style.cursor = 'grabbing';
    this.setNeedsRender();
    return true;
},
    onMouseDown(this: ShapeEditor, e: MouseEvent){

        // Dismiss context menu on any click
        this.hideContextMenu();

        // Panel placement takes priority over every other handler
        if (this.placingState) {
            if (e.button === 2) {
                e.preventDefault();
                // The browser dispatches contextmenu after this pointerdown.
                // Suppress that paired event after the placement is gone.
                this.rightClickMoved = true;
                this._cancelPlacing();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = this.getCanvasCoords(e);
                this._commitPlacingAt(cx, cy);
                return;
            }
            return;
        }

        // Paste-pending ghost commit / cancel
        if (this.pasteState) {
            if (e.button === 2) {
                e.preventDefault();
                // Keep the cancellation gesture from opening the normal menu
                // when its subsequent contextmenu event arrives.
                this.rightClickMoved = true;
                this._cancelPaste();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = this.getCanvasCoords(e);
                this._commitPasteAt(cx, cy);
                return;
            }
            return;
        }

        if (this.screenmap_pts.length === 0 && !this.bgImageMesh) return;

        const [cx, cy] = this.getCanvasCoords(e);

        // Camera movement is an explicit quasimode. It takes priority over
        // selection so Space+left and middle drag work from any canvas point.
        if (e.button === 1 || (e.button === 0 && this.spacePanHeld)) {
            e.preventDefault();
            this.isPanning = true;
            this.panStartX = cx;
            this.panStartY = cy;
            this.panStartCamX = this.camPanX;
            this.panStartCamY = this.camPanY;
            this._oc().style.cursor = 'move';
            return;
        }

        if (e.button === 2) {
            e.preventDefault();
            this.rightButtonDown = true;
            this.rightClickMoved = false;
            this.rightStartClientX = e.clientX;
            this.rightStartClientY = e.clientY;
            this.pendingRightPan = {
                canvasX: cx,
                canvasY: cy,
                clientX: e.clientX,
                clientY: e.clientY,
                camPanX: this.camPanX,
                camPanY: this.camPanY,
            };
            return;
        }

        if (e.button !== 0) return;

        // Chain mode: arrowhead / Start-handle drags only; LED hit-test and
        // group-drag are suppressed (issue #24 §1.7). Everything else pans.
        if (this.editorMode === 'chain') {
            const conn = this._hitChainArrowhead(cx, cy);
            if (conn) {
                this.connectorDrag = { upIdx: conn.up ?? 0, x: cx, y: cy, targetIdx: null };
                this._oc().style.cursor = 'grabbing';
                this.setNeedsRender();
                return;
            }
            const startIdx = this._hitStartHandle(cx, cy, -1);
            if (startIdx !== null) {
                this.startHandleDrag = { stripIdx: startIdx, x: cx, y: cy, targetIdx: null };
                this._oc().style.cursor = 'grabbing';
                this.setNeedsRender();
                return;
            }
            // Fall through to pan
            if (this.selectedIdx >= 0) { this.selectedIdx = -1; this.setNeedsGeometryUpdate(); }
            this.selection.clear();
            this.isPanning = true;
            this.panStartX = cx;
            this.panStartY = cy;
            this.panStartCamX = this.camPanX;
            this.panStartCamY = this.camPanY;
            this._oc().style.cursor = 'move';
            return;
        }

        // Shift/Ctrl/Meta on an LED ↦ multi-selection modifier (handled in
        // the LED-hit branch below). Skip the insert/append paths when the
        // cursor is over a LED so multi-select stays usable.
        const hitLedForModCheck = (e.shiftKey || e.ctrlKey || e.metaKey)
            ? this.hitTestLED(cx, cy)
            : -1;

        // Shift+Left-click on empty area: insert a new point between two existing points
        if (this.pointEditStripIdx !== null && e.shiftKey && this.screenmap_pts.length >= 2 && hitLedForModCheck < 0) {
            const edge = this.findNearestEdge(cx, cy);
            if (edge && edge.distSq <= STRIP_STROKE_HIT_PX * STRIP_STROKE_HIT_PX) {
                const { idx, t }: { idx: number; t: number } = edge;
                const si: [number, number] = this.nn(this.screenmap_pts[idx]);
                const si1: [number, number] = this.nn(this.screenmap_pts[idx + 1]);
                const ri: [number, number] = this.nn(this.rawPts[idx]);
                const ri1: [number, number] = this.nn(this.rawPts[idx + 1]);
                const newScreenmapPt: [number, number] = [
                    si[0] + t * (si1[0] - si[0]),
                    si[1] + t * (si1[1] - si[1]),
                ];
                const newRawPt: [number, number] = [
                    ri[0] + t * (ri1[0] - ri[0]),
                    ri[1] + t * (ri1[1] - ri[1]),
                ];
                this.insertPointAt(idx + 1, newScreenmapPt, newRawPt);
                return;
            }
        }

        // Ctrl+Left-mousedown on empty area: ambiguous — could be a click
        // ("append point") or a drag ("marquee select"). Stash the intent and
        // resolve in mousemove / mouseup once we know whether the user moved.
        if (this.pointEditStripIdx !== null && (e.ctrlKey || e.metaKey) && this.screenmap_pts.length > 0 && hitLedForModCheck < 0) {
            this._pendingMarquee = {
                cx, cy,
                mode: e.shiftKey ? 'add' : 'replace',
                appendOnClick: true,
            };
            this._oc().style.cursor = 'crosshair';
            return;
        }

        // The visible rotation handle wins when its 44px hit target overlaps
        // the auto-positioned ruler above the same group's OBB.
        const stripRotateHit = this.hitTestStripRotateHandle(cx, cy);

        // Priority 0: Ruler handle / body
        const rulerHit = stripRotateHit ? null : this.hitTestRuler(cx, cy);
        if (rulerHit) {
            const ruler = this.rulers[rulerHit.idx];
            if (ruler) {
                this.rulerDrag = rulerHit;
                this.rulerDragStart = {
                    cx, cy,
                    ax: ruler.ax, ay: ruler.ay,
                    bx: ruler.bx, by: ruler.by,
                };
                this._oc().style.cursor = rulerHit.kind === 'body' ? 'move' : 'grab';
                return;
            }
        }

        // Priority 0.5: Per-strip rotation handle (only when a strip is
        // selected). Checked before the global gizmo so a strip near the
        // top of the screenmap's bbox still gets its own handle hit.
        if (stripRotateHit) {
            const idx = this.selection.getStripIdx();
            if (idx !== null && this.stripInfo && idx < this.stripInfo.strips.length) {
                const stripIdxs = [...this.selection.getSelectedStripIdxs()];
                const pointIdxs = flatPointIndicesForStrips(this.stripInfo.strips, stripIdxs);
                if (pointIdxs.length === 0) return;
                this.stripRotateActive = true;
                this.stripRotateIdx = idx;
                this.stripRotateIdxs = stripIdxs;
                this.stripRotatePointIdxs = pointIdxs;
                this.stripRotateStartScreenmap = [];
                this.stripRotateStartRaw = [];
                for (const k of pointIdxs) {
                    const sm = this.nn(this.screenmap_pts[k]);
                    const rw = this.nn(this.rawPts[k]);
                    this.stripRotateStartScreenmap.push([sm[0], sm[1]]);
                    this.stripRotateStartRaw.push([rw[0], rw[1]]);
                }
                const obb = this._selectedStripObbCanvas();
                const handle = this._stripRotateHandlePos();
                if (!obb || !handle) return;
                this.stripRotateObbSnapshot = { ...obb };
                const [centerX, centerY] = this.canvasToScreenmapCoords(obb.cx, obb.cy);
                const [rawX, rawY] = this.screenmapToRawCoords(centerX, centerY);
                this.stripRotateCenterSm = { x: centerX, y: centerY };
                this.stripRotateCenterRaw = { x: rawX, y: rawY };
                this.stripRotateStartAngle = Math.atan2(cy - obb.cy, cx - obb.cx);
                this.stripRotateLastDeg = 0;
                if (!e.shiftKey && safeStorage.get('shapeeditor.freeRotateHintSeen') !== '1') {
                    safeStorage.set('shapeeditor.freeRotateHintSeen', '1');
                    void this._toast({ icon: 'info', title: 'Hold Shift + Click to free rotate', timer: 4000 });
                }
                this._oc().style.cursor = 'grabbing';
                return;
            }
        }

        // Shift + left drag on any group is an explicit free-translation
        // gesture. Let that direct-manipulation target win if the coarse strip
        // target overlaps one of the screenmap-wide gizmo handles after fitting.
        // The selected group's own rotation handle was already checked above.
        const shiftTranslateHit = e.shiftKey
            && this.editorMode === 'select'
            && this.pointEditStripIdx === null
            ? this._resolveCoarseStripHit(cx, cy)
            : null;
        const shiftTranslatesGroup = shiftTranslateHit !== null;

        // Priority 1: Gizmo handle (corner/edge/rotation)
        const gizmoHit = shiftTranslatesGroup ? null : this.hitTestGizmo(cx, cy);
        if (gizmoHit && gizmoHit !== 'translate') {
            this.gizmoActive = gizmoHit;
            const handles = this.computeGizmoHandles(this.ptsBBox);
            this.gizmoDragStart = {
                canvasX: cx, canvasY: cy,
                scale: parseFloat(this.dom_txt_scale.value) || 1,
                scaleX: parseFloat(this.dom_txt_scale_x.value) || 1,
                scaleY: parseFloat(this.dom_txt_scale_y.value) || 1,
                rotate: parseInt(this.dom_txt_rotate.value) || 0,
                translateX: parseInt(this.dom_txt_translate_x.value) || 0,
                translateY: parseInt(this.dom_txt_translate_y.value) || 0,
                bboxCenter: handles?.center ?? { x: 0, y: 0 },
            };
            this._oc().style.cursor = gizmoHit === 'rotate' ? 'grabbing' : this.getCursorForGizmo(gizmoHit);
            return;
        }

        // Select mode owns coarse group gestures. Point editing and touch keep
        // their established direct-manipulation paths isolated below.
        if (this.editorMode === 'select' && this.pointEditStripIdx === null) {
            const hit = shiftTranslateHit ?? this._resolveCoarseStripHit(cx, cy);
            if (this.touchMode === 'single') {
                if (hit) {
                    this.groupGestureSelectionSnapshot = new Set(this.selection.getSelectedStripIdxs());
                    this.selectedIdx = -1;
                    this.highlightedEdgeIdx = hit.edgeIdx;
                    if (this.selection.isStripSelected(hit.stripIdx)) {
                        this.pendingGroupGesture = {
                            kind: 'translate', stripIdx: hit.stripIdx, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                            marqueeMode: 'replace', toggleOnClick: false, freeTranslate: false,
                        };
                    } else {
                        this.selection.selectOnlyStrip(hit.stripIdx);
                        this.pendingGroupGesture = {
                            kind: 'select-only', stripIdx: hit.stripIdx, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                            marqueeMode: 'replace', toggleOnClick: false, freeTranslate: false,
                        };
                    }
                    this.setNeedsGeometryUpdate();
                    this._oc().style.cursor = 'grab';
                    return;
                }
            } else {
                const selected = hit ? this.selection.isStripSelected(hit.stripIdx) : false;
                const mode = (e.ctrlKey || e.metaKey) ? 'toggle' : (e.shiftKey ? 'add' : 'replace');
                const base = new Set(this.selection.getSelectedStripIdxs());

                // Preserve direct manipulation of an empty-area background
                // image handle; group targets above still win overlaps.
                if (!hit && this.bgImageMesh) {
                    const bgHit = this.hitTestBgGizmo(cx, cy);
                    if (bgHit) {
                        this.startBgGizmoDrag(bgHit, cx, cy);
                        this._oc().style.cursor = bgHit === 'translate' ? 'move' : this.getCursorForGizmo(bgHit);
                        return;
                    }
                }

                this.groupGestureSelectionSnapshot = base;

                if (e.ctrlKey || e.metaKey) {
                    this.pendingGroupGesture = {
                        kind: 'marquee', stripIdx: hit?.stripIdx ?? -1, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                        marqueeMode: 'toggle', toggleOnClick: Boolean(hit), freeTranslate: false,
                    };
                    this.groupMarqueeBaseSelection = base;
                    this._oc().style.cursor = 'crosshair';
                    return;
                }

                if (hit) {
                    this.selectedIdx = -1;
                    this.highlightedEdgeIdx = hit.edgeIdx;
                    if (e.shiftKey) {
                        if (!selected) this.selection.addStrip(hit.stripIdx);
                        this.pendingGroupGesture = {
                            kind: 'translate', stripIdx: hit.stripIdx, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                            marqueeMode: mode, toggleOnClick: selected, freeTranslate: true,
                        };
                    } else {
                        if (!selected) this.selection.selectOnlyStrip(hit.stripIdx);
                        this.pendingGroupGesture = {
                            kind: 'translate', stripIdx: hit.stripIdx, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                            marqueeMode: 'replace', toggleOnClick: false, freeTranslate: false,
                        };
                    }
                    this.setNeedsGeometryUpdate();
                    this._oc().style.cursor = 'grab';
                    return;
                }

                this.pendingGroupGesture = {
                    kind: 'marquee', stripIdx: -1, cx, cy, clientX: e.clientX, clientY: e.clientY, button: 0,
                    marqueeMode: mode, toggleOnClick: false, freeTranslate: false,
                };
                this.groupMarqueeBaseSelection = base;
                if (mode === 'replace') this.selection.clear();
                this._oc().style.cursor = 'crosshair';
                this.setNeedsGeometryUpdate();
                return;
            }
        }

        // Priority 2: LED point hit test
        const hitCandidates = this.hitTestLEDCandidates(cx, cy);
        const hitStrips = new Set(hitCandidates.map((candidate) => candidate.stripIdx));
        const selectedStrip = this.selection.getStripIdx();
        if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey
            && hitStrips.size > 1 && (selectedStrip === null || !hitStrips.has(selectedStrip))) {
            const resolvedStrip = hitCandidates[hitCandidates.length - 1]?.stripIdx;
            if (resolvedStrip !== undefined) {
                this.selectedIdx = -1;
                this.selection.selectStrip(resolvedStrip);
                this.setNeedsGeometryUpdate();
                void this._toastInfo(`Selected "${this.stripStore.getStrips()[resolvedStrip]?.name ?? ''}" — click again to select its LED`);
                return;
            }
        }
        const idx = this.hitTestLED(cx, cy);
        if (idx >= 0) {
            // Multi-selection modifiers: ctrl/meta toggles, shift adds.
            // Both consume the click — no drag is started so the user can
            // adjust the selection before initiating a group move.
            if (e.ctrlKey || e.metaKey) {
                if (this.multiSelectedIdxs.has(idx)) this.multiSelectedIdxs.delete(idx);
                else this.multiSelectedIdxs.add(idx);
                this.setNeedsGeometryUpdate();
                return;
            }
            if (e.shiftKey) {
                this.multiSelectedIdxs.add(idx);
                this.setNeedsGeometryUpdate();
                return;
            }
            // Plain click on an already multi-selected LED: start a group drag.
            if (this.multiSelectedIdxs.has(idx)) {
                this._startMultiDrag(cx, cy);
                return;
            }
            // Plain click on a non-selected LED: clear any prior multi-selection
            // before falling through to the strip / single-LED drag path.
            if (this.multiSelectedIdxs.size > 0) {
                this.multiSelectedIdxs.clear();
                this.setNeedsGeometryUpdate();
            }

            this.highlightedEdgeIdx = -1;
            const hitStripIdx = this.stripStore.findStripForIndex(idx);
            const inPointEdit = this.pointEditStripIdx !== null && this.pointEditStripIdx === hitStripIdx;

            if (inPointEdit) {
                this.selectedIdx = idx;
                this.syncPointSelection(idx);
                this.setNeedsGeometryUpdate(); // color update for selection
                this.dragStartCanvasX = cx;
                this.dragStartCanvasY = cy;
                this.dragStartScreenmapPt = [...this.nn(this.screenmap_pts[idx])] as [number, number];
                this.dragStartRawPt = [...this.nn(this.rawPts[idx])] as [number, number];
                this.isDragging = true;
                this._oc().style.cursor = 'grabbing';
            } else {
                this.selectedIdx = -1;
                this.selection.selectStrip(hitStripIdx);
                this.setNeedsGeometryUpdate();
                this._startStripDrag(hitStripIdx, cx, cy);
            }
            return;
        }

        // Priority 3: visible strip stroke. The line is part of the strip's
        // direct-manipulation target, ahead of broad background affordances.
        if (this.screenmap_pts.length >= 2) {
            const edge = this.findNearestEdge(cx, cy);
            if (edge && edge.distSq <= STRIP_STROKE_HIT_PX * STRIP_STROKE_HIT_PX) {
                this.highlightedEdgeIdx = edge.idx;
                this.selectedIdx = -1;
                this.selection.selectStrip(edge.stripIdx);
                this.setNeedsRender();
                this._startStripDrag(edge.stripIdx, cx, cy);
                return;
            }
        }
        if (this.highlightedEdgeIdx >= 0) { this.highlightedEdgeIdx = -1; this.setNeedsRender(); }

        // Priority 4: Background image gizmo (mouse is outside screenmap bbox)
        if (this.bgImageMesh) {
            const bgHit = this.hitTestBgGizmo(cx, cy);
            if (bgHit && bgHit !== 'translate') {
                this.startBgGizmoDrag(bgHit, cx, cy);
                this._oc().style.cursor = bgHit === 'rotate' ? 'grabbing' : this.getCursorForGizmo(bgHit);
                return;
            }
            if (bgHit === 'translate') {
                this.startBgGizmoDrag('translate', cx, cy);
                this._oc().style.cursor = 'move';
                return;
            }
        }

        // Priority 5: Pan camera (outside bbox)
        if (this.selectedIdx >= 0) { this.selectedIdx = -1; this.setNeedsGeometryUpdate(); }
        if (this.pointEditStripIdx !== null) { this.pointEditStripIdx = null; this._updateHintStrip(); }
        this.selection.clear();
        this.isPanning = true;
        this.panStartX = cx;
        this.panStartY = cy;
        this.panStartCamX = this.camPanX;
        this.panStartCamY = this.camPanY;
        this._oc().style.cursor = 'move';
    },
    onMouseMove(this: ShapeEditor, e: MouseEvent){

        if (this.placingState) {
            const [cx, cy] = this.getCanvasCoords(e);
            this._updateGhostFromCanvas(cx, cy);
            this._oc().style.cursor = 'crosshair';
            return;
        }
        if (this.pasteState) {
            const [cx, cy] = this.getCanvasCoords(e);
            this._updatePasteGhostFromCanvas(cx, cy);
            this._oc().style.cursor = 'crosshair';
            return;
        }
        if (this.screenmap_pts.length === 0 && !this.bgImageMesh) return;
        const [cx, cy] = this.getCanvasCoords(e);

        // Track shift key for rotation snapping
        this.shiftHeld = e.shiftKey;

        // Right drag always pans the camera. A stationary right click stays
        // eligible for its target-specific context menu until it crosses the
        // shared CSS-pixel threshold.
        if (this.rightButtonDown) {
            const dx = e.clientX - this.rightStartClientX;
            const dy = e.clientY - this.rightStartClientY;
            const crossedDragThreshold = dx * dx + dy * dy > 9;
            if (crossedDragThreshold) this.rightClickMoved = true;
            if (this.pendingRightPan) {
                if (!crossedDragThreshold) return;
                const pending = this.pendingRightPan;
                this.pendingRightPan = null;
                this.isPanning = true;
                this.panStartX = pending.canvasX;
                this.panStartY = pending.canvasY;
                this.panStartCamX = pending.camPanX;
                this.panStartCamY = pending.camPanY;
                this._oc().style.cursor = 'grabbing';
            } else if (!this.isPanning) return;
        }

        // Chain-mode connector drag (arrowhead → new downstream target)
        if (this.connectorDrag) {
            this.connectorDrag.x = cx;
            this.connectorDrag.y = cy;
            const target = this._hitStartHandle(cx, cy, this.connectorDrag.upIdx);
            if (target !== this.connectorDrag.targetIdx) {
                this.connectorDrag.targetIdx = target;
                if (target !== null) {
                    this._previewConnectorTarget(this.connectorDrag.upIdx, target);
                } else {
                    this.renderStripsPanel();
                }
            }
            this.setNeedsRender();
            return;
        }

        // Chain-mode Start-handle drag (strip Start → upstream End target)
        if (this.startHandleDrag) {
            this.startHandleDrag.x = cx;
            this.startHandleDrag.y = cy;
            const target = this._hitEndHandle(cx, cy, this.startHandleDrag.stripIdx);
            if (target !== this.startHandleDrag.targetIdx) {
                this.startHandleDrag.targetIdx = target;
                if (target !== null) {
                    this._previewConnectorTarget(target, this.startHandleDrag.stripIdx);
                } else {
                    this.renderStripsPanel();
                }
            }
            this.setNeedsRender();
            return;
        }

        // Ruler drag in progress
        if (this.rulerDrag && this.rulerDragStart) {
            const ds = this.rulerDragStart;
            const wdx = (cx - ds.cx) / this.camZoom;
            const wdy = (cy - ds.cy) / this.camZoom;
            const ruler = this.rulers[this.rulerDrag.idx];
            if (ruler) {
                if (this.rulerDrag.kind === 'a') {
                    ruler.ax = ds.ax + wdx;
                    ruler.ay = ds.ay + wdy;
                } else if (this.rulerDrag.kind === 'b') {
                    ruler.bx = ds.bx + wdx;
                    ruler.by = ds.by + wdy;
                } else {
                    // body — move both handles
                    ruler.ax = ds.ax + wdx;
                    ruler.ay = ds.ay + wdy;
                    ruler.bx = ds.bx + wdx;
                    ruler.by = ds.by + wdy;
                }
            }
            this.setNeedsRender();
            return;
        }

        // Per-strip rotation drag in progress
        if (this.stripRotateActive && this.stripRotateIdx >= 0 && this.stripInfo
            && this.stripRotateStartScreenmap && this.stripRotateStartRaw
            && this.stripRotateCenterSm && this.stripRotateCenterRaw) {
            const snapshot = this.stripRotateObbSnapshot;
            if (!snapshot) return;
            const curAngle = Math.atan2(cy - snapshot.cy, cx - snapshot.cx);
            let deltaDeg = (curAngle - this.stripRotateStartAngle) * 180 / Math.PI;
            // Pointer rotation uses integer-degree steps; Shift enables free-form rotation.
            // (rotation always uses INTEGER degree steps so the resulting
            // points are deterministic and undo-friendly).
            if (!e.shiftKey) deltaDeg = Math.round(deltaDeg);
            const deltaRad = deltaDeg * Math.PI / 180;
            const csm = this.stripRotateCenterSm;
            const crw = this.stripRotateCenterRaw;
            const rotatedSm = rotatePointsAround(this.stripRotateStartScreenmap, csm.x, csm.y, deltaRad);
            const rotatedRw = rotatePointsAround(this.stripRotateStartRaw, crw.x, crw.y, deltaRad);
            for (let k = 0; k < this.stripRotatePointIdxs.length; k++) {
                const base = this.stripRotatePointIdxs[k] ?? -1;
                if (base < 0) continue;
                this.screenmap_pts[base] = rotatedSm[k] ?? [0, 0] as [number, number];
                this.rawPts[base] = rotatedRw[k] ?? [0, 0] as [number, number];
            }
            this.stripRotateLastDeg = deltaDeg;
            this.setNeedsGeometryUpdate();
            return;
        }

        // Gizmo drag in progress
        if (this.gizmoActive) {
            this.handleGizmoDrag(cx, cy);
            return;
        }

        // Background image gizmo drag in progress
        if (this.bgGizmoActive) {
            this.handleBgGizmoDrag(cx, cy);
            return;
        }

        // Resolve click-vs-drag only after the shared three-CSS-pixel threshold.
        if (this.pendingGroupGesture) {
            const pending = this.pendingGroupGesture;
            const dx = e.clientX - pending.clientX;
            const dy = e.clientY - pending.clientY;
            if (dx * dx + dy * dy > 9) {
                if (pending.kind === 'translate' && pending.stripIdx >= 0) {
                    this.pendingGroupGesture = null;
                    this.stripDragFreeTranslate = pending.freeTranslate;
                    this._startStripDrag(pending.stripIdx, pending.cx, pending.cy);
                } else if (pending.kind === 'marquee') {
                    this.pendingGroupGesture = null;
                    this.groupMarqueeActive = true;
                    this.groupMarqueeMode = pending.marqueeMode;
                    this.marqueeStartCx = pending.cx;
                    this.marqueeStartCy = pending.cy;
                    this.marqueeCurCx = cx;
                    this.marqueeCurCy = cy;
                    this._updateGroupMarqueeSelection();
                    this.setNeedsGeometryUpdate();
                    return;
                } else return; // Selection-only remains inert for this pointer.
            } else return;
        }

        if (this.groupMarqueeActive) {
            this.marqueeCurCx = cx;
            this.marqueeCurCy = cy;
            this._updateGroupMarqueeSelection();
            this.setNeedsGeometryUpdate();
            return;
        }

        // Left-click drag on empty space: pan
        if (this.isPanning) {
            const dx = cx - this.panStartX;
            const dy = cy - this.panStartY;
            this.camPanX = this.panStartCamX + dx / this.camZoom;
            this.camPanY = this.panStartCamY + dy / this.camZoom;
            this.setNeedsRender();
            return;
        }

        // Pending Ctrl+mousedown promotes to a marquee on the first move
        // past a small threshold. Below the threshold, the click stays a
        // click and onMouseUp will run the append-point action.
        if (this._pendingMarquee) {
            const pm = this._pendingMarquee;
            const ddx = cx - pm.cx;
            const ddy = cy - pm.cy;
            if (ddx * ddx + ddy * ddy > 9) { // ~3px threshold
                this.marqueeActive = true;
                this.marqueeStartCx = pm.cx;
                this.marqueeStartCy = pm.cy;
                this.marqueeCurCx = cx;
                this.marqueeCurCy = cy;
                this.marqueeMode = pm.mode;
                this._marqueeBaseSelection = new Set(this.multiSelectedIdxs);
                if (pm.mode === 'replace') this.multiSelectedIdxs.clear();
                this._pendingMarquee = null;
                this._updateMarqueeSelection();
                this.setNeedsGeometryUpdate();
                return;
            }
        }

        // Marquee drag: live LED hit-test against the rectangle, eagerly
        // updating the multi-selection so the user sees what they'll get.
        if (this.marqueeActive) {
            this.marqueeCurCx = cx;
            this.marqueeCurCy = cy;
            this._updateMarqueeSelection();
            this.setNeedsGeometryUpdate();
            return;
        }

        // Multi-LED group drag: same canvas→screenmap delta math as
        // single-LED / strip drag, applied to every multi-selected index.
        if (this.multiDragActive) {
            const dx = cx - this.multiDragStartCanvasX;
            const dy = cy - this.multiDragStartCanvasY;
            const [sdx, sdy] = this.canvasDeltaToScreenmapDelta(dx, dy);
            for (const i of this.multiSelectedIdxs) {
                const startSm = this.multiDragStartScreenmap.get(i);
                const startRw = this.multiDragStartRaw.get(i);
                if (!startSm || !startRw) continue;
                this.screenmap_pts[i] = [startSm[0] + sdx, startSm[1] + sdy];
                this.rawPts[i] = [startRw[0] + sdx / this.fitScale, startRw[1] + sdy / this.fitScale];
            }
            this.multiDragLastSdx = sdx;
            this.multiDragLastSdy = sdy;
            this.setNeedsGeometryUpdate();
            return;
        }

        if (this.isDragging && this.selectedIdx >= 0) {
            // Move the point
            const dx = cx - this.dragStartCanvasX;
            const dy = cy - this.dragStartCanvasY;
            const [sdx, sdy] = this.canvasDeltaToScreenmapDelta(dx, dy);
            this.screenmap_pts[this.selectedIdx] = [
                (this.dragStartScreenmapPt?.[0] ?? 0) + sdx,
                (this.dragStartScreenmapPt?.[1] ?? 0) + sdy,
            ];
            this.rawPts[this.selectedIdx] = [
                (this.dragStartRawPt?.[0] ?? 0) + sdx / this.fitScale,
                (this.dragStartRawPt?.[1] ?? 0) + sdy / this.fitScale,
            ];
            this.setNeedsGeometryUpdate();
            return;
        }

        if (this.stripDragActive && this.stripDragIdx >= 0 && this.stripInfo) {
            const dx = cx - this.dragStartCanvasX;
            const dy = cy - this.dragStartCanvasY;
            const camZoom = this.camZoom > 0 ? this.camZoom : 1;
            const rawDx = dx / camZoom;
            const rawDy = dy / camZoom;
            const snapResult = resolveStripDragSnap({
                cursorDxPx: dx,
                cursorDyPx: dy,
                rawDx,
                rawDy,
                startGeometry: this.stripSnapStartGeometry,
                targets: this.stripSnapTargets,
                camZoom,
                tolerancePx: this.snapBackPx,
                snapEnabled: this.snapBackEnabled,
                shiftBypass: this.stripDragFreeTranslate,
            });
            const previousEngagement = JSON.stringify(this.stripSnapEngagement);
            this.stripSnapEngagement = snapResult.engagement;
            if (previousEngagement !== JSON.stringify(snapResult.engagement)) this.setNeedsRender();
            const localDelta = inverseTransformSnapDelta(
                { x: snapResult.dx, y: snapResult.dy },
                this.stripSnapTransform ?? {
                    scaleX: 1, scaleY: 1, cos: 1, sin: 0,
                },
            );
            const sdx = localDelta.x;
            const sdy = localDelta.y;
            for (const base of this.stripDragPointIdxs) {
                const startSm = this.stripDragStartScreenmapByIdx.get(base) ?? [0, 0] as [number, number];
                const startRw = this.stripDragStartRawByIdx.get(base) ?? [0, 0] as [number, number];
                this.screenmap_pts[base] = [
                    startSm[0] + sdx,
                    startSm[1] + sdy,
                ];
                this.rawPts[base] = [
                    startRw[0] + sdx / this.fitScale,
                    startRw[1] + sdy / this.fitScale,
                ];
            }
            this.stripDragLastSdx = sdx;
            this.stripDragLastSdy = sdy;
            this.setNeedsGeometryUpdate();
            return;
        }

        // Update the map-level hover before any specialized handle returns.
        // Direction arrows should reveal anywhere inside the screenmap OBB,
        // including over ruler/rotate/scale affordances.
        const wasHovering = this.isHovering;
        let pointerInScreenmapObb = false;
        if (this.ptsBBox) {
            const [lx, ly] = this.canvasToObbLocal(this.ptsBBox, cx, cy);
            pointerInScreenmapObb = Math.abs(lx) <= this.ptsBBox.hw && Math.abs(ly) <= this.ptsBBox.hh;
        }
        this.isHovering = pointerInScreenmapObb;
        if (this.isHovering !== wasHovering) this.setNeedsRender();

        // Ruler hover cursor
        const rulerHoverHit = this.hitTestRuler(cx, cy);
        if (rulerHoverHit) {
            this._oc().style.cursor = rulerHoverHit.kind === 'body' ? 'move' : 'grab';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
            // still update gizmo/bbox hover state below so rendering stays correct
        }

        // Per-strip rotate handle hover detection (takes priority over
        // the global gizmo so the handle glows when the user is over it).
        const prevStripRotHover = this.stripRotateHover;
        this.stripRotateHover = this.hitTestStripRotateHandle(cx, cy);
        if (this.stripRotateHover !== prevStripRotHover) this.setNeedsRender();
        if (this.stripRotateHover) {
            this._oc().style.cursor = 'grab';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
            return;
        }

        const shiftTranslateHover = e.shiftKey
            && this.editorMode === 'select'
            && this.pointEditStripIdx === null
            ? this._resolveCoarseStripHit(cx, cy)
            : null;
        const shiftHoversGroup = shiftTranslateHover !== null;

        // Gizmo hover detection
        const prevGizmoHover = this.gizmoHover;
        this.gizmoHover = shiftHoversGroup ? null : this.hitTestGizmo(cx, cy);
        if (this.gizmoHover !== prevGizmoHover) this.setNeedsRender();
        const hoveringMapOrGizmo = pointerInScreenmapObb || !!this.gizmoHover;
        if (this.isHovering !== hoveringMapOrGizmo) {
            this.isHovering = hoveringMapOrGizmo;
            this.setNeedsRender();
        }

        // Background image gizmo hover (only when not hovering screenmap gizmo)
        const prevBgGizmoHover = this.bgGizmoHover;
        if (!this.gizmoHover && this.bgImageMesh) {
            this.bgGizmoHover = this.hitTestBgGizmo(cx, cy);
        } else {
            this.bgGizmoHover = null;
        }
        if (this.bgGizmoHover !== prevBgGizmoHover) this.setNeedsRender();

        // Ruler hover takes top cursor priority
        if (rulerHoverHit) return;

        if (shiftHoversGroup) {
            this._oc().style.cursor = 'grab';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
            return;
        }

        // Gizmo handle hover takes cursor priority
        if (this.gizmoHover && this.gizmoHover !== 'translate') {
            this._oc().style.cursor = this.getCursorForGizmo(this.gizmoHover);
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
            return;
        }

        // Shift held: crosshair (insert between)
        // Ctrl held: copy cursor (extend/append)
        if (this.screenmap_pts.length > 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) {
            this._oc().style.cursor = e.shiftKey ? 'crosshair' : 'copy';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
            return;
        }

        const idx = this.hitTestLED(cx, cy);
        if (idx >= 0) {
            this._oc().style.cursor = 'grab';
            if (idx !== this.tooltipLedIdx) {
                this.tooltipLedIdx = idx;
                const [ox, oy] = this.nn(this.rawPts[idx]);
                this._tooltip().textContent = `LED #${String(idx)}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const tx = Math.min(cx + 14, this.canvasW - this._tooltip().offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            this._tooltip().style.left = `${String(tx)}px`;
            this._tooltip().style.top = `${String(ty)}px`;
            this._tooltip().style.opacity = '1';
        } else if ((this.findNearestEdge(cx, cy)?.distSq ?? Infinity) <= STRIP_STROKE_HIT_PX * STRIP_STROKE_HIT_PX) {
            this._oc().style.cursor = 'grab';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
        } else if (this.bgGizmoHover && this.bgGizmoHover !== 'translate') {
            this._oc().style.cursor = this.getCursorForGizmo(this.bgGizmoHover);
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
        } else if (this.bgGizmoHover === 'translate') {
            this._oc().style.cursor = 'move';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
        } else {
            this._oc().style.cursor = 'default';
            this.tooltipLedIdx = -1;
            this._tooltip().style.opacity = '0';
        }
    },
    onMouseUp(this: ShapeEditor, e: MouseEvent){

        if (e.button === 2) {
            this.rightButtonDown = false;
            this.pendingRightPan = null;
            // rightClickMoved is consumed by onContextMenu
        }

        // Chain-mode drags: commit on a valid drop target, else cancel.
        if (this.connectorDrag) {
            const { upIdx, targetIdx } = this.connectorDrag;
            this.connectorDrag = null;
            this._oc().style.cursor = 'default';
            if (targetIdx !== null) {
                this.doConnectorRetarget(upIdx, targetIdx);
            } else {
                this.renderStripsPanel();
            }
            this.setNeedsRender();
            return;
        }
        if (this.startHandleDrag) {
            const { stripIdx, targetIdx } = this.startHandleDrag;
            this.startHandleDrag = null;
            this._oc().style.cursor = 'default';
            if (targetIdx !== null) {
                // Dropping a strip's Start on another strip's End wires that
                // strip downstream of the target: target ──▶ stripIdx.
                this.doConnectorRetarget(targetIdx, stripIdx);
            } else {
                this.renderStripsPanel();
            }
            this.setNeedsRender();
            return;
        }

        if (this.rulerDrag) {
            this.rulerDrag = null;
            this.rulerDragStart = null;
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.stripRotateActive) {
            this._finalizeStripRotate();
            this._oc().style.cursor = 'grab';
            return;
        }

        if (this.gizmoActive) {
            this.commitGizmoDrag();
            this.gizmoActive = null;
            this.gizmoDragStart = null;
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.bgGizmoActive) {
            this.bgGizmoActive = null;
            this.bgGizmoDragStart = null;
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.isPanning) {
            this.isPanning = false;
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.pendingGroupGesture) {
            const pending = this.pendingGroupGesture;
            this.pendingGroupGesture = null;
            if (pending.toggleOnClick && pending.stripIdx >= 0) {
                this.selection.toggleStrip(pending.stripIdx);
                this.setNeedsGeometryUpdate();
            }
            this.groupGestureSelectionSnapshot = null;
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.groupMarqueeActive) {
            this.groupMarqueeActive = false;
            this.groupMarqueeBaseSelection = new Set();
            this.groupGestureSelectionSnapshot = null;
            this._oc().style.cursor = 'default';
            this.setNeedsGeometryUpdate();
            return;
        }

        // Ctrl+mousedown that never crossed the marquee threshold reverts to
        // the original ctrl+click "append point at click location" behavior.
        if (this._pendingMarquee) {
            const pm = this._pendingMarquee;
            this._pendingMarquee = null;
            if (pm.appendOnClick && this.screenmap_pts.length > 0) {
                const newScreenmapPt = this.canvasToScreenmapCoords(pm.cx, pm.cy);
                const newRawPt = this.screenmapToRawCoords(newScreenmapPt[0], newScreenmapPt[1]);
                this.insertPointAt(this.screenmap_pts.length, newScreenmapPt, newRawPt);
            }
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.marqueeActive) {
            this._commitMarquee();
            this._oc().style.cursor = 'default';
            return;
        }

        if (this.multiDragActive) {
            this._finalizeMultiDrag();
            this._oc().style.cursor = 'grab';
            return;
        }

        if (this.isDragging && this.selectedIdx >= 0) {
            const newScreenmapPt = [...this.nn(this.screenmap_pts[this.selectedIdx])];
            const newRawPt = [...this.nn(this.rawPts[this.selectedIdx])];
            // Only record undo if the point actually moved
            if (newScreenmapPt[0] !== (this.dragStartScreenmapPt?.[0] ?? 0) ||
                newScreenmapPt[1] !== (this.dragStartScreenmapPt?.[1] ?? 0)) {
                this.pushUndo({
                    type: 'move',
                    idx: this.selectedIdx,
                    oldScreenmapPt: this.dragStartScreenmapPt,
                    newScreenmapPt,
                    oldRawPt: this.dragStartRawPt,
                    newRawPt,
                });
            }
            this.isDragging = false;
            this.altQuasimode = false;
            this._oc().style.cursor = 'grab';
            return;
        }

        if (this.stripDragActive) {
            this._finalizeStripDrag();
            this._oc().style.cursor = 'grab';
            return;
        }
    },
    onDoubleClick(this: ShapeEditor, e: MouseEvent){

        if (this.placingState) return;
        if (e.button !== 0) return;
        if (this.screenmap_pts.length === 0) return;
        const [cx, cy] = this.getCanvasCoords(e);
        const idx = this.hitTestLED(cx, cy);
        if (idx < 0) return;
        const sIdx = this.stripStore.findStripForIndex(idx);
        if (sIdx < 0) return;
        if (this.pointEditStripIdx === sIdx) {
            // Double-click again exits point-edit
            this.pointEditStripIdx = null;
        } else {
            this.pointEditStripIdx = sIdx;
            this.selection.selectStrip(sIdx);
        }
        this._updateHintStrip();
        this.setNeedsGeometryUpdate();
    },
    _clearLongPress(this: ShapeEditor){

        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    },
    _synth(this: ShapeEditor, type: string, clientX: number, clientY: number, opts: Record<string, unknown> = {}){

        const init = {
            clientX,
            clientY,
            button: (typeof opts.button === 'number' ? opts.button : 0),
            bubbles: true,
            altKey: Boolean(opts.altKey),
            shiftKey: Boolean(opts.shiftKey),
            ctrlKey: Boolean(opts.ctrlKey),
            metaKey: Boolean(opts.metaKey),
        };
        const evt = new MouseEvent(type, init);
        if (type === 'mousedown') this.onMouseDown(evt);
        else if (type === 'mousemove') this.onMouseMove(evt);
        else if (type === 'mouseup') this.onMouseUp(evt);
    },
    _cancelSingleTouchGesture(this: ShapeEditor){

        // Cancel any in-flight single-touch drag cleanly (no undo entry).
        const suppressPendingContextMenu = this.rightButtonDown;
        if (this.connectorDrag || this.startHandleDrag) this._cancelConnectorDrag();
        if (this.groupGestureSelectionSnapshot) {
            this.selection.selectOnlyStrip(null);
            for (const idx of this.groupGestureSelectionSnapshot) this.selection.addStrip(idx);
        }
        if (this.marqueeActive) this._cancelMarquee();
        this._pendingMarquee = null;
        this.pendingGroupGesture = null;
        this.pendingRightPan = null;
        this.groupMarqueeActive = false;
        this.groupMarqueeBaseSelection = new Set();
        this.groupGestureSelectionSnapshot = null;
        this.rightButtonDown = false;
        this.rightClickMoved = suppressPendingContextMenu;
        if (this.stripDragActive) {
            for (const idx of this.stripDragPointIdxs) {
                const sm = this.stripDragStartScreenmapByIdx.get(idx);
                const rw = this.stripDragStartRawByIdx.get(idx);
                if (sm) this.screenmap_pts[idx] = [...sm];
                if (rw) this.rawPts[idx] = [...rw];
            }
            this.stripDragActive = false;
            this.stripDragIdx = -1;
            this.stripDragIdxs = [];
            this.stripDragPointIdxs = [];
            this.stripDragStartScreenmapByIdx.clear();
            this.stripDragStartRawByIdx.clear();
            this.stripDragStartScreenmap = null;
            this.stripDragStartRaw = null;
            this._clearStripSnapState();
            this.stripDragLastSdx = 0;
            this.stripDragLastSdy = 0;
            this.stripDragFreeTranslate = false;
        }
        if (this.stripRotateActive) {
            for (let i = 0; i < this.stripRotatePointIdxs.length; i++) {
                const idx = this.stripRotatePointIdxs[i] ?? -1;
                if (idx < 0) continue;
                const sm = this.stripRotateStartScreenmap?.[i];
                const rw = this.stripRotateStartRaw?.[i];
                if (sm) this.screenmap_pts[idx] = [...sm];
                if (rw) this.rawPts[idx] = [...rw];
            }
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
            this.stripRotateObbSnapshot = null;
        }
        if (this.multiDragActive) {
            for (const [idx, point] of this.multiDragStartScreenmap) this.screenmap_pts[idx] = [...point];
            for (const [idx, point] of this.multiDragStartRaw) this.rawPts[idx] = [...point];
            this.multiDragActive = false;
            this.multiDragStartScreenmap = new Map();
            this.multiDragStartRaw = new Map();
            this.multiDragLastSdx = 0;
            this.multiDragLastSdy = 0;
        }
        if (this.isDragging) {
            if (this.selectedIdx >= 0) {
                if (this.dragStartScreenmapPt) this.screenmap_pts[this.selectedIdx] = [...this.dragStartScreenmapPt];
                if (this.dragStartRawPt) this.rawPts[this.selectedIdx] = [...this.dragStartRawPt];
            }
            this.isDragging = false;
            this.altQuasimode = false;
        }
        if (this.isPanning) {
            this.camPanX = this.panStartCamX;
            this.camPanY = this.panStartCamY;
            this.isPanning = false;
        }
        if (this.gizmoActive) {
            const ds = this.gizmoDragStart;
            if (ds) {
                this.writeScale(this.dom_txt_scale, ds.scale);
                this.writeScale(this.dom_txt_scale_x, ds.scaleX);
                this.writeScale(this.dom_txt_scale_y, ds.scaleY);
                this.dom_txt_rotate.value = String(ds.rotate);
                this.dom_txt_translate_x.value = String(ds.translateX);
                this.dom_txt_translate_y.value = String(ds.translateY);
            }
            this.gizmoActive = null;
            this.gizmoDragStart = null;
        }
        if (this.rulerDrag) {
            const ds = this.rulerDragStart;
            const ruler = ds ? this.rulers[this.rulerDrag.idx] : null;
            if (ruler && ds) {
                ruler.ax = ds.ax; ruler.ay = ds.ay;
                ruler.bx = ds.bx; ruler.by = ds.by;
            }
            this.rulerDrag = null;
            this.rulerDragStart = null;
        }
        if (this.bgGizmoActive && this.bgGizmoDragStart) {
            const ds = this.bgGizmoDragStart;
            this.dom_txt_image_scale.value = String(ds.scale);
            this.dom_txt_image_rotate.value = String(ds.rotate);
            this.dom_txt_image_tx.value = String(ds.tx);
            this.dom_txt_image_ty.value = String(ds.ty);
            this.applyBgImageTransform();
            this.bgGizmoActive = null;
            this.bgGizmoDragStart = null;
        }
        this._oc().style.cursor = 'default';
        this.setNeedsGeometryUpdate();
    },
    _doLongPress(this: ShapeEditor, canvasX: number, canvasY: number, clientX: number, clientY: number){

        // Cancel the pending single-touch synth gesture so it does not also
        // commit a drag.
        this._cancelSingleTouchGesture();
        if (this.screenmap_pts.length === 0) {
            // Empty: open context menu
            this.showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
            this.touchMode = 'longpress-fired';
            return;
        }
        const idx = this.hitTestLED(canvasX, canvasY);
        if (idx >= 0) {
            const sIdx = this.stripStore.findStripForIndex(idx);
            if (sIdx >= 0) {
                this.selection.selectStrip(sIdx);
                this.pointEditStripIdx = sIdx;
                this._updateHintStrip();
                this.setNeedsGeometryUpdate();
                void this._toastInfo(`Editing points in "${this.stripStore.getStrips()[sIdx]?.name ?? ''}"`);
            }
        } else {
            this.showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
        }
        this.touchMode = 'longpress-fired';
    },
    _ledIdxsInCanvasRect(this: ShapeEditor, c1x: number, c1y: number, c2x: number, c2y: number): Set<number>{
    const minX = Math.min(c1x, c2x);
    const maxX = Math.max(c1x, c2x);
    const minY = Math.min(c1y, c2y);
    const maxY = Math.max(c1y, c2y);
    const out = new Set<number>();
    const camPanX = this.camPanX;
    const camPanY = this.camPanY;
    const z = this.camZoom;
    const hw = this.canvasW / 2;
    const hh = this.canvasH / 2;
    const pts = this.lastTransformedPts;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p) continue;
        const cx = (p[0] + camPanX) * z + hw;
        const cy = (p[1] + camPanY) * z + hh;
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) out.add(i);
    }
    return out;
},
    _updateMarqueeSelection(this: ShapeEditor){
    const hits = this._ledIdxsInCanvasRect(this.marqueeStartCx, this.marqueeStartCy, this.marqueeCurCx, this.marqueeCurCy);
    const base = this._marqueeBaseSelection;
    let next: Set<number>;
    if (this.marqueeMode === 'replace') {
        next = hits;
    } else if (this.marqueeMode === 'add') {
        next = new Set(base);
        for (const i of hits) next.add(i);
    } else { // toggle: symmetric difference
        next = new Set(base);
        for (const i of hits) {
            if (next.has(i)) next.delete(i);
            else next.add(i);
        }
    }
    this.multiSelectedIdxs = next;
},
    _updateGroupMarqueeSelection(this: ShapeEditor){
    if (!this.stripInfo) return;
    const canvasPoints = this.lastTransformedPts.map((point) => this.toCanvasCoords(point[0], point[1]));
    const hits = stripsIntersectingCanvasRect(this.stripInfo.strips, canvasPoints, this.marqueeStartCx, this.marqueeStartCy, this.marqueeCurCx, this.marqueeCurCy);
    let next: Set<number>;
    if (this.groupMarqueeMode === 'replace') {
        next = hits;
    } else if (this.groupMarqueeMode === 'add') {
        next = new Set(this.groupMarqueeBaseSelection);
        for (const idx of hits) next.add(idx);
    } else {
        next = new Set(this.groupMarqueeBaseSelection);
        for (const idx of hits) {
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
        }
    }
    this.selection.selectOnlyStrip(null);
    for (const idx of next) this.selection.addStrip(idx);
},
    _commitMarquee(this: ShapeEditor){
    // Selection was updated eagerly during mousemove; just clear the drag state.
    this.marqueeActive = false;
    this._marqueeBaseSelection = new Set<number>();
    this.setNeedsGeometryUpdate();
},
    _cancelMarquee(this: ShapeEditor){
    if (!this.marqueeActive) return;
    // Restore the pre-drag selection.
    this.multiSelectedIdxs = new Set(this._marqueeBaseSelection);
    this.marqueeActive = false;
    this._marqueeBaseSelection = new Set<number>();
    this.setNeedsGeometryUpdate();
},
    _startMultiDrag(this: ShapeEditor, cx: number, cy: number){
    this.multiDragActive = true;
    this.multiDragStartCanvasX = cx;
    this.multiDragStartCanvasY = cy;
    this.multiDragLastSdx = 0;
    this.multiDragLastSdy = 0;
    this.multiDragStartScreenmap = new Map<number, [number, number]>();
    this.multiDragStartRaw = new Map<number, [number, number]>();
    for (const i of this.multiSelectedIdxs) {
        const sm = this.screenmap_pts[i];
        const rw = this.rawPts[i];
        if (!sm || !rw) continue;
        this.multiDragStartScreenmap.set(i, [sm[0], sm[1]]);
        this.multiDragStartRaw.set(i, [rw[0], rw[1]]);
    }
    this._oc().style.cursor = 'grabbing';
},
    _finalizeMultiDrag(this: ShapeEditor){
    if (!this.multiDragActive) return;
    const sdx = this.multiDragLastSdx;
    const sdy = this.multiDragLastSdy;
    if ((sdx !== 0 || sdy !== 0) && this.multiSelectedIdxs.size > 0) {
        this.pushUndo({
            type: 'multi-translate',
            idxs: [...this.multiSelectedIdxs],
            sdx,
            sdy,
        });
        this._persistMultiStrip();
    }
    this.multiDragActive = false;
    this.multiDragStartScreenmap = new Map<number, [number, number]>();
    this.multiDragStartRaw = new Map<number, [number, number]>();
    this.multiDragLastSdx = 0;
    this.multiDragLastSdy = 0;
},
    _applyMultiTranslate(this: ShapeEditor, idxs: number[], sdx: number, sdy: number){
    for (const i of idxs) {
        const sm = this.screenmap_pts[i];
        const rw = this.rawPts[i];
        if (!sm || !rw) continue;
        this.screenmap_pts[i] = [sm[0] + sdx, sm[1] + sdy];
        this.rawPts[i] = [rw[0] + sdx / this.fitScale, rw[1] + sdy / this.fitScale];
    }
},
    _wireTouchHandlers(this: ShapeEditor, signal: AbortSignal){

        this._oc().addEventListener('touchstart', (e: TouchEvent) => {
            // Cancel scrolling/zooming on the page during canvas touches
            e.preventDefault();
            if (e.touches.length === 1) {
                const t = this.nn(e.touches[0]);
                this.touchMode = 'single';
                this.touchStartClientX = t.clientX;
                this.touchStartClientY = t.clientY;
                const [cx, cy] = this.getCanvasCoords(t);
                this.touchStartCanvasX = cx;
                this.touchStartCanvasY = cy;
                // Start long-press timer
                this._clearLongPress();
                this.longPressTimer = setTimeout(() => {
                    this.longPressTimer = null;
                    if (this.touchMode !== 'single') return;
                    this._doLongPress(this.touchStartCanvasX, this.touchStartCanvasY, this.touchStartClientX, this.touchStartClientY);
                }, this.LONG_PRESS_MS);
                // Forward as a synthesized mousedown for the drag/select path
                this._synth('mousedown', t.clientX, t.clientY);
            } else if (e.touches.length >= 2) {
                // Cancel any single-touch state cleanly
                this._clearLongPress();
                if (this.touchMode === 'single') {
                    this._cancelSingleTouchGesture();
                }
                this.touchMode = 'multi';
                const t0 = this.nn(e.touches[0]), t1 = this.nn(e.touches[1]);
                this.multiStartCentroid = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                this.multiStartDist = Math.hypot(dxs, dys) || 1;
                this.multiPanStartCamPanX = this.camPanX;
                this.multiPanStartCamPanY = this.camPanY;
                this.multiPinchStartZoom = this.camZoom;
            }
        }, { passive: false, signal });

        this._oc().addEventListener('touchmove', (e: TouchEvent) => {
            e.preventDefault();
            if (this.touchMode === 'longpress-fired') return;
            if (this.touchMode === 'single' && e.touches.length === 1) {
                const t = this.nn(e.touches[0]);
                const ddx = t.clientX - this.touchStartClientX;
                const ddy = t.clientY - this.touchStartClientY;
                if (Math.hypot(ddx, ddy) > this.LONG_PRESS_MOVE_TOL) this._clearLongPress();
                this._synth('mousemove', t.clientX, t.clientY);
                return;
            }
            if (this.touchMode === 'multi' && e.touches.length >= 2) {
                const t0 = this.nn(e.touches[0]), t1 = this.nn(e.touches[1]);
                const cx = (t0.clientX + t1.clientX) / 2;
                const cy = (t0.clientY + t1.clientY) / 2;
                const dx = cx - (this.multiStartCentroid?.[0] ?? 0);
                const dy = cy - (this.multiStartCentroid?.[1] ?? 0);
                // Pan: centroid delta in client px -> canvas px -> world px
                const rect = this._oc().getBoundingClientRect();
                const sx = this.canvasW / rect.width;
                const sy = this.canvasH / rect.height;
                this.camPanX = this.multiPanStartCamPanX + (dx * sx) / this.camZoom;
                this.camPanY = this.multiPanStartCamPanY + (dy * sy) / this.camZoom;
                // Pinch: distance ratio
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                const dist = Math.hypot(dxs, dys) || 1;
                const ratio = dist / this.multiStartDist;
                this.applyInteractiveZoom(this.multiPinchStartZoom * ratio);
                // A two-finger gesture also pans; render even when the pinch
                // ratio is unchanged or the zoom is clamped at its limit.
                this.setNeedsRender();
            }
        }, { passive: false, signal });

        this._oc().addEventListener('touchend', (e: TouchEvent) => {
            e.preventDefault();
            this._clearLongPress();
            if (this.touchMode === 'longpress-fired') {
                // Discard the residual touch — drag was already cancelled.
                if (e.touches.length === 0) {
                    this.touchMode = 'idle';
                }
                return;
            }
            if (this.touchMode === 'single') {
                // Forward as mouseup to commit / select
                const t = e.changedTouches[0] ?? null;
                if (t) {
                    this._synth('mouseup', t.clientX, t.clientY);
                }
                this.touchMode = 'idle';
                return;
            }
            if (this.touchMode === 'multi') {
                if (e.touches.length === 0) {
                    this.touchMode = 'idle';
                } else if (e.touches.length === 1) {
                    // Demote to single but don't restart drag — leave idle so
                    // the user can lift their second finger without surprises.
                    this.touchMode = 'idle';
                }
            }
        }, { passive: false, signal });

        this._oc().addEventListener('touchcancel', () => {
            this._clearLongPress();
            this._cancelSingleTouchGesture();
            this.touchMode = 'idle';
        }, { passive: true, signal });
    },
    onPointerCancel(this: ShapeEditor){
        this._cancelSingleTouchGesture();
    },
    onMouseLeave(this: ShapeEditor){

        if (this.gizmoActive) {
            this.commitGizmoDrag();
            this.gizmoActive = null;
            this.gizmoDragStart = null;
        }
        this.gizmoHover = null;
        if (this.bgGizmoActive) {
            this.bgGizmoActive = null;
            this.bgGizmoDragStart = null;
        }
        this.bgGizmoHover = null;
        if (this.isPanning) {
            this.isPanning = false;
        }
        if (this.rightButtonDown) {
            this.rightButtonDown = false;
            this.rightClickMoved = false;
        }
        this.pendingRightPan = null;
        if (this.isDragging && this.selectedIdx >= 0) {
            // Finalize drag on leave
            const newScreenmapPt = [...this.nn(this.screenmap_pts[this.selectedIdx])];
            const newRawPt = [...this.nn(this.rawPts[this.selectedIdx])];
            if (newScreenmapPt[0] !== (this.dragStartScreenmapPt?.[0] ?? 0) ||
                newScreenmapPt[1] !== (this.dragStartScreenmapPt?.[1] ?? 0)) {
                this.pushUndo({
                    type: 'move',
                    idx: this.selectedIdx,
                    oldScreenmapPt: this.dragStartScreenmapPt,
                    newScreenmapPt,
                    oldRawPt: this.dragStartRawPt,
                    newRawPt,
                });
            }
            this.isDragging = false;
            this.altQuasimode = false;
        }
        // Pointer capture owns active gestures. Leaving the canvas must not
        // commit or cancel a captured transform; pointerup/cancel decides it.
        if (this.marqueeActive) {
            this._commitMarquee();
        }
        if (this.multiDragActive) {
            this._finalizeMultiDrag();
        }
        // Drop a half-resolved Ctrl+mousedown without firing append
        // (the cursor left the canvas — we can't tell click vs. drag).
        this._pendingMarquee = null;
        this.isHovering = false;
        this.tooltipLedIdx = -1;
        this._tooltip().style.opacity = '0';
        this._oc().style.cursor = 'default';
    },
};
