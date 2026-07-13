// Named ShapeEditor method bundle: overlay.
import type { ShapeEditor } from './shapeeditor-class';
import { safeStorage } from "../services/storage";
import { getStripColors, stripStartEndLabels } from "../common";
import { gfxColors, withAlpha } from "../ui/theme";
import { computeDirectionArrowPlacements, directionArrowAnchorsFromPlacements, projectDirectionArrowAnchors } from "./direction-arrows";

export interface EditorOverlayMethods {
    drawOverlay: () => void;
    fillCircle: (x: number, y: number, diameter: number, color: string) => void;
    _drawMarqueeRect: () => void;
    _setOverlayCollapsed: (collapsed: boolean) => void;
    _drawSnapGuides: () => void;
    _drawStripRotateHandle: () => void;
    _stripRotateHandlePos: () => { idx: number; anchorX: number; anchorY: number; handleX: number; handleY: number } | null;
    _selectedStripBboxCanvas: () => { idx: number; minX: number; minY: number; maxX: number; maxY: number } | null;
    hitTestStripRotateHandle: (canvasX: number, canvasY: number) => boolean;
}

export const editorOverlayMethods: EditorOverlayMethods & ThisType<ShapeEditor> = {
    _setOverlayCollapsed(this: ShapeEditor, collapsed: boolean): void{
    this.overlayCollapsed = collapsed;
    this.dom_transform_overlay.classList.toggle('collapsed', collapsed);
    this.dom_btn_overlay_collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    safeStorage.set('shapeeditor.overlayCollapsed', collapsed ? '1' : '0');
},
    drawOverlay(this: ShapeEditor){

        if (!this.overlayCtx) return;
        this.overlayCtx.clearRect(0, 0, this.canvasW, this.canvasH);

        // Hover progress drives independent path, arrow, and gizmo opacity.
        const target = this.isHovering ? 1 : 0;
        const speed = 1 / (0.2 * 60); // step per frame for 0.2s
        if (this.overlayAlpha < target) this.overlayAlpha = Math.min(target, this.overlayAlpha + speed);
        else if (this.overlayAlpha > target) this.overlayAlpha = Math.max(target, this.overlayAlpha - speed);

        // Compute background image bounding box
        if (this.bgImageMesh && this.bgImageFitW > 0) {
            const s = parseFloat(this.dom_txt_image_scale.value) || 1;
            const deg = parseFloat(this.dom_txt_image_rotate.value) || 0;
            const rad = deg * Math.PI / 180;
            const bgCos = Math.cos(rad);
            const bgSin = Math.sin(rad);
            const imgTx = parseFloat(this.dom_txt_image_tx.value) || 0;
            const imgTy = parseFloat(this.dom_txt_image_ty.value) || 0;
            const [bgCx, bgCy] = this.toCanvasCoords(imgTx, imgTy);
            const bgHw = this.bgImageFitW / 2 * s * this.camZoom;
            const bgHh = this.bgImageFitH / 2 * s * this.camZoom;
            this.bgImageBBox = { cx: bgCx, cy: bgCy, hw: bgHw, hh: bgHh, cos: bgCos, sin: bgSin };
        } else {
            this.bgImageBBox = null;
        }

        if (this.lastTransformedPts.length === 0) {
            this.ptsBBox = null;
            this.directionArrowCount = 0;
            this.directionArrowLayers = [];
            this.directionArrowTransition.reset();
            this.directionArrowTransitionPhase = 'idle';
            this.drawBgGizmoHandles();
            this.drawRuler();
            this._drawPlacingGhost();
            this._drawPasteGhost();
            return;
        }

        const pts = this.lastTransformedPts.map(([x, y]: [number, number]) => this.toCanvasCoords(x, y));

        // Compute an oriented bounding box (OBB) that stays fixed as rotation changes.
        // We find the bbox of the *scaled-only* points (before rotation), then rotate
        // that rectangle so it tracks the content without growing/shrinking.
        const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
        const scaleX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const scaleY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(this.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const bboxCos = Math.cos(rotateRad);
        const bboxSin = Math.sin(rotateRad);
        const tx = parseFloat(this.dom_txt_translate_x.value) || 0;
        const ty = parseFloat(this.dom_txt_translate_y.value) || 0;

        // Bbox of scaled-only points (no rotation, no translation)
        let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
        for (const [x, y] of this.screenmap_pts) {
            const sx = x * scaleX;
            const sy = y * scaleY;
            if (sx < bx1) bx1 = sx;
            if (sy < by1) by1 = sy;
            if (sx > bx2) bx2 = sx;
            if (sy > by2) by2 = sy;
        }
        const pad = 20 / this.camZoom; // pad in world space
        bx1 -= pad; by1 -= pad; bx2 += pad; by2 += pad;

        // Center of the unrotated bbox in world space, then rotate + translate
        const wcx = (bx1 + bx2) / 2;
        const wcy = (by1 + by2) / 2;
        const rwcx = wcx * bboxCos - wcy * bboxSin + tx;
        const rwcy = wcx * bboxSin + wcy * bboxCos + ty;

        // Half-extents in world space, scaled to canvas pixels
        const hw = (bx2 - bx1) / 2 * this.camZoom;
        const hh = (by2 - by1) / 2 * this.camZoom;

        // Center in canvas coords
        const [ccx, ccy] = this.toCanvasCoords(rwcx, rwcy);

        this.ptsBBox = { cx: ccx, cy: ccy, hw, hh, cos: bboxCos, sin: bboxSin };

        // Draw oriented bounding box outline
        if (this.gizmoHover === 'translate' || this.gizmoActive === 'translate') {
            this.overlayCtx.globalAlpha = this.gizmoActive === 'translate' ? 0.8 : 0.5;
            this.overlayCtx.strokeStyle = gfxColors.accentBlue();
        } else {
            this.overlayCtx.globalAlpha = 0.3;
            this.overlayCtx.strokeStyle = gfxColors.textMuted();
        }
        this.overlayCtx.lineWidth = 1;
        this.overlayCtx.setLineDash([6, 4]);
        this.overlayCtx.save();
        this.overlayCtx.translate(ccx, ccy);
        this.overlayCtx.rotate(rotateRad);
        this.overlayCtx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        this.overlayCtx.restore();
        this.overlayCtx.setLineDash([]);

        // Draw gizmo handles (scale, rotate, translate affordances)
        this.drawGizmoHandles();

        // Issue #111: during a gizmo drag, the cached `pts` are at the
        // drag-start transform. Apply the live delta as a ctx affine and
        // draw a stripped-down overlay — full rendering returns on commit.
        if (this._isGizmoDragPreview()) {
            this._drawGizmoPreviewOverlay(pts);
            this.drawBgGizmoHandles();
            this.drawRuler();
            this._drawSnapGuides();
            this._drawStripRotateHandle();
            this._drawMarqueeRect();
            this._drawPlacingGhost();
            this._drawPasteGhost();
            return;
        }

        // Paths stay visible at rest; arrowheads use the independent hover
        // progress below and are absent until the pointer enters the map.
        {
            const pathAlpha = 0.35 + this.overlayAlpha * 0.3;
            this.overlayCtx.globalAlpha = pathAlpha;
            this.overlayCtx.lineWidth = 2;
            const hasMultiStrip = this.stripInfo && this.stripInfo.strips.length > 1;
            const stripColors = hasMultiStrip ? getStripColors(this._si().strips.length) : null;
            // Build a set of boundary indices (last point of each non-empty strip) to skip
            // cross-strip lines, plus a precomputed index→strip lookup table.
            const stripBoundaries = new Set<number>();
            let idxToStrip: Int32Array | null = null;
            if (hasMultiStrip) {
                for (const strip of this._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                idxToStrip = new Int32Array(pts.length).fill(-1);
                for (let s = 0; s < this._si().strips.length; s++) {
                    const st = this.nn(this._si().strips[s]);
                    const lo = Math.max(0, st.offset);
                    const hi = Math.min(pts.length, st.offset + st.count);
                    for (let i = lo; i < hi; i++) idxToStrip[i] = s;
                }
            }
            for (let i = 0; i < pts.length - 1; i++) {
                // Skip line between last point of one strip and first point of the next
                if (hasMultiStrip && stripBoundaries.has(i)) continue;

                const [x1, y1] = this.nn(pts[i]);
                const [x2, y2] = this.nn(pts[i + 1]);
                if (hasMultiStrip) {
                    const rawIdx = idxToStrip?.[i] ?? 0;
                    const stripIdx = rawIdx >= 0 ? rawIdx : 0;
                    this.overlayCtx.strokeStyle = stripColors?.[stripIdx] ?? gfxColors.textStrong();
                } else {
                    const hue = (120 + i * 2) % 360;
                    this.overlayCtx.strokeStyle = `hsl(${String(hue)}, 100%, 50%)`;
                }
                this.overlayCtx.beginPath();
                this.overlayCtx.moveTo(x1, y1);
                this.overlayCtx.lineTo(x2, y2);
                this.overlayCtx.stroke();

            }
            for (let i = 2; i < pts.length - 1; i++) {
                this.fillCircle(this.nn(pts[i])[0], this.nn(pts[i])[1], 4, withAlpha(gfxColors.textStrong(), 0.5));
            }

            const arrowStrips = hasMultiStrip
                ? this._si().strips.map((strip) => ({ offset: strip.offset, count: strip.count }))
                : [{ offset: 0, count: pts.length }];
            const adaptivePlacements = computeDirectionArrowPlacements(pts, arrowStrips);
            const adaptiveAnchors = directionArrowAnchorsFromPlacements(adaptivePlacements);
            const arrowLayers = this.directionArrowTransition.update(
                adaptiveAnchors,
                performance.now(),
                this.geometryDirty,
            );
            this.directionArrowLayers = arrowLayers.map((layer) => ({
                count: layer.anchors.length,
                opacity: layer.opacity,
            }));
            this.directionArrowTransitionPhase = this.directionArrowTransition.getPhase();
            const primaryLayer = arrowLayers.reduce((best, layer) => (
                !best || layer.opacity > best.opacity ? layer : best
            ), arrowLayers[0]);
            this.directionArrowCount = primaryLayer?.anchors.length ?? 0;
            if (this.overlayAlpha > 0) {
                const arrowLen = 12;
                const arrowHalf = 0.45;
                for (const layer of arrowLayers) {
                    this.overlayCtx.globalAlpha = this.overlayAlpha * layer.opacity;
                    for (const arrow of projectDirectionArrowAnchors(pts, layer.anchors)) {
                        this.overlayCtx.fillStyle = hasMultiStrip
                            ? stripColors?.[arrow.stripIndex] ?? gfxColors.textStrong()
                            : `hsl(${String((120 + arrow.segmentIndex * 2) % 360)}, 100%, 50%)`;
                        this.overlayCtx.beginPath();
                        this.overlayCtx.moveTo(arrow.x, arrow.y);
                        this.overlayCtx.lineTo(arrow.x - arrowLen * Math.cos(arrow.angle - arrowHalf), arrow.y - arrowLen * Math.sin(arrow.angle - arrowHalf));
                        this.overlayCtx.lineTo(arrow.x - arrowLen * Math.cos(arrow.angle + arrowHalf), arrow.y - arrowLen * Math.sin(arrow.angle + arrowHalf));
                        this.overlayCtx.closePath();
                        this.overlayCtx.fill();
                    }
                }
            }
        }

        // Highlighted edge for "insert between"
        if (this.highlightedEdgeIdx >= 0 && this.highlightedEdgeIdx < pts.length - 1) {
            this.overlayCtx.globalAlpha = 1;
            this.overlayCtx.strokeStyle = gfxColors.accentCyan();
            this.overlayCtx.lineWidth = 4;
            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(this.nn(pts[this.highlightedEdgeIdx])[0], this.nn(pts[this.highlightedEdgeIdx])[1]);
            this.overlayCtx.lineTo(this.nn(pts[this.highlightedEdgeIdx + 1])[0], this.nn(pts[this.highlightedEdgeIdx + 1])[1]);
            this.overlayCtx.stroke();
            // Midpoint marker
            const mx = (this.nn(pts[this.highlightedEdgeIdx])[0] + this.nn(pts[this.highlightedEdgeIdx + 1])[0]) / 2;
            const my = (this.nn(pts[this.highlightedEdgeIdx])[1] + this.nn(pts[this.highlightedEdgeIdx + 1])[1]) / 2;
            this.overlayCtx.fillStyle = gfxColors.accentCyan();
            this.overlayCtx.beginPath();
            this.overlayCtx.arc(mx, my, 5, 0, Math.PI * 2);
            this.overlayCtx.fill();
        }

        // Chain-order arrows: from each strip's LAST LED to next strip's FIRST LED.
        if ((this.showChainArrows || this.editorMode === 'chain') && this.stripInfo && this.stripInfo.strips.length > 1) {
            this.drawChainArrows(pts);
        } else {
            this._chainGeom.connectors.length = 0;
            this._chainGeom.starts.length = 0;
            this._chainGeom.ends.length = 0;
            this._chainGeom.crossBadges.length = 0;
        }
        this._drawChainDragGhost();

        // Start and end LEDs always visible (per strip when multi-strip).
        // Labels go through the layout engine so 16+ strip maps stay readable:
        // anchor dot at the LED, displaced label box, leader line when far.
        this.overlayCtx.globalAlpha = 1;
        const hasMultiStripLabels = this.stripInfo && this.stripInfo.strips.length > 1;
        const labelItems = [];
        const START_COLOR = gfxColors.ledStart();
        const END_COLOR = gfxColors.ledEnd();
        if (hasMultiStripLabels) {
            for (let s = 0; s < this._si().strips.length; s++) {
                const st = this.nn(this._si().strips[s]);
                if (st.count <= 0) continue;
                const startIdx = st.offset;
                const endIdx = st.offset + st.count - 1;
                if (startIdx < 0 || endIdx >= pts.length) continue;
                const labels = stripStartEndLabels(st, s);
                labelItems.push({ id: `start:${String(s)}`, text: labels.start, anchorX: this.nn(pts[startIdx])[0], anchorY: this.nn(pts[startIdx])[1], color: START_COLOR, dotRadius: 4 });
                if (labels.end !== null) {
                    labelItems.push({ id: `end:${String(s)}`, text: labels.end, anchorX: this.nn(pts[endIdx])[0], anchorY: this.nn(pts[endIdx])[1], color: END_COLOR, dotRadius: 4 });
                }
            }
        } else {
            if (pts.length > 1) this.fillCircle(this.nn(pts[1])[0], this.nn(pts[1])[1], 6, withAlpha(gfxColors.ledStart(), 0.5));
            const singleStrip = (this.stripInfo?.strips.length === 1)
                ? { name: this.stripInfo.strips[0]?.name ?? '', count: pts.length }
                : { name: '', count: pts.length };
            const labels = stripStartEndLabels(singleStrip, 0);
            labelItems.push({ id: 'start:0', text: labels.start, anchorX: this.nn(pts[0])[0], anchorY: this.nn(pts[0])[1], color: START_COLOR, dotRadius: 4 });
            if (labels.end !== null) {
                labelItems.push({ id: 'end:0', text: labels.end, anchorX: this.nn(pts[pts.length - 1])[0], anchorY: this.nn(pts[pts.length - 1])[1], color: END_COLOR, dotRadius: 4 });
            }
        }
        this.labelRenderer.draw(this.overlayCtx, labelItems, {
            font: 'bold 13px "Outfit", system-ui, sans-serif',
            textColor: gfxColors.textStrong(),
            bounds: { x: 0, y: 0, w: this.canvasW, h: this.canvasH },
            obstacles: () => pts.map(([x, y]: [number, number]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });

        // Strip selection bounding box (axis-aligned in canvas space)
        const selStripIdx = this.selection.getStripIdx();
        if (selStripIdx !== null && this.stripInfo && selStripIdx < this.stripInfo.strips.length) {
            const st = this.nn(this.stripInfo.strips[selStripIdx]);
            if (st.count > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const lo = Math.max(0, st.offset);
                const hi = Math.min(pts.length, st.offset + st.count);
                for (let i = lo; i < hi; i++) {
                    const [px, py] = this.nn(pts[i]);
                    if (px < minX) minX = px;
                    if (py < minY) minY = py;
                    if (px > maxX) maxX = px;
                    if (py > maxY) maxY = py;
                }
                if (isFinite(minX)) {
                    const pad = 10;
                    this.overlayCtx.globalAlpha = 0.9;
                    this.overlayCtx.strokeStyle = gfxColors.accentBlue();
                    this.overlayCtx.lineWidth = 2;
                    this.overlayCtx.setLineDash([6, 4]);
                    this.overlayCtx.strokeRect(minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2);
                    this.overlayCtx.setLineDash([]);
                }
            }
        }

        // Selection indicator
        if (this.selectedIdx >= 0 && this.selectedIdx < pts.length) {
            const [sx, sy] = this.nn(pts[this.selectedIdx]);
            this.overlayCtx.globalAlpha = 1;
            this.overlayCtx.strokeStyle = gfxColors.accentCyan();
            this.overlayCtx.lineWidth = 2;
            this.overlayCtx.beginPath();
            this.overlayCtx.arc(sx, sy, 10, 0, Math.PI * 2);
            this.overlayCtx.stroke();
            // Pulsing inner glow
            this.overlayCtx.strokeStyle = withAlpha(gfxColors.accentCyan(), 0.4);
            this.overlayCtx.lineWidth = 4;
            this.overlayCtx.beginPath();
            this.overlayCtx.arc(sx, sy, 14, 0, Math.PI * 2);
            this.overlayCtx.stroke();
        }

        this.drawBgGizmoHandles();
        this.drawRuler();
        this._drawSnapGuides();
        this._drawStripRotateHandle();
        this._drawMarqueeRect();
        this._drawPlacingGhost();
        this._drawPasteGhost();
    },
    _drawSnapGuides(this: ShapeEditor){
    if (!this.overlayCtx) return;
    // Only draw the candidates while a strip drag is in flight. Outside a
    // drag there are no targets to show.
    if (!this.stripDragActive) return;
    if (this.stripSnapXTargets.length === 0 && this.stripSnapYTargets.length === 0) return;
    const ctx = this.overlayCtx;
    const INACTIVE = withAlpha(gfxColors.accentRed(), 0.18);  // greyed red
    const ACTIVE   = withAlpha(gfxColors.accentRed(), 0.80);  // deep red, 80% opacity
    ctx.save();
    ctx.setLineDash([6, 4]);
    for (const tx of this.stripSnapXTargets) {
        const isActive = tx === this.stripSnapEngagedX;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        const [cx] = this.toCanvasCoords(tx, 0);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, this.canvasH);
        ctx.stroke();
    }
    for (const ty of this.stripSnapYTargets) {
        const isActive = ty === this.stripSnapEngagedY;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        const [, cy] = this.toCanvasCoords(0, ty);
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(this.canvasW, cy);
        ctx.stroke();
    }
    ctx.restore();
},
    fillCircle(this: ShapeEditor, x: number, y: number, diameter: number, color: string){

        this._octx().fillStyle = color;
        this._octx().beginPath();
        this._octx().arc(x, y, diameter / 2, 0, Math.PI * 2);
        this._octx().fill();
    },
    _drawMarqueeRect(this: ShapeEditor){
    if (!this.marqueeActive || !this.overlayCtx) return;
    const ctx = this.overlayCtx;
    const x = Math.min(this.marqueeStartCx, this.marqueeCurCx);
    const y = Math.min(this.marqueeStartCy, this.marqueeCurCy);
    const w = Math.abs(this.marqueeCurCx - this.marqueeStartCx);
    const h = Math.abs(this.marqueeCurCy - this.marqueeStartCy);
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
},
    _selectedStripBboxCanvas(this: ShapeEditor){
    const idx = this.selection.getStripIdx();
    if (idx === null || !this.stripInfo || idx >= this.stripInfo.strips.length) return null;
    const st = this.nn(this.stripInfo.strips[idx]);
    if (st.count <= 0) return null;
    const lo = Math.max(0, st.offset);
    const hi = Math.min(this.screenmap_pts.length, st.offset + st.count);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = lo; i < hi; i++) {
        const [px, py] = this.nn(this.screenmap_pts[i]);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
    }
    if (!isFinite(minX)) return null;
    return { idx, minX, minY, maxX, maxY };
},
    _stripRotateHandlePos(this: ShapeEditor){
    const bb = this._selectedStripBboxCanvas();
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
},
    hitTestStripRotateHandle(this: ShapeEditor, canvasX: number, canvasY: number): boolean{
    const h = this._stripRotateHandlePos();
    if (!h) return false;
    return Math.abs(canvasX - h.handleX) < 14 && Math.abs(canvasY - h.handleY) < 14;
},
    _drawStripRotateHandle(this: ShapeEditor){
    if (!this.overlayCtx) return;
    const h = this._stripRotateHandlePos();
    if (!h) return;
    const ctx = this.overlayCtx;
    const isActive = this.stripRotateActive || this.stripRotateHover;
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
},
};`n