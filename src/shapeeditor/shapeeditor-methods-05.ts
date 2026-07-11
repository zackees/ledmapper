// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 5/8).

import { ShapeEditor } from './shapeeditor-class';

import { getStripColors, stripStartEndLabels } from '../common';
import { gfxColors, withAlpha } from '../ui/theme';

import type { GizmoHandle } from './shapeeditor-types';

ShapeEditor.prototype.drawOverlay = function (this: ShapeEditor) {
    const self = this;

        if (!self.overlayCtx) return;
        self.overlayCtx.clearRect(0, 0, self.canvasW, self.canvasH);

        // Lerp overlayAlpha: 1 = rainbow visible (default), 0 = faded out (hovering inside bbox)
        const target = self.isHovering ? 0 : 1;
        const speed = 1 / (0.2 * 60); // step per frame for 0.2s
        if (self.overlayAlpha < target) self.overlayAlpha = Math.min(target, self.overlayAlpha + speed);
        else if (self.overlayAlpha > target) self.overlayAlpha = Math.max(target, self.overlayAlpha - speed);

        // Compute background image bounding box
        if (self.bgImageMesh && self.bgImageFitW > 0) {
            const s = parseFloat(self.dom_txt_image_scale.value) || 1;
            const deg = parseFloat(self.dom_txt_image_rotate.value) || 0;
            const rad = deg * Math.PI / 180;
            const bgCos = Math.cos(rad);
            const bgSin = Math.sin(rad);
            const imgTx = parseFloat(self.dom_txt_image_tx.value) || 0;
            const imgTy = parseFloat(self.dom_txt_image_ty.value) || 0;
            const [bgCx, bgCy] = self.toCanvasCoords(imgTx, imgTy);
            const bgHw = self.bgImageFitW / 2 * s * self.camZoom;
            const bgHh = self.bgImageFitH / 2 * s * self.camZoom;
            self.bgImageBBox = { cx: bgCx, cy: bgCy, hw: bgHw, hh: bgHh, cos: bgCos, sin: bgSin };
        } else {
            self.bgImageBBox = null;
        }

        if (self.lastTransformedPts.length === 0) { self.ptsBBox = null; self.drawBgGizmoHandles(); self.drawRuler(); self._drawPlacingGhost(); self._drawPasteGhost(); return; }

        const pts = self.lastTransformedPts.map(([x, y]: [number, number]) => self.toCanvasCoords(x, y));

        // Compute an oriented bounding box (OBB) that stays fixed as rotation changes.
        // We find the bbox of the *scaled-only* points (before rotation), then rotate
        // that rectangle so it tracks the content without growing/shrinking.
        const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
        const scaleX = (parseFloat(self.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const scaleY = (parseFloat(self.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(self.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const bboxCos = Math.cos(rotateRad);
        const bboxSin = Math.sin(rotateRad);
        const tx = parseFloat(self.dom_txt_translate_x.value) || 0;
        const ty = parseFloat(self.dom_txt_translate_y.value) || 0;

        // Bbox of scaled-only points (no rotation, no translation)
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const [x, y] of self.screenmap_pts) {
            const sx = x * scaleX;
            const sy = y * scaleY;
            if (sx < bx1) bx1 = sx;
            if (sy < by1) by1 = sy;
            if (sx > bx2) bx2 = sx;
            if (sy > by2) by2 = sy;
        }
        const pad = 20 / self.camZoom; // pad in world space
        bx1 -= pad; by1 -= pad; bx2 += pad; by2 += pad;

        // Center of the unrotated bbox in world space, then rotate + translate
        const wcx = (bx1 + bx2) / 2;
        const wcy = (by1 + by2) / 2;
        const rwcx = wcx * bboxCos - wcy * bboxSin + tx;
        const rwcy = wcx * bboxSin + wcy * bboxCos + ty;

        // Half-extents in world space, scaled to canvas pixels
        const hw = (bx2 - bx1) / 2 * self.camZoom;
        const hh = (by2 - by1) / 2 * self.camZoom;

        // Center in canvas coords
        const [ccx, ccy] = self.toCanvasCoords(rwcx, rwcy);

        self.ptsBBox = { cx: ccx, cy: ccy, hw, hh, cos: bboxCos, sin: bboxSin };

        // Draw oriented bounding box outline
        if (self.gizmoHover === 'translate' || self.gizmoActive === 'translate') {
            self.overlayCtx.globalAlpha = self.gizmoActive === 'translate' ? 0.8 : 0.5;
            self.overlayCtx.strokeStyle = gfxColors.accentBlue();
        } else {
            self.overlayCtx.globalAlpha = 0.3;
            self.overlayCtx.strokeStyle = gfxColors.textMuted();
        }
        self.overlayCtx.lineWidth = 1;
        self.overlayCtx.setLineDash([6, 4]);
        self.overlayCtx.save();
        self.overlayCtx.translate(ccx, ccy);
        self.overlayCtx.rotate(rotateRad);
        self.overlayCtx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        self.overlayCtx.restore();
        self.overlayCtx.setLineDash([]);

        // Draw gizmo handles (scale, rotate, translate affordances)
        self.drawGizmoHandles();

        // Issue #111: during a gizmo drag, the cached `pts` are at the
        // drag-start transform. Apply the live delta as a ctx affine and
        // draw a stripped-down overlay — full rendering returns on commit.
        if (self._isGizmoDragPreview()) {
            self._drawGizmoPreviewOverlay(pts);
            self.drawBgGizmoHandles();
            self.drawRuler();
            self._drawSnapGuides();
            self._drawStripRotateHandle();
            self._drawMarqueeRect();
            self._drawPlacingGhost();
            self._drawPasteGhost();
            return;
        }

        // Rainbow lines and arrows fade with hover
        if (self.overlayAlpha > 0) {
            self.overlayCtx.globalAlpha = self.overlayAlpha;
            self.overlayCtx.lineWidth = 2;
            const hasMultiStrip = self.stripInfo && self.stripInfo.strips.length > 1;
            const stripColors = hasMultiStrip ? getStripColors(self._si().strips.length) : null;
            // Build a set of boundary indices (last point of each non-empty strip) to skip
            // cross-strip lines, plus a precomputed index→strip lookup table.
            const stripBoundaries = new Set();
            let idxToStrip = null;
            if (hasMultiStrip) {
                for (const strip of self._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                idxToStrip = new Int32Array(pts.length).fill(-1);
                for (let s = 0; s < self._si().strips.length; s++) {
                    const st = self.nn(self._si().strips[s]);
                    const lo = Math.max(0, st.offset);
                    const hi = Math.min(pts.length, st.offset + st.count);
                    for (let i = lo; i < hi; i++) idxToStrip[i] = s;
                }
            }
            for (let i = 0; i < pts.length - 1; i++) {
                // Skip line between last point of one strip and first point of the next
                if (hasMultiStrip && stripBoundaries.has(i)) continue;

                const [x1, y1] = self.nn(pts[i]);
                const [x2, y2] = self.nn(pts[i + 1]);
                if (hasMultiStrip) {
                    const rawIdx = idxToStrip?.[i] ?? 0;
                    const stripIdx = rawIdx >= 0 ? rawIdx : 0;
                    self.overlayCtx.strokeStyle = stripColors?.[stripIdx] ?? gfxColors.textStrong();
                } else {
                    const hue = (120 + i * 2) % 360;
                    self.overlayCtx.strokeStyle = `hsl(${String(hue)}, 100%, 50%)`;
                }
                self.overlayCtx.beginPath();
                self.overlayCtx.moveTo(x1, y1);
                self.overlayCtx.lineTo(x2, y2);
                self.overlayCtx.stroke();

                if (i % 5 === 1 || i === pts.length - 2) {
                    const dx = x2 - x1, dy = y2 - y1;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 2) {
                        const angle = Math.atan2(dy, dx);
                        const t = 0.5;
                        const ax = x1 + dx * t, ay = y1 + dy * t;
                        const arrowLen = 12;
                        const arrowHalf = 0.45;
                        self.overlayCtx.fillStyle = self.overlayCtx.strokeStyle;
                        self.overlayCtx.beginPath();
                        self.overlayCtx.moveTo(ax, ay);
                        self.overlayCtx.lineTo(ax - arrowLen * Math.cos(angle - arrowHalf), ay - arrowLen * Math.sin(angle - arrowHalf));
                        self.overlayCtx.lineTo(ax - arrowLen * Math.cos(angle + arrowHalf), ay - arrowLen * Math.sin(angle + arrowHalf));
                        self.overlayCtx.closePath();
                        self.overlayCtx.fill();
                    }
                }
            }
            for (let i = 2; i < pts.length - 1; i++) {
                self.fillCircle(self.nn(pts[i])[0], self.nn(pts[i])[1], 4, withAlpha(gfxColors.textStrong(), 0.5));
            }
        }

        // Highlighted edge for "insert between"
        if (self.highlightedEdgeIdx >= 0 && self.highlightedEdgeIdx < pts.length - 1) {
            self.overlayCtx.globalAlpha = 1;
            self.overlayCtx.strokeStyle = gfxColors.accentCyan();
            self.overlayCtx.lineWidth = 4;
            self.overlayCtx.beginPath();
            self.overlayCtx.moveTo(self.nn(pts[self.highlightedEdgeIdx])[0], self.nn(pts[self.highlightedEdgeIdx])[1]);
            self.overlayCtx.lineTo(self.nn(pts[self.highlightedEdgeIdx + 1])[0], self.nn(pts[self.highlightedEdgeIdx + 1])[1]);
            self.overlayCtx.stroke();
            // Midpoint marker
            const mx = (self.nn(pts[self.highlightedEdgeIdx])[0] + self.nn(pts[self.highlightedEdgeIdx + 1])[0]) / 2;
            const my = (self.nn(pts[self.highlightedEdgeIdx])[1] + self.nn(pts[self.highlightedEdgeIdx + 1])[1]) / 2;
            self.overlayCtx.fillStyle = gfxColors.accentCyan();
            self.overlayCtx.beginPath();
            self.overlayCtx.arc(mx, my, 5, 0, Math.PI * 2);
            self.overlayCtx.fill();
        }

        // Chain-order arrows: from each strip's LAST LED to next strip's FIRST LED.
        if ((self.showChainArrows || self.editorMode === 'chain') && self.stripInfo && self.stripInfo.strips.length > 1) {
            self.drawChainArrows(pts);
        } else {
            self._chainGeom.connectors.length = 0;
            self._chainGeom.starts.length = 0;
            self._chainGeom.ends.length = 0;
            self._chainGeom.crossBadges.length = 0;
        }
        self._drawChainDragGhost();

        // Start and end LEDs always visible (per strip when multi-strip).
        // Labels go through the layout engine so 16+ strip maps stay readable:
        // anchor dot at the LED, displaced label box, leader line when far.
        self.overlayCtx.globalAlpha = 1;
        const hasMultiStripLabels = self.stripInfo && self.stripInfo.strips.length > 1;
        const labelItems = [];
        const START_COLOR = gfxColors.ledStart();
        const END_COLOR = gfxColors.ledEnd();
        if (hasMultiStripLabels) {
            for (let s = 0; s < self._si().strips.length; s++) {
                const st = self.nn(self._si().strips[s]);
                if (st.count <= 0) continue;
                const startIdx = st.offset;
                const endIdx = st.offset + st.count - 1;
                if (startIdx < 0 || endIdx >= pts.length) continue;
                const labels = stripStartEndLabels(st, s);
                labelItems.push({ id: `start:${String(s)}`, text: labels.start, anchorX: self.nn(pts[startIdx])[0], anchorY: self.nn(pts[startIdx])[1], color: START_COLOR, dotRadius: 4 });
                if (labels.end !== null) {
                    labelItems.push({ id: `end:${String(s)}`, text: labels.end, anchorX: self.nn(pts[endIdx])[0], anchorY: self.nn(pts[endIdx])[1], color: END_COLOR, dotRadius: 4 });
                }
            }
        } else {
            if (pts.length > 1) self.fillCircle(self.nn(pts[1])[0], self.nn(pts[1])[1], 6, withAlpha(gfxColors.ledStart(), 0.5));
            const singleStrip = (self.stripInfo?.strips.length === 1)
                ? { name: self.stripInfo.strips[0]?.name ?? '', count: pts.length }
                : { name: '', count: pts.length };
            const labels = stripStartEndLabels(singleStrip, 0);
            labelItems.push({ id: 'start:0', text: labels.start, anchorX: self.nn(pts[0])[0], anchorY: self.nn(pts[0])[1], color: START_COLOR, dotRadius: 4 });
            if (labels.end !== null) {
                labelItems.push({ id: 'end:0', text: labels.end, anchorX: self.nn(pts[pts.length - 1])[0], anchorY: self.nn(pts[pts.length - 1])[1], color: END_COLOR, dotRadius: 4 });
            }
        }
        self.labelRenderer.draw(self.overlayCtx, labelItems, {
            font: 'bold 13px "Outfit", system-ui, sans-serif',
            textColor: gfxColors.textStrong(),
            bounds: { x: 0, y: 0, w: self.canvasW, h: self.canvasH },
            obstacles: () => pts.map(([x, y]: [number, number]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });

        // Strip selection bounding box (axis-aligned in canvas space)
        const selStripIdx = self.selection.getStripIdx();
        if (selStripIdx !== null && self.stripInfo && selStripIdx < self.stripInfo.strips.length) {
            const st = self.nn(self.stripInfo.strips[selStripIdx]);
            if (st.count > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const lo = Math.max(0, st.offset);
                const hi = Math.min(pts.length, st.offset + st.count);
                for (let i = lo; i < hi; i++) {
                    const [px, py] = self.nn(pts[i]);
                    if (px < minX) minX = px;
                    if (py < minY) minY = py;
                    if (px > maxX) maxX = px;
                    if (py > maxY) maxY = py;
                }
                if (isFinite(minX)) {
                    const pad = 10;
                    self.overlayCtx.globalAlpha = 0.9;
                    self.overlayCtx.strokeStyle = gfxColors.accentBlue();
                    self.overlayCtx.lineWidth = 2;
                    self.overlayCtx.setLineDash([6, 4]);
                    self.overlayCtx.strokeRect(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
                    self.overlayCtx.setLineDash([]);
                }
            }
        }

        // Selection indicator
        if (self.selectedIdx >= 0 && self.selectedIdx < pts.length) {
            const [sx, sy] = self.nn(pts[self.selectedIdx]);
            self.overlayCtx.globalAlpha = 1;
            self.overlayCtx.strokeStyle = gfxColors.accentCyan();
            self.overlayCtx.lineWidth = 2;
            self.overlayCtx.beginPath();
            self.overlayCtx.arc(sx, sy, 10, 0, Math.PI * 2);
            self.overlayCtx.stroke();
            // Pulsing inner glow
            self.overlayCtx.strokeStyle = withAlpha(gfxColors.accentCyan(), 0.4);
            self.overlayCtx.lineWidth = 4;
            self.overlayCtx.beginPath();
            self.overlayCtx.arc(sx, sy, 14, 0, Math.PI * 2);
            self.overlayCtx.stroke();
        }

        self.drawBgGizmoHandles();
        self.drawRuler();
        self._drawSnapGuides();
        self._drawStripRotateHandle();
        self._drawMarqueeRect();
        self._drawPlacingGhost();
        self._drawPasteGhost();
    };

/**
 * Snap-line guides shown while a strip drag is in progress.
 *
 * While dragging, EVERY candidate target line (every other strip's
 * center on each axis) is drawn faintly so the user can see all
 * available snap points (issue #107). The line the dragged strip is
 * currently snapped to (if any) is promoted to deep red 80% opacity.
 *
 * Rotated strips snap correctly because each strip's center is the
 * mean of its already-transformed `screenmap_pts`, which reflects
 * any rotation (issue #105).
 */
ShapeEditor.prototype._drawSnapGuides = function (this: ShapeEditor) {
    const self = this;
    if (!self.overlayCtx) return;
    // Only draw the candidates while a strip drag is in flight. Outside a
    // drag there are no targets to show.
    if (!self.stripDragActive) return;
    if (self.stripSnapXTargets.length === 0 && self.stripSnapYTargets.length === 0) return;
    const ctx = self.overlayCtx;
    const INACTIVE = withAlpha(gfxColors.accentRed(), 0.18);  // greyed red
    const ACTIVE   = withAlpha(gfxColors.accentRed(), 0.80);  // deep red, 80% opacity
    ctx.save();
    ctx.setLineDash([6, 4]);
    for (const tx of self.stripSnapXTargets) {
        const isActive = tx === self.stripSnapEngagedX;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        const [cx] = self.toCanvasCoords(tx, 0);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, self.canvasH);
        ctx.stroke();
    }
    for (const ty of self.stripSnapYTargets) {
        const isActive = ty === self.stripSnapEngagedY;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        const [, cy] = self.toCanvasCoords(0, ty);
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(self.canvasW, cy);
        ctx.stroke();
    }
    ctx.restore();
};

ShapeEditor.prototype.fillCircle = function (this: ShapeEditor, x: number, y: number, diameter: number, color: string) {
    const self = this;

        self._octx().fillStyle = color;
        self._octx().beginPath();
        self._octx().arc(x, y, diameter / 2, 0, Math.PI * 2);
        self._octx().fill();
    };

ShapeEditor.prototype.obbToCanvas = function (this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number }, lx: number, ly: number) {

        const { cx, cy, cos, sin } = bbox;
        return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    };

ShapeEditor.prototype.computeGizmoHandles = function (this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number; hw: number; hh: number } | null | undefined) {
    const self = this;

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
                tl: self.obbToCanvas(bbox, -hw, -hh),
                tr: self.obbToCanvas(bbox, hw, -hh),
                bl: self.obbToCanvas(bbox, -hw, hh),
                br: self.obbToCanvas(bbox, hw, hh),
            },
            edges: {
                top:    self.obbToCanvas(bbox, 0, -hh),
                bottom: self.obbToCanvas(bbox, 0, hh),
                left:   self.obbToCanvas(bbox, -hw, 0),
                right:  self.obbToCanvas(bbox, hw, 0),
            },
            rotate: self.obbToCanvas(bbox, 0, -hh - rotLineLen),
            center: { x: bbox.cx, y: bbox.cy },
        };
    };

ShapeEditor.prototype.canvasToObbLocal = function (this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number } | null | undefined, canvasX: number, canvasY: number): [number, number] {

        if (!bbox) return [0, 0];
        const dx = canvasX - bbox.cx;
        const dy = canvasY - bbox.cy;
        // Inverse rotation
        return [dx * bbox.cos + dy * bbox.sin,
               -dx * bbox.sin + dy * bbox.cos];
    };

ShapeEditor.prototype.hitTestGizmo = function (this: ShapeEditor, canvasX: number, canvasY: number): string | null {
    const self = this;

        const handles = self.computeGizmoHandles(self.ptsBBox);
        if (!handles) return null;
        const threshold = 14;

        // Rotation handle (above bbox)
        const rh = handles.rotate;
        if (Math.abs(canvasX - rh.x) < threshold && Math.abs(canvasY - rh.y) < threshold) return 'rotate';

        // Corner handles
        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'corner-' + key;
        }

        // Edge midpoint handles
        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'edge-' + key;
        }

        return null;
    };

