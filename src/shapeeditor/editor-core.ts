// Named ShapeEditor method bundle: core.
import type { ShapeEditor } from './shapeeditor-class';
import type { Line, Scene, WebGLRenderer, OrthographicCamera } from "three";
import type { StripInfo } from "./strips-model";
import { fireDialog } from "../ui/dialogs";
import type { SweetAlertResult } from "sweetalert2";

export interface EditorCoreMethods {
    qe: <T extends HTMLElement>(sel: string, _cast?: (e: Element) => T) => T;
    nn: <T>(v: T | null | undefined, msg?: string) => T;
    markDirty: () => void;
    clearDirty: () => void;
    _refreshSaveEnabled: () => void;
    markDirtyAndGeometry: () => void;
    _relativeTime: (savedAt: number) => string;
    _toast: (opts: Record<string, unknown>) => Promise<SweetAlertResult<unknown> | null>;
    _toastInfo: (text: string) => Promise<SweetAlertResult<unknown> | null>;
    _toastSuccess: (text: string) => Promise<SweetAlertResult<unknown> | null>;
    hslStringToRgb: (hslStr: string) => number[];
    setNeedsGeometryUpdate: () => void;
    setNeedsRender: () => void;
    _oc: () => HTMLCanvasElement;
    _octx: () => CanvasRenderingContext2D;
    _scene: () => Scene;
    _renderer: () => WebGLRenderer;
    _camera: () => OrthographicCamera;
    _si: () => StripInfo;
    _tooltip: () => HTMLElement;
    _outline: () => Line;
    _infoDiv: () => HTMLElement;
    _placeholderDiv: () => HTMLElement;
    makeCtxBtn: (label: string, action: string, parent?: HTMLElement | null) => HTMLButtonElement;
    makeCtxSeparator: () => HTMLDivElement;
}

export const editorCoreMethods: EditorCoreMethods & ThisType<ShapeEditor> = {
    qe<T extends HTMLElement>(this: ShapeEditor, sel: string, _cast?: (e: Element) => T): T{

        const el = this.container.querySelector(sel);
        if (!el) throw new Error(`Missing element "${sel}"`);
        return el as T;
    },
    nn<T>(this: ShapeEditor, v: T | null | undefined, msg?: string): T{

        if (v === null || v === undefined) throw new Error(msg ?? 'unexpected null/undefined');
        return v;
    },
    markDirty(this: ShapeEditor){

        this.dom_btn_reset.disabled = false;
        this._refreshSaveEnabled();
    },
    clearDirty(this: ShapeEditor){

        this.dom_btn_reset.disabled = true;
        this._refreshSaveEnabled();
    },
    _refreshSaveEnabled(this: ShapeEditor){

        this.dom_btn_save.disabled = this.screenmap_pts.length === 0;
    },
    markDirtyAndGeometry(this: ShapeEditor){
 this.markDirty(); this.setNeedsGeometryUpdate(); },
    _relativeTime(this: ShapeEditor, savedAt: number){

        const ms = Math.max(0, Date.now() - savedAt);
        const sec = Math.floor(ms / 1000);
        if (sec < 45) return 'just now';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${String(min)} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${String(hr)} h ago`;
        const day = Math.floor(hr / 24);
        return `${String(day)} d ago`;
    },
    async _toast(this: ShapeEditor, opts: Record<string, unknown>){

        try {
            if (this.signal.aborted) return null;
            const callerDidOpen = typeof opts.didOpen === 'function'
                ? opts.didOpen as (popup: HTMLElement) => void
                : null;
            return await fireDialog({
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 6000,
                timerProgressBar: true,
                ...opts,
                // SweetAlert's `top` position otherwise starts at the viewport
                // edge, on top of the app-shell mode bar. Measure the actual
                // canvas boundary so wrapped/responsive editor controls remain
                // usable too, without relying on a hard-coded header height.
                didOpen: (popup) => {
                    const popupContainer = popup.closest<HTMLElement>('.swal2-container');
                    if (popupContainer) {
                        const canvasTop = Math.ceil(this.mainEl.getBoundingClientRect().top);
                        popupContainer.style.setProperty('padding-top', `${String(canvasTop + 8)}px`, 'important');
                    }
                    callerDidOpen?.(popup);
                },
            });
        } catch { return null; }
    },
    _toastInfo(this: ShapeEditor, text: string){

        return this._toast({ icon: 'info', title: text });
    },
    _toastSuccess(this: ShapeEditor, text: string){

        return this._toast({ icon: 'success', title: text });
    },
    hslStringToRgb(this: ShapeEditor, hslStr: string){

        const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(hslStr);
        if (!m?.[1] || !m[2] || !m[3]) return [1, 1, 1];
        const h = parseFloat(m[1]) / 360;
        const s = parseFloat(m[2]) / 100;
        const l = parseFloat(m[3]) / 100;
        if (s === 0) return [l, l, l];
        const hue2rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
    },
    setNeedsGeometryUpdate(this: ShapeEditor){
 this.geometryDirty = true; this.frameDirty = true; },
    setNeedsRender(this: ShapeEditor){
 this.frameDirty = true; },
    _oc(this: ShapeEditor): HTMLCanvasElement{

        if (!this.overlayCanvas) throw new Error('overlayCanvas not initialized');
        return this.overlayCanvas;
    },
    _octx(this: ShapeEditor): CanvasRenderingContext2D{

        if (!this.overlayCtx) throw new Error('overlayCtx not initialized');
        return this.overlayCtx;
    },
    _scene(this: ShapeEditor): Scene{

        if (!this.scene) throw new Error('scene not initialized');
        return this.scene;
    },
    _renderer(this: ShapeEditor): WebGLRenderer{

        if (!this.renderer) throw new Error('renderer not initialized');
        return this.renderer;
    },
    _camera(this: ShapeEditor): OrthographicCamera{

        if (!this.camera) throw new Error('camera not initialized');
        return this.camera;
    },
    _si(this: ShapeEditor): StripInfo{

        if (!this.stripInfo) throw new Error('stripInfo not initialized');
        return this.stripInfo;
    },
    _tooltip(this: ShapeEditor): HTMLElement{

        if (!this.tooltip) throw new Error('tooltip not initialized');
        return this.tooltip;
    },
    _outline(this: ShapeEditor): Line{

        if (!this.screenmapOutline) throw new Error('screenmapOutline not initialized');
        return this.screenmapOutline;
    },
    _infoDiv(this: ShapeEditor): HTMLElement{

        if (!this.infoDiv) throw new Error('infoDiv not initialized');
        return this.infoDiv;
    },
    _placeholderDiv(this: ShapeEditor): HTMLElement{

        if (!this.placeholderDiv) throw new Error('placeholderDiv not initialized');
        return this.placeholderDiv;
    },
    makeCtxBtn(this: ShapeEditor, label: string, action: string, parent?: HTMLElement | null){

        const ctxContainer = parent ?? this.ctxMenu;
        const btn = document.createElement('button');
        btn.dataset.action = action;
        btn.textContent = label;
        btn.className = this.ctxBtnClass;
        if (ctxContainer) ctxContainer.appendChild(btn);
        return btn;
    },
    makeCtxSeparator(this: ShapeEditor){

        const sep = document.createElement('div');
        sep.className = 'shapeeditor-context-menu-separator';
        if (this.ctxMenu) this.ctxMenu.appendChild(sep);
        return sep;
    },
};
