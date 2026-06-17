// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 4/8).

import { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, TextureLoader, PlaneGeometry, MeshBasicMaterial, Mesh, SRGBColorSpace, DoubleSide, type Material } from 'three';
import type { StripEntry, StripInfo } from './strips-model';

import { parse_screenmap_data, centerAndFitPoints, parseScreenmapMultiStrip, getPinColors } from '../common';

import { fileHasExtension } from '../drag-drop';
import { saveScreenmap, notePinMutation } from '../screenmap-store';
import { safeStorage } from '../services/storage';
import { fireDialog, errorDialog } from '../ui/dialogs';
import { mountPresetPicker } from '../ui/preset-picker';
import type { PresetCategory } from '../ui/preset-picker';

import type { PresetEntry } from './shapeeditor-types';

ShapeEditor.prototype._openHelpOverlay = async function (this: ShapeEditor) {
    const self = this;

        try {
            if (self.signal.aborted) return;
            const dismissed = safeStorage.get('lm:shapeeditor-helpDismissed') === '1';
            const html = `
                <div style="text-align:left;font:13px/1.45 'Outfit',system-ui,sans-serif;color:#e5e7eb;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
                    <div>
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Mouse</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li>Drag canvas: pan</li>
                            <li>R-drag: zoom</li>
                            <li>Click LED: select its strip</li>
                            <li>Drag LED: move whole strip</li>
                            <li>Alt + drag LED: move single point</li>
                            <li>Double-click LED: enter point-edit</li>
                            <li>Drag inside box: move selection</li>
                            <li>Corner/edge/rotate handles: scale &amp; rotate layout</li>
                            <li>Shift + click edge: insert between</li>
                            <li>Ctrl + click: extend (append LED)</li>
                            <li>Ctrl + drag: shape select (rubber-band)</li>
                            <li>Ctrl + click LED: toggle in shape selection</li>
                            <li>Right-click: context menu</li>
                        </ul>
                    </div>
                    <div>
                        <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Keyboard</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li><b>I</b> — Insert panel</li>
                            <li><b>Ctrl+V</b> — Paste screenmap</li>
                            <li><b>?</b> / <b>F1</b> — This help</li>
                            <li><b>Ctrl+Z</b> / <b>Ctrl+Y</b> — Undo / Redo</li>
                            <li><b>Delete</b> — Remove selection</li>
                            <li><b>Esc</b> — Cancel / exit point-edit</li>
                        </ul>
                        <h3 style="margin:12px 0 6px 0;font-size:14px;color:#93c5fd;">Touch</h3>
                        <ul style="margin:0;padding-left:18px;">
                            <li>Tap LED: select strip</li>
                            <li>Drag LED: move whole strip</li>
                            <li>Drag empty space: pan</li>
                            <li>Long-press LED: enter point-edit</li>
                            <li>Long-press empty: context menu</li>
                            <li>Two-finger drag: pan</li>
                            <li>Pinch: zoom</li>
                        </ul>
                    </div>
                </div>
                <div id="help_chains_pins" style="margin-top:14px;text-align:left;font:13px/1.45 'Outfit',system-ui,sans-serif;color:#e5e7eb;">
                    <h3 style="margin:0 0 6px 0;font-size:14px;color:#93c5fd;">Chains and Pins</h3>
                    <ul style="margin:0;padding-left:18px;">
                        <li><b>Chain</b> mode: drag a connector arrowhead to rewire strips; right-click an arrow for Swap / Split / Move options</li>
                        <li><b>Reorder</b> mode: move strips within a pin with the ▲/▼ arrows; drag a grip across pin headers to repin</li>
                        <li><b>+ Pin</b>: move the selected strip onto a fresh pin</li>
                        <li><b>LOCK</b> (🔓/🔒) overrides a strip's <code>video_offset</code>; unlocked values re-derive from pin order</li>
                        <li>Pin names are labels; export order, not name, determines FastLED <code>addLeds</code> call order</li>
                    </ul>
                </div>
                <div style="margin-top:14px;text-align:left;">
                    <label style="font-size:12px;color:#9ca3af;display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                        <input id="help_dont_show" type="checkbox" ${dismissed ? 'checked' : ''}>
                        Don't show on launch
                    </label>
                </div>
            `;
            const res = await fireDialog({
                title: 'ScreenMap Editor — Keyboard help',
                html,
                width: 640,
                confirmButtonText: 'Got it',
                showCloseButton: true,
                focusConfirm: false,
                // preConfirm returning false would block the popup from
                // closing, so wrap the checkbox state in an object.
                preConfirm: () => {
                    const cb = document.getElementById('help_dont_show');
                    return { dontShow: cb ? (cb as HTMLInputElement).checked : false };
                },
            });
            // Only the confirm button reports the checkbox; closing via the
            // × or Esc leaves the stored preference untouched.
            if (res.isConfirmed && res.value) {
                const resVal: unknown = res.value;
                const dontShow = typeof resVal === 'object' && resVal !== null
                    && 'dontShow' in resVal && (resVal as Record<string, unknown>).dontShow === true;
                if (dontShow) {
                    safeStorage.set('lm:shapeeditor-helpDismissed', '1');
                } else {
                    safeStorage.remove('lm:shapeeditor-helpDismissed');
                }
            }
        } catch { /* swal may fail in headless edge cases */ }
    };