ShapeEditor.prototype.getCursorForGizmo = function (this: ShapeEditor, handleId: string | null) {

        if (!handleId) return 'default';
        if (handleId === 'rotate') return 'grab';
        if (handleId === 'translate') return 'move';
        if (handleId === 'edge-top' || handleId === 'edge-bottom') return 'ns-resize';
        if (handleId === 'edge-left' || handleId === 'edge-right') return 'ew-resize';
        if (handleId === 'corner-tl' || handleId === 'corner-br') return 'nwse-resize';
        if (handleId === 'corner-tr' || handleId === 'corner-bl') return 'nesw-resize';
        return 'default';
    };

ShapeEditor.prototype.drawGizmoHandles = function (this: ShapeEditor) {
    const self = this;

        const handles = self.computeGizmoHandles(self.ptsBBox);
        if (!handles) return;

        // Hide handles if bbox is too small on screen (very zoomed out)
        if (handles.hw < 8 || handles.hh < 8) return;

        // Fade in as rainbow fades out (inverse of overlayAlpha)
        const gizmoAlpha = 1 - self.overlayAlpha;
        if (gizmoAlpha < 0.01) return;

        if (!self.ptsBBox) return;
        const rotRad = Math.atan2(self.ptsBBox.sin, self.ptsBBox.cos);

        self._octx().save();
        self._octx().globalAlpha = gizmoAlpha;

        // Draw rotation connecting line (dashed)
        const topCenter = handles.edges.top;
        self._octx().strokeStyle = gfxColors.accentBlue();
        self._octx().lineWidth = 1;
        self._octx().setLineDash([4, 3]);
        self._octx().beginPath();
        self._octx().moveTo(topCenter.x, topCenter.y);
        self._octx().lineTo(handles.rotate.x, handles.rotate.y);
        self._octx().stroke();
        self._octx().setLineDash([]);

        // Draw rotation handle (arc with arrowhead)
        const isRotHover = self.gizmoHover === 'rotate' || self.gizmoActive === 'rotate';
        const rotColor = isRotHover ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
        const rx: number = handles.rotate.x;
        const ry: number = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        const arcStart = -Math.PI * 1.25;
        const arcEnd = Math.PI * 0.05;

        // Arc stroke
        self._octx().strokeStyle = rotColor;
        self._octx().lineWidth = 2;
        self._octx().beginPath();
        self._octx().arc(rx, ry, arcR, arcStart, arcEnd);
        self._octx().stroke();

        // Arrowhead at arc end
        const ax = rx + arcR * Math.cos(arcEnd);
        const ay = ry + arcR * Math.sin(arcEnd);
        const tangent = arcEnd + Math.PI / 2; // tangent direction (perpendicular to radius)
        const arrowLen = 5;
        const arrowHalf = 0.55;
        self._octx().fillStyle = rotColor;
        self._octx().beginPath();
        self._octx().moveTo(ax, ay);
        self._octx().lineTo(ax - arrowLen * Math.cos(tangent - arrowHalf), ay - arrowLen * Math.sin(tangent - arrowHalf));
        self._octx().lineTo(ax - arrowLen * Math.cos(tangent + arrowHalf), ay - arrowLen * Math.sin(tangent + arrowHalf));
        self._octx().closePath();
        self._octx().fill();

        // Helper: draw a rotated rect centered at (h.x, h.y)
        function drawHandle(h: GizmoHandle, w: number, ht: number, color: string) {
            self._octx().save();
            self._octx().translate(h.x, h.y);
            self._octx().rotate(rotRad);
            self._octx().fillStyle = color;
            self._octx().fillRect(-w / 2, -ht / 2, w, ht);
            self._octx().strokeStyle = gfxColors.textStrong();
            self._octx().lineWidth = 1;
            self._octx().strokeRect(-w / 2, -ht / 2, w, ht);
            self._octx().restore();
        }

        // Draw corner handles (squares)
        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            const id = 'corner-' + key;
            const active = self.gizmoHover === id || self.gizmoActive === id;
            const size = active ? 12 : 10;
            const color = active ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
            drawHandle(h, size, size, color);
        }

        // Draw edge handles (oriented rectangles)
        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            const id = 'edge-' + key;
            const active = self.gizmoHover === id || self.gizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            const color = active ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
            drawHandle(h, w, ht, color);
        }

        self._octx().restore();
    };

