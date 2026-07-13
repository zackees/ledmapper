// Named ShapeEditor method bundle: interaction.
import type { ShapeEditor } from './shapeeditor-class';
import { computeStripSnapTargets } from "./strip-snap-targets";
import { rotatePointsAround } from "./strip-rotate";

const STRIP_STROKE_HIT_PX = 10;

export interface EditorInteractionMethods {
    _startStripDrag: (stripIdx: number, canvasX: number, canvasY: number) => boolean;
    _ledIdxsInCanvasRect: (c1x: number, c1y: number, c2x: number, c2y: number) => Set<number>;
    _updateMarqueeSelection: () => void;
    _commitMarquee: () => void;
    _cancelMarquee: () => void;
    _startMultiDrag: (cx: number, cy: number) => void;
    _finalizeMultiDrag: () => void;
    _applyMultiTranslate: (idxs: number[], sdx: number, sdy: number) => void;
    onContextMenu: (e: MouseEvent) => void;
    onMouseDown: (e: MouseEvent) => void;
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: (e: MouseEvent) => void;
    onDoubleClick: (e: MouseEvent) => void;
    _clearLongPress: () => void;
    _synth: (type: string, clientX: number, clientY: number, opts?: Record<string, unknown>) => void;
    _cancelSingleTouchGesture: () => void;
    _doLongPress: (canvasX: number, canvasY: number, clientX: number, clientY: number) => void;
    _wireTouchHandlers: (signal: AbortSignal) => void;
    onMouseLeave: () => void;
}

