// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 6/8).

import { ShapeEditor } from './shapeeditor-class';
import { computeStripSnapTargets } from './strip-snap-targets';
import { rotatePointsAround } from './strip-rotate';

ShapeEditor.prototype.onContextMenu = function (this: ShapeEditor, e: MouseEvent) {
    const self = this;

        e.preventDefault();
        // Cancel panel placement on right-click
        if (self.placingState) {
            self._cancelPlacing();
            return;
        }
        if (self.pasteState) {
            self._cancelPaste();
            return;
        }
        // If right-click was used for zoom dragging, skip the context menu
        const wasMoved = self.rightClickMoved;
        self.rightClickMoved = false;
        if (wasMoved) return;
        if (self.screenmap_pts.length === 0) return;
        const [cx, cy] = self.getCanvasCoords(e);
        // Ruler hit-test: stash the index so the context menu can show
        // "Duplicate ruler" / "Delete ruler" wired to this specific ruler.
        // -1 means "no ruler under the cursor at right-click time".
        self.ctxMenuRulerIdx = self._findRulerAtCanvasPoint(cx, cy);
        // Stash the screenmap (world) coordinates so "Insert ruler" can place
        // the new 60 cm ruler centered at the click location.
        const worldClick = self.canvasToScreenmapCoords(cx, cy);
        self.ctxMenuClickX = worldClick[0];
        self.ctxMenuClickY = worldClick[1];
        // Chain mode: right-click on a connector arrow opens the connector menu
        if (self.editorMode === 'chain') {
            const conn = self._hitConnectorBody(cx, cy);
            if (conn) {
                if (conn.up !== undefined && conn.down !== undefined) self._openConnectorMenu(conn.up, conn.down, e.clientX, e.clientY);
                return;
            }
        }
        const idx = self.hitTestLED(cx, cy);
        if (idx >= 0) {
            self.selectedIdx = idx;
            self.syncPointSelection(idx);
            self.highlightedEdgeIdx = -1;
            self.setNeedsGeometryUpdate();
            self.showContextMenu(e.clientX, e.clientY, idx, -1);
            return;
        }
        // No point hit — check for edge hit
        const edge = self.findNearestEdge(cx, cy);
        if (edge && edge.distSq < 20 * 20) {
            self.highlightedEdgeIdx = edge.idx;
            self.setNeedsRender();
            self.showContextMenu(e.clientX, e.clientY, -1, edge.idx);
            return;
        }
        self.highlightedEdgeIdx = -1;
        let insideBBox = false;
        if (self.ptsBBox) {
            const [lx, ly] = self.canvasToObbLocal(self.ptsBBox, cx, cy);
            insideBBox = Math.abs(lx) <= self.ptsBBox.hw && Math.abs(ly) <= self.ptsBBox.hh;
        }
        self.showContextMenu(e.clientX, e.clientY, -1, -1, insideBBox);
    };