ShapeEditor.prototype.hitTestLED = function (this: ShapeEditor, canvasX: number, canvasY: number) {
    const self = this;

        if (self.lastTransformedPts.length === 0) return -1;
        const threshold = 10;
        const threshSq = threshold * threshold;
        let bestIdx = -1, bestDist = threshSq;
        let bestStripIdx = -1;
        const selectedStripIdx = self.selection.getStripIdx();
        const strips = self.stripInfo?.strips ?? [{ offset: 0, count: self.lastTransformedPts.length }];
        for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
            const strip = strips[stripIdx];
            if (!strip) continue;
            const start = Math.max(0, strip.offset);
            const end = Math.min(self.lastTransformedPts.length, strip.offset + strip.count);
            for (let i = start; i < end; i++) {
                const [cx, cy] = self.toCanvasCoords(self.nn(self.lastTransformedPts[i])[0], self.nn(self.lastTransformedPts[i])[1]);
                const dx = canvasX - cx;
                const dy = canvasY - cy;
                const d = dx * dx + dy * dy;
                const tied = Math.abs(d - bestDist) < 0.01;
                const selectedWinsTie = tied && stripIdx === selectedStripIdx && bestStripIdx !== selectedStripIdx;
                const topmostWinsTie = tied && stripIdx > bestStripIdx && bestStripIdx !== selectedStripIdx;
                if (d < bestDist - 0.01 || selectedWinsTie || topmostWinsTie) {
                    bestDist = d;
                    bestIdx = i;
                    bestStripIdx = stripIdx;
                }
            }
        }
        return bestIdx;
    };

