// Named ShapeEditor method bundle: background.
import type { ShapeEditor } from './shapeeditor-class';
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Material } from "three";
import { gfxColors } from "../ui/theme";
import type { GizmoHandle } from "./shapeeditor-types";

export interface EditorBackgroundMethods {
    setBgControlsEnabled: (enabled: boolean) => void;
    resetBgControls: () => void;
    applyBgImageTransform: () => void;
    clearBackgroundImage: () => void;
    removeBackgroundImage: () => void;
    showDeleteBgConfirm: () => void;
    dismissDeleteBgConfirm: () => void;
    loadBackgroundImage: (file: File) => void;
    hitTestBgGizmo: (canvasX: number, canvasY: number) => string | null;
    drawBgGizmoHandles: () => void;
    handleBgGizmoDrag: (cx: number, cy: number) => void;
    startBgGizmoDrag: (hit: string, cx: number, cy: number) => void;
}

export const editorBackgroundMethods: EditorBackgroundMethods & ThisType<ShapeEditor> = {
    setBgControlsEnabled(this: ShapeEditor, enabled: boolean){

        for (const el of this.bgImageControls) el.disabled = !enabled;
    },
    resetBgControls(this: ShapeEditor){

        this.dom_txt_image_opacity.value = '50';
        this.dom_txt_image_scale.value = '1.00';
        this.dom_txt_image_rotate.value = '0.00';
        this.dom_txt_image_tx.value = '0';
        this.dom_txt_image_ty.value = '0';
    },
    applyBgImageTransform(this: ShapeEditor){

        if (!this.bgImageMesh) return;
        const s = parseFloat(this.dom_txt_image_scale.value) || 1;
        const deg = parseFloat(this.dom_txt_image_rotate.value) || 0;
        const tx = parseFloat(this.dom_txt_image_tx.value) || 0;
        const ty = parseFloat(this.dom_txt_image_ty.value) || 0;
        this.bgImageMesh.scale.set(s, -s, 1); // negative y for y-down camera
        this.bgImageMesh.rotation.z = deg * Math.PI / 180;
        this.bgImageMesh.position.set(tx, ty, 0);
        this.setNeedsRender();
    },
    clearBackgroundImage(this: ShapeEditor){

        if (this.bgImageMesh) {
            this._scene().remove(this.bgImageMesh);
            this.bgImageMesh.geometry.dispose();
            ((this.bgImageMesh.material as Material)).dispose();
            this.bgImageMesh = null;
        }
        if (this.bgImageTexture) {
            this.bgImageTexture.dispose();
            this.bgImageTexture = null;
        }
        if (this.bgImageObjectURL) {
            URL.revokeObjectURL(this.bgImageObjectURL);
            this.bgImageObjectURL = null;
        }
        this.setBgControlsEnabled(false);
        this.bgImageFitW = 0;
        this.bgImageFitH = 0;
        this.bgImageBBox = null;
        this.bgGizmoActive = null;
        this.bgGizmoHover = null;
        this.bgGizmoDragStart = null;
    },
    removeBackgroundImage(this: ShapeEditor){

        this.clearBackgroundImage();
        this.resetBgControls();
        this.dom_btn_upload_image.value = '';
        this.dom_bg_accordion.removeAttribute('open');
        this.setNeedsRender();
    },
    showDeleteBgConfirm(this: ShapeEditor){

        if (this.deleteBgConfirmEl) return; // already showing
        this.deleteBgConfirmEl = document.createElement('div');
        this.deleteBgConfirmEl.className = 'delete-bg-confirm';
        this.deleteBgConfirmEl.innerHTML =
            '<div class="delete-bg-confirm-prompt">Delete background image?</div>' +
            '<button data-bg-del="yes" class="delete-bg-confirm-btn delete-bg-confirm-btn--yes">Delete</button>' +
            '<button data-bg-del="no" class="delete-bg-confirm-btn delete-bg-confirm-btn--no">Cancel</button>';
        this.deleteBgConfirmEl.addEventListener('click', (e: MouseEvent) => {
            const val = (e.target as HTMLElement | null)?.dataset.bgDel;
            if (val === 'yes') this.removeBackgroundImage();
            if (val) this.dismissDeleteBgConfirm();
        });
        if (this.wrapper) this.wrapper.appendChild(this.deleteBgConfirmEl);
    },
    dismissDeleteBgConfirm(this: ShapeEditor){

        if (this.deleteBgConfirmEl) {
            this.deleteBgConfirmEl.remove();
            this.deleteBgConfirmEl = null;
        }
    },
    loadBackgroundImage(this: ShapeEditor, file: File){

        this.clearBackgroundImage();
        this.resetBgControls();

        this.bgImageObjectURL = URL.createObjectURL(file);
        const loader = new TextureLoader();
        loader.load(this.bgImageObjectURL, (texture) => {
            this.bgImageTexture = texture;
            texture.colorSpace = SRGBColorSpace;

            const img = texture.image;
            // Size to fill the canvas, maintaining aspect ratio
            const aspect = img.width / img.height;
            const canvasAspect = this.canvasW / this.canvasH;
            let fitW, fitH;
            if (aspect > canvasAspect) {
                fitW = this.canvasW;
                fitH = this.canvasW / aspect;
            } else {
                fitH = this.canvasH;
                fitW = this.canvasH * aspect;
            }

            this.bgImageFitW = fitW;
            this.bgImageFitH = fitH;

            const geometry = new PlaneGeometry(fitW, fitH);
            const material = new MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: (parseFloat(this.dom_txt_image_opacity.value) || 50) / 100,
                depthWrite: false,
                depthTest: false,
                side: DoubleSide,
            });

            const mesh = new Mesh(geometry, material);
            this.bgImageMesh = mesh;
            mesh.renderOrder = 1;
            mesh.scale.y = -1;
            this._scene().add(mesh);

            this.setBgControlsEnabled(true);
            this.dom_bg_accordion.setAttribute('open', '');
        });
    },
    hitTestBgGizmo(this: ShapeEditor, canvasX: number, canvasY: number){

        if (!this.bgImageBBox) return null;
        const handles = this.computeGizmoHandles(this.bgImageBBox);
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

        const [lx, ly] = this.canvasToObbLocal(this.bgImageBBox, canvasX, canvasY);
        if (Math.abs(lx) <= handles.hw && Math.abs(ly) <= handles.hh) {
            return 'translate';
        }

        return null;
    },
    drawBgGizmoHandles(this: ShapeEditor){

        if (!this.bgImageBBox || !this.overlayCtx) return;
        const handles = this.computeGizmoHandles(this.bgImageBBox);
        if (!handles) return;
        if (handles.hw < 8 || handles.hh < 8) return;

        const rotRad = Math.atan2(this.bgImageBBox.sin, this.bgImageBBox.cos);

        this.overlayCtx.save();

        // Draw oriented bounding box outline
        const isTranslating = this.bgGizmoHover === 'translate' || this.bgGizmoActive === 'translate';
        if (isTranslating) {
            this.overlayCtx.globalAlpha = this.bgGizmoActive === 'translate' ? 0.8 : 0.5;
            this.overlayCtx.strokeStyle = gfxColors.accentAmber();
        } else {
            this.overlayCtx.globalAlpha = 0.3;
            this.overlayCtx.strokeStyle = gfxColors.textMuted();
        }
        this.overlayCtx.lineWidth = 1;
        this.overlayCtx.setLineDash([6, 4]);
        this.overlayCtx.save();
        this.overlayCtx.translate(this.bgImageBBox.cx, this.bgImageBBox.cy);
        this.overlayCtx.rotate(rotRad);
        this.overlayCtx.strokeRect(-handles.hw, -handles.hh, handles.hw * 2, handles.hh * 2);
        this.overlayCtx.restore();
        this.overlayCtx.setLineDash([]);

        this.overlayCtx.globalAlpha = 0.7;

        // Rotation connecting line
        const topCenter = handles.edges.top;
        this.overlayCtx.strokeStyle = gfxColors.accentAmber();
        this.overlayCtx.lineWidth = 1;
        this.overlayCtx.setLineDash([4, 3]);
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(topCenter.x, topCenter.y);
        this.overlayCtx.lineTo(handles.rotate.x, handles.rotate.y);
        this.overlayCtx.stroke();
        this.overlayCtx.setLineDash([]);

        // Rotation handle
        const isRotHover = this.bgGizmoHover === 'rotate' || this.bgGizmoActive === 'rotate';
        const rotColor = isRotHover ? gfxColors.accentAmberHover() : gfxColors.accentAmber();
        const rx: number = handles.rotate.x, ry: number = handles.rotate.y;
        const arcR = isRotHover ? 9 : 7;
        this.overlayCtx.strokeStyle = rotColor;
        this.overlayCtx.lineWidth = 2;
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(rx, ry, arcR, -Math.PI * 1.25, Math.PI * 0.05);
        this.overlayCtx.stroke();

        const ax = rx + arcR * Math.cos(Math.PI * 0.05);
        const ay = ry + arcR * Math.sin(Math.PI * 0.05);
        const tangent = Math.PI * 0.05 + Math.PI / 2;
        this.overlayCtx.fillStyle = rotColor;
        this.overlayCtx.beginPath();
        this.overlayCtx.moveTo(ax, ay);
        this.overlayCtx.lineTo(ax - 5 * Math.cos(tangent - 0.55), ay - 5 * Math.sin(tangent - 0.55));
        this.overlayCtx.lineTo(ax - 5 * Math.cos(tangent + 0.55), ay - 5 * Math.sin(tangent + 0.55));
        this.overlayCtx.closePath();
        this.overlayCtx.fill();

        // Corner and edge handles
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

        for (const [key, h] of Object.entries(handles.corners as Record<string, GizmoHandle>)) {
            const id = 'corner-' + key;
            const active = this.bgGizmoHover === id || this.bgGizmoActive === id;
            const size = active ? 12 : 10;
            drawHandle(h, size, size, active ? gfxColors.accentAmberHover() : gfxColors.accentAmber());
        }

        for (const [key, h] of Object.entries(handles.edges as Record<string, GizmoHandle>)) {
            const id = 'edge-' + key;
            const active = this.bgGizmoHover === id || this.bgGizmoActive === id;
            const isHoriz = (key === 'top' || key === 'bottom');
            const w = isHoriz ? (active ? 18 : 16) : (active ? 10 : 8);
            const ht = isHoriz ? (active ? 10 : 8) : (active ? 18 : 16);
            drawHandle(h, w, ht, active ? gfxColors.accentAmberHover() : gfxColors.accentAmber());
        }

        this.overlayCtx.restore();
    },
    handleBgGizmoDrag(this: ShapeEditor, cx: number, cy: number){

        if (!this.bgGizmoDragStart || !this.bgGizmoActive) return;
        const ds = this.bgGizmoDragStart;
        const dx = cx - ds.canvasX;
        const dy = cy - ds.canvasY;

        if (this.bgGizmoActive === 'translate') {
            const wdx = dx / this.camZoom;
            const wdy = dy / this.camZoom;
            const newTx = Math.round(ds.tx + wdx);
            const newTy = Math.round(ds.ty + wdy);
            this.dom_txt_image_tx.value = String(newTx);
            this.dom_txt_image_ty.value = String(newTy);
            this.applyBgImageTransform();
            return;
        }

        if (this.bgGizmoActive === 'rotate') {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startAngle = Math.atan2(
                ds.canvasY - center.y,
                ds.canvasX - center.x
            );
            const currentAngle = Math.atan2(cy - center.y, cx - center.x);
            const deltaDeg = (currentAngle - startAngle) * 180 / Math.PI;
            let newRotate = ds.rotate + deltaDeg;
            if (this.shiftHeld) newRotate = Math.round(newRotate / 15) * 15;
            newRotate = Math.max(-180, Math.min(180, newRotate));
            this.dom_txt_image_rotate.value = newRotate.toFixed(2);
            this.applyBgImageTransform();
            return;
        }

        // Corner or edge: uniform scale (image has single scale)
        if (this.bgGizmoActive.startsWith('corner-') || this.bgGizmoActive.startsWith('edge-')) {
            const center = ds.bboxCenter ?? { x: 0, y: 0 };
            const startDist = Math.hypot(
                ds.canvasX - center.x,
                ds.canvasY - center.y
            );
            const currentDist = Math.hypot(cx - center.x, cy - center.y);
            if (startDist > 1) {
                const ratio = currentDist / startDist;
                const newScale = Math.max(0.1, Math.min(5, ds.scale * ratio));
                this.dom_txt_image_scale.value = newScale.toFixed(2);
                this.applyBgImageTransform();
            }
            return;
        }
    },
    startBgGizmoDrag(this: ShapeEditor, hit: string, cx: number, cy: number){

        this.bgGizmoActive = hit;
        const handles = this.computeGizmoHandles(this.bgImageBBox);
        this.bgGizmoDragStart = {
            canvasX: cx, canvasY: cy,
            scale: parseFloat(this.dom_txt_image_scale.value) || 1,
            rotate: parseFloat(this.dom_txt_image_rotate.value) || 0,
            tx: parseFloat(this.dom_txt_image_tx.value) || 0,
            ty: parseFloat(this.dom_txt_image_ty.value) || 0,
            bboxCenter: handles ? handles.center : (this.bgImageBBox ? { x: this.bgImageBBox.cx, y: this.bgImageBBox.cy } : { x: 0, y: 0 }),
        };
    },
};`n