ShapeEditor.prototype.onMouseDown = function (this: ShapeEditor, e: MouseEvent) {
    const self = this;

        // Dismiss context menu on any click
        self.hideContextMenu();

        // Panel placement takes priority over every other handler
        if (self.placingState) {
            if (e.button === 2) {
                e.preventDefault();
                self._cancelPlacing();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = self.getCanvasCoords(e);
                self._commitPlacingAt(cx, cy);
                return;
            }
            return;
        }

        // Paste-pending ghost commit / cancel
        if (self.pasteState) {
            if (e.button === 2) {
                e.preventDefault();
                self._cancelPaste();
                return;
            }
            if (e.button === 0) {
                e.preventDefault();
                const [cx, cy] = self.getCanvasCoords(e);
                self._commitPasteAt(cx, cy);
                return;
            }
            return;
        }

        if (self.screenmap_pts.length === 0 && !self.bgImageMesh) return;

        if (e.button === 2) {
            // Right-click: start potential zoom drag
            self.rightButtonDown = true;
            self.rightClickMoved = false;
            const [, cy] = self.getCanvasCoords(e);
            self.zoomStartY = cy;
            self.zoomStartLevel = self.camZoom;
            return;
        }

        if (e.button !== 0) return;
        const [cx, cy] = self.getCanvasCoords(e);

        // Chain mode: arrowhead / Start-handle drags only; LED hit-test and
        // group-drag are suppressed (issue #24 §1.7). Everything else pans.
        if (self.editorMode === 'chain') {
            const conn = self._hitChainArrowhead(cx, cy);
            if (conn) {
                self.connectorDrag = { upIdx: conn.up ?? 0, x: cx, y: cy, targetIdx: null };
                self._oc().style.cursor = 'grabbing';
                self.setNeedsRender();
                return;
            }
            const startIdx = self._hitStartHandle(cx, cy, -1);
            if (startIdx !== null) {
                self.startHandleDrag = { stripIdx: startIdx, x: cx, y: cy, targetIdx: null };
                self._oc().style.cursor = 'grabbing';
                self.setNeedsRender();
                return;
            }
            // Fall through to pan
            if (self.selectedIdx >= 0) { self.selectedIdx = -1; self.setNeedsGeometryUpdate(); }
            self.selection.clear();
            self.isPanning = true;
            self.panStartX = cx;
            self.panStartY = cy;
            self.panStartCamX = self.camPanX;
            self.panStartCamY = self.camPanY;
            self._oc().style.cursor = 'move';
            return;
        }

        // Shift/Ctrl/Meta on an LED ↦ multi-selection modifier (handled in
        // the LED-hit branch below). Skip the insert/append paths when the
        // cursor is over a LED so multi-select stays usable.
        const hitLedForModCheck = (e.shiftKey || e.ctrlKey || e.metaKey)
            ? self.hitTestLED(cx, cy)
            : -1;

        // Shift+Left-click on empty area: insert a new point between two existing points
        if (e.shiftKey && self.screenmap_pts.length >= 2 && hitLedForModCheck < 0) {
            const edge = self.findNearestEdge(cx, cy);
            if (edge) {
                const { idx, t } = edge;
                const si = self.nn(self.screenmap_pts[idx]), si1 = self.nn(self.screenmap_pts[idx + 1]);
                const ri = self.nn(self.rawPts[idx]), ri1 = self.nn(self.rawPts[idx + 1]);
                const newScreenmapPt: [number, number] = [
                    si[0] + t * (si1[0] - si[0]),
                    si[1] + t * (si1[1] - si[1]),
                ];
                const newRawPt: [number, number] = [
                    ri[0] + t * (ri1[0] - ri[0]),
                    ri[1] + t * (ri1[1] - ri[1]),
                ];
                self.insertPointAt(idx + 1, newScreenmapPt, newRawPt);
                return;
            }
        }

        // Ctrl+Left-mousedown on empty area: ambiguous — could be a click
        // ("append point") or a drag ("marquee select"). Stash the intent and
        // resolve in mousemove / mouseup once we know whether the user moved.
        if ((e.ctrlKey || e.metaKey) && self.screenmap_pts.length > 0 && hitLedForModCheck < 0) {
            self._pendingMarquee = {
                cx, cy,
                mode: e.shiftKey ? 'add' : 'replace',
                appendOnClick: true,
            };
            self._oc().style.cursor = 'crosshair';
            return;
        }

        // Priority 0: Ruler handle / body
        const rulerHit = self.hitTestRuler(cx, cy);
        if (rulerHit) {
            const ruler = self.rulers[rulerHit.idx];
            if (ruler) {
                self.rulerDrag = rulerHit;
                self.rulerDragStart = {
                    cx, cy,
                    ax: ruler.ax, ay: ruler.ay,
                    bx: ruler.bx, by: ruler.by,
                };
                self._oc().style.cursor = rulerHit.kind === 'body' ? 'move' : 'grab';
                return;
            }
        }

        // Priority 0.5: Per-strip rotation handle (only when a strip is
        // selected). Checked before the global gizmo so a strip near the
        // top of the screenmap's bbox still gets its own handle hit.
        if (self.hitTestStripRotateHandle(cx, cy)) {
            const idx = self.selection.getStripIdx();
            if (idx !== null && self.stripInfo && idx < self.stripInfo.strips.length) {
                const strip = self.nn(self.stripInfo.strips[idx]);
                self.stripRotateActive = true;
                self.stripRotateIdx = idx;
                self.stripRotateStartScreenmap = [];
                self.stripRotateStartRaw = [];
                let cxSm = 0, cySm = 0, cxRw = 0, cyRw = 0, n = 0;
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    const sm = self.nn(self.screenmap_pts[k]);
                    const rw = self.nn(self.rawPts[k]);
                    self.stripRotateStartScreenmap.push([sm[0], sm[1]]);
                    self.stripRotateStartRaw.push([rw[0], rw[1]]);
                    cxSm += sm[0]; cySm += sm[1]; cxRw += rw[0]; cyRw += rw[1]; n++;
                }
                if (n > 0) {
                    cxSm /= n; cySm /= n; cxRw /= n; cyRw /= n;
                }
                self.stripRotateCenterSm = { x: cxSm, y: cySm };
                self.stripRotateCenterRaw = { x: cxRw, y: cyRw };
                // Cursor angle around the canvas-space handle anchor (the
                // top-center of the strip bbox in canvas px). We rotate the
                // points around their screenmap-space mean (also at the
                // bbox center), so the rotation pivot in cm == the visual
                // pivot in canvas px.
                const bb = self._selectedStripBboxCanvas();
                if (bb) {
                    const anchorX = (bb.minX + bb.maxX) / 2;
                    const anchorY = (bb.minY + bb.maxY) / 2;
                    self.stripRotateStartAngle = Math.atan2(cy - anchorY, cx - anchorX);
                } else {
                    self.stripRotateStartAngle = 0;
                }
                self.stripRotateLastDeg = 0;
                self._oc().style.cursor = 'grabbing';
                return;
            }
        }

        // Priority 1: Gizmo handle (corner/edge/rotation)
        const gizmoHit = self.hitTestGizmo(cx, cy);
        if (gizmoHit && gizmoHit !== 'translate') {
            self.gizmoActive = gizmoHit;
            const handles = self.computeGizmoHandles(self.ptsBBox);
            self.gizmoDragStart = {
                canvasX: cx, canvasY: cy,
                scale: parseFloat(self.dom_txt_scale.value) || 1,
                scaleX: parseFloat(self.dom_txt_scale_x.value) || 1,
                scaleY: parseFloat(self.dom_txt_scale_y.value) || 1,
                rotate: parseInt(self.dom_txt_rotate.value) || 0,
                translateX: parseInt(self.dom_txt_translate_x.value) || 0,
                translateY: parseInt(self.dom_txt_translate_y.value) || 0,
                bboxCenter: handles?.center ?? { x: 0, y: 0 },
            };
            self._oc().style.cursor = gizmoHit === 'rotate' ? 'grabbing' : self.getCursorForGizmo(gizmoHit);
            return;
        }

        // Priority 2: LED point hit test
        const idx = self.hitTestLED(cx, cy);
        if (idx >= 0) {
            // Multi-selection modifiers: ctrl/meta toggles, shift adds.
            // Both consume the click — no drag is started so the user can
            // adjust the selection before initiating a group move.
            if (e.ctrlKey || e.metaKey) {
                if (self.multiSelectedIdxs.has(idx)) self.multiSelectedIdxs.delete(idx);
                else self.multiSelectedIdxs.add(idx);
                self.setNeedsGeometryUpdate();
                return;
            }
            if (e.shiftKey) {
                self.multiSelectedIdxs.add(idx);
                self.setNeedsGeometryUpdate();
                return;
            }
            // Plain click on an already multi-selected LED: start a group drag.
            if (self.multiSelectedIdxs.has(idx)) {
                self._startMultiDrag(cx, cy);
                return;
            }
            // Plain click on a non-selected LED: clear any prior multi-selection
            // before falling through to the strip / single-LED drag path.
            if (self.multiSelectedIdxs.size > 0) {
                self.multiSelectedIdxs.clear();
                self.setNeedsGeometryUpdate();
            }

            self.selectedIdx = idx;
            self.syncPointSelection(idx);
            self.highlightedEdgeIdx = -1;
            self.setNeedsGeometryUpdate(); // color update for selection
            self.dragStartCanvasX = cx;
            self.dragStartCanvasY = cy;
            self.dragStartScreenmapPt = [...self.nn(self.screenmap_pts[idx])] as [number, number];
            self.dragStartRawPt = [...self.nn(self.rawPts[idx])] as [number, number];

            // Alt quasimode = single-point move regardless of mode.
            self.altQuasimode = e.altKey;
            const hitStripIdx = self.stripStore.findStripForIndex(idx);
            const inPointEdit = self.pointEditStripIdx !== null && self.pointEditStripIdx === hitStripIdx;

            if (self.altQuasimode || inPointEdit) {
                // Single-point drag (existing behavior)
                self.isDragging = true;
                self._oc().style.cursor = 'grabbing';
            } else {
                // Group drag for the whole strip
                self.stripDragActive = true;
                self.stripDragIdx = hitStripIdx;
                const strip = self.nn(self._si().strips[hitStripIdx]);
                self.stripDragStartScreenmap = [];
                self.stripDragStartRaw = [];
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    self.stripDragStartScreenmap.push([self.nn(self.screenmap_pts[k])[0], self.nn(self.screenmap_pts[k])[1]]);
                    self.stripDragStartRaw.push([self.nn(self.rawPts[k])[0], self.nn(self.rawPts[k])[1]]);
                }
                self.stripDragLastSdx = 0;
                self.stripDragLastSdy = 0;
                // Dragged strip's starting center (rotation-aware: mean of
                // its already-transformed `screenmap_pts`). Computed first
                // so the snap-target precompute can use it as the band-filter
                // anchor for issue #115's inter-strip grid pitch inference.
                let cx0 = 0, cy0 = 0, cn0 = 0;
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    const p = self.screenmap_pts[k];
                    if (!p) continue;
                    cx0 += p[0]; cy0 += p[1]; cn0++;
                }
                self.stripSnapStartCenter = cn0 > 0
                    ? { x: cx0 / cn0, y: cy0 / cn0 }
                    : null;
                // ── Strip-drag snap precompute (issues #105, #110, #115) ──
                // Targets per other strip: center (#105), ±k·LED_pitch (#110,
                // k ∈ {1..3}), and ±k·grid_pitch (#115, k ∈ {1..5}). The
                // inter-strip grid pitch is inferred from neighbor centers
                // along each axis, band-filtered by the dragged strip's
                // start center so far-row outliers don't contaminate it.
                const { xTargets, yTargets } = computeStripSnapTargets(
                    self._si().strips, hitStripIdx, self.screenmap_pts,
                    self.stripSnapStartCenter ?? undefined,
                );
                self.stripSnapXTargets = xTargets;
                self.stripSnapYTargets = yTargets;
                self.stripSnapEngagedX = null;
                self.stripSnapEngagedY = null;
                self._oc().style.cursor = 'grabbing';
            }
            return;
        }

        // Priority 3: Edge selection (click near a line segment)
        if (self.screenmap_pts.length >= 2) {
            const edge = self.findNearestEdge(cx, cy);
            if (edge && edge.distSq < 20 * 20) {
                self.highlightedEdgeIdx = edge.idx;
                self.selectedIdx = -1;
                self.selection.clear();
                self.setNeedsRender();
                return;
            }
        }
        if (self.highlightedEdgeIdx >= 0) { self.highlightedEdgeIdx = -1; self.setNeedsRender(); }

        // Marquee select is gated behind Ctrl+drag (handled by the
        // _pendingMarquee branch above). Plain left-drag keeps its
        // original behavior: translate gizmo inside the bbox, pan outside.

        // Priority 4: Translate (inside bbox, no LED hit)
        if (gizmoHit === 'translate') {
            self.gizmoActive = 'translate';
            self.gizmoDragStart = {
                canvasX: cx, canvasY: cy,
                scale: parseFloat(self.dom_txt_scale.value) || 1,
                scaleX: parseFloat(self.dom_txt_scale_x.value) || 1,
                scaleY: parseFloat(self.dom_txt_scale_y.value) || 1,
                rotate: parseInt(self.dom_txt_rotate.value) || 0,
                translateX: parseInt(self.dom_txt_translate_x.value) || 0,
                translateY: parseInt(self.dom_txt_translate_y.value) || 0,
                bboxCenter: null,
            };
            self._oc().style.cursor = 'move';
            return;
        }

        // Priority 4: Background image gizmo (mouse is outside screenmap bbox)
        if (self.bgImageMesh) {
            const bgHit = self.hitTestBgGizmo(cx, cy);
            if (bgHit && bgHit !== 'translate') {
                self.startBgGizmoDrag(bgHit, cx, cy);
                self._oc().style.cursor = bgHit === 'rotate' ? 'grabbing' : self.getCursorForGizmo(bgHit);
                return;
            }
            if (bgHit === 'translate') {
                self.startBgGizmoDrag('translate', cx, cy);
                self._oc().style.cursor = 'move';
                return;
            }
        }

        // Priority 5: Pan camera (outside bbox)
        if (self.selectedIdx >= 0) { self.selectedIdx = -1; self.setNeedsGeometryUpdate(); }
        if (self.pointEditStripIdx !== null) { self.pointEditStripIdx = null; self._updateHintStrip(); }
        self.selection.clear();
        self.isPanning = true;
        self.panStartX = cx;
        self.panStartY = cy;
        self.panStartCamX = self.camPanX;
        self.panStartCamY = self.camPanY;
        self._oc().style.cursor = 'move';
    };