ShapeEditor.prototype._maybeShowGestureNotice = function (this: ShapeEditor) {
    const self = this;

        if (self._gestureNoticeShown) return;
        const sIdx = self.selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        if (safeStorage.get('lm:shapeeditor-gestureNotice') === '1') {
            self._gestureNoticeShown = true;
            return;
        }
        // Don't stack on top of the first-run help modal — skip if the
        // dismissal key is missing (help is about to auto-open or did).
        if (safeStorage.get('lm:shapeeditor-helpDismissed') !== '1') return;
        self._gestureNoticeShown = true;
        safeStorage.set('lm:shapeeditor-gestureNotice', '1');
        void self._toastInfo('New: drag moves the strip — double-click to edit points');
    };

ShapeEditor.prototype._maybeAutoOpenHelpOnLaunch = function (this: ShapeEditor) {
    const self = this;

        if (self._autoOpenHelpScheduled) return;
        self._autoOpenHelpScheduled = true;
        if (safeStorage.get('lm:shapeeditor-helpDismissed') === '1') return;
        // Defer to next tick so any preset autoload finishes first
        setTimeout(() => {
            if (self.signal.aborted) return;
            void self._openHelpOverlay();
        }, 250);
    };

ShapeEditor.prototype.buildGrid = function (this: ShapeEditor, width: number, height: number) {
    const self = this;

        if (self.gridLines) {
            self._scene().remove(self.gridLines);
            self.gridLines.geometry.dispose();
            ((self.gridLines.material as Material)).dispose();
        }

        const extent = Math.max(width, height) * 5; // Large enough for pan/zoom
        const gridSize = 50;
        const vertices = [];

        for (let x = -extent; x <= extent; x += gridSize) {
            vertices.push(x, -extent, 0, x, extent, 0);
        }
        for (let y = -extent; y <= extent; y += gridSize) {
            vertices.push(-extent, y, 0, extent, y, 0);
        }

        const geom = new BufferGeometry();
        geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
        self.gridLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x323232, transparent: true }));
        self._scene().add(self.gridLines);
    };

ShapeEditor.prototype.center_and_fit = function (this: ShapeEditor, pts: [number, number][], canvasW: number, canvasH: number) {

        return centerAndFitPoints(pts, canvasW, canvasH, { margin: 0.95, center: 'origin' });
    };