ShapeEditor.prototype.hitTestBgGizmo = function (this: ShapeEditor, canvasX: number, canvasY: number) {
    const self = this;

        if (!self.bgImageBBox) return null;
        const handles = self.computeGizmoHandles(self.bgImageBBox);
        if (!handles) return null;
        const threshold = 14;

        const rh = handles.rotate;
        if (Math.abs(canvasX - rh.x) < threshold && Math.abs(canvasY - rh.y) < threshold) return 'rotate';

        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'corner-' + key;
        }

        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            if (Math.abs(canvasX - h.x) < threshold && Math.abs(canvasY - h.y) < threshold) return 'edge-' + key;
        }

        const [lx, ly] = self.canvasToObbLocal(self.bgImageBBox, canvasX, canvasY);
        if (Math.abs(lx) <= handles.hw && Math.abs(ly) <= handles.hh) {
            return 'translate';
        }

        return null;
    };

ShapeEditor.prototype.drawBgGizmoHandles = function (this: ShapeEditor) {
    const self = this;

        if (!self.bgImageBBox || !self.overlayCtx) return;
        const handles = self.computeGizmoHandles(self.bgImageBBox);
        if (!handles) return;
        if (handles.hw < 8 || handles.hh < 8) return;

        const rotRad = Math.atan2(self.bgImageBBox.sin, self.bgImageBBox.cos);

        self.overlayCtx.save();

        // Draw oriented bounding box outline
        const isTranslating = self.bgGizmoHover === 'translate' || self.bgGizmoActive === 'translate';
        if (isTranslating) {
            self.overlayCtx.globalAlpha = self.bgGizmoActive === 'translate' ? 0.8 : 0.5;
            self.overlayCtx.strokeStyle = gfxColors.accentAmber();
        } else {
            self.overlayCtx.globalAlpha = 0.3;
            self.overlayCtx.strokeStyle = gfxColors.textMuted();
        }
        self.overlayCtx.lineWidth = 1;
        self.overlayCtx.setLineDash([6, 4]);
        self.overlayCtx.save();
        self.overlayCtx.translate(self.bgImageBBox.cx, self.bgImageBBox.cy);
        self.overlayCtx.rotate(rotRad);
        self.overlayCtx.strokeRect(-handles.hw, -handles.hh, handles.hw * 2, handles.hh * 2);
        self.overlayCtx.restore();
        self.overlayCtx.setLineDash([]);

        self.overlayCtx.globalAlpha = 0.7;

        // Rotation connecting line
        const topCenter = handles.edges.top;
        self.overlayCtx.strokeStyle = gfxColors.accentAmber();
        self.overlayCtx.lineWidth = 1;
        self.overlayCtx.setLineDash([4, 3]);
        self.overlayCtx.beginPath();
        self.overlayCtx.moveTo(topCenter.x, topCenter.y);
        self.overlayCtx.lineTo(handles.rotate.x, handles.rotate.y);
        self.overlayCtx.stroke();
        self.overlayCtx.setLineDash([]);

        // Rotation handle
        const isRotHover = self.bgGizmoHover === 'rotate' || self.bgGizmoActive === 'rotate';
        const rotColor = isRotHover ? gfxColors.accentAmberHover() : gfxColors.accentAmber();
        const rx: number = handles.rotate.x, ry: number = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        self.overlayCtx.strokeStyle = rotColor;
        self.overlayCtx.lineWidth = 2;
        self.overlayCtx.beginPath();
        self.overlayCtx.arc(rx, ry, arcR, -Math.PI * 1.25, Math.PI * 0.05);
        self.overlayCtx.stroke();

        const ax = rx + arcR * Math.cos(Math.PI * 0.05);
        const ay = ry + arcR * Math.sin(Math.PI * 0.05);
        const tangent = Math.PI * 0.05 + Math.PI / 2;
        self.overlayCtx.fillStyle = rotColor;
        self.overlayCtx.beginPath();
        self.overlayCtx.moveTo(ax, ay);
        self.overlayCtx.lineTo(ax - 5 * Math.cos(tangent - 0.55), ay - 5 * Math.sin(tangent - 0.55));
        self.overlayCtx.lineTo(ax - 5 * Math.cos(tangent + 0.55), ay - 5 * Math.sin(tangent + 0.55));
        self.overlayCtx.closePath();
        self.overlayCtx.fill();

        // Corner and edge handles
        function drawHandle(h: GizmoHandle, w: number, ht: number, color: string) {
            self._octx().save();
            self._octx().translate(h.x, h.y);
            self._octx().rotate(rotRad);
            self._octx().fillStyle = color;
            self._octx().fillRect(-w / 2, -ht / 2, w, ht);
            self._octx().strokeStyle = gfxColors.textStrong();
            self._octx().lineWidth = 1;
            self._octx().strokeRect(-w / 2, -ht / 2, w, ht);
            self._octx().restore();
        }

        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            const id = 'corner-' + key;
            const active = self.bgGizmoHover === id || self.bgGizmoActive === id;
            const size = active ? 12 : 10;
            drawHandle(h, size, size, active ? gfxColors.accentAmberHover() : gfxColors.accentAmber());
        }

        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            const id = 'edge-' + key;
            const active = self.bgGizmoHover === id || self.bgGizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            drawHandle(h, w, ht, active ? gfxColors.accentAmberHover() : gfxColors.accentAmber());
        }

        self.overlayCtx.restore();
    };

