// Named ShapeEditor method bundle: renderer.
import type { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Line, LineBasicMaterial, LineSegments, OrthographicCamera, Scene, WebGLRenderer, type BufferAttribute, type Material } from "three";
import { getStripColors } from "../common";
import { savePresetScreenmap } from "../screenmap-store";
import { buildPointsMesh } from "../three-utils";

export interface EditorRendererMethods {
    initRenderer: () => void;
    buildScreenmap: (transformedPts: [number, number][]) => void;
    updateLabels: (transformedPts: [number, number][]) => void;
    handleResize: () => void;
    animate: () => void;
}

export const editorRendererMethods: EditorRendererMethods & ThisType<ShapeEditor> = {
    initRenderer(this: ShapeEditor){

        this.wrapper = document.createElement('div');
        this.wrapper.className = 'shapeeditor-canvas-viewport';
        this.mainEl.appendChild(this.wrapper);

        const { width, height } = this.getCanvasSize();
        this.canvasW = width;
        this.canvasH = height;

        this.renderer = new WebGLRenderer({ antialias: false });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x121212, 1);

        this.scene = new Scene();

        const hw = width / 2, hh = height / 2;
        this.camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        this.camera.position.z = 1;

        this.renderer.domElement.className = 'shapeeditor-three-canvas';
        this.wrapper.appendChild(this.renderer.domElement);

        // Overlay canvas for rainbow lines, arrows, and labels (always visible)
        this.overlayCanvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        this.overlayCanvas.width = width * dpr;
        this.overlayCanvas.height = height * dpr;
        this.overlayCanvas.className = 'shapeeditor-overlay-canvas';
        this.wrapper.appendChild(this.overlayCanvas);
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        this._octx().scale(dpr, dpr);

        // LED index tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'shapeeditor-tooltip';
        this.wrapper.appendChild(this.tooltip);

        // Right-click context menu. Lives on document.body but the
        // shapeeditor CSS classes are unscoped so they still apply.
        this.ctxMenu = document.createElement('div');
        this.ctxMenu.className = 'shapeeditor-ctx-menu';

        // ── File operations (wrapped for show/hide) ──
        this.ctxFileOps = document.createElement('div');
        this.ctxMenu.appendChild(this.ctxFileOps);
        this.makeCtxBtn('New', 'new', this.ctxFileOps);
        this.ctxBtnSave = this.makeCtxBtn('Save As\u2026', 'save', this.ctxFileOps);

        // Load Screenmap with submenu
        const ctxLoadWrapper = document.createElement('div');
        ctxLoadWrapper.className = 'shapeeditor-ctx-load-wrapper';
        this.ctxFileOps.appendChild(ctxLoadWrapper);
        this.ctxBtnLoadScreenmap = document.createElement('button');
        this.ctxBtnLoadScreenmap.textContent = 'Load Screenmap \u25B8';
        this.ctxBtnLoadScreenmap.className = `${this.ctxBtnClass} shapeeditor-ctx-load-trigger`;
        ctxLoadWrapper.appendChild(this.ctxBtnLoadScreenmap);

        this.ctxLoadSubmenu = document.createElement('div');
        this.ctxLoadSubmenu.className = 'shapeeditor-ctx-submenu';
        ctxLoadWrapper.appendChild(this.ctxLoadSubmenu);

        // "Upload file…" always first in submenu
        this.makeCtxBtn('Upload file\u2026', 'upload-screenmap', this.ctxLoadSubmenu);

        ctxLoadWrapper.addEventListener('mouseenter', () => {
            if (this.ctxBtnLoadScreenmap) this.ctxBtnLoadScreenmap.classList.add('is-active');
            // Explicit 'block': the .shapeeditor-ctx-submenu class carries
            // `display: none` (#170), so '' would fall back to hidden.
            if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'block';
        });
        ctxLoadWrapper.addEventListener('mouseleave', () => {
            if (this.ctxBtnLoadScreenmap) this.ctxBtnLoadScreenmap.classList.remove('is-active');
            if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'none';
        });

        // Load Image (triggers file picker)
        this.makeCtxBtn('Load Background Image\u2026', 'load-image', this.ctxFileOps);
        this.ctxLoadImageInput = document.createElement('input');
        this.ctxLoadImageInput.type = 'file';
        this.ctxLoadImageInput.accept = 'image/*';
        this.ctxLoadImageInput.style.display = 'none';
        this.ctxFileOps.appendChild(this.ctxLoadImageInput);

        this.ctxFileOpsSep = this.makeCtxSeparator();

        // ── Discoverability entry points ──
        this.makeCtxBtn('Insert panel…', 'insert-panel');
        this.makeCtxBtn('Paste screenmap', 'paste-screenmap');
        this.ctxBtnCopyStrip = this.makeCtxBtn('Copy strip', 'copy-strip');

        // ── Point operations ──
        this.ctxBtnDelete = this.makeCtxBtn('Delete Point', 'delete');
        this.ctxBtnInsertBetween = this.makeCtxBtn('Insert between', 'insert-between');
        this.ctxBtnInsertFwd = this.makeCtxBtn('Insert, shift forward', 'insert-forward');
        this.ctxBtnInsertBack = this.makeCtxBtn('Insert, shift back', 'insert-back');

        // Ruler operations
        this.ctxRulerSep = this.makeCtxSeparator();
        this.ctxBtnInsertRuler = this.makeCtxBtn('Insert ruler (60 cm)', 'insert-ruler');
        this.ctxBtnDuplicateRuler = this.makeCtxBtn('Duplicate ruler', 'duplicate-ruler');
        this.ctxBtnDeleteRuler = this.makeCtxBtn('Delete ruler', 'delete-ruler');

        // Inspector
        this.makeCtxSeparator();
        this.makeCtxBtn('Inspect JSON…', 'inspect-json');

        // Trailing help entry
        this.makeCtxSeparator();
        this.makeCtxBtn('Keyboard help', 'kbd-help');

        document.body.appendChild(this.ctxMenu);

        // Hidden file input for "Upload file…" submenu item
        const ctxUploadInput = document.createElement('input');
        ctxUploadInput.type = 'file';
        ctxUploadInput.accept = '.json';
        ctxUploadInput.style.display = 'none';
        document.body.appendChild(ctxUploadInput);
        ctxUploadInput.addEventListener('change', () => {
            if (ctxUploadInput.files?.[0]) {
                const reader = new FileReader();
                reader.onload = (ev) => { if (ev.target) this.load_screenmap_data(ev.target.result as string); };
                reader.readAsText(ctxUploadInput.files[0]);
            }
            ctxUploadInput.value = '';
        }, { signal: this.signal });

        this.ctxLoadImageInput.addEventListener('change', () => {
            if (this.ctxLoadImageInput?.files?.[0]) this.loadBackgroundImage(this.ctxLoadImageInput.files[0]);
            if (this.ctxLoadImageInput) this.ctxLoadImageInput.value = '';
        }, { signal: this.signal });

        this.ctxMenu.addEventListener('click', (e: MouseEvent) => {
            const cm_tgt = e.target instanceof HTMLElement ? e.target : null;
            const action = cm_tgt?.dataset.action ?? null;
            if (action === 'new') {
                this.dom_btn_new.click();
            } else if (action === 'save') {
                this.saveAs();
            } else if (action === 'upload-screenmap') {
                ctxUploadInput.click();
            } else if (action?.startsWith('load-preset:')) {
                const file = action.slice('load-preset:'.length);
                const generation = ++this.layoutLoadGeneration;
                fetch(`/screenmaps/${file}`, { signal: this.signal }).then(r => r.text()).then((text) => {
                    if (this.signal.aborted || generation !== this.layoutLoadGeneration) return;
                    if (!savePresetScreenmap(text, file)) throw new Error(`Could not persist preset ${file}`);
                    this.load_screenmap_data(text, false);
                    this.presetPicker?.setActive(file);
                })
                    .catch((err: unknown) => { console.warn('Failed to load preset:', err); });
            } else if (action === 'load-image') {
                this.ctxLoadImageInput?.click();
            } else if (action === 'delete' && this.ctxMenuIdx >= 0) {
                this.deletePoint(this.ctxMenuIdx);
            } else if (action === 'insert-between' && this.highlightedEdgeIdx >= 0) {
                this.insertBetween(this.highlightedEdgeIdx);
            } else if (action === 'insert-forward') {
                this.insertShiftForward();
            } else if (action === 'insert-back') {
                this.insertShiftBack();
            } else if (action === 'insert-panel') {
                void this._openInsertDialog();
            } else if (action === 'paste-screenmap') {
                void this._pasteFromClipboardAPI();
            } else if (action === 'copy-strip') {
                this._copySelectedStripToClipboard();
            } else if (action === 'inspect-json') {
                void this._openInspectJsonDialog();
            } else if (action === 'insert-ruler') {
                this._insertRulerAt(this.ctxMenuClickX, this.ctxMenuClickY);
            } else if (action === 'duplicate-ruler' && this.ctxMenuRulerIdx >= 0) {
                this._duplicateRuler(this.ctxMenuRulerIdx);
            } else if (action === 'delete-ruler' && this.ctxMenuRulerIdx >= 0) {
                this._deleteRuler(this.ctxMenuRulerIdx);
            } else if (action === 'kbd-help') {
                void this._openHelpOverlay();
            }
            this.hideContextMenu();
        }, { signal: this.signal });

        // Dismiss on any click outside
        window.addEventListener('mousedown', (e) => {
            if (this.ctxMenu?.style.display !== 'none' && !this.ctxMenu?.contains(e.target as Node | null)) {
                this.hideContextMenu();
            }
        }, { signal: this.signal });

        // ── Mouse interaction ─────────────────────────────────────────────

        // Pointer Events cover mouse, touch, and stylus with one interaction
        // path. PointerEvent extends MouseEvent, so the existing handlers can
        // consume these events without an unsafe cast.
        const overlayCanvas = this._oc();
        if ('PointerEvent' in window) {
            let activePointerId: number | null = null;
            overlayCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
                // Touch is handled by the existing TouchEvent path below. Letting
                // both paths see the same contact would start every gesture twice.
                if (e.pointerType === 'touch') return;
                this.onMouseDown(e);
                activePointerId = e.pointerId;
                overlayCanvas.setPointerCapture(e.pointerId);
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointermove', (e: PointerEvent) => {
                if (e.pointerType === 'touch') return;
                this.onMouseMove(e);
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointerup', (e: PointerEvent) => {
                if (e.pointerType === 'touch' || activePointerId !== e.pointerId) return;
                // Commit before releasing capture. releasePointerCapture emits
                // lostpointercapture, which is only cancellation when unexpected.
                this.onMouseUp(e);
                if (activePointerId === e.pointerId) activePointerId = null;
                if (overlayCanvas.hasPointerCapture(e.pointerId)) overlayCanvas.releasePointerCapture(e.pointerId);
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointercancel', (e: PointerEvent) => {
                if (e.pointerType === 'touch' || activePointerId !== e.pointerId) return;
                activePointerId = null;
                this.onPointerCancel();
            }, { signal: this.signal });
            overlayCanvas.addEventListener('lostpointercapture', (e: PointerEvent) => {
                if (activePointerId !== e.pointerId) return;
                activePointerId = null;
                this.onPointerCancel();
            }, { signal: this.signal });
            overlayCanvas.addEventListener('pointerleave', (e: PointerEvent) => {
                if (e.pointerType === 'touch') return;
                this.onMouseLeave();
            }, { signal: this.signal });
        } else {
            overlayCanvas.addEventListener('mousedown', (e: MouseEvent) => { this.onMouseDown(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mousemove', (e: MouseEvent) => { this.onMouseMove(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mouseup', (e: MouseEvent) => { this.onMouseUp(e); }, { signal: this.signal });
            overlayCanvas.addEventListener('mouseleave', () => { this.onMouseLeave(); }, { signal: this.signal });
        }
        // TouchEvents remain a supported test and mobile input path even when
        // pointer events are available; pointer listeners above do not receive
        // synthetic TouchEvents dispatched by the browser/app.
        this._wireTouchHandlers(this.signal);
        overlayCanvas.addEventListener('contextmenu', (e: MouseEvent) => { this.onContextMenu(e); }, { signal: this.signal });
        overlayCanvas.addEventListener('dblclick', (e: MouseEvent) => { this.onDoubleClick(e); }, { signal: this.signal });
        overlayCanvas.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const zoomFactor = Math.pow(2, -e.deltaY / 3000);
            this.applyInteractiveZoom(this.camZoom * zoomFactor);
        }, { passive: false, signal: this.signal });

        this.infoDiv = document.createElement('div');
        this.infoDiv.className = 'shapeeditor-canvas-label shapeeditor-info-div';
        this.wrapper.appendChild(this.infoDiv);

        this.placeholderDiv = document.createElement('div');
        this.placeholderDiv.className = 'shapeeditor-placeholder';
        this.placeholderDiv.textContent = 'Upload a screenmap file to begin';
        this.wrapper.appendChild(this.placeholderDiv);

        // ── Hint strip (lives inside #main, outside the renderer wrapper so
        // it sits above the canvas and is part of the tool's DOM) ──
        this.hintStripTextEl = this.container.querySelector<HTMLElement>('#hint_strip_text');
        this.hintStripHelpBtn = this.container.querySelector<HTMLButtonElement>('#hint_strip_help');
        if (this.hintStripHelpBtn) {
            this.hintStripHelpBtn.addEventListener('click', () => {
                void this._openHelpOverlay();
            }, { signal: this.signal });
        }
        this._updateHintStrip();

        this.buildGrid(width, height);
    },
    buildScreenmap(this: ShapeEditor, transformedPts: [number, number][]){

        const count = transformedPts.length;

        if (count !== this.lastBuiltPointCount) {
            // Point count changed — full rebuild required
            if (this.screenmapOutline) {
                this._scene().remove(this.screenmapOutline);
                this.screenmapOutline.geometry.dispose();
                ((this.screenmapOutline.material as Material)).dispose();
            }
            if (this.pointsMesh) {
                this._scene().remove(this.pointsMesh);
                this.pointsGeometry?.dispose();
                this.pointsMaterial?.dispose();
            }

            const hasMultiStrip = this.stripInfo && this.stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Build LineSegments pairs, skipping cross-strip boundaries.
                // Skip empty strips (count <= 0) so we don't introduce bogus boundaries.
                const stripColors = getStripColors(this._si().strips.length);
                const stripRgbs = stripColors.map(this.hslStringToRgb);
                const stripBoundaries = new Set();
                for (const strip of this._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                // Per-index strip lookup table — O(N) once, instead of O(N*S) inside the loop.
                const idxToStrip = new Int32Array(count).fill(-1);
                for (let s = 0; s < this._si().strips.length; s++) {
                    const st = this.nn(this._si().strips[s]);
                    const lo = Math.max(0, st.offset);
                    const hi = Math.min(count, st.offset + st.count);
                    for (let i = lo; i < hi; i++) idxToStrip[i] = s;
                }
                // Count valid segments (skip boundaries)
                let segCount = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (!stripBoundaries.has(i)) segCount++;
                }
                const lineVerts = new Float32Array(segCount * 2 * 3);
                const lineColors = new Float32Array(segCount * 2 * 3);
                let seg = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (stripBoundaries.has(i)) continue;
                    const rawStripIdx = idxToStrip[i] ?? 0;
                    const stripIdx = rawStripIdx >= 0 ? rawStripIdx : 0;
                    const rgb = this.nn(stripRgbs[stripIdx]);
                    const sr = this.nn(rgb[0]), sg = this.nn(rgb[1]), sb = this.nn(rgb[2]);
                    const pti = this.nn(transformedPts[i]), pti1 = this.nn(transformedPts[i + 1]);
                    const v = seg * 6;
                    lineVerts[v] = pti[0]; lineVerts[v + 1] = pti[1]; lineVerts[v + 2] = 0;
                    lineVerts[v + 3] = pti1[0]; lineVerts[v + 4] = pti1[1]; lineVerts[v + 5] = 0;
                    lineColors[v] = sr; lineColors[v + 1] = sg; lineColors[v + 2] = sb;
                    lineColors[v + 3] = sr; lineColors[v + 4] = sg; lineColors[v + 5] = sb;
                    seg++;
                }
                const lineGeom = new BufferGeometry();
                lineGeom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
                lineGeom.setAttribute('color', new Float32BufferAttribute(lineColors, 3));
                this.screenmapOutline = new LineSegments(lineGeom, new LineBasicMaterial({ vertexColors: true, transparent: true }));
            } else {
                const lineVerts = new Float32Array(count * 3);
                for (let i = 0; i < count; i++) {
                    const tp = this.nn(transformedPts[i]);
                    lineVerts[i * 3] = tp[0];
                    lineVerts[i * 3 + 1] = tp[1];
                    lineVerts[i * 3 + 2] = 0;
                }
                const lineGeom = new BufferGeometry();
                const linePosAttr = new Float32BufferAttribute(lineVerts, 3);
                linePosAttr.setUsage(DynamicDrawUsage);
                lineGeom.setAttribute('position', linePosAttr);
                this.screenmapOutline = new Line(lineGeom, new LineBasicMaterial({ color: 0x2196F3, transparent: true }));
            }
            this.screenmapOutline.renderOrder = 2;
            this._scene().add(this.screenmapOutline);

            const diameterCm = parseFloat(this.dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
            const pixelDiameter = Math.max(2, diameterCm * this.fitScale * scaleGlobal);

            const result = buildPointsMesh({
                points: transformedPts,
                circleTexture: this.circleTexture,
                diameter: pixelDiameter,
                defaultColor: [244 / 255, 67 / 255, 54 / 255],
            });
            (result.geometry.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage);

            this.pointsGeometry = result.geometry;
            this.pointsMaterial = result.material;
            this.pointsMesh = result.mesh;
            this.pointsColorAttr = result.colorAttribute;
            this.pointsMesh.renderOrder = 3;
            this._scene().add(this.pointsMesh);

            this.lastBuiltPointCount = count;
        } else {
            // Same point count — update buffers in place (no allocation)
            const hasMultiStrip = this.stripInfo && this.stripInfo.strips.length > 1;
            const outlinePos = this._outline().geometry.getAttribute('position');
            const pointsPos = this.pointsGeometry?.getAttribute('position');

            if (hasMultiStrip) {
                // LineSegments layout: pairs of vertices, skipping cross-strip boundaries.
                // Skip empty strips so we don't introduce bogus boundary indices.
                const stripBoundaries = new Set();
                for (const strip of this._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                let seg = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (stripBoundaries.has(i)) continue;
                    const v = seg * 2;
                    const pti = this.nn(transformedPts[i]), pti1 = this.nn(transformedPts[i + 1]);
                    outlinePos.setXY(v, pti[0], pti[1]);
                    outlinePos.setXY(v + 1, pti1[0], pti1[1]);
                    seg++;
                }
            } else {
                for (let i = 0; i < count; i++) {
                    const tp = this.nn(transformedPts[i]);
                    outlinePos.setXY(i, tp[0], tp[1]);
                }
            }
            if (pointsPos) {
                for (let i = 0; i < count; i++) {
                    const tp = this.nn(transformedPts[i]);
                    pointsPos.setXY(i, tp[0], tp[1]);
                }
                pointsPos.needsUpdate = true;
            }
            outlinePos.needsUpdate = true;

            // Update point size
            const diameterCm = parseFloat(this.dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
            if (this.pointsMaterial) this.pointsMaterial.size = Math.max(2, diameterCm * this.fitScale * scaleGlobal);
        }

        // Update colors (selection highlight, first/last LED markers)
        if (this.pointsColorAttr) {
            const colors = this.pointsColorAttr.array;
            const hasMultiStrip = this.stripInfo && this.stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Per-strip coloring (dim non-selected strips when one is selected)
                const stripColors = getStripColors(this._si().strips.length);
                const stripRgbs = stripColors.map(this.hslStringToRgb);
                const selectedStrips = this.selection.getSelectedStripIdxs();
                const dim = 0.35;
                for (let s = 0; s < this._si().strips.length; s++) {
                    const strip = this.nn(this._si().strips[s]);
                    const rgb = this.nn(stripRgbs[s]);
                    let sr = this.nn(rgb[0]), sg = this.nn(rgb[1]), sb = this.nn(rgb[2]);
                    if (selectedStrips.size > 0 && !selectedStrips.has(s)) {
                        sr *= dim; sg *= dim; sb *= dim;
                    }
                    for (let i = strip.offset; i < strip.offset + strip.count && i < count; i++) {
                        const ci = i * 3;
                        colors[ci] = sr; colors[ci + 1] = sg; colors[ci + 2] = sb;
                    }
                }
            } else {
                // Single-strip: default red
                const r = 244 / 255, g = 67 / 255, b = 54 / 255;
                for (let i = 0; i < count; i++) {
                    const ci = i * 3;
                    colors[ci] = r; colors[ci + 1] = g; colors[ci + 2] = b;
                }
            }
            // First LED green
            colors[0] = 76 / 255; colors[1] = 175 / 255; colors[2] = 80 / 255;
            // Marquee multi-selection: paint every selected LED cyan.
            if (this.multiSelectedIdxs.size > 0) {
                for (const i of this.multiSelectedIdxs) {
                    if (i < 0 || i >= count) continue;
                    const ci = i * 3;
                    colors[ci] = 0; colors[ci + 1] = 1; colors[ci + 2] = 1;
                }
            }
            // Single selected LED cyan (existing single-selection highlight)
            if (this.selectedIdx > 0 && this.selectedIdx < count) {
                const ci = this.selectedIdx * 3;
                colors[ci] = 0; colors[ci + 1] = 1; colors[ci + 2] = 1;
            }
            this.pointsColorAttr.needsUpdate = true;
        }
    },
    updateLabels(this: ShapeEditor, transformedPts: [number, number][]){

        if (transformedPts.length === 0) {
            this._placeholderDiv().style.display = '';
            this._infoDiv().textContent = '';
            return;
        }

        this._placeholderDiv().style.display = 'none';

        const scaleG = parseFloat(this.dom_txt_scale.value) || 1;
        const sX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleG;
        const sY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleG;
        const physW = (this.origWidth * sX).toFixed(2);
        const physH = (this.origHeight * sY).toFixed(2);

        this._infoDiv().innerHTML =
            `Points: ${String(this.screenmap_pts.length)}<br>Size: ${physW} &times; ${physH} cm` +
            `<br><span class="shapeeditor-info-hint">Shift+click: insert between &nbsp; Ctrl+click: extend end</span>`;
    },
    handleResize(this: ShapeEditor){

        const { width, height } = this.getCanvasSize();
        this.canvasW = width;
        this.canvasH = height;
        this._renderer().setSize(width, height);

        const hw = width / 2, hh = height / 2;
        this._camera().left = -hw;
        this._camera().right = hw;
        this._camera().top = -hh;
        this._camera().bottom = hh;
        this._camera().zoom = this.camZoom;
        this._camera().updateProjectionMatrix();

        const dpr = window.devicePixelRatio || 1;
        this._oc().width = width * dpr;
        this._oc().height = height * dpr;
        this._octx().scale(dpr, dpr);

        this.buildGrid(width, height);
        this.drawOverlay();
    },
    animate(this: ShapeEditor){

        this.rafId = requestAnimationFrame(() => {
            this.animate();
        });

        // Auto-sync canvas/camera/overlay if mainEl dimensions changed
        const { width: curW, height: curH } = this.getCanvasSize();
        if (curW !== this.canvasW || curH !== this.canvasH) {
            this.handleResize();
            this.geometryDirty = true;
            this.frameDirty = true;
        }

        // Keep animating while overlayAlpha is mid-transition
        const targetAlpha = this.isHovering ? 1 : 0;
        if (Math.abs(this.overlayAlpha - targetAlpha) > 0.001) this.frameDirty = true;
        if (this.directionArrowTransition.isActive()) this.frameDirty = true;

        // Issue #111: drag preview lifecycle.
        // While a gizmo drag is in flight, push the live transform delta to
        // the mesh model matrix instead of rebaking the vertex buffer. When
        // the drag ends, animate() reverts the mesh transforms so the next
        // baked rebuild lines up.
        const previewing = this._isGizmoDragPreview();
        if (previewing) {
            this._dragPreviewActive = true;
            this.frameDirty = true;
        } else if (this._dragPreviewActive) {
            this._resetMeshTransforms();
            this._dragPreviewActive = false;
            // Bake the committed transform into the buffer this frame.
            this.geometryDirty = true;
            this.frameDirty = true;
        }

        // Nothing to do — skip all work this frame
        if (!this.geometryDirty && !this.frameDirty) return;

        if (this.screenmap_pts.length > 0) {
            // The rebuild path bakes the current DOM transform into the
            // points-mesh / outline buffers. While previewing, handleGizmoDrag
            // no longer sets geometryDirty, so this only runs at preview entry
            // (if the buffer was stale) and at preview exit (to bake the
            // committed transform).
            if (this.geometryDirty) {
                const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
                const scaleX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleGlobal;
                const scaleY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleGlobal;
                const rotateDeg = parseInt(this.dom_txt_rotate.value) || 0;
                const rotateRad = rotateDeg * Math.PI / 180;
                const cosR = Math.cos(rotateRad);
                const sinR = Math.sin(rotateRad);
                const tx = parseFloat(this.dom_txt_translate_x.value) || 0;
                const ty = parseFloat(this.dom_txt_translate_y.value) || 0;

                const transformedPts: [number, number][] = this.screenmap_pts.map(([x, y]: [number, number]) => {
                    const sx = x * scaleX;
                    const sy = y * scaleY;
                    return [
                        sx * cosR - sy * sinR + tx,
                        sx * sinR + sy * cosR + ty,
                    ] as [number, number];
                });
                this.lastTransformedPts = transformedPts;
                this.buildScreenmap(transformedPts);
                this.updateLabels(transformedPts);
            }
            // Push the live drag delta onto the (possibly just-rebuilt) mesh.
            // No-op when not previewing.
            if (previewing) this._applyDragPreviewMatrices();
            this.drawOverlay();
        } else {
            if (this.screenmapOutline) {
                this._scene().remove(this.screenmapOutline);
                this.screenmapOutline.geometry.dispose();
                ((this.screenmapOutline.material as Material)).dispose();
                this.screenmapOutline = null;
            }
            if (this.pointsMesh) {
                this._scene().remove(this.pointsMesh);
                this.pointsGeometry?.dispose();
                this.pointsMaterial?.dispose();
                this.pointsMesh = null;
                this.lastBuiltPointCount = -1;
            }
            this.updateLabels([]);
            this.lastTransformedPts = [];
            this.drawOverlay();
        }

        // Apply camera pan/zoom (view-only, not an edit)
        this._camera().position.x = -this.camPanX;
        this._camera().position.y = -this.camPanY;
        this._camera().zoom = this.camZoom;
        this._camera().updateProjectionMatrix();

        this._renderer().render(this._scene(), this._camera());

        this.geometryDirty = false;
        this.frameDirty = false;
    },
};
