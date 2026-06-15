// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 7/8).

import { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, Float32BufferAttribute, DynamicDrawUsage, LineSegments, LineBasicMaterial, Line, type BufferAttribute, type Material } from 'three';

import type { PanelOpts, WiringStyle, DataInCorner, RotationDeg } from './panel-catalog';
import { getStripColors } from '../common';

import { notePinMutation } from '../screenmap-store';

import { buildPointsMesh } from '../three-utils';

import { getCatalogEntry, generatePanelPoints } from './panel-catalog';
import { snapToGrid } from './grid-snap';

import type { UndoAction } from './shapeeditor-types';

ShapeEditor.prototype._wireTouchHandlers = function (this: ShapeEditor, signal: AbortSignal) {
    const self = this;

        self._oc().addEventListener('touchstart', (e: TouchEvent) => {
            // Cancel scrolling/zooming on the page during canvas touches
            e.preventDefault();
            if (e.touches.length === 1) {
                const t = self.nn(e.touches[0]);
                self.touchMode = 'single';
                self.touchStartClientX = t.clientX;
                self.touchStartClientY = t.clientY;
                const [cx, cy] = self.getCanvasCoords(t);
                self.touchStartCanvasX = cx;
                self.touchStartCanvasY = cy;
                // Start long-press timer
                self._clearLongPress();
                self.longPressTimer = setTimeout(() => {
                    self.longPressTimer = null;
                    if (self.touchMode !== 'single') return;
                    self._doLongPress(self.touchStartCanvasX, self.touchStartCanvasY, self.touchStartClientX, self.touchStartClientY);
                }, self.LONG_PRESS_MS);
                // Forward as a synthesized mousedown for the drag/select path
                self._synth('mousedown', t.clientX, t.clientY);
            } else if (e.touches.length >= 2) {
                // Cancel any single-touch state cleanly
                self._clearLongPress();
                if (self.touchMode === 'single') {
                    self._cancelSingleTouchGesture();
                }
                self.touchMode = 'multi';
                const t0 = self.nn(e.touches[0]), t1 = self.nn(e.touches[1]);
                self.multiStartCentroid = [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                self.multiStartDist = Math.hypot(dxs, dys) || 1;
                self.multiPanStartCamPanX = self.camPanX;
                self.multiPanStartCamPanY = self.camPanY;
                self.multiPinchStartZoom = self.camZoom;
            }
        }, { passive: false, signal });

        self._oc().addEventListener('touchmove', (e: TouchEvent) => {
            e.preventDefault();
            if (self.touchMode === 'longpress-fired') return;
            if (self.touchMode === 'single' && e.touches.length === 1) {
                const t = self.nn(e.touches[0]);
                const ddx = t.clientX - self.touchStartClientX;
                const ddy = t.clientY - self.touchStartClientY;
                if (Math.hypot(ddx, ddy) > self.LONG_PRESS_MOVE_TOL) self._clearLongPress();
                self._synth('mousemove', t.clientX, t.clientY);
                return;
            }
            if (self.touchMode === 'multi' && e.touches.length >= 2) {
                const t0 = self.nn(e.touches[0]), t1 = self.nn(e.touches[1]);
                const cx = (t0.clientX + t1.clientX) / 2;
                const cy = (t0.clientY + t1.clientY) / 2;
                const dx = cx - (self.multiStartCentroid?.[0] ?? 0);
                const dy = cy - (self.multiStartCentroid?.[1] ?? 0);
                // Pan: centroid delta in client px -> canvas px -> world px
                const rect = self._oc().getBoundingClientRect();
                const sx = self.canvasW / rect.width;
                const sy = self.canvasH / rect.height;
                self.camPanX = self.multiPanStartCamPanX + (dx * sx) / self.camZoom;
                self.camPanY = self.multiPanStartCamPanY + (dy * sy) / self.camZoom;
                // Pinch: distance ratio
                const dxs = t0.clientX - t1.clientX;
                const dys = t0.clientY - t1.clientY;
                const dist = Math.hypot(dxs, dys) || 1;
                const ratio = dist / self.multiStartDist;
                self.camZoom = Math.max(0.1, Math.min(10, self.multiPinchStartZoom * ratio));
                self.setNeedsRender();
            }
        }, { passive: false, signal });

        self._oc().addEventListener('touchend', (e: TouchEvent) => {
            e.preventDefault();
            self._clearLongPress();
            if (self.touchMode === 'longpress-fired') {
                // Discard the residual touch — drag was already cancelled.
                if (e.touches.length === 0) {
                    self.touchMode = 'idle';
                }
                return;
            }
            if (self.touchMode === 'single') {
                // Forward as mouseup to commit / select
                const t = e.changedTouches[0] ?? null;
                if (t) {
                    self._synth('mouseup', t.clientX, t.clientY);
                }
                self.touchMode = 'idle';
                return;
            }
            if (self.touchMode === 'multi') {
                if (e.touches.length === 0) {
                    self.touchMode = 'idle';
                } else if (e.touches.length === 1) {
                    // Demote to single but don't restart drag — leave idle so
                    // the user can lift their second finger without surprises.
                    self.touchMode = 'idle';
                }
            }
        }, { passive: false, signal });

        self._oc().addEventListener('touchcancel', () => {
            self._clearLongPress();
            self._cancelSingleTouchGesture();
            self.touchMode = 'idle';
        }, { passive: true, signal });
    };

ShapeEditor.prototype.onMouseLeave = function (this: ShapeEditor) {
    const self = this;

        if (self.gizmoActive) {
            self.commitGizmoDrag();
            self.gizmoActive = null;
            self.gizmoDragStart = null;
        }
        self.gizmoHover = null;
        if (self.bgGizmoActive) {
            self.bgGizmoActive = null;
            self.bgGizmoDragStart = null;
        }
        self.bgGizmoHover = null;
        if (self.isPanning) {
            self.isPanning = false;
        }
        if (self.rightButtonDown) {
            self.rightButtonDown = false;
            self.rightClickMoved = false;
        }
        if (self.isDragging && self.selectedIdx >= 0) {
            // Finalize drag on leave
            const newScreenmapPt = [...self.nn(self.screenmap_pts[self.selectedIdx])];
            const newRawPt = [...self.nn(self.rawPts[self.selectedIdx])];
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
        }
        if (self.stripDragActive) {
            self._finalizeStripDrag();
        }
        self.isHovering = false;
        self.tooltipLedIdx = -1;
        self._tooltip().style.opacity = '0';
        self._oc().style.cursor = 'default';
    };

ShapeEditor.prototype.buildScreenmap = function (this: ShapeEditor, transformedPts: [number, number][]) {
    const self = this;

        const count = transformedPts.length;

        if (count !== self.lastBuiltPointCount) {
            // Point count changed — full rebuild required
            if (self.screenmapOutline) {
                self._scene().remove(self.screenmapOutline);
                self.screenmapOutline.geometry.dispose();
                ((self.screenmapOutline.material as Material)).dispose();
            }
            if (self.pointsMesh) {
                self._scene().remove(self.pointsMesh);
                self.pointsGeometry?.dispose();
                self.pointsMaterial?.dispose();
            }

            const hasMultiStrip = self.stripInfo && self.stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Build LineSegments pairs, skipping cross-strip boundaries.
                // Skip empty strips (count <= 0) so we don't introduce bogus boundaries.
                const stripColors = getStripColors(self._si().strips.length);
                const stripRgbs = stripColors.map(self.hslStringToRgb);
                const stripBoundaries = new Set();
                for (const strip of self._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                // Per-index strip lookup table — O(N) once, instead of O(N*S) inside the loop.
                const idxToStrip = new Int32Array(count).fill(-1);
                for (let s = 0; s < self._si().strips.length; s++) {
                    const st = self.nn(self._si().strips[s]);
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
                    const rgb = self.nn(stripRgbs[stripIdx]);
                    const sr = self.nn(rgb[0]), sg = self.nn(rgb[1]), sb = self.nn(rgb[2]);
                    const pti = self.nn(transformedPts[i]), pti1 = self.nn(transformedPts[i + 1]);
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
                self.screenmapOutline = new LineSegments(lineGeom, new LineBasicMaterial({ vertexColors: true, transparent: true }));
            } else {
                const lineVerts = new Float32Array(count * 3);
                for (let i = 0; i < count; i++) {
                    const tp = self.nn(transformedPts[i]);
                    lineVerts[i * 3] = tp[0];
                    lineVerts[i * 3 + 1] = tp[1];
                    lineVerts[i * 3 + 2] = 0;
                }
                const lineGeom = new BufferGeometry();
                const linePosAttr = new Float32BufferAttribute(lineVerts, 3);
                linePosAttr.setUsage(DynamicDrawUsage);
                lineGeom.setAttribute('position', linePosAttr);
                self.screenmapOutline = new Line(lineGeom, new LineBasicMaterial({ color: 0x2196F3, transparent: true }));
            }
            self.screenmapOutline.renderOrder = 2;
            self._scene().add(self.screenmapOutline);

            const diameterCm = parseFloat(self.dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
            const pixelDiameter = Math.max(2, diameterCm * self.fitScale * scaleGlobal);

            const result = buildPointsMesh({
                points: transformedPts,
                circleTexture: self.circleTexture,
                diameter: pixelDiameter,
                defaultColor: [244 / 255, 67 / 255, 54 / 255],
            });
            (result.geometry.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage);

            self.pointsGeometry = result.geometry;
            self.pointsMaterial = result.material;
            self.pointsMesh = result.mesh;
            self.pointsColorAttr = result.colorAttribute;
            self.pointsMesh.renderOrder = 3;
            self._scene().add(self.pointsMesh);

            self.lastBuiltPointCount = count;
        } else {
            // Same point count — update buffers in place (no allocation)
            const hasMultiStrip = self.stripInfo && self.stripInfo.strips.length > 1;
            const outlinePos = self._outline().geometry.getAttribute('position');
            const pointsPos = self.pointsGeometry?.getAttribute('position');

            if (hasMultiStrip) {
                // LineSegments layout: pairs of vertices, skipping cross-strip boundaries.
                // Skip empty strips so we don't introduce bogus boundary indices.
                const stripBoundaries = new Set();
                for (const strip of self._si().strips) {
                    if (strip.count > 0) {
                        stripBoundaries.add(strip.offset + strip.count - 1);
                    }
                }
                let seg = 0;
                for (let i = 0; i < count - 1; i++) {
                    if (stripBoundaries.has(i)) continue;
                    const v = seg * 2;
                    const pti = self.nn(transformedPts[i]), pti1 = self.nn(transformedPts[i + 1]);
                    outlinePos.setXY(v, pti[0], pti[1]);
                    outlinePos.setXY(v + 1, pti1[0], pti1[1]);
                    seg++;
                }
            } else {
                for (let i = 0; i < count; i++) {
                    const tp = self.nn(transformedPts[i]);
                    outlinePos.setXY(i, tp[0], tp[1]);
                }
            }
            if (pointsPos) {
                for (let i = 0; i < count; i++) {
                    const tp = self.nn(transformedPts[i]);
                    pointsPos.setXY(i, tp[0], tp[1]);
                }
                pointsPos.needsUpdate = true;
            }
            outlinePos.needsUpdate = true;

            // Update point size
            const diameterCm = parseFloat(self.dom_txt_diameter.value) || 0.5;
            const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
            if (self.pointsMaterial) self.pointsMaterial.size = Math.max(2, diameterCm * self.fitScale * scaleGlobal);
        }

        // Update colors (selection highlight, first/last LED markers)
        if (self.pointsColorAttr) {
            const colors = self.pointsColorAttr.array;
            const hasMultiStrip = self.stripInfo && self.stripInfo.strips.length > 1;

            if (hasMultiStrip) {
                // Per-strip coloring (dim non-selected strips when one is selected)
                const stripColors = getStripColors(self._si().strips.length);
                const stripRgbs = stripColors.map(self.hslStringToRgb);
                const selStrip = self.selection.getStripIdx();
                const dim = 0.35;
                for (let s = 0; s < self._si().strips.length; s++) {
                    const strip = self.nn(self._si().strips[s]);
                    const rgb = self.nn(stripRgbs[s]);
                    let sr = self.nn(rgb[0]), sg = self.nn(rgb[1]), sb = self.nn(rgb[2]);
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
            // Selected LED cyan
            if (self.selectedIdx > 0 && self.selectedIdx < count) {
                const ci = self.selectedIdx * 3;
                colors[ci] = 0; colors[ci + 1] = 1; colors[ci + 2] = 1;
            }
            self.pointsColorAttr.needsUpdate = true;
        }
    };

ShapeEditor.prototype.updateLabels = function (this: ShapeEditor, transformedPts: [number, number][]) {
    const self = this;

        if (transformedPts.length === 0) {
            self._placeholderDiv().style.display = '';
            self._infoDiv().textContent = '';
            return;
        }

        self._placeholderDiv().style.display = 'none';

        const scaleG = parseFloat(self.dom_txt_scale.value) || 1;
        const sX = (parseFloat(self.dom_txt_scale_x.value) || 1) * scaleG;
        const sY = (parseFloat(self.dom_txt_scale_y.value) || 1) * scaleG;
        const physW = (self.origWidth * sX).toFixed(2);
        const physH = (self.origHeight * sY).toFixed(2);

        self._infoDiv().innerHTML =
            `Points: ${String(self.screenmap_pts.length)}<br>Size: ${physW} &times; ${physH} cm` +
            `<br><span style="opacity:0.5;font-size:12px">Shift+click: insert between &nbsp; Ctrl+click: extend end</span>`;
    };

ShapeEditor.prototype.handleResize = function (this: ShapeEditor) {
    const self = this;

        const { width, height } = self.getCanvasSize();
        self.canvasW = width;
        self.canvasH = height;
        self._renderer().setSize(width, height);

        const hw = width / 2, hh = height / 2;
        self._camera().left = -hw;
        self._camera().right = hw;
        self._camera().top = -hh;
        self._camera().bottom = hh;
        self._camera().zoom = self.camZoom;
        self._camera().updateProjectionMatrix();

        const dpr = window.devicePixelRatio || 1;
        self._oc().width = width * dpr;
        self._oc().height = height * dpr;
        self._octx().scale(dpr, dpr);

        self.buildGrid(width, height);
        self.drawOverlay();
    };

ShapeEditor.prototype.animate = function (this: ShapeEditor) {
    const self = this;

        self.rafId = requestAnimationFrame(() => self.animate());

        // Auto-sync canvas/camera/overlay if mainEl dimensions changed
        const { width: curW, height: curH } = self.getCanvasSize();
        if (curW !== self.canvasW || curH !== self.canvasH) {
            self.handleResize();
            self.geometryDirty = true;
            self.frameDirty = true;
        }

        // Keep animating while overlayAlpha is mid-transition
        const targetAlpha = self.isHovering ? 0 : 1;
        if (Math.abs(self.overlayAlpha - targetAlpha) > 0.001) self.frameDirty = true;

        // Issue #111: drag preview lifecycle.
        // While a gizmo drag is in flight, push the live transform delta to
        // the mesh model matrix instead of rebaking the vertex buffer. When
        // the drag ends, animate() reverts the mesh transforms so the next
        // baked rebuild lines up.
        const previewing = self._isGizmoDragPreview();
        if (previewing) {
            self._dragPreviewActive = true;
            self.frameDirty = true;
        } else if (self._dragPreviewActive) {
            self._resetMeshTransforms();
            self._dragPreviewActive = false;
            // Bake the committed transform into the buffer this frame.
            self.geometryDirty = true;
            self.frameDirty = true;
        }

        // Nothing to do — skip all work this frame
        if (!self.geometryDirty && !self.frameDirty) return;

        if (self.screenmap_pts.length > 0) {
            // The rebuild path bakes the current DOM transform into the
            // points-mesh / outline buffers. While previewing, handleGizmoDrag
            // no longer sets geometryDirty, so this only runs at preview entry
            // (if the buffer was stale) and at preview exit (to bake the
            // committed transform).
            if (self.geometryDirty) {
                const scaleGlobal = parseFloat(self.dom_txt_scale.value) || 1;
                const scaleX = (parseFloat(self.dom_txt_scale_x.value) || 1) * scaleGlobal;
                const scaleY = (parseFloat(self.dom_txt_scale_y.value) || 1) * scaleGlobal;
                const rotateDeg = parseInt(self.dom_txt_rotate.value) || 0;
                const rotateRad = rotateDeg * Math.PI / 180;
                const cosR = Math.cos(rotateRad);
                const sinR = Math.sin(rotateRad);
                const tx = parseFloat(self.dom_txt_translate_x.value) || 0;
                const ty = parseFloat(self.dom_txt_translate_y.value) || 0;

                const transformedPts: [number, number][] = self.screenmap_pts.map(([x, y]: [number, number]) => {
                    const sx = x * scaleX;
                    const sy = y * scaleY;
                    return [
                        sx * cosR - sy * sinR + tx,
                        sx * sinR + sy * cosR + ty,
                    ] as [number, number];
                });
                self.lastTransformedPts = transformedPts;
                self.buildScreenmap(transformedPts);
                self.updateLabels(transformedPts);
            }
            // Push the live drag delta onto the (possibly just-rebuilt) mesh.
            // No-op when not previewing.
            if (previewing) self._applyDragPreviewMatrices();
            self.drawOverlay();
        } else {
            if (self.screenmapOutline) {
                self._scene().remove(self.screenmapOutline);
                self.screenmapOutline.geometry.dispose();
                ((self.screenmapOutline.material as Material)).dispose();
                self.screenmapOutline = null;
            }
            if (self.pointsMesh) {
                self._scene().remove(self.pointsMesh);
                self.pointsGeometry?.dispose();
                self.pointsMaterial?.dispose();
                self.pointsMesh = null;
                self.lastBuiltPointCount = -1;
            }
            self.updateLabels([]);
            self.lastTransformedPts = [];
            self.drawOverlay();
        }

        // Apply camera pan/zoom (view-only, not an edit)
        self._camera().position.x = -self.camPanX;
        self._camera().position.y = -self.camPanY;
        self._camera().zoom = self.camZoom;
        self._camera().updateProjectionMatrix();

        self._renderer().render(self._scene(), self._camera());

        self.geometryDirty = false;
        self.frameDirty = false;
    };

ShapeEditor.prototype._readPanelOpts = function (this: ShapeEditor): PanelOpts {
    const self = this;

        const rot = self.dom_pp_rotation ? parseInt(self.dom_pp_rotation.value, 10) || 0 : 0;
        // Clamp to the valid RotationDeg union
        const validRots: RotationDeg[] = [0, 90, 180, 270];
        const rotation = (validRots.includes(rot as RotationDeg)
            ? rot
            : 0) as RotationDeg;
        return {
            wiring: (self.dom_pp_wiring ? self.dom_pp_wiring.value : 'serpentine') as WiringStyle,
            dataInCorner: (self.dom_pp_corner ? self.dom_pp_corner.value : 'TL') as DataInCorner,
            rotation,
            flipH: self.dom_pp_flipH ? self.dom_pp_flipH.checked : false,
            flipV: self.dom_pp_flipV ? self.dom_pp_flipV.checked : false,
            spacing: self.dom_pp_spacing ? (parseFloat(self.dom_pp_spacing.value) || 1) : 1,
        };
    };

ShapeEditor.prototype._enterPlacing = function (this: ShapeEditor, catalogId: string) {
    const self = this;

        const entry = getCatalogEntry(catalogId);
        if (!entry) return;
        const opts = self._readPanelOpts();
        const localPts = generatePanelPoints(entry, opts);
        self.placingState = { entry, opts, localPts, ghostWorld: null };
        self._updateHintStrip();
        if (self.dom_pp_status) self.dom_pp_status.textContent = `Placing ${entry.label} — click canvas (Esc to cancel)`;
        self._oc().style.cursor = 'crosshair';
        self.setNeedsRender();
    };

ShapeEditor.prototype._cancelPlacing = function (this: ShapeEditor) {
    const self = this;

        self.placingState = null;
        self.pendingNewStripPin = null;
        if (self.dom_pp_status) self.dom_pp_status.textContent = '';
        self._oc().style.cursor = 'default';
        self.setNeedsRender();
        self._updateHintStrip();
    };

ShapeEditor.prototype._canvasToWorldPx = function (this: ShapeEditor, cx: number, cy: number): [number, number] {
    const self = this;

        return [
            (cx - self.canvasW / 2) / self.camZoom - self.camPanX,
            (cy - self.canvasH / 2) / self.camZoom - self.camPanY,
        ];
    };

ShapeEditor.prototype._gridSizePx = function (this: ShapeEditor) {
    const self = this;

        const grid = self.dom_pp_grid ? (parseFloat(self.dom_pp_grid.value) || 1) : 1;
        const fs = self.fitScale > 0 ? self.fitScale : 1;
        return grid * fs;
    };

ShapeEditor.prototype._updateGhostFromCanvas = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        if (!self.placingState) return;
        let [wx, wy] = self._canvasToWorldPx(cx, cy);
        if (self.dom_pp_snap?.checked) {
            const gpx = self._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        self.placingState.ghostWorld = [wx, wy];
        self.setNeedsRender();
    };

ShapeEditor.prototype._drawPlacingGhost = function (this: ShapeEditor) {
    const self = this;

        if (!self.placingState?.ghostWorld) return;
        const ctx = self._octx();
        const [wx, wy] = self.placingState.ghostWorld;
        const fs = self.fitScale > 0 ? self.fitScale : 1;
        const pts = self.placingState.localPts;
        if (pts.length === 0) return;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(59,130,246,0.9)';
        ctx.fillStyle = 'rgba(59,130,246,0.4)';
        // Connecting polyline (wiring order)
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const [px, py] = self.nn(pts[i]);
            const [cx, cy] = self.toCanvasCoords(wx + px * fs, wy + py * fs);
            if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        const r = Math.max(2, 0.3 * fs * self.camZoom);
        for (const [px, py] of pts) {
            const [cx, cy] = self.toCanvasCoords(wx + px * fs, wy + py * fs);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // Crosshair at origin
        const [ocx, ocy] = self.toCanvasCoords(wx, wy);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.moveTo(ocx - 6, ocy); ctx.lineTo(ocx + 6, ocy);
        ctx.moveTo(ocx, ocy - 6); ctx.lineTo(ocx, ocy + 6);
        ctx.stroke();
        ctx.restore();
    };

ShapeEditor.prototype._uniqueStripName = function (this: ShapeEditor, base: string) {
    const self = this;

        const used = new Set();
        const strips = self.stripStore.getStrips();
        for (const s of strips) used.add(s.name);
        let i = 1;
        while (used.has(`${base}${String(i)}`)) i++;
        return `${base}${String(i)}`;
    };

ShapeEditor.prototype._isEmptyScreenmap = function (this: ShapeEditor) {
    const self = this;

        return !self.stripInfo || self.stripInfo.strips.length === 0
            || (self.stripInfo.strips.length === 1 && (self.stripInfo.strips[0]?.count ?? 0) <= 1
                && self.stripInfo.totalCount <= 1);
    };

ShapeEditor.prototype._initFreshScreenmapForPanel = function (this: ShapeEditor) {
    const self = this;

        // Initialise transform + fitScale + storage for a brand-new screenmap
        // when the user places a panel onto an empty editor.
        self.screenmap_pts = [];
        self.rawPts = [];
        self.stripInfo = null;
        self.stripStore.load(null);
        self.origDiameter = 0.5;
        self.dom_txt_diameter.value = String(self.origDiameter);
        self.origWidth = 0;
        self.origHeight = 0;
        // Choose a fitScale that gives a reasonable initial pixel pitch.
        const { width: fitW, height: fitH } = self.getFitSize();
        self.fitScale = Math.min(fitW, fitH) / 40;
        if (!isFinite(self.fitScale) || self.fitScale <= 0) self.fitScale = 20;
        self.resetTransforms();
    };

ShapeEditor.prototype._commitPlacingAt = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        if (!self.placingState) return;
        const entry = self.placingState.entry;
        const opts = self.placingState.opts;
        let [wx, wy] = self._canvasToWorldPx(cx, cy);
        if (self.dom_pp_snap?.checked) {
            const gpx = self._gridSizePx();
            [wx, wy] = snapToGrid([wx, wy], gpx);
        }
        if (self._isEmptyScreenmap()) {
            self._initFreshScreenmapForPanel();
        }
        const name = self._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId: entry.id,
            opts: { ...opts },
            worldX: wx,
            worldY: wy,
            name,
            pin: self.pendingNewStripPin ?? self._defaultNewStripPin(),
        };
        self.pendingNewStripPin = null;
        self._doPanelPlace(action);
        self.pushUndo(action);
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
        self.placingState = null;
        if (self.dom_pp_status) self.dom_pp_status.textContent = `Placed ${entry.label} as ${name}`;
        self._oc().style.cursor = 'default';
        self._updateHintStrip();
    };

ShapeEditor.prototype._doPanelPlace = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        const entry = getCatalogEntry(action.catalogId as string);
        if (!entry) return;
        const localPts = generatePanelPoints(entry, (action.opts as PanelOpts | undefined) ?? {});
        const fs = self.fitScale > 0 ? self.fitScale : 1;
        // rawPts (cm-units): use worldX/worldY divided by fitScale to place
        // the panel origin at the click point. screenmap_pts = rawPts * fs
        // - offset (keeps consistency with existing screenmap_pts coords).
        // For a fresh map (rawPts empty) we set rawPts directly so
        // rawPts[i]*fitScale == screenmap_pts[i].
        const screenmapPts: [number, number][] = [];
        const rawPtsAdd: [number, number][] = [];
        // Determine current "raw->screenmap" offset using existing point 0
        let offX = 0, offY = 0;
        if (self.rawPts.length > 0) {
            offX = self.nn(self.rawPts[0])[0] * fs - self.nn(self.screenmap_pts[0])[0];
            offY = self.nn(self.rawPts[0])[1] * fs - self.nn(self.screenmap_pts[0])[1];
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
        const insertAt = self.screenmap_pts.length;
        for (let i = 0; i < screenmapPts.length; i++) {
            self.screenmap_pts.push(self.nn(screenmapPts[i]));
            self.rawPts.push(self.nn(rawPtsAdd[i]));
        }
        const newIdx = self.stripStore.addStrip({
            name: action.name as string,
            points: rawPtsAdd,
            diameter: typeof self.origDiameter === 'number' ? self.origDiameter : 0.5,
            video_offset: insertAt,
            pin: (typeof action.pin === 'string' && action.pin) ? (action.pin) : 'pin1',
            videoOffsetOverride: false,
        });
        self.stripInfo = self.stripStore.get();
        // origWidth/Height may still be 0 for fresh maps — recompute from rawPts
        // so the cm size label is reasonable.
        if (self.origWidth === 0 && self.origHeight === 0 && self.rawPts.length > 0) {
            let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
            for (const [x, y] of self.rawPts) {
                if (x < xmin) xmin = x; if (x > xmax) xmax = x;
                if (y < ymin) ymin = y; if (y > ymax) ymax = y;
            }
            self.origWidth = xmax - xmin;
            self.origHeight = ymax - ymin;
        }
        self.selection.selectStrip(newIdx);
        action._insertAt = insertAt;
        action._count = screenmapPts.length;
    };

ShapeEditor.prototype._redoPanelPlace = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        self._doPanelPlace(action);
    };

ShapeEditor.prototype._undoPanelPlace = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        if (!self.stripInfo) return;
        // Find the strip we added by name (most reliable after reordering).
        let stripIdx = -1;
        const strips = self.stripInfo.strips;
        for (let i = strips.length - 1; i >= 0; i--) {
            if (strips[i]?.name === action.name) { stripIdx = i; break; }
        }
        if (stripIdx < 0) return;
        const strip = self.nn(strips[stripIdx]);
        self.screenmap_pts.splice(strip.offset, strip.count);
        self.rawPts.splice(strip.offset, strip.count);
        self.stripStore.removeStrip(stripIdx);
        self.selection.onStripRemove(stripIdx);
        self.selectedIdx = -1;
        self.stripInfo = self.stripStore.get();
    };

ShapeEditor.prototype._debugPlacePanel = function (this: ShapeEditor, catalogId: string, worldX: number, worldY: number, opts: PanelOpts) {
    const self = this;

        const entry = getCatalogEntry(catalogId);
        if (!entry) return null;
        const mergedOpts = { ...self._readPanelOpts(), ...opts };
        if (self._isEmptyScreenmap()) {
            self._initFreshScreenmapForPanel();
        }
        const name = self._uniqueStripName('panel');
        const action = {
            type: 'panel-place',
            catalogId,
            opts: mergedOpts,
            worldX,
            worldY,
            name,
            pin: self.pendingNewStripPin ?? self._defaultNewStripPin(),
        };
        self.pendingNewStripPin = null;
        self._doPanelPlace(action);
        self.pushUndo(action);
        notePinMutation();
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
        return name;
    };