ShapeEditor.prototype.load_screenmap_data = function (this: ShapeEditor, text: string) {
    const self = this;

        self.clearEditingState();

        self.screenmap_pts = parse_screenmap_data(text);
        if (self.screenmap_pts.length === 0) return;
        // Loading a new file is a user-initiated pin change — even if it has
        // fewer pins than the previous working copy (guard grace window).
        notePinMutation();
        saveScreenmap(text);
        try { self.renderBackupRow(); } catch { /* render is best-effort */ }

        // Parse multi-strip metadata for color-coded visualization
        try {
            self.stripInfo = parseScreenmapMultiStrip(text) as unknown as StripInfo;
        } catch {
            self.stripInfo = null;
        }
        self.stripStore.load(self.stripInfo);
        self.renderStripsPanel();

        // Populate diameter from file if available
        if (typeof self.screenmap_pts.diameter === "number" && self.screenmap_pts.diameter > 0) {
            self.origDiameter = self.screenmap_pts.diameter;
        } else {
            self.origDiameter = 0.5;
        }
        self.dom_txt_diameter.value = String(self.origDiameter);

        self.rawPts = self.screenmap_pts.map(([x, y]: [number, number]) => [x, y] as [number, number]);

        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        self.screenmap_pts.forEach(([x, y]: [number, number]) => {
            xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
            ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        });
        self.origWidth = xmax - xmin;
        self.origHeight = ymax - ymin;

        // Use the smaller reference size so the screenmap stays the same pixel
        // size regardless of how large the canvas is (leaves room for pan/zoom).
        const { width: fitW, height: fitH } = self.getFitSize();
        const availW = 0.95 * fitW;
        const availH = 0.95 * fitH;
        self.fitScale = Math.min(
            self.origWidth > 0 ? availW / self.origWidth : availW,
            self.origHeight > 0 ? availH / self.origHeight : availH,
        );
        self.screenmap_pts = self.center_and_fit(self.screenmap_pts, fitW, fitH);
        self.positionRulerAboveBBox();
    };

ShapeEditor.prototype.loadScreenmapFile = function (this: ShapeEditor, file: File | null | undefined) {
    const self = this;

        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            void errorDialog('Wrong file type', 'Please choose a .json screenmap file.');
            return;
        }
        self.presetPicker?.setActive('');
        file.text().then((arg: any) => self.load_screenmap_data(arg)).catch((error: unknown) => {
            void errorDialog('Error reading screenmap file', String(error));
        });
    };

ShapeEditor.prototype.loadPresetsFromManifest = async function (this: ShapeEditor) {
    const self = this;

        try {
            const resp = await fetch('/screenmaps/manifest.json');
            const manifest: unknown = await resp.json();
            const rawPresets: unknown = typeof manifest === 'object' && manifest !== null
                ? (manifest as Record<string, unknown>).presets
                : undefined;
            const rawCategories: unknown = typeof manifest === 'object' && manifest !== null
                ? (manifest as Record<string, unknown>).categories
                : undefined;
            self.loadedPresets = Array.isArray(rawPresets)
                ? rawPresets.filter((p): p is PresetEntry =>
                    typeof p === 'object' && p !== null
                    && typeof (p as Record<string, unknown>).file === 'string'
                    && typeof (p as Record<string, unknown>).name === 'string')
                : [];
            const categories: PresetCategory[] = Array.isArray(rawCategories)
                ? rawCategories.filter((c): c is PresetCategory =>
                    typeof c === 'object' && c !== null
                    && typeof (c as Record<string, unknown>).id === 'string'
                    && typeof (c as Record<string, unknown>).label === 'string')
                : [];
            // Mount the shared accordion picker. The on-click load path goes
            // through the picker's `onChoose` callback instead of a
            // <select>-change event.
            const loadPresetFile = async (file: string) => {
                try {
                    const r = await fetch(`/screenmaps/${file}`);
                    self.load_screenmap_data(await r.text());
                    self.presetPicker?.setActive(file);
                } catch (e: unknown) {
                    console.warn('Failed to load preset:', e);
                }
            };
            if (self.presetPicker) {
                self.presetPicker.destroy();
                self.presetPicker = null;
            }
            self.presetPicker = mountPresetPicker(self.dom_sel_preset_mount, {
                mode: 'inline',
                storageKey: 'lm.presetPicker.openCategory.shapeeditor',
                signal: self.signal,
                presets: self.loadedPresets,
                categories,
                onChoose: loadPresetFile,
            });
            // Keep populating the right-click context-menu submenu — it
            // works off the same loadedPresets list.
            for (const preset of self.loadedPresets) {
                self.makeCtxBtn(preset.name, `load-preset:${preset.file}`, self.ctxLoadSubmenu);
            }
            // Restore stored screenmap (autosave/backup-aware), then fall
            // back to the first preset if nothing was auto-loaded.
            const autoLoaded = self._autoloadOnLaunch();
            self.renderBackupRow();
            if (autoLoaded) {
                // already loaded
            } else if (self.loadedPresets.length > 0) {
                const first = self.nn(self.loadedPresets[0]);
                void loadPresetFile(first.file);
            }
            self._updateHintStrip();
            self._maybeAutoOpenHelpOnLaunch();
        } catch (e: unknown) {
            console.warn("Failed to load preset manifest:", e);
            self.dom_sel_preset_mount.textContent = 'No presets available';
            self._maybeAutoOpenHelpOnLaunch();
        }
    };