export const editorInteractionMethods: EditorInteractionMethods & ThisType<ShapeEditor> = {
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
        // If right-click was used for zoom dragging, skip the context menu
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

    const strip = this.stripInfo.strips[stripIdx];
    if (!strip) return false;
    this.dragStartCanvasX = canvasX;
    this.dragStartCanvasY = canvasY;
    this.stripDragActive = true;
    this.stripDragIdx = stripIdx;
    this.stripDragStartScreenmap = [];
    this.stripDragStartRaw = [];
    for (let k = strip.offset; k < strip.offset + strip.count; k++) {
        this.stripDragStartScreenmap.push([this.nn(this.screenmap_pts[k])[0], this.nn(this.screenmap_pts[k])[1]]);
        this.stripDragStartRaw.push([this.nn(this.rawPts[k])[0], this.nn(this.rawPts[k])[1]]);
    }
    this.stripDragLastSdx = 0;
    this.stripDragLastSdy = 0;

    let cx0 = 0, cy0 = 0, count = 0;
    for (let k = strip.offset; k < strip.offset + strip.count; k++) {
        const point = this.screenmap_pts[k];
        if (!point) continue;
        cx0 += point[0];
        cy0 += point[1];
        count++;
    }
    this.stripSnapStartCenter = count > 0 ? { x: cx0 / count, y: cy0 / count } : null;
    const { xTargets, yTargets } = computeStripSnapTargets(
        this.stripInfo.strips,
        stripIdx,
        this.screenmap_pts,
        this.stripSnapStartCenter ?? undefined,
    );
    this.stripSnapXTargets = xTargets;
    this.stripSnapYTargets = yTargets;
    this.stripSnapEngagedX = null;
    this.stripSnapEngagedY = null;
    this._oc().style.cursor = 'grabbing';
    return true;
},
    onMouseDown(this: ShapeEditor, e: MouseEvent){

        // Dismiss context menu on any click
        this.hideContextMenu();

        // Panel placement takes priority over every other handler
        if (this.placingState) {
            if (e.button === 2) {
                e.preventDefault();
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

        if (e.button === 2) {
            // Right-click: start potential zoom drag
            this.rightButtonDown = true;
            this.rightClickMoved = false;
            const [, cy] = this.getCanvasCoords(e);
            this.zoomStartY = cy;
            this.zoomStartLevel = this.camZoom;
            return;
        }

        if (e.button !== 0) return;
        const [cx, cy] = this.getCanvasCoords(e);

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
        if (e.shiftKey && this.screenmap_pts.length >= 2 && hitLedForModCheck < 0) {
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
        if ((e.ctrlKey || e.metaKey) && this.screenmap_pts.length > 0 && hitLedForModCheck < 0) {
            this._pendingMarquee = {
                cx, cy,
                mode: e.shiftKey ? 'add' : 'replace',
                appendOnClick: true,
            };
            this._oc().style.cursor = 'crosshair';
            return;
        }

        // Priority 0: Ruler handle / body
        const rulerHit = this.hitTestRuler(cx, cy);
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
        if (this.hitTestStripRotateHandle(cx, cy)) {
            const idx = this.selection.getStripIdx();
            if (idx !== null && this.stripInfo && idx < this.stripInfo.strips.length) {
                const strip = this.nn(this.stripInfo.strips[idx]);
                this.stripRotateActive = true;
                this.stripRotateIdx = idx;
                this.stripRotateStartScreenmap = [];
                this.stripRotateStartRaw = [];
                let cxSm = 0, cySm = 0, cxRw = 0, cyRw = 0, n = 0;
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    const sm = this.nn(this.screenmap_pts[k]);
                    const rw = this.nn(this.rawPts[k]);
                    this.stripRotateStartScreenmap.push([sm[0], sm[1]]);
                    this.stripRotateStartRaw.push([rw[0], rw[1]]);
                    cxSm += sm[0]; cySm += sm[1]; cxRw += rw[0]; cyRw += rw[1]; n++;
                }
                if (n > 0) {
                    cxSm /= n; cySm /= n; cxRw /= n; cyRw /= n;
                }
                this.stripRotateCenterSm = { x: cxSm, y: cySm };
                this.stripRotateCenterRaw = { x: cxRw, y: cyRw };
                // Cursor angle around the canvas-space handle anchor (the
                // top-center of the strip bbox in canvas px). We rotate the
                // points around their screenmap-space mean (also at the
                // bbox center), so the rotation pivot in cm == the visual
                // pivot in canvas px.
                const bb = this._selectedStripBboxCanvas();
                if (bb) {
                    const anchorX = (bb.minX + bb.maxX) / 2;
                    const anchorY = (bb.minY + bb.maxY) / 2;
                    this.stripRotateStartAngle = Math.atan2(cy - anchorY, cx - anchorX);
                } else {
                    this.stripRotateStartAngle = 0;
                }
                this.stripRotateLastDeg = 0;
                this._oc().style.cursor = 'grabbing';
                return;
            }
        }

        // Priority 1: Gizmo handle (corner/edge/rotation)
        const gizmoHit = this.hitTestGizmo(cx, cy);
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

        // Priority 2: LED point hit test
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

            this.selectedIdx = idx;
            this.syncPointSelection(idx);
            this.highlightedEdgeIdx = -1;
            this.setNeedsGeometryUpdate(); // color update for selection
            this.dragStartCanvasX = cx;
            this.dragStartCanvasY = cy;
            this.dragStartScreenmapPt = [...this.nn(this.screenmap_pts[idx])] as [number, number];
            this.dragStartRawPt = [...this.nn(this.rawPts[idx])] as [number, number];

            // Alt quasimode = single-point move regardless of mode.
            this.altQuasimode = e.altKey;
            const hitStripIdx = this.stripStore.findStripForIndex(idx);
            const inPointEdit = this.pointEditStripIdx !== null && this.pointEditStripIdx === hitStripIdx;

            if (this.altQuasimode || inPointEdit) {
                // Single-point drag (existing behavior)
                this.isDragging = true;
                this._oc().style.cursor = 'grabbing';
            } else {
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

        // Marquee select is gated behind Ctrl+drag (handled by the
        // _pendingMarquee branch above). Plain left-drag keeps its
        // original behavior: pan on empty canvas.

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

        // Right-click drag: zoom
        if (this.rightButtonDown) {
            const dy = cy - this.zoomStartY;
            if (Math.abs(dy) > 3) this.rightClickMoved = true;
            if (this.rightClickMoved) {
                this.applyInteractiveZoom(this.zoomStartLevel * Math.pow(2, -dy / 200));
                this._oc().style.cursor = 'ns-resize';
            }
            return;
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
            const bb = this._selectedStripBboxCanvas();
            if (!bb) return;
            const anchorX = (bb.minX + bb.maxX) / 2;
            const anchorY = (bb.minY + bb.maxY) / 2;
            const curAngle = Math.atan2(cy - anchorY, cx - anchorX);
            let deltaDeg = (curAngle - this.stripRotateStartAngle) * 180 / Math.PI;
            // Shift snaps to 15° increments, matching the global gizmo
            // (rotation always uses INTEGER degree steps so the resulting
            // points are deterministic and undo-friendly).
            if (this.shiftHeld) deltaDeg = Math.round(deltaDeg / 15) * 15;
            else deltaDeg = Math.round(deltaDeg);
            const deltaRad = deltaDeg * Math.PI / 180;
            const strip = this.nn(this.stripInfo.strips[this.stripRotateIdx]);
            const csm = this.stripRotateCenterSm;
            const crw = this.stripRotateCenterRaw;
            const rotatedSm = rotatePointsAround(this.stripRotateStartScreenmap, csm.x, csm.y, deltaRad);
            const rotatedRw = rotatePointsAround(this.stripRotateStartRaw, crw.x, crw.y, deltaRad);
            for (let k = 0; k < strip.count; k++) {
                const base = strip.offset + k;
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
            let [sdx, sdy] = this.canvasDeltaToScreenmapDelta(dx, dy);
            // ── Magnetic snap-back to original position ─────────────────
            // When the drag has only moved the cursor a few pixels from the
            // initial mousedown point, zero out the delta so the strip
            // visibly snaps back to its starting place. The threshold is in
            // canvas pixels (not cm) so it stays the same on screen at any
            // zoom level. Both the toggle and the threshold are user-
            // controllable via the Magnetic-snap checkbox + Tolerance slider
            // in the Screenmap controls panel (persisted in localStorage).
            // Holding Shift bypasses every kind of snap for this move
            // (Figma convention).
            const shiftBypass = e.shiftKey;
            const snapPx = !shiftBypass && this.snapBackEnabled ? this.snapBackPx : 0;
            const wasSnapped = this.stripSnapActive;
            this.stripSnapActive = snapPx > 0 && Math.hypot(dx, dy) < snapPx;
            if (this.stripSnapActive) {
                sdx = 0;
                sdy = 0;
            }
            if (this.stripSnapActive !== wasSnapped) this.setNeedsRender();
            // ── Center-to-center snap (issue #105) ─────────────────────
            // When the snap-back-to-origin isn't active, look for the
            // closest other strip's center on each axis independently.
            // Engage if within `snapBackPx / pxPerCm` cm.
            const prevSnapX = this.stripSnapEngagedX;
            const prevSnapY = this.stripSnapEngagedY;
            if (!this.stripSnapActive && snapPx > 0 && this.stripSnapStartCenter) {
                const pxPerCm = this.fitScale * this.camZoom;
                const tolCm = pxPerCm > 0 ? snapPx / pxPerCm : 0;
                const candCx = this.stripSnapStartCenter.x + sdx;
                const candCy = this.stripSnapStartCenter.y + sdy;
                let bestX: number | null = null;
                let bestXDist = tolCm;
                for (const t of this.stripSnapXTargets) {
                    const d = Math.abs(t - candCx);
                    if (d < bestXDist) { bestX = t; bestXDist = d; }
                }
                let bestY: number | null = null;
                let bestYDist = tolCm;
                for (const t of this.stripSnapYTargets) {
                    const d = Math.abs(t - candCy);
                    if (d < bestYDist) { bestY = t; bestYDist = d; }
                }
                if (bestX !== null) sdx = bestX - this.stripSnapStartCenter.x;
                if (bestY !== null) sdy = bestY - this.stripSnapStartCenter.y;
                this.stripSnapEngagedX = bestX;
                this.stripSnapEngagedY = bestY;
            } else {
                this.stripSnapEngagedX = null;
                this.stripSnapEngagedY = null;
            }
            if (prevSnapX !== this.stripSnapEngagedX || prevSnapY !== this.stripSnapEngagedY) {
                this.setNeedsRender();
            }
            const strip = this.nn(this.stripInfo.strips[this.stripDragIdx]);
            for (let k = 0; k < strip.count; k++) {
                const base = strip.offset + k;
                const startSm = this.stripDragStartScreenmap ? (this.stripDragStartScreenmap[k] ?? [0, 0] as [number, number]) : [0, 0] as [number, number];
                const startRw = this.stripDragStartRaw ? (this.stripDragStartRaw[k] ?? [0, 0] as [number, number]) : [0, 0] as [number, number];
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

        // Gizmo hover detection
        const prevGizmoHover = this.gizmoHover;
        this.gizmoHover = this.hitTestGizmo(cx, cy);
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
            // rightClickMoved is consumed by onContextMenu
            this._oc().style.cursor = 'default';
            return;
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

        const init = { clientX, clientY, button: (typeof opts.button === 'number' ? opts.button : 0), bubbles: true };
        const evt = new MouseEvent(type, init);
        if (type === 'mousedown') this.onMouseDown(evt);
        else if (type === 'mousemove') this.onMouseMove(evt);
        else if (type === 'mouseup') this.onMouseUp(evt);
    },
    _cancelSingleTouchGesture(this: ShapeEditor){

        // Cancel any in-flight single-touch drag cleanly (no undo entry).
        if (this.stripDragActive) {
            this.stripDragActive = false;
            this.stripDragIdx = -1;
            this.stripDragStartScreenmap = null;
            this.stripDragStartRaw = null;
            this.stripSnapActive = false;
            this.stripSnapXTargets = [];
            this.stripSnapYTargets = [];
            this.stripSnapStartCenter = null;
            this.stripSnapEngagedX = null;
            this.stripSnapEngagedY = null;
            this.stripDragLastSdx = 0;
            this.stripDragLastSdy = 0;
        }
        if (this.stripRotateActive) {
            this.stripRotateActive = false;
            this.stripRotateIdx = -1;
            this.stripRotateStartScreenmap = null;
            this.stripRotateStartRaw = null;
            this.stripRotateCenterSm = null;
            this.stripRotateCenterRaw = null;
            this.stripRotateStartAngle = 0;
            this.stripRotateLastDeg = 0;
        }
        if (this.isDragging) {
            this.isDragging = false;
            this.altQuasimode = false;
        }
        if (this.isPanning) {
            this.isPanning = false;
        }
        if (this.gizmoActive) {
            this.gizmoActive = null;
            this.gizmoDragStart = null;
        }
        if (this.rulerDrag) {
            this.rulerDrag = null;
            this.rulerDragStart = null;
        }
        this._oc().style.cursor = 'default';
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
        if (this.stripDragActive) {
            this._finalizeStripDrag();
        }
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