ShapeEditor.prototype.handleBgGizmoDrag = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        if (!self.bgGizmoDragStart || !self.bgGizmoActive) return;
        const ds = self.bgGizmoDragStart;
        const dx = cx - ds.canvasX;
        const dy = cy - ds.canvasY;

        if (self.bgGizmoActive === 'translate') {
            const wdx = dx / self.camZoom;
            const wdy = dy / self.camZoom;
            const newTx = Math.round(ds.tx + wdx);
            const newTy = Math.round(ds.ty + wdy);
            self.dom_txt_image_tx.value = String(newTx);
            self.dom_txt_image_ty.value = String(newTy);
            self.applyBgImageTransform();
            return;
        }

        if (self.bgGizmoActive === 'rotate') {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startAngle = Math.atan2(
                ds.canvasY - center.y,
                ds.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = ds.rotate + deltaDeg;
            if (self.shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            newRotate = Math.max(-180, Math.min(180, newRotate));
            self.dom_txt_image_rotate.value = newRotate.toFixed(2);
            self.applyBgImageTransform();
            return;
        }

        // Corner or edge: uniform scale (image has single scale)
        if (self.bgGizmoActive.startsWith('corner-') || self.bgGizmoActive.startsWith('edge-')) {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startDist = Math.hypot(
                ds.canvasX - center.x,
                ds.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                const newScale = Math.max(0.1, Math.min(5, ds.scale * ratio));
                self.dom_txt_image_scale.value = newScale.toFixed(2);
                self.applyBgImageTransform();
            }
            return;
        }
    };

ShapeEditor.prototype.startBgGizmoDrag = function (this: ShapeEditor, hit: string, cx: number, cy: number) {
    const self = this;

        self.bgGizmoActive = hit;
        const handles = self.computeGizmoHandles(self.bgImageBBox);
        self.bgGizmoDragStart = {
            canvasX: cx, canvasY: cy,
            scale: parseFloat(self.dom_txt_image_scale.value) || 1,
            rotate: parseFloat(self.dom_txt_image_rotate.value) || 0,
            tx: parseFloat(self.dom_txt_image_tx.value) || 0,
            ty: parseFloat(self.dom_txt_image_ty.value) || 0,
            bboxCenter: handles ? handles.center : (self.bgImageBBox ? { x: self.bgImageBBox.cx, y: self.bgImageBBox.cy } : { x: 0, y: 0 }),
        };
    };

ShapeEditor.prototype.handleGizmoDrag = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        if (!self.gizmoDragStart || !self.gizmoActive) return;
        const ds = self.gizmoDragStart;
        const dx = cx - ds.canvasX;
        const dy = cy - ds.canvasY;

        if (self.gizmoActive === 'translate') {
            const wdx = dx / self.camZoom;
            const wdy = dy / self.camZoom;
            self.setTranslate(ds.translateX + wdx, ds.translateY + wdy);
            self.markDirty(); self.setNeedsRender();
            return;
        }

        if (self.gizmoActive === 'rotate') {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startAngle = Math.atan2(
                ds.canvasY - center.y,
                ds.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = ds.rotate + Math.round(deltaDeg);
            // Snap to 15-degree increments when shift held
            if (self.shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            self.setRotate(self.clampRotate(newRotate));
            self.markDirty(); self.setNeedsRender();
            return;
        }

        if (self.gizmoActive.startsWith('corner-')) {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startDist = Math.hypot(
                ds.canvasX - center.x,
                ds.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                self.writeScale(self.dom_txt_scale, self.clampScale(ds.scale * ratio));
                self.markDirty(); self.setNeedsRender();
            }
            return;
        }

        if (self.gizmoActive.startsWith('edge-')) {
            const edge = self.gizmoActive.split('-')[1] ?? '';
            // Project mouse positions onto OBB local axes for signed distance
            const [startLx, startLy] = self.canvasToObbLocal(self.ptsBBox, ds.canvasX, ds.canvasY);
            const [curLx, curLy] = self.canvasToObbLocal(self.ptsBBox, cx, cy);

            if (edge === 'left' || edge === 'right') {
                if (Math.abs(startLx) > 1) {
                    const ratio = curLx / startLx; // signed: crossing center negates
                    self.writeScale(self.dom_txt_scale_x, self.clampScale(ds.scaleX * ratio));
                    self.markDirty(); self.setNeedsRender();
                }
            } else {
                if (Math.abs(startLy) > 1) {
                    const ratio = curLy / startLy; // signed: crossing center negates
                    self.writeScale(self.dom_txt_scale_y, self.clampScale(ds.scaleY * ratio));
                    self.markDirty(); self.setNeedsRender();
                }
            }
            return;
        }
    };

ShapeEditor.prototype.commitGizmoDrag = function (this: ShapeEditor) {
    const self = this;

        if (!self.gizmoDragStart) return;
        const checks = [
            ['scale', self.gizmoDragStart.scale, self.getTransformValue('scale')],
            ['scaleX', self.gizmoDragStart.scaleX, self.getTransformValue('scaleX')],
            ['scaleY', self.gizmoDragStart.scaleY, self.getTransformValue('scaleY')],
            ['rotate', self.gizmoDragStart.rotate, self.getTransformValue('rotate')],
            ['translateX', self.gizmoDragStart.translateX, self.getTransformValue('translateX')],
            ['translateY', self.gizmoDragStart.translateY, self.getTransformValue('translateY')],
        ];
        for (const [control, oldVal, newVal] of checks) {
            if (oldVal !== newVal) {
                self.pushUndo({ type: 'transform', control, oldValue: oldVal, newValue: newVal });
                self.committedTransform[control as string] = newVal as number;
            }
        }
        // Bake the previewed transform into the geometry buffers on the next
        // frame. animate() will see _dragPreviewActive=true with gizmoActive
        // null and reset mesh transforms before the rebuild.
        self.setNeedsGeometryUpdate();
    };

// Dashed cyan rubber-band rectangle while a marquee selection is in flight.
// LEDs covered by the rectangle are already highlighted (the per-vertex
// cyan in the points mesh is updated eagerly during the drag), so this is
// purely a visual cue for "what you're selecting".
ShapeEditor.prototype._drawMarqueeRect = function (this: ShapeEditor) {
    const self = this;
    if (!self.marqueeActive || !self.overlayCtx) return;
    const ctx = self.overlayCtx;
    const x = Math.min(self.marqueeStartCx, self.marqueeCurCx);
    const y = Math.min(self.marqueeStartCy, self.marqueeCurCy);
    const w = Math.abs(self.marqueeCurCx - self.marqueeStartCx);
    const h = Math.abs(self.marqueeCurCy - self.marqueeStartCy);
    if (w < 1 && h < 1) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = withAlpha(gfxColors.accentCyan(), 0.10);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = gfxColors.accentCyan();
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.restore();
};

// Issue #111: scene-transform drag preview helpers.
//
// During a gizmo drag we leave the points-mesh / outline vertex buffers frozen
// at the values captured in `gizmoDragStart`, and express the live transform
// delta as a model matrix on the meshes plus a matching ctx affine on the 2D
// overlay. That makes a drag on a 64x64 grid as cheap as a camera pan.
ShapeEditor.prototype._isGizmoDragPreview = function (this: ShapeEditor): boolean {
    return this.gizmoActive !== null && this.gizmoDragStart !== null;
};

ShapeEditor.prototype._computeDragDelta = function (this: ShapeEditor) {
    const self = this;
    const ds = self.gizmoDragStart;
    if (!ds) return null;

    // Base effective transform (captured at drag start; matches what the
    // vertex buffer was baked with).
    const baseSX = ds.scale * ds.scaleX;
    const baseSY = ds.scale * ds.scaleY;
    const baseRot = ds.rotate * Math.PI / 180;
    const baseTX = ds.translateX;
    const baseTY = ds.translateY;

    // Current effective transform (live DOM values).
    const curScale = parseFloat(self.dom_txt_scale.value) || 1;
    const curSX = (parseFloat(self.dom_txt_scale_x.value) || 1) * curScale;
    const curSY = (parseFloat(self.dom_txt_scale_y.value) || 1) * curScale;
    const curRot = (parseInt(self.dom_txt_rotate.value) || 0) * Math.PI / 180;
    const curTX = parseFloat(self.dom_txt_translate_x.value) || 0;
    const curTY = parseFloat(self.dom_txt_translate_y.value) || 0;

    // Both transforms are T * R * S applied around the world origin, so the
    // delta D such that T_cur = D ∘ T_base decomposes as:
    //   rotation delta = curRot - baseRot
    //   scale delta    = (curSX/baseSX, curSY/baseSY)
    //   translate delta = curT - rotateScale(baseT)  (since baseT is moved by the rotate/scale of D)
    // We need D(baseT) = curT, so dtx = curT - D_rot_scale(baseT).
    const dRotRad = curRot - baseRot;
    const dsX = baseSX !== 0 ? curSX / baseSX : 1;
    const dsY = baseSY !== 0 ? curSY / baseSY : 1;
    const cosD = Math.cos(dRotRad);
    const sinD = Math.sin(dRotRad);
    // D applied to baseT: scale → rotate → (no translate yet)
    const baseTxRotated = baseTX * dsX * cosD - baseTY * dsY * sinD;
    const baseTyRotated = baseTX * dsX * sinD + baseTY * dsY * cosD;
    const dtx = curTX - baseTxRotated;
    const dty = curTY - baseTyRotated;
    return { dtx, dty, dRotRad, dsX, dsY };
};

ShapeEditor.prototype._applyDragPreviewMatrices = function (this: ShapeEditor) {
    const self = this;
    const delta = self._computeDragDelta();
    if (!delta) return;
    const { dtx, dty, dRotRad, dsX, dsY } = delta;
    if (self.pointsMesh) {
        self.pointsMesh.position.set(dtx, dty, 0);
        self.pointsMesh.rotation.set(0, 0, dRotRad);
        self.pointsMesh.scale.set(dsX, dsY, 1);
    }
    if (self.screenmapOutline) {
        self.screenmapOutline.position.set(dtx, dty, 0);
        self.screenmapOutline.rotation.set(0, 0, dRotRad);
        self.screenmapOutline.scale.set(dsX, dsY, 1);
    }
};

ShapeEditor.prototype._resetMeshTransforms = function (this: ShapeEditor) {
    const self = this;
    if (self.pointsMesh) {
        self.pointsMesh.position.set(0, 0, 0);
        self.pointsMesh.rotation.set(0, 0, 0);
        self.pointsMesh.scale.set(1, 1, 1);
    }
    if (self.screenmapOutline) {
        self.screenmapOutline.position.set(0, 0, 0);
        self.screenmapOutline.rotation.set(0, 0, 0);
        self.screenmapOutline.scale.set(1, 1, 1);
    }
};

// Cheap overlay pass used while a gizmo drag is in flight. Reuses cached
// `lastTransformedPts` (baked at drag-start values) and applies the world
// delta as a canvas-space affine, so all the per-point geometry follows the
// drag without any per-point recomputation.
//
// `pts` is `lastTransformedPts` already mapped to canvas via toCanvasCoords
// (so callers don't pay for that map twice).
ShapeEditor.prototype._drawGizmoPreviewOverlay = function (this: ShapeEditor, pts: [number, number][]) {
    const self = this;
    const ctx = self.overlayCtx;
    if (!ctx) return;
    if (pts.length === 0) return;
    const delta = self._computeDragDelta();
    if (!delta) return;
    const { dtx, dty, dRotRad, dsX, dsY } = delta;

    // Canvas-space delta affine = M_wc ∘ M_world_delta ∘ M_wc^-1, where
    // M_wc maps world to canvas: c = w * camZoom + offset.
    // offset = (canvasW/2 + camPanX*camZoom, canvasH/2 + camPanY*camZoom).
    const ox = self.camPanX * self.camZoom + self.canvasW / 2;
    const oy = self.camPanY * self.camZoom + self.canvasH / 2;
    const cosD = Math.cos(dRotRad);
    const sinD = Math.sin(dRotRad);
    const a = dsX * cosD;
    const b = dsX * sinD;
    const c = -dsY * sinD;
    const d = dsY * cosD;
    const e = -a * ox - c * oy + dtx * self.camZoom + ox;
    const f = -b * ox - d * oy + dty * self.camZoom + oy;
    const txPt = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];

    // One batched stroke for the entire trace (rainbow + arrows + interior
    // dots are skipped — they return on commit). Cheap even for 4096 points.
    if (self.overlayAlpha > 0) {
        const hasMultiStrip = self.stripInfo && self.stripInfo.strips.length > 1;
        const stripBoundaries = new Set<number>();
        if (hasMultiStrip) {
            for (const strip of self._si().strips) {
                if (strip.count > 0) stripBoundaries.add(strip.offset + strip.count - 1);
            }
        }
        ctx.globalAlpha = self.overlayAlpha * 0.55;
        ctx.strokeStyle = gfxColors.textMuted();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let penDown = false;
        for (let i = 0; i < pts.length - 1; i++) {
            if (hasMultiStrip && stripBoundaries.has(i)) { penDown = false; continue; }
            const [x1, y1] = self.nn(pts[i]);
            const [x2, y2] = self.nn(pts[i + 1]);
            const [tx1, ty1] = txPt(x1, y1);
            const [tx2, ty2] = txPt(x2, y2);
            if (!penDown) { ctx.moveTo(tx1, ty1); penDown = true; }
            ctx.lineTo(tx2, ty2);
        }
        ctx.stroke();
    }

    // Highlighted edge (insert-between affordance) — keep it visible.
    if (self.highlightedEdgeIdx >= 0 && self.highlightedEdgeIdx < pts.length - 1) {
        const [x1, y1] = self.nn(pts[self.highlightedEdgeIdx]);
        const [x2, y2] = self.nn(pts[self.highlightedEdgeIdx + 1]);
        const [tx1, ty1] = txPt(x1, y1);
        const [tx2, ty2] = txPt(x2, y2);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gfxColors.accentCyan();
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(tx1, ty1);
        ctx.lineTo(tx2, ty2);
        ctx.stroke();
    }

    // Selected-LED ring tracks the drag, but stays 10px in canvas space.
    if (self.selectedIdx >= 0 && self.selectedIdx < pts.length) {
        const [sx, sy] = self.nn(pts[self.selectedIdx]);
        const [tsx, tsy] = txPt(sx, sy);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gfxColors.accentCyan();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tsx, tsy, 10, 0, Math.PI * 2);
        ctx.stroke();
    }
};