ShapeEditor.prototype.setBgControlsEnabled = function (this: ShapeEditor, enabled: boolean) {
    const self = this;

        for (const el of self.bgImageControls) el.disabled = !enabled;
    };

ShapeEditor.prototype.resetBgControls = function (this: ShapeEditor) {
    const self = this;

        self.dom_txt_image_opacity.value = '50';
        self.dom_txt_image_scale.value = '1.00';
        self.dom_txt_image_rotate.value = '0.00';
        self.dom_txt_image_tx.value = '0';
        self.dom_txt_image_ty.value = '0';
    };

ShapeEditor.prototype.applyBgImageTransform = function (this: ShapeEditor) {
    const self = this;

        if (!self.bgImageMesh) return;
        const s = parseFloat(self.dom_txt_image_scale.value) || 1;
        const deg = parseFloat(self.dom_txt_image_rotate.value) || 0;
        const tx = parseFloat(self.dom_txt_image_tx.value) || 0;
        const ty = parseFloat(self.dom_txt_image_ty.value) || 0;
        self.bgImageMesh.scale.set(s, -s, 1); // negative y for y-down camera
        self.bgImageMesh.rotation.z = deg * Math.PI / 180;
        self.bgImageMesh.position.set(tx, ty, 0);
        self.setNeedsRender();
    };

ShapeEditor.prototype.clearBackgroundImage = function (this: ShapeEditor) {
    const self = this;

        if (self.bgImageMesh) {
            self._scene().remove(self.bgImageMesh);
            self.bgImageMesh.geometry.dispose();
            ((self.bgImageMesh.material as Material)).dispose();
            self.bgImageMesh = null;
        }
        if (self.bgImageTexture) {
            self.bgImageTexture.dispose();
            self.bgImageTexture = null;
        }
        if (self.bgImageObjectURL) {
            URL.revokeObjectURL(self.bgImageObjectURL);
            self.bgImageObjectURL = null;
        }
        self.setBgControlsEnabled(false);
        self.bgImageFitW = 0;
        self.bgImageFitH = 0;
        self.bgImageBBox = null;
        self.bgGizmoActive = null;
        self.bgGizmoHover = null;
        self.bgGizmoDragStart = null;
    };

ShapeEditor.prototype.removeBackgroundImage = function (this: ShapeEditor) {
    const self = this;

        self.clearBackgroundImage();
        self.resetBgControls();
        self.dom_btn_upload_image.value = '';
        self.dom_bg_accordion.removeAttribute('open');
        self.setNeedsRender();
    };

ShapeEditor.prototype.showDeleteBgConfirm = function (this: ShapeEditor) {
    const self = this;

        if (self.deleteBgConfirmEl) return; // already showing
        self.deleteBgConfirmEl = document.createElement('div');
        self.deleteBgConfirmEl.style.cssText =
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;' +
            'background:#1e1e1e;border:1px solid #444;border-radius:8px;' +
            'padding:16px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.6);text-align:center;' +
            'font:14px/1.4 "Outfit",system-ui,sans-serif;color:#eee;';
        self.deleteBgConfirmEl.innerHTML =
            '<div style="margin-bottom:12px">Delete background image?</div>' +
            '<button data-bg-del="yes" style="padding:6px 16px;margin:0 6px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font:inherit">Delete</button>' +
            '<button data-bg-del="no" style="padding:6px 16px;margin:0 6px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;font:inherit">Cancel</button>';
        self.deleteBgConfirmEl.addEventListener('click', (e: MouseEvent) => {
            const val = (e.target as HTMLElement | null)?.dataset.bgDel;
            if (val === 'yes') self.removeBackgroundImage();
            if (val) self.dismissDeleteBgConfirm();
        });
        if (self.wrapper) self.wrapper.appendChild(self.deleteBgConfirmEl);
    };

