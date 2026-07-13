// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 7/8).

import { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, Float32BufferAttribute, DynamicDrawUsage, LineSegments, LineBasicMaterial, Line, type BufferAttribute, type Material } from 'three';

import type { PanelOpts, WiringStyle, DataInCorner, RotationDeg } from './panel-catalog';
import { getStripColors } from '../common';
import { gfxColors, withAlpha } from '../ui/theme';

import { notePinMutation } from '../screenmap-store';

import { buildPointsMesh } from '../three-utils';

import { getCatalogEntry, generatePanelPoints } from './panel-catalog';
import { snapToGrid } from './grid-snap';

import type { UndoAction } from './shapeeditor-types';

ShapeEditor.prototype._wireTouchHandlers = function (this: ShapeEditor, signal: AbortSignal) {

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
    };

ShapeEditor.prototype.onMouseLeave = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.buildScreenmap = function (this: ShapeEditor, transformedPts: [number, number][]) {

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
                const selStrip = this.selection.getStripIdx();
                const dim = 0.35;
                for (let s = 0; s < this._si().strips.length; s++) {
                    const strip = this.nn(this._si().strips[s]);
                    const rgb = this.nn(stripRgbs[s]);
                    let sr = this.nn(rgb[0]), sg = this.nn(rgb[1]), sb = this.nn(rgb[2]);
                    if (selStrip !== null && s !== selStrip) {
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
    };

ShapeEditor.prototype.updateLabels = function (this: ShapeEditor, transformedPts: [number, number][]) {

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
    };

ShapeEditor.prototype.handleResize = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.animate = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype._readPanelOpts = function (this: ShapeEditor): PanelOpts {

        const rot = parseInt(this.dom_pp_rotation.value, 10) || 0;
        // Clamp to the valid RotationDeg union
        const validRots: RotationDeg[] = [0, 90, 180, 270];
        const rotation = (validRots.includes(rot as RotationDeg)
            ? rot
            : 0) as RotationDeg;
        return {
            wiring: this.dom_pp_wiring.value as WiringStyle,
            dataInCorner: this.dom_pp_corner.value as DataInCorner,
            rotation,
            flipH: this.dom_pp_flipH.checked,
            flipV: this.dom_pp_flipV.checked,
            spacing: parseFloat(this.dom_pp_spacing.value) || 1,
        };
    };

ShapeEditor.prototype._enterPlacing = function (this: ShapeEditor, catalogId: string) {

        const entry = getCatalogEntry(catalogId);
        if (!entry) return;
        // Placement owns the canvas until the new panel is committed. Exit
        // chain/reorder mode up front so the placed strip is immediately
        // selectable and draggable instead of inheriting a stale mode that
        // deliberately suppresses LED hit-testing.
        if (this.editorMode) this.setEditorMode(null);
        const opts = this._readPanelOpts();
        const localPts = generatePanelPoints(entry, opts);
        this.placingState = { entry, opts, localPts, ghostWorld: null };
        this._updateHintStrip();
        this.dom_pp_status.textContent = `Placing ${entry.label} — click canvas (Esc to cancel)`;
        this._oc().style.cursor = 'crosshair';
        this.setNeedsRender();
    };

ShapeEditor.prototype._cancelPlacing = function (this: ShapeEditor) {

        this.placingState = null;
        this.pendingNewStripPin = null;
        this.dom_pp_status.textContent = '';
        this._oc().style.cursor = 'default';
        this.setNeedsRender();
        this._updateHintStrip();
    };

ShapeEditor.prototype._canvasToWorldPx = function (this: ShapeEditor, cx: number, cy: number): [number, number] {

        return [
            (cx - this.canvasW / 2) / this.camZoom - this.camPanX,
            (cy - this.canvasH / 2) / this.camZoom - this.camPanY,
        ];
    };

ShapeEditor.prototype._gridSizePx = function (this: ShapeEditor) {

        const grid = parseFloat(this.dom_pp_grid.value) || 1;
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        return grid * fs;
    };

ShapeEditor.prototype._updateGhostFromCanvas = function (this: ShapeEditor, cx: number, cy: number) {

        if (!this.placingState) return;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        this.placingState.ghostWorld = [wx, wy];
        this.setNeedsRender();
    };

ShapeEditor.prototype._drawPlacingGhost = function (this: ShapeEditor) {

        if (!this.placingState?.ghostWorld) return;
        const ctx = this._octx();
        const [wx, wy] = this.placingState.ghostWorld;
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        const pts = this.placingState.localPts;
        if (pts.length === 0) return;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(gfxColors.accentBlue(), 0.9);
        ctx.fillStyle = withAlpha(gfxColors.accentBlue(), 0.4);
        // Connecting polyline (wiring order)
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const [px, py] = this.nn(pts[i]);
            const [cx, cy] = this.toCanvasCoords(wx + px * fs, wy + py * fs);
            if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        const r = Math.max(2, 0.3 * fs * this.camZoom);
        for (const [px, py] of pts) {
            const [cx, cy] = this.toCanvasCoords(wx + px * fs, wy + py * fs);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Crosshair at origin
        const [ocx, ocy] = this.toCanvasCoords(wx, wy);
        ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.8);
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    };

ShapeEditor.prototype._uniqueStripName = function (this: ShapeEditor, base: string) {

        const used = new Set();
        const strips = this.stripStore.getStrips();
        for (const s of strips) used.add(s.name);
        let i = 1;
        while (used.has(`${base}${String(i)}`)) i++;
        return `${base}${String(i)}`;
    };

ShapeEditor.prototype._isEmptyScreenmap = function (this: ShapeEditor) {

        return !this.stripInfo || this.stripInfo.strips.length === 0
            || (this.stripInfo.strips.length === 1 && (this.stripInfo.strips[0]?.count ?? 0) <= 1
                && this.stripInfo.totalCount <= 1);
    };

ShapeEditor.prototype._initFreshScreenmapForPanel = function (this: ShapeEditor) {

        // Initialise transform + fitScale + storage for a brand-new screenmap
        // when the user places a panel onto an empty editor.
        this.screenmap_pts = [];
        this.rawPts = [];
        this.stripInfo = null;
        this.stripStore.load(null);
        this.origDiameter = 0.5;
        this.dom_txt_diameter.value = String(this.origDiameter);
        this.origWidth = 0;
        this.origHeight = 0;
        // Choose a fitScale that gives a reasonable initial pixel pitch.
        const { width: fitW, height: fitH } = this.getFitSize();
        this.fitScale = Math.min(fitW, fitH) / 40;
        if (!isFinite(this.fitScale) || this.fitScale <= 0) this.fitScale = 20;
        this.resetTransforms();
    };

ShapeEditor.prototype._commitPlacingAt = function (this: ShapeEditor, cx: number, cy: number) {

        if (!this.placingState) return;
        const entry = this.placingState.entry;
        const opts = this.placingState.opts;
        let [wx, wy] = this._canvasToWorldPx(cx, cy);
        if (this.dom_pp_snap.checked) {
            const gpx = this._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        if (this._isEmptyScreenmap()) {
            this._initFreshScreenmapForPanel();
        }
        const name = this._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId: entry.id,
            opts: { ...opts },
            worldX: wx,
            worldY: wy,
            name,
            pin: this.pendingNewStripPin ?? this._defaultNewStripPin(),
        };
        this.pendingNewStripPin = null;
        this._doPanelPlace(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        this.placingState = null;
        this.dom_pp_status.textContent = `Placed ${entry.label} as ${name}`;
        this._oc().style.cursor = 'default';
        this._updateHintStrip();
    };

ShapeEditor.prototype._doPanelPlace = function (this: ShapeEditor, action: UndoAction) {

        const entry = getCatalogEntry(action.catalogId as string);
        if (!entry) return;
        const localPts = generatePanelPoints(entry, (action.opts as PanelOpts | undefined) ?? {});
        const fs = this.fitScale > 0 ? this.fitScale : 1;
        // rawPts (cm-units): use worldX/worldY divided by fitScale to place
        // the panel origin at the click point. screenmap_pts = rawPts * fs
        // - offset (keeps consistency with existing screenmap_pts coords).
        // For a fresh map (rawPts empty) we set rawPts directly so
        // rawPts[i]*fitScale == screenmap_pts[i].
        const screenmapPts: [number, number][] = [];
        const rawPtsAdd: [number, number][] = [];
        // Determine current "raw->screenmap" offset using existing point 0
        let offX = 0, offY = 0;
        if (this.rawPts.length > 0) {
            offX = this.nn(this.rawPts[0])[0] * fs - this.nn(this.screenmap_pts[0])[0];
            offY = this.nn(this.rawPts[0])[1] * fs - this.nn(this.screenmap_pts[0])[1];
        }
        const actionWorldX = action.worldX as number;
        const actionWorldY = action.worldY as number;
        for (const [px, py] of localPts) {
            const sx = actionWorldX + px * fs;
            const sy = actionWorldY + py * fs;
            screenmapPts.push([sx, sy]);
            rawPtsAdd.push([(sx + offX) / fs, (sy + offY) / fs]);
        }
        // Append to flat arrays
        const insertAt = this.screenmap_pts.length;
        for (let i = 0; i < screenmapPts.length; i++) {
            this.screenmap_pts.push(this.nn(screenmapPts[i]));
            this.rawPts.push(this.nn(rawPtsAdd[i]));
        }
        const newIdx = this.stripStore.addStrip({
            name: action.name as string,
            points: rawPtsAdd,
            diameter: typeof this.origDiameter === 'number' ? this.origDiameter : 0.5,
            video_offset: insertAt,
            pin: (typeof action.pin === 'string' && action.pin) ? (action.pin) : 'pin1',
            videoOffsetOverride: false,
        });
        this.stripInfo = this.stripStore.get();
        // origWidth/Height may still be 0 for fresh maps — recompute from rawPts
        // so the cm size label is reasonable.
        if (this.origWidth === 0 && this.origHeight === 0 && this.rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of this.rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            this.origWidth = xmax - xmin;
            this.origHeight = ymax - ymin;
        }
        this.selection.selectStrip(newIdx);
        action._insertAt = insertAt;
        action._count = screenmapPts.length;
    };

ShapeEditor.prototype._redoPanelPlace = function (this: ShapeEditor, action: UndoAction) {

        this._doPanelPlace(action);
    };

ShapeEditor.prototype._undoPanelPlace = function (this: ShapeEditor, action: UndoAction) {

        if (!this.stripInfo) return;
        // Find the strip we added by name (most reliable after reordering).
        let stripIdx = -1;
        const strips = this.stripInfo.strips;
        for (let i = strips.length - 1; i >= 0; i--) {
            if (strips[i]?.name === action.name) { stripIdx = i; break; }
        }
        if (stripIdx < 0) return;
        const strip = this.nn(strips[stripIdx]);
        this.screenmap_pts.splice(strip.offset, strip.count);
        this.rawPts.splice(strip.offset, strip.count);
        this.stripStore.removeStrip(stripIdx);
        this.selection.onStripRemove(stripIdx);
        this.selectedIdx = -1;
        this.stripInfo = this.stripStore.get();
    };

ShapeEditor.prototype._debugPlacePanel = function (this: ShapeEditor, catalogId: string, worldX: number, worldY: number, opts: PanelOpts) {

        const entry = getCatalogEntry(catalogId);
        if (!entry) return null;
        const mergedOpts = { ...this._readPanelOpts(), ...opts };
        if (this._isEmptyScreenmap()) {
            this._initFreshScreenmapForPanel();
        }
        const name = this._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId,
            opts: mergedOpts,
            worldX,
            worldY,
            name,
            pin: this.pendingNewStripPin ?? this._defaultNewStripPin(),
        };
        this.pendingNewStripPin = null;
        this._doPanelPlace(action);
        this.pushUndo(action);
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        return name;
    };