ShapeEditor.prototype.onMouseMove = function (this: ShapeEditor, e: MouseEvent) {
    const self = this;

        if (self.placingState) {
            const [cx, cy] = self.getCanvasCoords(e);
            self._updateGhostFromCanvas(cx, cy);
            self._oc().style.cursor = 'crosshair';
            return;
        }
        if (self.pasteState) {
            const [cx, cy] = self.getCanvasCoords(e);
            self._updatePasteGhostFromCanvas(cx, cy);
            self._oc().style.cursor = 'crosshair';
            return;
        }
        if (self.screenmap_pts.length === 0 && !self.bgImageMesh) return;
        const [cx, cy] = self.getCanvasCoords(e);

        // Track shift key for rotation snapping
        self.shiftHeld = e.shiftKey;

        // Right-click drag: zoom
        if (self.rightButtonDown) {
            const dy = cy - self.zoomStartY;
            if (Math.abs(dy) > 3) self.rightClickMoved = true;
            if (self.rightClickMoved) {
                self.camZoom = Math.max(0.1, Math.min(10, self.zoomStartLevel * Math.pow(2, -dy / 200)));
                self._oc().style.cursor = 'ns-resize';
                self.setNeedsRender();
            }
            return;
        }

        // Chain-mode connector drag (arrowhead → new downstream target)
        if (self.connectorDrag) {
            self.connectorDrag.x = cx;
            self.connectorDrag.y = cy;
            const target = self._hitStartHandle(cx, cy, self.connectorDrag.upIdx);
            if (target !== self.connectorDrag.targetIdx) {
                self.connectorDrag.targetIdx = target;
                if (target !== null) {
                    self._previewConnectorTarget(self.connectorDrag.upIdx, target);
                } else {
                    self.renderStripsPanel();
                }
            }
            self.setNeedsRender();
            return;
        }

        // Chain-mode Start-handle drag (strip Start → upstream End target)
        if (self.startHandleDrag) {
            self.startHandleDrag.x = cx;
            self.startHandleDrag.y = cy;
            const target = self._hitEndHandle(cx, cy, self.startHandleDrag.stripIdx);
            if (target !== self.startHandleDrag.targetIdx) {
                self.startHandleDrag.targetIdx = target;
                if (target !== null) {
                    self._previewConnectorTarget(target, self.startHandleDrag.stripIdx);
                } else {
                    self.renderStripsPanel();
                }
            }
            self.setNeedsRender();
            return;
        }

        // Ruler drag in progress
        if (self.rulerDrag && self.rulerDragStart) {
            const ds = self.rulerDragStart;
            const wdx = (cx - ds.cx) / self.camZoom;
            const wdy = (cy - ds.cy) / self.camZoom;
            const ruler = self.rulers[self.rulerDrag.idx];
            if (ruler) {
                if (self.rulerDrag.kind === 'a') {
                    ruler.ax = ds.ax + wdx;
                    ruler.ay = ds.ay + wdy;
                } else if (self.rulerDrag.kind === 'b') {
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
            self.setNeedsRender();
            return;
        }

        // Per-strip rotation drag in progress
        if (self.stripRotateActive && self.stripRotateIdx >= 0 && self.stripInfo
            && self.stripRotateStartScreenmap && self.stripRotateStartRaw
            && self.stripRotateCenterSm && self.stripRotateCenterRaw) {
            const bb = self._selectedStripBboxCanvas();
            if (!bb) return;
            const anchorX = (bb.minX + bb.maxX) / 2;
            const anchorY = (bb.minY + bb.maxY) / 2;
            const curAngle = Math.atan2(cy - anchorY, cx - anchorX);
            let deltaDeg = (curAngle - self.stripRotateStartAngle) * 180 / Math.PI;
            // Shift snaps to 15° increments, matching the global gizmo
            // (rotation always uses INTEGER degree steps so the resulting
            // points are deterministic and undo-friendly).
            if (self.shiftHeld) deltaDeg = Math.round(deltaDeg / 15) * 15;
            else deltaDeg = Math.round(deltaDeg);
            const deltaRad = deltaDeg * Math.PI / 180;
            const strip = self.nn(self.stripInfo.strips[self.stripRotateIdx]);
            const csm = self.stripRotateCenterSm;
            const crw = self.stripRotateCenterRaw;
            const rotatedSm = rotatePointsAround(self.stripRotateStartScreenmap, csm.x, csm.y, deltaRad);
            const rotatedRw = rotatePointsAround(self.stripRotateStartRaw, crw.x, crw.y, deltaRad);
            for (let k = 0; k < strip.count; k++) {
                const base = strip.offset + k;
                self.screenmap_pts[base] = rotatedSm[k] ?? [0, 0] as [number, number];
                self.rawPts[base] = rotatedRw[k] ?? [0, 0] as [number, number];
            }
            self.stripRotateLastDeg = deltaDeg;
            self.setNeedsGeometryUpdate();
            return;
        }

        // Gizmo drag in progress
        if (self.gizmoActive) {
            self.handleGizmoDrag(cx, cy);
            return;
        }

        // Background image gizmo drag in progress
        if (self.bgGizmoActive) {
            self.handleBgGizmoDrag(cx, cy);
            return;
        }

        // Left-click drag on empty space: pan
        if (self.isPanning) {
            const dx = cx - self.panStartX;
            const dy = cy - self.panStartY;
            self.camPanX = self.panStartCamX + dx / self.camZoom;
            self.camPanY = self.panStartCamY + dy / self.camZoom;
            self.setNeedsRender();
            return;
        }

        // Pending Ctrl+mousedown promotes to a marquee on the first move
        // past a small threshold. Below the threshold, the click stays a
        // click and onMouseUp will run the append-point action.
        if (self._pendingMarquee) {
            const pm = self._pendingMarquee;
            const ddx = cx - pm.cx;
            const ddy = cy - pm.cy;
            if (ddx * ddx + ddy * ddy > 9) { // ~3px threshold
                self.marqueeActive = true;
                self.marqueeStartCx = pm.cx;
                self.marqueeStartCy = pm.cy;
                self.marqueeCurCx = cx;
                self.marqueeCurCy = cy;
                self.marqueeMode = pm.mode;
                self._marqueeBaseSelection = new Set(self.multiSelectedIdxs);
                if (pm.mode === 'replace') self.multiSelectedIdxs.clear();
                self._pendingMarquee = null;
                self._updateMarqueeSelection();
                self.setNeedsGeometryUpdate();
                return;
            }
        }

        // Marquee drag: live LED hit-test against the rectangle, eagerly
        // updating the multi-selection so the user sees what they'll get.
        if (self.marqueeActive) {
            self.marqueeCurCx = cx;
            self.marqueeCurCy = cy;
            self._updateMarqueeSelection();
            self.setNeedsGeometryUpdate();
            return;
        }

        // Multi-LED group drag: same canvas→screenmap delta math as
        // single-LED / strip drag, applied to every multi-selected index.
        if (self.multiDragActive) {
            const dx = cx - self.multiDragStartCanvasX;
            const dy = cy - self.multiDragStartCanvasY;
            const [sdx, sdy] = self.canvasDeltaToScreenmapDelta(dx, dy);
            for (const i of self.multiSelectedIdxs) {
                const startSm = self.multiDragStartScreenmap.get(i);
                const startRw = self.multiDragStartRaw.get(i);
                if (!startSm || !startRw) continue;
                self.screenmap_pts[i] = [startSm[0] + sdx, startSm[1] + sdy];
                self.rawPts[i] = [startRw[0] + sdx / self.fitScale, startRw[1] + sdy / self.fitScale];
            }
            self.multiDragLastSdx = sdx;
            self.multiDragLastSdy = sdy;
            self.setNeedsGeometryUpdate();
            return;
        }

        if (self.isDragging && self.selectedIdx >= 0) {
            // Move the point
            const dx = cx - self.dragStartCanvasX;
            const dy = cy - self.dragStartCanvasY;
            const [sdx, sdy] = self.canvasDeltaToScreenmapDelta(dx, dy);
            self.screenmap_pts[self.selectedIdx] = [
                (self.dragStartScreenmapPt?.[0] ?? 0) + sdx,
                (self.dragStartScreenmapPt?.[1] ?? 0) + sdy,
            ];
            self.rawPts[self.selectedIdx] = [
                (self.dragStartRawPt?.[0] ?? 0) + sdx / self.fitScale,
                (self.dragStartRawPt?.[1] ?? 0) + sdy / self.fitScale,
            ];
            self.setNeedsGeometryUpdate();
            return;
        }

        if (self.stripDragActive && self.stripDragIdx >= 0 && self.stripInfo) {
            const dx = cx - self.dragStartCanvasX;
            const dy = cy - self.dragStartCanvasY;
            let [sdx, sdy] = self.canvasDeltaToScreenmapDelta(dx, dy);
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
            const snapPx = !shiftBypass && self.snapBackEnabled ? self.snapBackPx : 0;
            const wasSnapped = self.stripSnapActive;
            self.stripSnapActive = snapPx > 0 && Math.hypot(dx, dy) < snapPx;
            if (self.stripSnapActive) {
                sdx = 0;
                sdy = 0;
            }
            if (self.stripSnapActive !== wasSnapped) self.setNeedsRender();
            // ── Center-to-center snap (issue #105) ─────────────────────
            // When the snap-back-to-origin isn't active, look for the
            // closest other strip's center on each axis independently.
            // Engage if within `snapBackPx / pxPerCm` cm.
            const prevSnapX = self.stripSnapEngagedX;
            const prevSnapY = self.stripSnapEngagedY;
            if (!self.stripSnapActive && snapPx > 0 && self.stripSnapStartCenter) {
                const pxPerCm = self.fitScale * self.camZoom;
                const tolCm = pxPerCm > 0 ? snapPx / pxPerCm : 0;
                const candCx = self.stripSnapStartCenter.x + sdx;
                const candCy = self.stripSnapStartCenter.y + sdy;
                let bestX: number | null = null;
                let bestXDist = tolCm;
                for (const t of self.stripSnapXTargets) {
                    const d = Math.abs(t - candCx);
                    if (d < bestXDist) { bestX = t; bestXDist = d; }
                }
                let bestY: number | null = null;
                let bestYDist = tolCm;
                for (const t of self.stripSnapYTargets) {
                    const d = Math.abs(t - candCy);
                    if (d < bestYDist) { bestY = t; bestYDist = d; }
                }
                if (bestX !== null) sdx = bestX - self.stripSnapStartCenter.x;
                if (bestY !== null) sdy = bestY - self.stripSnapStartCenter.y;
                self.stripSnapEngagedX = bestX;
                self.stripSnapEngagedY = bestY;
            } else {
                self.stripSnapEngagedX = null;
                self.stripSnapEngagedY = null;
            }
            if (prevSnapX !== self.stripSnapEngagedX || prevSnapY !== self.stripSnapEngagedY) {
                self.setNeedsRender();
            }
            const strip = self.nn(self.stripInfo.strips[self.stripDragIdx]);
            for (let k = 0; k < strip.count; k++) {
                const base = strip.offset + k;
                const startSm = self.stripDragStartScreenmap ? (self.stripDragStartScreenmap[k] ?? [0, 0] as [number, number]) : [0, 0] as [number, number];
                const startRw = self.stripDragStartRaw ? (self.stripDragStartRaw[k] ?? [0, 0] as [number, number]) : [0, 0] as [number, number];
                self.screenmap_pts[base] = [
                    startSm[0] + sdx,
                    startSm[1] + sdy,
                ];
                self.rawPts[base] = [
                    startRw[0] + sdx / self.fitScale,
                    startRw[1] + sdy / self.fitScale,
                ];
            }
            self.stripDragLastSdx = sdx;
            self.stripDragLastSdy = sdy;
            self.setNeedsGeometryUpdate();
            return;
        }

        // Ruler hover cursor
        const rulerHoverHit = self.hitTestRuler(cx, cy);
        if (rulerHoverHit) {
            self._oc().style.cursor = rulerHoverHit.kind === 'body' ? 'move' : 'grab';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
            // still update gizmo/bbox hover state below so rendering stays correct
        }

        // Per-strip rotate handle hover detection (takes priority over
        // the global gizmo so the handle glows when the user is over it).
        const prevStripRotHover = self.stripRotateHover;
        self.stripRotateHover = self.hitTestStripRotateHandle(cx, cy);
        if (self.stripRotateHover !== prevStripRotHover) self.setNeedsRender();
        if (self.stripRotateHover) {
            self._oc().style.cursor = 'grab';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
            return;
        }

        // Gizmo hover detection
        const prevGizmoHover = self.gizmoHover;
        self.gizmoHover = self.hitTestGizmo(cx, cy);
        if (self.gizmoHover !== prevGizmoHover) self.setNeedsRender();

        // Check if mouse is inside the points bounding box (controls rainbow fade)
        const wasHovering = self.isHovering;
        if (self.ptsBBox) {
            const [lx, ly] = self.canvasToObbLocal(self.ptsBBox, cx, cy);
            const inObb = Math.abs(lx) <= self.ptsBBox.hw && Math.abs(ly) <= self.ptsBBox.hh;
            self.isHovering = inObb || !!self.gizmoHover;
        } else {
            self.isHovering = false;
        }
        if (self.isHovering !== wasHovering) self.setNeedsRender();

        // Background image gizmo hover (only when not hovering screenmap gizmo)
        const prevBgGizmoHover = self.bgGizmoHover;
        if (!self.gizmoHover && self.bgImageMesh) {
            self.bgGizmoHover = self.hitTestBgGizmo(cx, cy);
        } else {
            self.bgGizmoHover = null;
        }
        if (self.bgGizmoHover !== prevBgGizmoHover) self.setNeedsRender();

        // Ruler hover takes top cursor priority
        if (rulerHoverHit) return;

        // Gizmo handle hover takes cursor priority
        if (self.gizmoHover && self.gizmoHover !== 'translate') {
            self._oc().style.cursor = self.getCursorForGizmo(self.gizmoHover);
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
            return;
        }

        // Shift held: crosshair (insert between)
        // Ctrl held: copy cursor (extend/append)
        if (self.screenmap_pts.length > 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) {
            self._oc().style.cursor = e.shiftKey ? 'crosshair' : 'copy';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
            return;
        }

        const idx = self.hitTestLED(cx, cy);
        if (idx >= 0) {
            self._oc().style.cursor = 'grab';
            if (idx !== self.tooltipLedIdx) {
                self.tooltipLedIdx = idx;
                const [ox, oy] = self.nn(self.rawPts[idx]);
                self._tooltip().textContent = `LED #${String(idx)}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const tx = Math.min(cx + 14, self.canvasW - self._tooltip().offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            self._tooltip().style.left = `${String(tx)}px`;
            self._tooltip().style.top = `${String(ty)}px`;
            self._tooltip().style.opacity = '1';
        } else if (self.gizmoHover === 'translate') {
            self._oc().style.cursor = 'move';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
        } else if (self.bgGizmoHover && self.bgGizmoHover !== 'translate') {
            self._oc().style.cursor = self.getCursorForGizmo(self.bgGizmoHover);
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
        } else if (self.bgGizmoHover === 'translate') {
            self._oc().style.cursor = 'move';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
        } else {
            self._oc().style.cursor = 'default';
            self.tooltipLedIdx = -1;
            self._tooltip().style.opacity = '0';
        }
    };

ShapeEditor.prototype.onMouseUp = function (this: ShapeEditor, e: MouseEvent) {
    const self = this;

        if (e.button === 2) {
            self.rightButtonDown = false;
            // rightClickMoved is consumed by onContextMenu
            self._oc().style.cursor = 'default';
            return;
        }

        // Chain-mode drags: commit on a valid drop target, else cancel.
        if (self.connectorDrag) {
            const { upIdx, targetIdx } = self.connectorDrag;
            self.connectorDrag = null;
            self._oc().style.cursor = 'default';
            if (targetIdx !== null) {
                self.doConnectorRetarget(upIdx, targetIdx);
            } else {
                self.renderStripsPanel();
            }
            self.setNeedsRender();
            return;
        }
        if (self.startHandleDrag) {
            const { stripIdx, targetIdx } = self.startHandleDrag;
            self.startHandleDrag = null;
            self._oc().style.cursor = 'default';
            if (targetIdx !== null) {
                // Dropping a strip's Start on another strip's End wires that
                // strip downstream of the target: target ──▶ stripIdx.
                self.doConnectorRetarget(targetIdx, stripIdx);
            } else {
                self.renderStripsPanel();
            }
            self.setNeedsRender();
            return;
        }

        if (self.rulerDrag) {
            self.rulerDrag = null;
            self.rulerDragStart = null;
            self._oc().style.cursor = 'default';
            return;
        }

        if (self.stripRotateActive) {
            self._finalizeStripRotate();
            self._oc().style.cursor = 'grab';
            return;
        }

        if (self.gizmoActive) {
            self.commitGizmoDrag();
            self.gizmoActive = null;
            self.gizmoDragStart = null;
            self._oc().style.cursor = 'default';
            return;
        }

        if (self.bgGizmoActive) {
            self.bgGizmoActive = null;
            self.bgGizmoDragStart = null;
            self._oc().style.cursor = 'default';
            return;
        }

        if (self.isPanning) {
            self.isPanning = false;
            self._oc().style.cursor = 'default';
            return;
        }

        // Ctrl+mousedown that never crossed the marquee threshold reverts to
        // the original ctrl+click "append point at click location" behavior.
        if (self._pendingMarquee) {
            const pm = self._pendingMarquee;
            self._pendingMarquee = null;
            if (pm.appendOnClick && self.screenmap_pts.length > 0) {
                const newScreenmapPt = self.canvasToScreenmapCoords(pm.cx, pm.cy);
                const newRawPt = self.screenmapToRawCoords(newScreenmapPt[0], newScreenmapPt[1]);
                self.insertPointAt(self.screenmap_pts.length, newScreenmapPt, newRawPt);
            }
            self._oc().style.cursor = 'default';
            return;
        }

        if (self.marqueeActive) {
            self._commitMarquee();
            self._oc().style.cursor = 'default';
            return;
        }

        if (self.multiDragActive) {
            self._finalizeMultiDrag();
            self._oc().style.cursor = 'grab';
            return;
        }

        if (self.isDragging && self.selectedIdx >= 0) {
            const newScreenmapPt = [...self.nn(self.screenmap_pts[self.selectedIdx])];
            const newRawPt = [...self.nn(self.rawPts[self.selectedIdx])];
            // Only record undo if the point actually moved
            if (newScreenmapPt[0] !== (self.dragStartScreenmapPt?.[0] ?? 0) ||
                newScreenmapPt[1] !== (self.dragStartScreenmapPt?.[1] ?? 0)) {
                self.pushUndo({
                    type: 'move',
                    idx: self.selectedIdx,
                    oldScreenmapPt: self.dragStartScreenmapPt,
                    newScreenmapPt,
                    oldRawPt: self.dragStartRawPt,
                    newRawPt,
                });
            }
            self.isDragging = false;
            self.altQuasimode = false;
            self._oc().style.cursor = 'grab';
            return;
        }

        if (self.stripDragActive) {
            self._finalizeStripDrag();
            self._oc().style.cursor = 'grab';
            return;
        }
    };

ShapeEditor.prototype._finalizeStripDrag = function (this: ShapeEditor) {
    const self = this;

        if (!self.stripDragActive) return;
        const sdx = self.stripDragLastSdx;
        const sdy = self.stripDragLastSdy;
        if (sdx !== 0 || sdy !== 0) {
            self.pushUndo({
                type: 'strip-translate',
                stripIdx: self.stripDragIdx,
                sdx,
                sdy,
            });
            self._persistMultiStrip();
        }
        self.stripDragActive = false;
        self.stripDragIdx = -1;
        self.stripDragStartScreenmap = null;
        self.stripDragStartRaw = null;
        self.stripSnapActive = false;
        self.stripSnapXTargets = [];
        self.stripSnapYTargets = [];
        self.stripSnapStartCenter = null;
        self.stripSnapEngagedX = null;
        self.stripSnapEngagedY = null;
        self.stripDragLastSdx = 0;
        self.stripDragLastSdy = 0;
    };

ShapeEditor.prototype._applyStripTranslate = function (this: ShapeEditor, stripIdx: number, sdx: number, sdy: number) {
    const self = this;

        if (!self.stripInfo || stripIdx < 0 || stripIdx >= self.stripInfo.strips.length) return;
        const strip = self.nn(self.stripInfo.strips[stripIdx]);
        for (let k = strip.offset; k < strip.offset + strip.count; k++) {
            self.screenmap_pts[k] = [self.nn(self.screenmap_pts[k])[0] + sdx, self.nn(self.screenmap_pts[k])[1] + sdy];
            self.rawPts[k] = [self.nn(self.rawPts[k])[0] + sdx / self.fitScale, self.nn(self.rawPts[k])[1] + sdy / self.fitScale];
        }
    };

ShapeEditor.prototype._finalizeStripRotate = function (this: ShapeEditor) {
    const self = this;
        if (!self.stripRotateActive) return;
        const deg = self.stripRotateLastDeg;
        const stripIdx = self.stripRotateIdx;
        const csm = self.stripRotateCenterSm;
        const crw = self.stripRotateCenterRaw;
        if (deg !== 0 && csm && crw && stripIdx >= 0) {
            self.pushUndo({
                type: 'strip-rotate',
                stripIdx,
                deltaDeg: deg,
                centerSm: { x: csm.x, y: csm.y },
                centerRaw: { x: crw.x, y: crw.y },
            });
            self._persistMultiStrip();
        }
        self.stripRotateActive = false;
        self.stripRotateIdx = -1;
        self.stripRotateStartScreenmap = null;
        self.stripRotateStartRaw = null;
        self.stripRotateCenterSm = null;
        self.stripRotateCenterRaw = null;
        self.stripRotateStartAngle = 0;
        self.stripRotateLastDeg = 0;
    };

/**
 * Rotate the points of a single strip around its captured bbox center by
 * `deltaRad` (radians). Modifies both `screenmap_pts` and `rawPts` in place.
 * Used by `applyAction` / `applyInverse` for the `strip-rotate` undo type.
 */
ShapeEditor.prototype._applyStripRotate = function (this: ShapeEditor, stripIdx: number, deltaRad: number, centerSm: { x: number; y: number }, centerRaw: { x: number; y: number }) {
    const self = this;
        if (!self.stripInfo || stripIdx < 0 || stripIdx >= self.stripInfo.strips.length) return;
        const strip = self.nn(self.stripInfo.strips[stripIdx]);
        const lo = strip.offset;
        const hi = strip.offset + strip.count;
        const sliceSm: [number, number][] = [];
        const sliceRw: [number, number][] = [];
        for (let k = lo; k < hi; k++) {
            sliceSm.push([self.nn(self.screenmap_pts[k])[0], self.nn(self.screenmap_pts[k])[1]]);
            sliceRw.push([self.nn(self.rawPts[k])[0], self.nn(self.rawPts[k])[1]]);
        }
        const rotatedSm = rotatePointsAround(sliceSm, centerSm.x, centerSm.y, deltaRad);
        const rotatedRw = rotatePointsAround(sliceRw, centerRaw.x, centerRaw.y, deltaRad);
        for (let k = lo; k < hi; k++) {
            self.screenmap_pts[k] = rotatedSm[k - lo] ?? [0, 0] as [number, number];
            self.rawPts[k] = rotatedRw[k - lo] ?? [0, 0] as [number, number];
        }
    };

ShapeEditor.prototype.onDoubleClick = function (this: ShapeEditor, e: MouseEvent) {
    const self = this;

        if (self.placingState) return;
        if (e.button !== 0) return;
        if (self.screenmap_pts.length === 0) return;
        const [cx, cy] = self.getCanvasCoords(e);
        const idx = self.hitTestLED(cx, cy);
        if (idx < 0) return;
        const sIdx = self.stripStore.findStripForIndex(idx);
        if (sIdx < 0) return;
        if (self.pointEditStripIdx === sIdx) {
            // Double-click again exits point-edit
            self.pointEditStripIdx = null;
        } else {
            self.pointEditStripIdx = sIdx;
            self.selection.selectStrip(sIdx);
        }
        self._updateHintStrip();
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype._clearLongPress = function (this: ShapeEditor) {
    const self = this;

        if (self.longPressTimer !== null) {
            clearTimeout(self.longPressTimer);
            self.longPressTimer = null;
        }
    };

ShapeEditor.prototype._synth = function (this: ShapeEditor, type: string, clientX: number, clientY: number, opts: Record<string, unknown> = {}) {
    const self = this;

        const init = { clientX, clientY, button: (typeof opts.button === 'number' ? opts.button : 0), bubbles: true };
        const evt = new MouseEvent(type, init);
        if (type === 'mousedown') self.onMouseDown(evt);
        else if (type === 'mousemove') self.onMouseMove(evt);
        else if (type === 'mouseup') self.onMouseUp(evt);
    };

ShapeEditor.prototype._cancelSingleTouchGesture = function (this: ShapeEditor) {
    const self = this;

        // Cancel any in-flight single-touch drag cleanly (no undo entry).
        if (self.stripDragActive) {
            self.stripDragActive = false;
            self.stripDragIdx = -1;
            self.stripDragStartScreenmap = null;
            self.stripDragStartRaw = null;
            self.stripSnapActive = false;
            self.stripSnapXTargets = [];
            self.stripSnapYTargets = [];
            self.stripSnapStartCenter = null;
            self.stripSnapEngagedX = null;
            self.stripSnapEngagedY = null;
            self.stripDragLastSdx = 0;
            self.stripDragLastSdy = 0;
        }
        if (self.stripRotateActive) {
            self.stripRotateActive = false;
            self.stripRotateIdx = -1;
            self.stripRotateStartScreenmap = null;
            self.stripRotateStartRaw = null;
            self.stripRotateCenterSm = null;
            self.stripRotateCenterRaw = null;
            self.stripRotateStartAngle = 0;
            self.stripRotateLastDeg = 0;
        }
        if (self.isDragging) {
            self.isDragging = false;
            self.altQuasimode = false;
        }
        if (self.isPanning) {
            self.isPanning = false;
        }
        if (self.gizmoActive) {
            self.gizmoActive = null;
            self.gizmoDragStart = null;
        }
        if (self.rulerDrag) {
            self.rulerDrag = null;
            self.rulerDragStart = null;
        }
        self._oc().style.cursor = 'default';
    };

ShapeEditor.prototype._doLongPress = function (this: ShapeEditor, canvasX: number, canvasY: number, clientX: number, clientY: number) {
    const self = this;

        // Cancel the pending single-touch synth gesture so it does not also
        // commit a drag.
        self._cancelSingleTouchGesture();
        if (self.screenmap_pts.length === 0) {
            // Empty: open context menu
            self.showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
            self.touchMode = 'longpress-fired';
            return;
        }
        const idx = self.hitTestLED(canvasX, canvasY);
        if (idx >= 0) {
            const sIdx = self.stripStore.findStripForIndex(idx);
            if (sIdx >= 0) {
                self.selection.selectStrip(sIdx);
                self.pointEditStripIdx = sIdx;
                self._updateHintStrip();
                self.setNeedsGeometryUpdate();
                void self._toastInfo(`Editing points in "${self.stripStore.getStrips()[sIdx]?.name ?? ''}"`);
            }
        } else {
            self.showContextMenu(clientX || 0, clientY || 0, -1, -1, false);
        }
        self.touchMode = 'longpress-fired';
    };

// ── Marquee + multi-LED group drag ──────────────────────────────────────
//
// Walks `lastTransformedPts` once and projects each LED to canvas space
// inline (instead of allocating a fresh canvas-coords array via map())
// so the marquee stays cheap even on a 64x64 grid.
ShapeEditor.prototype._ledIdxsInCanvasRect = function (this: ShapeEditor, c1x: number, c1y: number, c2x: number, c2y: number): Set<number> {
    const self = this;
    const minX = Math.min(c1x, c2x);
    const maxX = Math.max(c1x, c2x);
    const minY = Math.min(c1y, c2y);
    const maxY = Math.max(c1y, c2y);
    const out = new Set<number>();
    const camPanX = self.camPanX;
    const camPanY = self.camPanY;
    const z = self.camZoom;
    const hw = self.canvasW / 2;
    const hh = self.canvasH / 2;
    const pts = self.lastTransformedPts;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p) continue;
        const cx = (p[0] + camPanX) * z + hw;
        const cy = (p[1] + camPanY) * z + hh;
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) out.add(i);
    }
    return out;
};

ShapeEditor.prototype._updateMarqueeSelection = function (this: ShapeEditor) {
    const self = this;
    const hits = self._ledIdxsInCanvasRect(self.marqueeStartCx, self.marqueeStartCy, self.marqueeCurCx, self.marqueeCurCy);
    const base = self._marqueeBaseSelection;
    let next: Set<number>;
    if (self.marqueeMode === 'replace') {
        next = hits;
    } else if (self.marqueeMode === 'add') {
        next = new Set(base);
        for (const i of hits) next.add(i);
    } else { // toggle: symmetric difference
        next = new Set(base);
        for (const i of hits) {
            if (next.has(i)) next.delete(i);
            else next.add(i);
        }
    }
    self.multiSelectedIdxs = next;
};

ShapeEditor.prototype._commitMarquee = function (this: ShapeEditor) {
    const self = this;
    // Selection was updated eagerly during mousemove; just clear the drag state.
    self.marqueeActive = false;
    self._marqueeBaseSelection = new Set<number>();
    self.setNeedsGeometryUpdate();
};

ShapeEditor.prototype._cancelMarquee = function (this: ShapeEditor) {
    const self = this;
    if (!self.marqueeActive) return;
    // Restore the pre-drag selection.
    self.multiSelectedIdxs = new Set(self._marqueeBaseSelection);
    self.marqueeActive = false;
    self._marqueeBaseSelection = new Set<number>();
    self.setNeedsGeometryUpdate();
};

ShapeEditor.prototype._startMultiDrag = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;
    self.multiDragActive = true;
    self.multiDragStartCanvasX = cx;
    self.multiDragStartCanvasY = cy;
    self.multiDragLastSdx = 0;
    self.multiDragLastSdy = 0;
    self.multiDragStartScreenmap = new Map<number, [number, number]>();
    self.multiDragStartRaw = new Map<number, [number, number]>();
    for (const i of self.multiSelectedIdxs) {
        const sm = self.screenmap_pts[i];
        const rw = self.rawPts[i];
        if (!sm || !rw) continue;
        self.multiDragStartScreenmap.set(i, [sm[0], sm[1]]);
        self.multiDragStartRaw.set(i, [rw[0], rw[1]]);
    }
    self._oc().style.cursor = 'grabbing';
};

ShapeEditor.prototype._finalizeMultiDrag = function (this: ShapeEditor) {
    const self = this;
    if (!self.multiDragActive) return;
    const sdx = self.multiDragLastSdx;
    const sdy = self.multiDragLastSdy;
    if ((sdx !== 0 || sdy !== 0) && self.multiSelectedIdxs.size > 0) {
        self.pushUndo({
            type: 'multi-translate',
            idxs: [...self.multiSelectedIdxs],
            sdx,
            sdy,
        });
        self._persistMultiStrip();
    }
    self.multiDragActive = false;
    self.multiDragStartScreenmap = new Map<number, [number, number]>();
    self.multiDragStartRaw = new Map<number, [number, number]>();
    self.multiDragLastSdx = 0;
    self.multiDragLastSdy = 0;
};

ShapeEditor.prototype._applyMultiTranslate = function (this: ShapeEditor, idxs: number[], sdx: number, sdy: number) {
    const self = this;
    for (const i of idxs) {
        const sm = self.screenmap_pts[i];
        const rw = self.rawPts[i];
        if (!sm || !rw) continue;
        self.screenmap_pts[i] = [sm[0] + sdx, sm[1] + sdy];
        self.rawPts[i] = [rw[0] + sdx / self.fitScale, rw[1] + sdy / self.fitScale];
    }
};