ShapeEditor.prototype.dismissDeleteBgConfirm = function (this: ShapeEditor) {
    const self = this;

        if (self.deleteBgConfirmEl) {
            self.deleteBgConfirmEl.remove();
            self.deleteBgConfirmEl = null;
        }
    };

ShapeEditor.prototype.loadBackgroundImage = function (this: ShapeEditor, file: File) {
    const self = this;

        self.clearBackgroundImage();
        self.resetBgControls();

        self.bgImageObjectURL = URL.createObjectURL(file);
        const loader = new TextureLoader();
        loader.load(self.bgImageObjectURL, (texture) => {
            self.bgImageTexture = texture;
            self.bgImageTexture.colorSpace = SRGBColorSpace;

            const img = texture.image;
            // Size to fill the canvas, maintaining aspect ratio
            const aspect = img.width / img.height;
            const canvasAspect = self.canvasW / self.canvasH;
            let fitW, fitH;
            if (aspect > canvasAspect) {
                fitW = self.canvasW;
                fitH = self.canvasW / aspect;
            } else {
                fitH = self.canvasH;
                fitW = self.canvasH * aspect;
            }

            self.bgImageFitW = fitW;
            self.bgImageFitH = fitH;

            const geometry = new PlaneGeometry(fitW, fitH);
            const material = new MeshBasicMaterial({
                map: self.bgImageTexture,
                transparent: true,
                opacity: (parseFloat(self.dom_txt_image_opacity.value) || 50) / 100,
                depthWrite: false,
                depthTest: false,
                side: DoubleSide,
            });

            self.bgImageMesh = new Mesh(geometry, material);
            self.bgImageMesh.renderOrder = 1;
            self.bgImageMesh.scale.y = -1;
            self._scene().add(self.bgImageMesh);

            self.setBgControlsEnabled(true);
            self.dom_bg_accordion.setAttribute('open', '');
        });
    };

ShapeEditor.prototype.toCanvasCoords = function (this: ShapeEditor, x: number, y: number): [number, number] {
    const self = this;

        return [
            (x + self.camPanX) * self.camZoom + self.canvasW / 2,
            (y + self.camPanY) * self.camZoom + self.canvasH / 2,
        ];
    };

ShapeEditor.prototype.positionRulerAboveBBox = function (this: ShapeEditor) {
    const self = this;

        if (self.screenmap_pts.length === 0) return;
        // Auto-create the initial ruler only when there are none. If the user
        // has deleted all rulers, leave the canvas free until they explicitly
        // Insert one via the context menu.
        if (self.rulers.length > 0) return;
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of self.screenmap_pts) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const bboxH = ymax - ymin;
        const gap = bboxH * 0.10;
        self.rulers.push({
            ax: xmin, ay: ymin - gap,
            bx: xmax, by: ymin - gap,
        });
    };

ShapeEditor.prototype.hitTestRuler = function (this: ShapeEditor, cx: number, cy: number) {
    const self = this;

        // Returns the active ruler hit ({idx, kind}) or null. Walks rulers in
        // reverse order so the most-recently-added (drawn last, on top) wins
        // when two rulers overlap.
        const r = self.RULER_HANDLE_R + 4;
        for (let idx = self.rulers.length - 1; idx >= 0; idx--) {
            const ruler = self.rulers[idx];
            if (!ruler) continue;
            const [ax, ay] = self.toCanvasCoords(ruler.ax, ruler.ay);
            const [bx, by] = self.toCanvasCoords(ruler.bx, ruler.by);
            if (Math.hypot(cx - ax, cy - ay) <= r) return { idx, kind: 'a' as const };
            if (Math.hypot(cx - bx, cy - by) <= r) return { idx, kind: 'b' as const };
            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq > 0) {
                const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
                const px = ax + t * dx, py = ay + t * dy;
                if (Math.hypot(cx - px, cy - py) <= 14) return { idx, kind: 'body' as const };
            }
        }
        return null;
    };

