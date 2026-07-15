// Named ShapeEditor method bundle: overlay.
import type { ShapeEditor } from './shapeeditor-class';
import { safeStorage } from "../services/storage";
import { getStripColors, stripStartEndLabels } from "../common";
import { gfxColors, withAlpha } from "../ui/theme";
import { computeDirectionArrowPlacements, directionArrowAnchorsFromPlacements, projectDirectionArrowAnchors } from "./direction-arrows";
import { minimumAreaObb, rotateOrientedBox, rotationHandleFromObb, type RotationHandlePosition } from "./strip-rotate";
import { groupFocusOpacity } from "./selection-focus";

export interface EditorOverlayMethods {
    drawOverlay: () => void;
    fillCircle: (x: number, y: number, diameter: number, color: string) => void;
    _drawMarqueeRect: () => void;
    _setOverlayCollapsed: (collapsed: boolean) => void;
    _drawSnapGuides: () => void;
    _drawStripRotateHandle: () => void;
    _stripRotateVisualGeometry: () => { obb: SelectedStripObb; handle: RotationHandlePosition & { centerX: number; centerY: number } } | null;
    _stripRotateHandlePos: () => { idx: number; anchorX: number; anchorY: number; handleX: number; handleY: number; centerX: number; centerY: number } | null;
    _selectedStripObbCanvas: () => { idx: number; cx: number; cy: number; cos: number; sin: number; hw: number; hh: number } | null;
    hitTestStripRotateHandle: (canvasX: number, canvasY: number) => boolean;
}

type SelectedStripObb = NonNullable<ReturnType<EditorOverlayMethods['_selectedStripObbCanvas']>>;