/**
 * Axis-aligned screenmap-pts bbox of the currently selected strip's LEDs.
 * Returns null if no strip is selected, the strip is empty, or the
 * screenmap_pts array doesn't include its range.
 */
ShapeEditor.prototype._selectedStripBboxCanvas = function (this: ShapeEditor) {
    const self = this;
    const idx = self.selection.getStripIdx();
    if (idx === null || !self.stripInfo || idx >= self.stripInfo.strips.length) return null;
    const st = self.nn(self.stripInfo.strips[idx]);
    if (st.count <= 0) return null;
    const lo = Math.max(0, st.offset);
    const hi = Math.min(self.screenmap_pts.length, st.offset + st.count);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = lo; i < hi; i++) {
        const [px, py] = self.nn(self.screenmap_pts[i]);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
    }
    if (!isFinite(minX)) return null;
    return { idx, minX, minY, maxX, maxY };
};

/**
 * Canvas-pixel position of the per-strip rotation handle: 30px above the
 * selected strip's bbox top-center (matching the whole-screenmap gizmo's
 * 30px rotation arm). The handle itself is drawn in `_drawStripRotateHandle`.
 */
ShapeEditor.prototype._stripRotateHandlePos = function (this: ShapeEditor) {
    const self = this;
    const bb = self._selectedStripBboxCanvas();
    if (!bb) return null;
    const pad = 10;
    const armLen = 30;
    return {
        idx: bb.idx,
        anchorX: (bb.minX + bb.maxX) / 2,
        anchorY: bb.minY - pad,
        handleX: (bb.minX + bb.maxX) / 2,
        handleY: bb.minY - pad - armLen,
    };
};