ShapeEditor.prototype._findRulerAtCanvasPoint = function (this: ShapeEditor, cx: number, cy: number): number {
    const hit = this.hitTestRuler(cx, cy);
    return hit ? hit.idx : -1;
};

/** Insert a new horizontal ruler 60 cm long centered on the given screenmap
 *  (world) coordinates. */
ShapeEditor.prototype._insertRulerAt = function (this: ShapeEditor, worldX: number, worldY: number): void {
    const half = 30; // 60 cm wide, centered → ±30 cm
    this.rulers.push({
        ax: worldX - half, ay: worldY,
        bx: worldX + half, by: worldY,
    });
    this.setNeedsRender();
};

/** Duplicate the ruler at `idx`. Offsets the copy by 10 cm perpendicular to
 *  the original so the two are visually distinguishable. */
ShapeEditor.prototype._duplicateRuler = function (this: ShapeEditor, idx: number): void {
    const src = this.rulers[idx];
    if (!src) return;
    const dx = src.bx - src.ax, dy = src.by - src.ay;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const step = 10;
    this.rulers.push({
        ax: src.ax + px * step, ay: src.ay + py * step,
        bx: src.bx + px * step, by: src.by + py * step,
    });
    this.setNeedsRender();
};

/** Delete the ruler at `idx`. The last remaining ruler may be deleted; the
 *  user can re-insert via the context menu. */
ShapeEditor.prototype._deleteRuler = function (this: ShapeEditor, idx: number): void {
    if (idx < 0 || idx >= this.rulers.length) return;
    this.rulers.splice(idx, 1);
    if (this.rulerDrag?.idx === idx) {
        this.rulerDrag = null;
        this.rulerDragStart = null;
    } else if (this.rulerDrag && this.rulerDrag.idx > idx) {
        this.rulerDrag = { idx: this.rulerDrag.idx - 1, kind: this.rulerDrag.kind };
    }
    this.setNeedsRender();
};

