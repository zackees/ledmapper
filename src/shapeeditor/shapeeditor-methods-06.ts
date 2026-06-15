// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 6/8).

import { ShapeEditor } from './shapeeditor-class';
import { computeStripSnapTargets } from './strip-snap-targets';

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

        // Shift+Left-click: insert a new point between two existing points
        if (e.shiftKey && self.screenmap_pts.length >= 2) {
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

        // Ctrl+Left-click: extend — append a new point at the click location
        if ((e.ctrlKey || e.metaKey) && self.screenmap_pts.length > 0) {
            const newScreenmapPt = self.canvasToScreenmapCoords(cx, cy);
            const newRawPt = self.screenmapToRawCoords(newScreenmapPt[0], newScreenmapPt[1]);
            self.insertPointAt(self.screenmap_pts.length, newScreenmapPt, newRawPt);
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
                // ── Strip-drag snap precompute (issues #105, #110) ───
                // For every strip OTHER than the dragged one, emit center-
                // to-center targets (#105, k=0) AND ±k·pitch targets for
                // k ∈ {1, 2, 3} (#110, bricklayer snap). Pitch is the
                // median LED-to-LED distance in the neighbor strip.
                // Rotation is already folded into `screenmap_pts`.
                const { xTargets, yTargets } = computeStripSnapTargets(
                    self._si().strips, hitStripIdx, self.screenmap_pts,
                );
                self.stripSnapXTargets = xTargets;
                self.stripSnapYTargets = yTargets;
                // Dragged strip's starting center (rotation-aware: mean of
                // its already-transformed `screenmap_pts`).
                let cx0 = 0, cy0 = 0, cn0 = 0;
                for (let k = strip.offset; k < strip.offset + strip.count; k++) {
                    const p = self.screenmap_pts[k];
                    if (!p) continue;
                    cx0 += p[0]; cy0 += p[1]; cn0++;
                }
                self.stripSnapStartCenter = cn0 > 0
                    ? { x: cx0 / cn0, y: cy0 / cn0 }
                    : null;
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