/** Hit-test the per-strip rotation handle. Returns true within 14px. */
ShapeEditor.prototype.hitTestStripRotateHandle = function (this: ShapeEditor, canvasX: number, canvasY: number): boolean {
    const self = this;
    const h = self._stripRotateHandlePos();
    if (!h) return false;
    return Math.abs(canvasX - h.handleX) < 14 && Math.abs(canvasY - h.handleY) < 14;
};

/**
 * Draw the per-strip rotate handle (purple to distinguish from the blue
 * whole-screenmap gizmo). Visible only when a strip is selected. Style
 * mirrors `drawGizmoHandles`: dashed connector line + arc with arrowhead.
 */
ShapeEditor.prototype._drawStripRotateHandle = function (this: ShapeEditor) {
    const self = this;
    if (!self.overlayCtx) return;
    const h = self._stripRotateHandlePos();
    if (!h) return;
    const ctx = self.overlayCtx;
    const isActive = self.stripRotateActive || self.stripRotateHover;
    const color = isActive ? gfxColors.accentPurpleHover() : gfxColors.accentPurple(); // tailwind purple-400 / purple-500
    ctx.save();
    ctx.globalAlpha = 0.95;
    // Dashed connector
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(h.anchorX, h.anchorY);
    ctx.lineTo(h.handleX, h.handleY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arc with arrowhead
    const arcR = isActive ? 9 : 7;
    const arcStart = -Math.PI * 1.25;
    const arcEnd = Math.PI * 0.05;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(h.handleX, h.handleY, arcR, arcStart, arcEnd);
    ctx.stroke();
    const ax = h.handleX + arcR * Math.cos(arcEnd);
    const ay = h.handleY + arcR * Math.sin(arcEnd);
    const tangent = arcEnd + Math.PI / 2;
    const arrowLen = 5;
    const arrowHalf = 0.55;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - arrowLen * Math.cos(tangent - arrowHalf), ay - arrowLen * Math.sin(tangent - arrowHalf));
    ctx.lineTo(ax - arrowLen * Math.cos(tangent + arrowHalf), ay - arrowLen * Math.sin(tangent + arrowHalf));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
};