ShapeEditor.prototype.drawRuler = function (this: ShapeEditor) {
    const self = this;

        if (!self.overlayCtx || self.fitScale <= 0) return;
        if (self.rulers.length === 0) return;
        const ctx = self.overlayCtx;
        const pxPerCm = self.fitScale * self.camZoom;
        // Draw each ruler. The original implementation only had one; this loop
        // wraps the per-ruler drawing block below.
        for (const ruler of self.rulers) {
        const [ax, ay] = self.toCanvasCoords(ruler.ax, ruler.ay);
        const [bx, by] = self.toCanvasCoords(ruler.bx, ruler.by);
        const dx = bx - ax, dy = by - ay;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) continue;
        const lenCm = lenPx / pxPerCm;

        // Unit vector along ruler
        const ux = dx / lenPx, uy = dy / lenPx;
        // Normal (perpendicular, pointing "up" relative to the ruler direction)
        const nx = -uy, ny = ux;

        ctx.save();

        // ── Ruler body (dark band) ──
        const bandHalf = 10; // half-height of the ruler band
        ctx.beginPath();
        ctx.moveTo(ax + nx * bandHalf, ay + ny * bandHalf);
        ctx.lineTo(bx + nx * bandHalf, by + ny * bandHalf);
        ctx.lineTo(bx - nx * bandHalf, by - ny * bandHalf);
        ctx.lineTo(ax - nx * bandHalf, ay - ny * bandHalf);
        ctx.closePath();
        ctx.fillStyle = 'rgba(20, 20, 20, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Tick marks ──
        const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        let stepCm = 1;
        for (const s of niceSteps) {
            if (s * pxPerCm >= 8) { stepCm = s; break; }
        }
        const majorEvery = stepCm < 1 ? Math.round(1 / stepCm) : (stepCm < 10 ? Math.round(10 / stepCm) : 1);
        const nTicks = Math.floor(lenCm / stepCm);

        for (let i = 0; i <= nTicks; i++) {
            const d = i * stepCm * pxPerCm; // distance in px from A
            const tx = ax + ux * d;
            const ty = ay + uy * d;
            const isMajor = (i % majorEvery === 0);
            const tickLen = isMajor ? 8 : 4;

            ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)';
            ctx.lineWidth = isMajor ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(tx - nx * bandHalf, ty - ny * bandHalf);
            ctx.lineTo(tx - nx * (bandHalf - tickLen), ty - ny * (bandHalf - tickLen));
            ctx.stroke();
            // Mirror tick on the other side
            ctx.beginPath();
            ctx.moveTo(tx + nx * bandHalf, ty + ny * bandHalf);
            ctx.lineTo(tx + nx * (bandHalf - tickLen), ty + ny * (bandHalf - tickLen));
            ctx.stroke();

            // Labels on major ticks (above the ruler)
            if (isMajor && i > 0) {
                const cm = i * stepCm;
                const label = Number.isInteger(cm) ? cm.toString() : cm.toFixed(1);
                ctx.save();
                ctx.translate(tx + nx * (bandHalf + 10), ty + ny * (bandHalf + 10));
                ctx.rotate(Math.atan2(dy, dx));
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }

        // ── Total length label (centered, below ruler) ──
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.save();
        ctx.translate(mx - nx * (bandHalf + 12), my - ny * (bandHalf + 12));
        const angle = Math.atan2(dy, dx);
        // Flip text if ruler is angled so text would be upside-down
        const flipText = angle > Math.PI / 2 || angle < -Math.PI / 2;
        ctx.rotate(flipText ? angle + Math.PI : angle);
        ctx.font = 'bold 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lenCm.toFixed(2) + ' cm', 0, 0);
        ctx.restore();

        // ── Handle circles ──
        for (const [hx, hy] of [[ax, ay], [bx, by]] as [number, number][]) {
            ctx.beginPath();
            ctx.arc(hx, hy, self.RULER_HANDLE_R, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(59,130,246,0.85)';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // "0" label at A handle
        ctx.save();
        ctx.translate(ax + nx * (bandHalf + 10), ay + ny * (bandHalf + 10));
        ctx.rotate(Math.atan2(dy, dx));
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0', 0, 0);
        ctx.restore();

        ctx.restore();
        } // end for each ruler
    };

ShapeEditor.prototype._chainArrowCount = function (this: ShapeEditor) {
    const self = this;

        if (!self.showChainArrows && self.editorMode !== 'chain') return 0;
        if (!self.stripInfo || self.stripInfo.strips.length <= 1) return 0;
        let drawable = 0;
        for (let s = 0; s < self.stripInfo.strips.length - 1; s++) {
            const a = self.nn(self.stripInfo.strips[s]), b = self.nn(self.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && self._pinOfStrip(a) === self._pinOfStrip(b)) drawable++;
        }
        return drawable;
    };

ShapeEditor.prototype._crossPinBadgeCount = function (this: ShapeEditor) {
    const self = this;

        if (!self.showChainArrows && self.editorMode !== 'chain') return 0;
        if (!self.stripInfo || self.stripInfo.strips.length <= 1) return 0;
        let n = 0;
        for (let s = 0; s < self.stripInfo.strips.length - 1; s++) {
            const a = self.nn(self.stripInfo.strips[s]), b = self.nn(self.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && self._pinOfStrip(a) !== self._pinOfStrip(b)) n++;
        }
        return n;
    };

ShapeEditor.prototype.drawChainArrows = function (this: ShapeEditor, pts: [number, number][]) {
    const self = this;

        const strips = self._si().strips;
        const ctx = self._octx();
        const pinOrder = self.stripStore.getPinOrder();
        const pinColors = getPinColors(pinOrder.length);
        const pinColorOf = (strip: StripEntry) => {
            const i = pinOrder.indexOf(self._pinOfStrip(strip));
            return pinColors[i >= 0 ? i : 0] ?? '#3b82f6';
        };
        // Refresh canvas-space geometry used by Chain-mode hit-tests.
        self._chainGeom.connectors.length = 0;
        self._chainGeom.starts.length = 0;
        self._chainGeom.ends.length = 0;
        self._chainGeom.crossBadges.length = 0;
        for (let s = 0; s < strips.length; s++) {
            const st = self.nn(strips[s]);
            if (st.count <= 0) continue;
            const si = st.offset;
            const ei = st.offset + st.count - 1;
            if (si >= pts.length || ei >= pts.length) continue;
            self._chainGeom.starts.push({ strip: s, x: self.nn(pts[si])[0], y: self.nn(pts[si])[1] });
            self._chainGeom.ends.push({ strip: s, x: self.nn(pts[ei])[0], y: self.nn(pts[ei])[1] });
        }
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#3b82f6';
        ctx.fillStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        let badgeN = 1;
        for (let s = 0; s < strips.length - 1; s++) {
            const a = self.nn(strips[s]), b = self.nn(strips[s + 1]);
            if (a.count <= 0 || b.count <= 0) continue;
            const aLast = a.offset + a.count - 1;
            const bFirst = b.offset;
            if (aLast >= pts.length || bFirst >= pts.length) continue;
            const [x1, y1] = self.nn(pts[aLast]);
            const [x2, y2] = self.nn(pts[bFirst]);
            if (self._pinOfStrip(a) !== self._pinOfStrip(b)) {
                // Cross-pin boundary: no arrow — pin-tinted dot near the next
                // strip's Start (§1.7).
                const tint = pinColorOf(b);
                ctx.setLineDash([]);
                ctx.fillStyle = tint;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.8)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = tint;
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(self._pinOfStrip(b), x2 + 21, y2 - 12);
                ctx.strokeStyle = '#3b82f6';
                ctx.fillStyle = '#3b82f6';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                self._chainGeom.crossBadges.push({ up: s, down: s + 1, x: x2 + 12, y: y2 - 12 });
                continue;
            }
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // arrowhead at target
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 4) {
                const ang = Math.atan2(dy, dx);
                const al = 10, ah = 0.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - al * Math.cos(ang - ah), y2 - al * Math.sin(ang - ah));
                ctx.lineTo(x2 - al * Math.cos(ang + ah), y2 - al * Math.sin(ang + ah));
                ctx.closePath();
                ctx.fill();
                ctx.setLineDash([6, 4]);
            }
            // numbered badge at midpoint
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.setLineDash([]);
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.arc(mx, my, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#3b82f6';
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(badgeN), mx, my);
            ctx.setLineDash([6, 4]);
            badgeN++;
            self._chainGeom.connectors.push({ x: x1, y: y1, up: s, down: s + 1, x1, y1, x2, y2, hx: x2, hy: y2 });
        }
        ctx.restore();
    };

ShapeEditor.prototype._drawChainDragGhost = function (this: ShapeEditor) {
    const self = this;

        const ctx = self._octx();
        const drag = self.connectorDrag ?? self.startHandleDrag;
        if (!drag) return;
        let ax: number | null = null, ay: number | null = null;
        if (self.connectorDrag) {
            const cdrag = self.connectorDrag;
            const end = self._chainGeom.ends.find((e) => e.strip === cdrag.upIdx);
            if (end) { ax = end.x; ay = end.y; }
        } else if (self.startHandleDrag) {
            const shdrag = self.startHandleDrag;
            const start = self._chainGeom.starts.find((e) => e.strip === shdrag.stripIdx);
            if (start) { ax = start.x; ay = start.y; }
        }
        if (ax === null || ay === null) return;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(drag.x, drag.y);
        ctx.stroke();
        if (drag.targetIdx !== null) {
            const handles = self.connectorDrag ? self._chainGeom.starts : self._chainGeom.ends;
            const h = handles.find((e) => e.strip === drag.targetIdx);
            if (h) {
                ctx.setLineDash([]);
                ctx.strokeStyle = '#22d3ee';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(h.x, h.y, 13, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    };
