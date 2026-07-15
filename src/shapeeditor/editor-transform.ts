// Named ShapeEditor method bundle: transform.
import type { ShapeEditor } from './shapeeditor-class';
import { gfxColors } from "../ui/theme";
import type { GizmoHandle } from "./shapeeditor-types";

interface FitViewport {
    width: number;
    height: number;
    centerOffsetX: number;
    centerOffsetY: number;
    excludedLeft: number;
}

export interface EditorTransformMethods {
    resetTransforms: () => void;
    clampScale: (v: number | string) => number;
    writeScale: (txt: HTMLInputElement, val: number | string) => void;
    clampRotate: (v: number | string) => number;
    setRotate: (rawVal: number | string) => void;
    clampTranslate: (v: number | string) => number;
    setTranslate: (x: number | string, y: number | string) => void;
    wireTransformUndo: (controlName: string, ...elements: HTMLInputElement[]) => void;
    applyInteractiveZoom: (zoom: number) => boolean;
    getTransformValue: (control: string) => number;
    setTransformValue: (control: string, value: number) => void;
    getCanvasSize: () => { width: number; height: number };
    getFitViewport: () => FitViewport;
    getFitSize: () => { width: number; height: number };
    getCurrentTransform: () => { sX: number; sY: number; cosR: number; sinR: number; tx: number; ty: number };
    canvasDeltaToScreenmapDelta: (dx: number, dy: number) => [number, number];
    getCanvasCoords: (e: { clientX: number; clientY: number }) => [number, number];
    toCanvasCoords: (x: number, y: number) => [number, number];
    obbToCanvas: (bbox: { cx: number; cy: number; cos: number; sin: number }, lx: number, ly: number) => { x: number; y: number };
    computeGizmoHandles: (bbox: { cx: number; cy: number; cos: number; sin: number; hw: number; hh: number } | null | undefined) => { hw: number; hh: number; corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } }; edges: { top: { x: number; y: number }; bottom: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } }; rotate: { x: number; y: number }; center: { x: number; y: number } } | null;
    canvasToObbLocal: (bbox: { cx: number; cy: number; cos: number; sin: number } | null | undefined, canvasX: number, canvasY: number) => [number, number];
    hitTestGizmo: (canvasX: number, canvasY: number) => string | null;
    getCursorForGizmo: (handleId: string | null) => string;
    drawGizmoHandles: () => void;
    handleGizmoDrag: (cx: number, cy: number) => void;
    commitGizmoDrag: () => void;
    _isGizmoDragPreview: () => boolean;
    _computeDragDelta: () => { dtx: number; dty: number; dRotRad: number; dsX: number; dsY: number } | null;
    _applyDragPreviewMatrices: () => void;
    _resetMeshTransforms: () => void;
    _drawGizmoPreviewOverlay: (pts: [number, number][]) => void;
}