/** Draw an upright, local mode label without covering a nearby LED or rotate handle. */
function drawPointEditBadge(
    ctx: CanvasRenderingContext2D,
    obb: SelectedStripObb,
    canvasW: number,
    canvasH: number,
    points: readonly [number, number][],
    rotateHandle: ReturnType<EditorOverlayMethods['_stripRotateHandlePos']>,
): void {
    const title = 'EDIT LED MODE';
    const subtitle = 'Drag LEDs individually · Esc to exit';
    const margin = 8;
    const paddingX = 10;
    const paddingY = 7;
    const titleLineH = 14;
    const subtitleLineH = 13;

    const corner = (u: number, v: number) => ({
        x: obb.cx + u * obb.cos - v * obb.sin,
        y: obb.cy + u * obb.sin + v * obb.cos,
    });
    const corners = [corner(-obb.hw, -obb.hh), corner(obb.hw, -obb.hh), corner(obb.hw, obb.hh), corner(-obb.hw, obb.hh)];
    const minX = Math.min(...corners.map((point) => point.x));
    const maxX = Math.max(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const maxY = Math.max(...corners.map((point) => point.y));

    ctx.save();
    ctx.font = '700 12px "Outfit", system-ui, sans-serif';
    const titleW = ctx.measureText(title).width;
    ctx.font = '12px "Outfit", system-ui, sans-serif';
    const subtitleW = ctx.measureText(subtitle).width;
    const badgeW = Math.max(titleW, subtitleW) + paddingX * 2;
    const badgeH = paddingY * 2 + titleLineH + subtitleLineH + 2;
    // The dedicated rotation handle sits above the OBB, so reserve its arm
    // before considering the preferred visual-top placement.
    const handleClearance = rotateHandle ? 46 : 12;
    const candidates = [
        { x: obb.cx - badgeW / 2, y: minY - badgeH - handleClearance },
        { x: obb.cx - badgeW / 2, y: maxY + 12 },
        { x: maxX + 12, y: obb.cy - badgeH / 2 },
        { x: minX - badgeW - 12, y: obb.cy - badgeH / 2 },
    ];
    const fits = (candidate: { x: number; y: number }) => (
        candidate.x >= margin && candidate.y >= margin
        && candidate.x + badgeW <= canvasW - margin && candidate.y + badgeH <= canvasH - margin
    );
    const hidesAffordance = (candidate: { x: number; y: number }) => {
        const contains = (x: number, y: number, radius: number) => (
            x + radius >= candidate.x && x - radius <= candidate.x + badgeW
            && y + radius >= candidate.y && y - radius <= candidate.y + badgeH
        );
        return points.some(([x, y]) => contains(x, y, 10))
            || (rotateHandle !== null && contains(rotateHandle.handleX, rotateHandle.handleY, 12));
    };
    const chosen = candidates.find((candidate) => fits(candidate) && !hidesAffordance(candidate))
        ?? candidates.find(fits)
        ?? {
            x: Math.max(margin, Math.min(canvasW - badgeW - margin, obb.cx - badgeW / 2)),
            y: Math.max(margin, Math.min(canvasH - badgeH - margin, maxY + 12)),
        };

    ctx.globalAlpha = 0.98;
    ctx.fillStyle = gfxColors.bgPopoverStrong();
    ctx.fillRect(chosen.x, chosen.y, badgeW, badgeH);
    ctx.strokeStyle = gfxColors.accentRed();
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(chosen.x, chosen.y, badgeW, badgeH);
    ctx.fillStyle = gfxColors.accentRed();
    ctx.font = '700 12px "Outfit", system-ui, sans-serif';
    ctx.fillText(title, chosen.x + paddingX, chosen.y + paddingY + titleLineH - 2);
    ctx.fillStyle = gfxColors.textStrong();
    ctx.font = '12px "Outfit", system-ui, sans-serif';
    ctx.fillText(subtitle, chosen.x + paddingX, chosen.y + paddingY + titleLineH + subtitleLineH);
    ctx.restore();
}

export const editorOverlayMethods: EditorOverlayMethods & ThisType<ShapeEditor> = {
    _setOverlayCollapsed(this: ShapeEditor, collapsed: boolean): void{
    this.overlayCollapsed = collapsed;
    this.dom_transform_overlay.classList.toggle('collapsed', collapsed);
    const expanded = collapsed ? 'false' : 'true';
    this.dom_btn_overlay_collapse.setAttribute('aria-expanded', expanded);
    this.dom_btn_overlay_expand.setAttribute('aria-expanded', expanded);
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

        // Draw the whole-screenmap transform outline. Point-edit mode applies
        // to a selected strip below, not this global transform affordance.
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
            const selectedStripIdx = this.selection.getStripIdx();
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
                    this.overlayCtx.globalAlpha = pathAlpha * groupFocusOpacity(selectedStripIdx, stripIdx);
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
                const rawIdx = idxToStrip?.[i] ?? 0;
                const stripIdx = rawIdx >= 0 ? rawIdx : 0;
                this.overlayCtx.globalAlpha = groupFocusOpacity(selectedStripIdx, stripIdx);
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
                    for (const arrow of projectDirectionArrowAnchors(pts, layer.anchors)) {
                        this.overlayCtx.globalAlpha = this.overlayAlpha * layer.opacity * groupFocusOpacity(selectedStripIdx, arrow.stripIndex);
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
                const opacity = groupFocusOpacity(this.selection.getStripIdx(), s);
                labelItems.push({ id: `start:${String(s)}`, text: labels.start, anchorX: this.nn(pts[startIdx])[0], anchorY: this.nn(pts[startIdx])[1], color: START_COLOR, dotRadius: 4, opacity });
                if (labels.end !== null) {
                    labelItems.push({ id: `end:${String(s)}`, text: labels.end, anchorX: this.nn(pts[endIdx])[0], anchorY: this.nn(pts[endIdx])[1], color: END_COLOR, dotRadius: 4, opacity });
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

        // The selection box and rotation handle must share projected canvas
        // geometry so the affordance stays attached during pan and zoom.
        const selectedObb = this._selectedStripObbCanvas();
        if (selectedObb) {
            const { cx, cy, cos, sin, hw, hh } = selectedObb;
            const corner = (u: number, v: number) => ({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos });
            const corners = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
            const isPointEditing = this.pointEditStripIdx === selectedObb.idx;
            this.overlayCtx.globalAlpha = 0.9;
            this.overlayCtx.strokeStyle = isPointEditing ? gfxColors.accentRed() : gfxColors.accentBlue();
            this.overlayCtx.lineWidth = isPointEditing ? 3 : 2;
            this.overlayCtx.setLineDash(isPointEditing ? [] : [6, 4]);
            this.overlayCtx.beginPath();
            const firstCorner = corners[0] ?? { x: cx, y: cy };
            this.overlayCtx.moveTo(firstCorner.x, firstCorner.y);
            for (const point of corners.slice(1)) this.overlayCtx.lineTo(point.x, point.y);
            this.overlayCtx.closePath();
            this.overlayCtx.stroke();
            this.overlayCtx.setLineDash([]);
            if (isPointEditing) {
                drawPointEditBadge(
                    this.overlayCtx,
                    selectedObb,
                    this.canvasW,
                    this.canvasH,
                    pts,
                    this._stripRotateHandlePos(),
                );
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
    if (this.stripSnapTargets.x.length === 0
        && this.stripSnapTargets.y.length === 0
        && this.stripSnapTargets.rulerBodies.length === 0) return;
    const ctx = this.overlayCtx;
    const INACTIVE = withAlpha(gfxColors.accentRed(), 0.18);  // greyed red
    const ACTIVE   = withAlpha(gfxColors.accentRed(), 0.80);  // deep red, 80% opacity
    ctx.save();
    ctx.setLineDash([6, 4]);
    const activeX = this.stripSnapEngagement.mode === 'axis'
        ? this.stripSnapEngagement.x?.targetId ?? null
        : null;
    const activeY = this.stripSnapEngagement.mode === 'axis'
        ? this.stripSnapEngagement.y?.targetId ?? null
        : null;
    const activeBody = this.stripSnapEngagement.mode === 'ruler-body'
        ? this.stripSnapEngagement.targetId
        : null;
    for (const target of this.stripSnapTargets.x) {
        const [cx] = this.toCanvasCoords(target.value, 0);
        if (cx < -32 || cx > this.canvasW + 32) continue;
        const isActive = target.id === activeX;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, this.canvasH);
        ctx.stroke();
    }
    for (const target of this.stripSnapTargets.y) {
        const [, cy] = this.toCanvasCoords(0, target.value);
        if (cy < -32 || cy > this.canvasH + 32) continue;
        const isActive = target.id === activeY;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(this.canvasW, cy);
        ctx.stroke();
    }
    for (const target of this.stripSnapTargets.rulerBodies) {
        const [ax, ay] = this.toCanvasCoords(target.ax, target.ay);
        const [bx, by] = this.toCanvasCoords(target.bx, target.by);
        const isActive = target.id === activeBody;
        ctx.strokeStyle = isActive ? ACTIVE : INACTIVE;
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
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
    _selectedStripObbCanvas(this: ShapeEditor){
        const idx = this.selection.getStripIdx();
        if (idx === null || !this.stripInfo || idx >= this.stripInfo.strips.length) return null;
        if (this.stripRotateActive && this.stripRotateObbSnapshot?.idx === idx) {
            const rotated = rotateOrientedBox(
                this.stripRotateObbSnapshot,
                this.stripRotateLastDeg * Math.PI / 180,
            );
            return { ...rotated, idx };
        }
        const st = this.nn(this.stripInfo.strips[idx]);
    if (st.count <= 0) return null;
    const lo = Math.max(0, st.offset);
    const hi = Math.min(this.lastTransformedPts.length, st.offset + st.count);
    const canvasPts: [number, number][] = [];
    for (let i = lo; i < hi; i++) {
        const [worldX, worldY] = this.nn(this.lastTransformedPts[i]);
        const [px, py] = this.toCanvasCoords(worldX, worldY);
        canvasPts.push([px, py]);
    }
        const obb = minimumAreaObb(canvasPts);
        return obb ? { idx, ...obb } : null;
    },
    _stripRotateVisualGeometry(this: ShapeEditor){
        const box = this._selectedStripObbCanvas();
        if (!box) return null;
        const handle = rotationHandleFromObb(box);
        return { obb: box, handle: { ...handle, centerX: box.cx, centerY: box.cy } };
    },
    _stripRotateHandlePos(this: ShapeEditor){
    const visual = this._stripRotateVisualGeometry();
    if (!visual) return null;
    return { idx: visual.obb.idx, ...visual.handle };
},
    hitTestStripRotateHandle(this: ShapeEditor, canvasX: number, canvasY: number): boolean{
    const h = this._stripRotateHandlePos();
    if (!h) return false;
    return Math.abs(canvasX - h.handleX) <= 22 && Math.abs(canvasY - h.handleY) <= 22;
},
    _drawStripRotateHandle(this: ShapeEditor){
    if (!this.overlayCtx) return;
    const visual = this._stripRotateVisualGeometry();
    if (!visual) {
        this.stripRotateLastDrawnVisual = null;
        return;
    }
    const h = { idx: visual.obb.idx, ...visual.handle };
    this.stripRotateLastDrawnVisual = { obb: { ...visual.obb }, handle: { ...h } };
    this.stripRotateDrawRevision++;
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
    if (this.stripRotateActive) {
        ctx.fillStyle = gfxColors.textStrong();
        ctx.font = '12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${String(this.stripRotateLastDeg)} deg`, h.handleX + 14, h.handleY);
    }
    ctx.restore();
},
};