export const editorTransformMethods: EditorTransformMethods & ThisType<ShapeEditor> = {
    resetTransforms(this: ShapeEditor){

        this.writeScale(this.dom_txt_scale, 1);
        this.writeScale(this.dom_txt_scale_x, 1);
        this.writeScale(this.dom_txt_scale_y, 1);
        this.setRotate(0);
        this.setTranslate(0, 0);
        this.dom_txt_diameter.value = String(this.origDiameter);
        this.committedTransform.scale = 1;
        this.committedTransform.scaleX = 1;
        this.committedTransform.scaleY = 1;
        this.committedTransform.rotate = 0;
        this.committedTransform.translateX = 0;
        this.committedTransform.translateY = 0;
        this.clearDirty();
        this.setNeedsGeometryUpdate();
    },
    clampScale(this: ShapeEditor, v: number | string){

        const n = parseFloat(String(v));
        if (isNaN(n)) return 1;
        const abs = Math.abs(n);
        const sign = n < 0 ? -1 : 1;
        return sign * Math.max(this.SCALE_MIN, Math.min(this.SCALE_MAX, abs));
    },
    writeScale(this: ShapeEditor, txt: HTMLInputElement, val: number | string){

        txt.value = this.clampScale(val).toFixed(2);
    },
    clampRotate(this: ShapeEditor, v: number | string){

        const n = typeof v === 'number' ? v : parseInt(v);
        return isNaN(n) ? 0 : Math.max(-180, Math.min(180, n));
    },
    setRotate(this: ShapeEditor, rawVal: number | string){

        this.dom_txt_rotate.value = String(this.clampRotate(rawVal));
    },
    clampTranslate(this: ShapeEditor, v: number | string){

        const n = parseFloat(String(v));
        return isNaN(n) ? 0 : Math.max(-500, Math.min(500, Math.round(n)));
    },
    setTranslate(this: ShapeEditor, x: number | string, y: number | string){

        this.dom_txt_translate_x.value = String(this.clampTranslate(x));
        this.dom_txt_translate_y.value = String(this.clampTranslate(y));
    },
    wireTransformUndo(this: ShapeEditor, controlName: string, ...elements: HTMLInputElement[]){

        for (const el of elements) {
            el.addEventListener('change', () => {
                const newVal = this.getTransformValue(controlName);
                const oldVal = this.committedTransform[controlName] ?? 0;
                if (oldVal !== newVal) {
                    this.pushUndo({ type: 'transform', control: controlName, oldValue: oldVal, newValue: newVal });
                    this.committedTransform[controlName] = newVal;
                }
            }, { signal: this.signal });
        }
    },
    applyInteractiveZoom(this: ShapeEditor, zoom: number): boolean{
    const nextZoom = Math.max(0.1, Math.min(10, zoom));
    if (Math.abs(nextZoom - this.camZoom) <= Number.EPSILON) return false;
    this.camZoom = nextZoom;
    this.directionArrowTransition.noteZoom(performance.now());
    this.setNeedsRender();
    return true;
},
    getTransformValue(this: ShapeEditor, control: string){

        switch (control) {
            case 'scale': return parseFloat(this.dom_txt_scale.value) || 1;
            case 'scaleX': return parseFloat(this.dom_txt_scale_x.value) || 1;
            case 'scaleY': return parseFloat(this.dom_txt_scale_y.value) || 1;
            case 'rotate': return parseInt(this.dom_txt_rotate.value) || 0;
            case 'translateX': return parseInt(this.dom_txt_translate_x.value) || 0;
            case 'translateY': return parseInt(this.dom_txt_translate_y.value) || 0;
            default: return 0;
        }
    },
    setTransformValue(this: ShapeEditor, control: string, value: number){

        switch (control) {
            case 'scale': this.writeScale(this.dom_txt_scale, value); break;
            case 'scaleX': this.writeScale(this.dom_txt_scale_x, value); break;
            case 'scaleY': this.writeScale(this.dom_txt_scale_y, value); break;
            case 'rotate': this.setRotate(value); break;
            case 'translateX': this.setTranslate(value, parseInt(this.dom_txt_translate_y.value) || 0); break;
            case 'translateY': this.setTranslate(parseInt(this.dom_txt_translate_x.value) || 0, value); break;
        }
    },
    getCanvasSize(this: ShapeEditor){

        const viewport = this.wrapper;
        return {
            width: viewport && viewport.clientWidth > 0 ? viewport.clientWidth
                : (this.mainEl.clientWidth > 0 ? this.mainEl.clientWidth : Math.floor(window.innerWidth)),
            height: viewport && viewport.clientHeight > 0 ? viewport.clientHeight
                : (this.mainEl.clientHeight > 0 ? this.mainEl.clientHeight : Math.floor(window.innerHeight * 0.6)),
        };
    },
    getFitSize(this: ShapeEditor){

        const { width, height } = this.getFitViewport();
        return { width, height };
    },
    getFitViewport(this: ShapeEditor): FitViewport{

        const { width, height } = this.getCanvasSize();
        let excludedLeft = 0;
        const overlay = this.dom_transform_overlay;
        const canvasViewport = this.wrapper;
        if (overlay.isConnected && canvasViewport?.isConnected) {
            const style = getComputedStyle(overlay);
            // Mobile reuses this element as a fixed modal sheet. Only the
            // desktop absolute overlay participates in initial fit exclusion.
            if (style.position === 'absolute' && style.display !== 'none') {
                const canvasRect = canvasViewport.getBoundingClientRect();
                const overlayRect = overlay.getBoundingClientRect();
                const overlapsCanvas = overlayRect.right > canvasRect.left
                    && overlayRect.left < canvasRect.right
                    && overlayRect.bottom > canvasRect.top
                    && overlayRect.top < canvasRect.bottom;
                if (overlapsCanvas && canvasRect.width > 0) {
                    const canvasUnitsPerCssPixel = width / canvasRect.width;
                    const overlayRight = (overlayRect.right - canvasRect.left) * canvasUnitsPerCssPixel;
                    const gutter = 12 * canvasUnitsPerCssPixel;
                    excludedLeft = Math.max(0, Math.min(width - 1, overlayRight + gutter));
                }
            }
        }
        const usableWidth = Math.max(1, width - excludedLeft);
        return {
            width: Math.max(1, Math.floor(usableWidth * 0.86)),
            height: Math.max(1, Math.floor(height * 0.78)),
            centerOffsetX: excludedLeft / 2,
            centerOffsetY: 0,
            excludedLeft,
        };
    },
    getCurrentTransform(this: ShapeEditor): { sX: number; sY: number; cosR: number; sinR: number; tx: number; ty: number }{

        const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
        const sX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleGlobal;
        const sY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleGlobal;
        const rotateDeg = parseInt(this.dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const tx = parseFloat(this.dom_txt_translate_x.value) || 0;
        const ty = parseFloat(this.dom_txt_translate_y.value) || 0;
        return { sX, sY, cosR: Math.cos(rotateRad), sinR: Math.sin(rotateRad), tx, ty };
    },
    canvasDeltaToScreenmapDelta(this: ShapeEditor, dx: number, dy: number): [number, number]{

        const { sX, sY, cosR, sinR } = this.getCurrentTransform();
        // Account for camera zoom, then inverse rotation and inverse scale
        const wdx = dx / this.camZoom;
        const wdy = dy / this.camZoom;
        const urx = wdx * cosR + wdy * sinR;
        const ury = -wdx * sinR + wdy * cosR;
        return [urx / sX, ury / sY];
    },
    getCanvasCoords(this: ShapeEditor, e: { clientX: number; clientY: number }): [number, number]{

        const rect = this._oc().getBoundingClientRect();
        return [
            (e.clientX - rect.left) * (this.canvasW / rect.width),
            (e.clientY - rect.top) * (this.canvasH / rect.height),
        ];
    },
    toCanvasCoords(this: ShapeEditor, x: number, y: number): [number, number]{

        return [
            (x + this.camPanX) * this.camZoom + this.canvasW / 2,
            (y + this.camPanY) * this.camZoom + this.canvasH / 2,
        ];
    },
    obbToCanvas(this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number }, lx: number, ly: number){

        const { cx, cy, cos, sin } = bbox;
        return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    },
    computeGizmoHandles(this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number; hw: number; hh: number } | null | undefined){

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
                tl: this.obbToCanvas(bbox, -hw, -hh),
                tr: this.obbToCanvas(bbox, hw, -hh),
                bl: this.obbToCanvas(bbox, -hw, hh),
                br: this.obbToCanvas(bbox, hw, hh),
            },
            edges: {
                top:    this.obbToCanvas(bbox, 0, -hh),
                bottom: this.obbToCanvas(bbox, 0, hh),
                left:   this.obbToCanvas(bbox, -hw, 0),
                right:  this.obbToCanvas(bbox, hw, 0),
            },
            rotate: this.obbToCanvas(bbox, 0, -hh - rotLineLen),
            center: { x: bbox.cx, y: bbox.cy },
        };
    },
    canvasToObbLocal(this: ShapeEditor, bbox: { cx: number; cy: number; cos: number; sin: number } | null | undefined, canvasX: number, canvasY: number): [number, number]{

        if (!bbox) return [0, 0];
        const dx = canvasX - bbox.cx;
        const dy = canvasY - bbox.cy;
        // Inverse rotation
        return [dx * bbox.cos + dy * bbox.sin,
               -dx * bbox.sin + dy * bbox.cos];
    },
    hitTestGizmo(this: ShapeEditor, canvasX: number, canvasY: number): string | null{

        const handles = this.computeGizmoHandles(this.ptsBBox);
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
    },
    getCursorForGizmo(this: ShapeEditor, handleId: string | null){

        if (!handleId) return 'default';
        if (handleId === 'rotate') return 'grab';
        if (handleId === 'translate') return 'move';
        if (handleId === 'edge-top' || handleId === 'edge-bottom') return 'ns-resize';
        if (handleId === 'edge-left' || handleId === 'edge-right') return 'ew-resize';
        if (handleId === 'corner-tl' || handleId === 'corner-br') return 'nwse-resize';
        if (handleId === 'corner-tr' || handleId === 'corner-bl') return 'nesw-resize';
        return 'default';
    },
    drawGizmoHandles(this: ShapeEditor){

        const handles = this.computeGizmoHandles(this.ptsBBox);
        if (!handles) return;

        // Hide handles if bbox is too small on screen (very zoomed out)
        if (handles.hw < 8 || handles.hh < 8) return;

        // Transform handles join the hover affordance without controlling
        // path or direction-arrow opacity.
        const gizmoAlpha = this.overlayAlpha;
        if (gizmoAlpha < 0.01) return;

        if (!this.ptsBBox) return;
        const rotRad = Math.atan2(this.ptsBBox.sin, this.ptsBBox.cos);

        this._octx().save();
        this._octx().globalAlpha = gizmoAlpha;

        // Draw rotation connecting line (dashed)
        const topCenter = handles.edges.top;
        this._octx().strokeStyle = gfxColors.accentBlue();
        this._octx().lineWidth = 1;
        this._octx().setLineDash([4, 3]);
        this._octx().beginPath();
        this._octx().moveTo(topCenter.x, topCenter.y);
        this._octx().lineTo(handles.rotate.x, handles.rotate.y);
        this._octx().stroke();
        this._octx().setLineDash([]);

        // Draw rotation handle (arc with arrowhead)
        const isRotHover = this.gizmoHover === 'rotate' || this.gizmoActive === 'rotate';
        const rotColor = isRotHover ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
        const rx: number = handles.rotate.x;
        const ry: number = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        const arcStart = -Math.PI * 1.25;
        const arcEnd = Math.PI * 0.05;

        // Arc stroke
        this._octx().strokeStyle = rotColor;
        this._octx().lineWidth = 2;
        this._octx().beginPath();
        this._octx().arc(rx, ry, arcR, arcStart, arcEnd);
        this._octx().stroke();

        // Arrowhead at arc end
        const ax = rx + arcR * Math.cos(arcEnd);
        const ay = ry + arcR * Math.sin(arcEnd);
        const tangent = arcEnd + Math.PI / 2; // tangent direction (perpendicular to radius)
        const arrowLen = 5;
        const arrowHalf = 0.55;
        this._octx().fillStyle = rotColor;
        this._octx().beginPath();
        this._octx().moveTo(ax, ay);
        this._octx().lineTo(ax - arrowLen * Math.cos(tangent - arrowHalf), ay - arrowLen * Math.sin(tangent - arrowHalf));
        this._octx().lineTo(ax - arrowLen * Math.cos(tangent + arrowHalf), ay - arrowLen * Math.sin(tangent + arrowHalf));
        this._octx().closePath();
        this._octx().fill();

        // Helper: draw a rotated rect centered at (h.x, h.y)
        const drawHandle = (h: GizmoHandle, w: number, ht: number, color: string) => {
            this._octx().save();
            this._octx().translate(h.x, h.y);
            this._octx().rotate(rotRad);
            this._octx().fillStyle = color;
            this._octx().fillRect(-w / 2, -ht / 2, w, ht);
            this._octx().strokeStyle = gfxColors.textStrong();
            this._octx().lineWidth = 1;
            this._octx().strokeRect(-w / 2, -ht / 2, w, ht);
            this._octx().restore();
        }

        // Draw corner handles (squares)
        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            const id = 'corner-' + key;
            const active = this.gizmoHover === id || this.gizmoActive === id;
            const size = active ? 12 : 10;
            const color = active ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
            drawHandle(h, size, size, color);
        }

        // Draw edge handles (oriented rectangles)
        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            const id = 'edge-' + key;
            const active = this.gizmoHover === id || this.gizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            const color = active ? gfxColors.accentBlueHover() : gfxColors.accentBlue();
            drawHandle(h, w, ht, color);
        }

        this._octx().restore();
    },
    handleGizmoDrag(this: ShapeEditor, cx: number, cy: number){

        if (!this.gizmoDragStart || !this.gizmoActive) return;
        const ds = this.gizmoDragStart;
        const dx = cx - ds.canvasX;
        const dy = cy - ds.canvasY;

        if (this.gizmoActive === 'translate') {
            const wdx = dx / this.camZoom;
            const wdy = dy / this.camZoom;
            this.setTranslate(ds.translateX + wdx, ds.translateY + wdy);
            this.markDirty(); this.setNeedsRender();
            return;
        }

        if (this.gizmoActive === 'rotate') {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startAngle = Math.atan2(
                ds.canvasY - center.y,
                ds.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = ds.rotate + Math.round(deltaDeg);
            // Snap to 15-degree increments when shift held
            if (this.shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            this.setRotate(this.clampRotate(newRotate));
            this.markDirty(); this.setNeedsRender();
            return;
        }

        if (this.gizmoActive.startsWith('corner-')) {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startDist = Math.hypot(
                ds.canvasX - center.x,
                ds.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                this.writeScale(this.dom_txt_scale, this.clampScale(ds.scale * ratio));
                this.markDirty(); this.setNeedsRender();
            }
            return;
        }

        if (this.gizmoActive.startsWith('edge-')) {
            const edge = this.gizmoActive.split('-')[1] ?? '';
            // Project mouse positions onto OBB local axes for signed distance
            const [startLx, startLy] = this.canvasToObbLocal(this.ptsBBox, ds.canvasX, ds.canvasY);
            const [curLx, curLy] = this.canvasToObbLocal(this.ptsBBox, cx, cy);

            if (edge === 'left' || edge === 'right') {
                if (Math.abs(startLx) > 1) {
                    const ratio = curLx / startLx; // signed: crossing center negates
                    this.writeScale(this.dom_txt_scale_x, this.clampScale(ds.scaleX * ratio));
                    this.markDirty(); this.setNeedsRender();
                }
            } else {
                if (Math.abs(startLy) > 1) {
                    const ratio = curLy / startLy; // signed: crossing center negates
                    this.writeScale(this.dom_txt_scale_y, this.clampScale(ds.scaleY * ratio));
                    this.markDirty(); this.setNeedsRender();
                }
            }
            return;
        }
    },
    commitGizmoDrag(this: ShapeEditor){

        if (!this.gizmoDragStart) return;
        const checks = [
            ['scale', this.gizmoDragStart.scale, this.getTransformValue('scale')],
            ['scaleX', this.gizmoDragStart.scaleX, this.getTransformValue('scaleX')],
            ['scaleY', this.gizmoDragStart.scaleY, this.getTransformValue('scaleY')],
            ['rotate', this.gizmoDragStart.rotate, this.getTransformValue('rotate')],
            ['translateX', this.gizmoDragStart.translateX, this.getTransformValue('translateX')],
            ['translateY', this.gizmoDragStart.translateY, this.getTransformValue('translateY')],
        ];
        for (const [control, oldVal, newVal] of checks) {
            if (oldVal !== newVal) {
                this.pushUndo({ type: 'transform', control, oldValue: oldVal, newValue: newVal });
                this.committedTransform[control as string] = newVal as number;
            }
        }
        // Bake the previewed transform into the geometry buffers on the next
        // frame. animate() will see _dragPreviewActive=true with gizmoActive
        // null and reset mesh transforms before the rebuild.
        this.setNeedsGeometryUpdate();
    },
    _isGizmoDragPreview(this: ShapeEditor): boolean{
    return this.gizmoActive !== null && this.gizmoDragStart !== null;
},
    _computeDragDelta(this: ShapeEditor){
    const ds = this.gizmoDragStart;
    if (!ds) return null;

    // Base effective transform (captured at drag start; matches what the
    // vertex buffer was baked with).
    const baseSX = ds.scale * ds.scaleX;
    const baseSY = ds.scale * ds.scaleY;
    const baseRot = ds.rotate * Math.PI / 180;
    const baseTX = ds.translateX;
    const baseTY = ds.translateY;

    // Current effective transform (live DOM values).
    const curScale = parseFloat(this.dom_txt_scale.value) || 1;
    const curSX = (parseFloat(this.dom_txt_scale_x.value) || 1) * curScale;
    const curSY = (parseFloat(this.dom_txt_scale_y.value) || 1) * curScale;
    const curRot = (parseInt(this.dom_txt_rotate.value) || 0) * Math.PI / 180;
    const curTX = parseFloat(this.dom_txt_translate_x.value) || 0;
    const curTY = parseFloat(this.dom_txt_translate_y.value) || 0;

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
},
    _applyDragPreviewMatrices(this: ShapeEditor){
    const delta = this._computeDragDelta();
    if (!delta) return;
    const { dtx, dty, dRotRad, dsX, dsY } = delta;
    if (this.pointsMesh) {
        this.pointsMesh.position.set(dtx, dty, 0);
        this.pointsMesh.rotation.set(0, 0, dRotRad);
        this.pointsMesh.scale.set(dsX, dsY, 1);
    }
    if (this.screenmapOutline) {
        this.screenmapOutline.position.set(dtx, dty, 0);
        this.screenmapOutline.rotation.set(0, 0, dRotRad);
        this.screenmapOutline.scale.set(dsX, dsY, 1);
    }
},
    _resetMeshTransforms(this: ShapeEditor){
    if (this.pointsMesh) {
        this.pointsMesh.position.set(0, 0, 0);
        this.pointsMesh.rotation.set(0, 0, 0);
        this.pointsMesh.scale.set(1, 1, 1);
    }
    if (this.screenmapOutline) {
        this.screenmapOutline.position.set(0, 0, 0);
        this.screenmapOutline.rotation.set(0, 0, 0);
        this.screenmapOutline.scale.set(1, 1, 1);
    }
},
    _drawGizmoPreviewOverlay(this: ShapeEditor, pts: [number, number][]){
    const ctx = this.overlayCtx;
    if (!ctx) return;
    if (pts.length === 0) return;
    const delta = this._computeDragDelta();
    if (!delta) return;
    const { dtx, dty, dRotRad, dsX, dsY } = delta;

    // Canvas-space delta affine = M_wc ∘ M_world_delta ∘ M_wc^-1, where
    // M_wc maps world to canvas: c = w * camZoom + offset.
    // offset = (canvasW/2 + camPanX*camZoom, canvasH/2 + camPanY*camZoom).
    const ox = this.camPanX * this.camZoom + this.canvasW / 2;
    const oy = this.camPanY * this.camZoom + this.canvasH / 2;
    const cosD = Math.cos(dRotRad);
    const sinD = Math.sin(dRotRad);
    const a = dsX * cosD;
    const b = dsX * sinD;
    const c = -dsY * sinD;
    const d = dsY * cosD;
    const e = -a * ox - c * oy + dtx * this.camZoom + ox;
    const f = -b * ox - d * oy + dty * this.camZoom + oy;
    const txPt = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];

    // One batched stroke for the entire trace (rainbow + arrows + interior
    // dots are skipped — they return on commit). Cheap even for 4096 points.
    {
        const hasMultiStrip = this.stripInfo && this.stripInfo.strips.length > 1;
        const stripBoundaries = new Set<number>();
        if (hasMultiStrip) {
            for (const strip of this._si().strips) {
                if (strip.count > 0) stripBoundaries.add(strip.offset + strip.count - 1);
            }
        }
        const previewPathAlpha = 0.35 + this.overlayAlpha * 0.3;
        ctx.globalAlpha = previewPathAlpha * 0.55;
        ctx.strokeStyle = gfxColors.textMuted();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let penDown = false;
        for (let i = 0; i < pts.length - 1; i++) {
            if (hasMultiStrip && stripBoundaries.has(i)) { penDown = false; continue; }
            const [x1, y1] = this.nn(pts[i]);
            const [x2, y2] = this.nn(pts[i + 1]);
            const [tx1, ty1] = txPt(x1, y1);
            const [tx2, ty2] = txPt(x2, y2);
            if (!penDown) { ctx.moveTo(tx1, ty1); penDown = true; }
            ctx.lineTo(tx2, ty2);
        }
        ctx.stroke();
    }

    // Highlighted edge (insert-between affordance) — keep it visible.
    if (this.highlightedEdgeIdx >= 0 && this.highlightedEdgeIdx < pts.length - 1) {
        const [x1, y1] = this.nn(pts[this.highlightedEdgeIdx]);
        const [x2, y2] = this.nn(pts[this.highlightedEdgeIdx + 1]);
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
    if (this.selectedIdx >= 0 && this.selectedIdx < pts.length) {
        const [sx, sy] = this.nn(pts[this.selectedIdx]);
        const [tsx, tsy] = txPt(sx, sy);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gfxColors.accentCyan();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tsx, tsy, 10, 0, Math.PI * 2);
        ctx.stroke();
    }
},
};
