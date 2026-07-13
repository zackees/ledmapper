// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 4/8).

import { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial, TextureLoader, PlaneGeometry, MeshBasicMaterial, Mesh, SRGBColorSpace, DoubleSide, type Material } from 'three';
import type { StripEntry, StripInfo } from './strips-model';

import { parse_screenmap_data, centerAndFitPoints, computeCenterFitScale, parseScreenmapMultiStrip, getPinColors } from '../common';

import { fileHasExtension } from '../drag-drop';
import { saveScreenmap, savePresetScreenmap, getPresetSelection, getScreenmap, notePinMutation } from '../screenmap-store';
import { analyzeCanonical64x64Divergence, CANONICAL_64X64_PRESET, getDefaultPresetFile, isCanonical64x64Geometry } from '../canonical-screenmap';
import { safeStorage } from '../services/storage';
import { fireDialog, errorDialog } from '../ui/dialogs';
import { gfxColors, withAlpha } from '../ui/theme';
import { mountPresetPicker } from '../ui/preset-picker';
import type { PresetCategory } from '../ui/preset-picker';

import type { PresetEntry } from './shapeeditor-types';

ShapeEditor.prototype._openHelpOverlay = async function (this: ShapeEditor) {

        try {
            if (this.signal.aborted) return;
            const dismissed = safeStorage.get('lm:shapeeditor-helpDismissed') === '1';
            const html = `
                <div class="help-overlay-grid">
                    <div>
                        <h3 class="help-overlay-h3">Mouse</h3>
                        <ul class="help-overlay-ul">
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
                        <h3 class="help-overlay-h3">Keyboard</h3>
                        <ul class="help-overlay-ul">
                            <li><b>I</b> — Insert panel</li>
                            <li><b>Ctrl+V</b> — Paste screenmap</li>
                            <li><b>?</b> / <b>F1</b> — This help</li>
                            <li><b>Ctrl+Z</b> / <b>Ctrl+Y</b> — Undo / Redo</li>
                            <li><b>Delete</b> — Remove selection</li>
                            <li><b>Esc</b> — Cancel / exit point-edit</li>
                        </ul>
                        <h3 class="help-overlay-h3 is-spaced-top">Touch</h3>
                        <ul class="help-overlay-ul">
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
                <div id="help_chains_pins" class="help-overlay-section is-spaced-top">
                    <h3 class="help-overlay-h3">Chains and Pins</h3>
                    <ul class="help-overlay-ul">
                        <li><b>Chain</b> mode: drag a connector arrowhead to rewire strips; right-click an arrow for Swap / Split / Move options</li>
                        <li><b>Reorder</b> mode: move strips within a pin with the ▲/▼ arrows; drag a grip across pin headers to repin</li>
                        <li><b>+ Pin</b>: move the selected strip onto a fresh pin</li>
                        <li><b>LOCK</b> (🔓/🔒) overrides a strip's <code>video_offset</code>; unlocked values re-derive from pin order</li>
                        <li>Pin names are labels; export order, not name, determines FastLED <code>addLeds</code> call order</li>
                    </ul>
                </div>
                <div class="help-overlay-dismiss-row">
                    <label class="help-overlay-dismiss-label">
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

        if (this._gestureNoticeShown) return;
        const sIdx = this.selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        if (safeStorage.get('lm:shapeeditor-gestureNotice') === '1') {
            this._gestureNoticeShown = true;
            return;
        }
        // Don't stack on top of the first-run help modal — skip if the
        // dismissal key is missing (help is about to auto-open or did).
        if (safeStorage.get('lm:shapeeditor-helpDismissed') !== '1') return;
        this._gestureNoticeShown = true;
        safeStorage.set('lm:shapeeditor-gestureNotice', '1');
        void this._toastInfo('New: drag moves the strip — double-click to edit points');
    };

ShapeEditor.prototype._maybeAutoOpenHelpOnLaunch = function (this: ShapeEditor) {

        if (this._autoOpenHelpScheduled) return;
        this._autoOpenHelpScheduled = true;
        if (safeStorage.get('lm:shapeeditor-helpDismissed') === '1') return;
        // First run gets a one-line nudge toast, not the full ~30-shortcut
        // reference dumped over the canvas before the tool is even seen (#290).
        // The complete keyboard help stays one keypress away — ?, F1, or the
        // "? Help" button in the hint strip.
        setTimeout(() => {
            if (this.signal.aborted) return;
            void this._toastInfo('Click an LED to select · drag to move · press ? for all shortcuts');
        }, 400);
    };

ShapeEditor.prototype.buildGrid = function (this: ShapeEditor, width: number, height: number) {

        if (this.gridLines) {
            this._scene().remove(this.gridLines);
            this.gridLines.geometry.dispose();
            ((this.gridLines.material as Material)).dispose();
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
        this.gridLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x323232, transparent: true }));
        this._scene().add(this.gridLines);
    };

ShapeEditor.prototype.center_and_fit = function (this: ShapeEditor, pts: [number, number][], canvasW: number, canvasH: number) {

        return centerAndFitPoints(pts, canvasW, canvasH, {
            margin: 0.95,
            center: 'origin',
            pixelAlignScale: true,
        });
    };

ShapeEditor.prototype.load_screenmap_data = function (this: ShapeEditor, text: string, persist = true) {

        this.clearEditingState();

        this.screenmap_pts = parse_screenmap_data(text);
        if (this.screenmap_pts.length === 0) return;
        // Loading a new file is a user-initiated pin change — even if it has
        // fewer pins than the previous working copy (guard grace window).
        if (persist) {
            notePinMutation();
            saveScreenmap(text);
            try { this.renderBackupRow(); } catch { /* render is best-effort */ }
        }

        // Parse multi-strip metadata for color-coded visualization
        try {
            this.stripInfo = parseScreenmapMultiStrip(text) as unknown as StripInfo;
        } catch {
            this.stripInfo = null;
        }
        this.stripStore.load(this.stripInfo);
        this.renderStripsPanel();

        // Populate diameter from file if available
        if (typeof this.screenmap_pts.diameter === "number" && this.screenmap_pts.diameter > 0) {
            this.origDiameter = this.screenmap_pts.diameter;
        } else {
            this.origDiameter = 0.5;
        }
        this.dom_txt_diameter.value = String(this.origDiameter);

        this.rawPts = this.screenmap_pts.map(([x, y]: [number, number]) => [x, y] as [number, number]);

        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        this.screenmap_pts.forEach(([x, y]: [number, number]) => {
            xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
            ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        });
        this.origWidth = xmax - xmin;
        this.origHeight = ymax - ymin;

        // Use the smaller reference size so the screenmap stays the same pixel
        // size regardless of how large the canvas is (leaves room for pan/zoom).
        const { width: fitW, height: fitH } = this.getFitSize();
        this.fitScale = computeCenterFitScale(this.rawPts, fitW, fitH, {
            margin: 0.95,
            center: 'origin',
            pixelAlignScale: true,
        });
        this.screenmap_pts = this.center_and_fit(this.screenmap_pts, fitW, fitH);
        this.positionRulerAboveBBox();
        // A loaded map is a document you can export straight away (#292).
        this._refreshSaveEnabled();
    };

ShapeEditor.prototype.loadScreenmapFile = function (this: ShapeEditor, file: File | null | undefined) {

        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            void errorDialog('Wrong file type', 'Please choose a .json screenmap file.');
            return;
        }
        const generation = ++this.layoutLoadGeneration;
        this.presetPicker?.setActive('');
        file.text().then((text) => {
            if (!this.signal.aborted && generation === this.layoutLoadGeneration) this.load_screenmap_data(text);
        }).catch((error: unknown) => {
            void errorDialog('Error reading screenmap file', String(error));
        });
    };

ShapeEditor.prototype.loadPresetsFromManifest = async function (this: ShapeEditor) {
        const startupGeneration = ++this.layoutLoadGeneration;
        const isStaleLayoutLoad = (generation: number) => (
            this.signal.aborted || generation !== this.layoutLoadGeneration
        );

        try {
            const resp = await fetch('/screenmaps/manifest.json', { signal: this.signal });
            if (isStaleLayoutLoad(startupGeneration)) return;
            const manifest: unknown = await resp.json();
            if (isStaleLayoutLoad(startupGeneration)) return;
            const rawPresets: unknown = typeof manifest === 'object' && manifest !== null
                ? (manifest as Record<string, unknown>).presets
                : undefined;
            const rawCategories: unknown = typeof manifest === 'object' && manifest !== null
                ? (manifest as Record<string, unknown>).categories
                : undefined;
            this.loadedPresets = Array.isArray(rawPresets)
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
            const loadPresetFile = async (file: string, generation: number) => {
                try {
                    const r = await fetch(`/screenmaps/${file}`, { signal: this.signal });
                    const text = await r.text();
                    if (isStaleLayoutLoad(generation)) return;
                    if (!savePresetScreenmap(text, file)) throw new Error(`Could not persist preset ${file}`);
                    this.load_screenmap_data(text, false);
                    this.presetPicker?.setActive(file);
                } catch (e: unknown) {
                    console.warn('Failed to load preset:', e);
                }
            };
            if (this.presetPicker) {
                this.presetPicker.destroy();
                this.presetPicker = null;
            }
            this.presetPicker = mountPresetPicker(this.dom_sel_preset_mount, {
                mode: 'inline',
                storageKey: 'lm.presetPicker.openCategory.shapeeditor',
                signal: this.signal,
                presets: this.loadedPresets,
                categories,
                onChoose: (file) => loadPresetFile(file, ++this.layoutLoadGeneration),
            });
            // Keep populating the right-click context-menu submenu — it
            // works off the same loadedPresets list.
            for (const preset of this.loadedPresets) {
                this.makeCtxBtn(preset.name, `load-preset:${preset.file}`, this.ctxLoadSubmenu);
            }
            // Restore stored screenmap (autosave/backup-aware), then fall
            // back to the first preset if nothing was auto-loaded.
            const defaultPresetFile = getDefaultPresetFile(manifest) ?? this.loadedPresets[0]?.file ?? null;
            const storedPreset = getPresetSelection();
            const storedPresetIsValid = typeof storedPreset === 'string'
                && this.loadedPresets.some((preset) => preset.file === storedPreset);
            let autoLoaded = false;
            if (storedPresetIsValid) {
                await loadPresetFile(storedPreset, startupGeneration);
                if (isStaleLayoutLoad(startupGeneration)) return;
                autoLoaded = true;
            } else {
                autoLoaded = this._autoloadOnLaunch();
            }
            this.renderBackupRow();
            if (autoLoaded && !storedPresetIsValid) {
                const stored = getScreenmap();
                if (stored && defaultPresetFile === CANONICAL_64X64_PRESET) {
                    const canonicalResponse = await fetch(`/screenmaps/${CANONICAL_64X64_PRESET}`, { signal: this.signal });
                    const canonicalText = await canonicalResponse.text();
                    if (isStaleLayoutLoad(startupGeneration)) return;
                    if (isCanonical64x64Geometry(stored, canonicalText)) {
                        await loadPresetFile(CANONICAL_64X64_PRESET, startupGeneration);
                        this.renderBackupRow();
                        this._updateHintStrip();
                        this._maybeAutoOpenHelpOnLaunch();
                        return;
                    }
                    const divergence = analyzeCanonical64x64Divergence(stored, canonicalText);
                    if (divergence && !isStaleLayoutLoad(startupGeneration)) {
                        const result = await fireDialog({
                            icon: 'warning',
                            title: 'Stored 64x64 layout differs from the built-in preset',
                            html: `This copy has <b>${String(divergence.actualLedCount)} LEDs</b>; `
                                + `the canonical layout has <b>${String(divergence.expectedLedCount)}</b>. `
                                + 'Resetting keeps this copy as a recoverable backup.',
                            confirmButtonText: 'Reset to built-in',
                            showCancelButton: true,
                            cancelButtonText: 'Keep custom layout',
                        });
                        if (result.isConfirmed && !isStaleLayoutLoad(startupGeneration)) {
                            await loadPresetFile(CANONICAL_64X64_PRESET, startupGeneration);
                            this.renderBackupRow();
                        }
                    }
                }
            } else if (!autoLoaded && defaultPresetFile) {
                await loadPresetFile(defaultPresetFile, startupGeneration);
            }
            if (isStaleLayoutLoad(startupGeneration)) return;
            this._updateHintStrip();
            this._maybeAutoOpenHelpOnLaunch();
        } catch (e: unknown) {
            if (this.signal.aborted) return;
            console.warn("Failed to load preset manifest:", e);
            this.dom_sel_preset_mount.textContent = 'No presets available';
            this._maybeAutoOpenHelpOnLaunch();
        }
    };

ShapeEditor.prototype.setBgControlsEnabled = function (this: ShapeEditor, enabled: boolean) {

        for (const el of this.bgImageControls) el.disabled = !enabled;
    };

ShapeEditor.prototype.resetBgControls = function (this: ShapeEditor) {

        this.dom_txt_image_opacity.value = '50';
        this.dom_txt_image_scale.value = '1.00';
        this.dom_txt_image_rotate.value = '0.00';
        this.dom_txt_image_tx.value = '0';
        this.dom_txt_image_ty.value = '0';
    };

ShapeEditor.prototype.applyBgImageTransform = function (this: ShapeEditor) {

        if (!this.bgImageMesh) return;
        const s = parseFloat(this.dom_txt_image_scale.value) || 1;
        const deg = parseFloat(this.dom_txt_image_rotate.value) || 0;
        const tx = parseFloat(this.dom_txt_image_tx.value) || 0;
        const ty = parseFloat(this.dom_txt_image_ty.value) || 0;
        this.bgImageMesh.scale.set(s, -s, 1); // negative y for y-down camera
        this.bgImageMesh.rotation.z = deg * Math.PI / 180;
        this.bgImageMesh.position.set(tx, ty, 0);
        this.setNeedsRender();
    };

ShapeEditor.prototype.clearBackgroundImage = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.removeBackgroundImage = function (this: ShapeEditor) {

        this.clearBackgroundImage();
        this.resetBgControls();
        this.dom_btn_upload_image.value = '';
        this.dom_bg_accordion.removeAttribute('open');
        this.setNeedsRender();
    };

ShapeEditor.prototype.showDeleteBgConfirm = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.dismissDeleteBgConfirm = function (this: ShapeEditor) {

        if (this.deleteBgConfirmEl) {
            this.deleteBgConfirmEl.remove();
            this.deleteBgConfirmEl = null;
        }
    };

ShapeEditor.prototype.loadBackgroundImage = function (this: ShapeEditor, file: File) {

        this.clearBackgroundImage();
        this.resetBgControls();

        this.bgImageObjectURL = URL.createObjectURL(file);
        const loader = new TextureLoader();
        loader.load(this.bgImageObjectURL, (texture) => {
            this.bgImageTexture = texture;
            this.bgImageTexture.colorSpace = SRGBColorSpace;

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
                map: this.bgImageTexture,
                transparent: true,
                opacity: (parseFloat(this.dom_txt_image_opacity.value) || 50) / 100,
                depthWrite: false,
                depthTest: false,
                side: DoubleSide,
            });

            this.bgImageMesh = new Mesh(geometry, material);
            this.bgImageMesh.renderOrder = 1;
            this.bgImageMesh.scale.y = -1;
            this._scene().add(this.bgImageMesh);

            this.setBgControlsEnabled(true);
            this.dom_bg_accordion.setAttribute('open', '');
        });
    };

ShapeEditor.prototype.toCanvasCoords = function (this: ShapeEditor, x: number, y: number): [number, number] {

        return [
            (x + this.camPanX) * this.camZoom + this.canvasW / 2,
            (y + this.camPanY) * this.camZoom + this.canvasH / 2,
        ];
    };

ShapeEditor.prototype.positionRulerAboveBBox = function (this: ShapeEditor) {

        if (this.screenmap_pts.length === 0) return;
        // Auto-create the initial ruler only when there are none. If the user
        // has deleted all rulers, leave the canvas free until they explicitly
        // Insert one via the context menu.
        if (this.rulers.length > 0) return;
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of this.screenmap_pts) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const bboxH = ymax - ymin;
        const gap = bboxH * 0.10;
        this.rulers.push({
            ax: xmin, ay: ymin - gap,
            bx: xmax, by: ymin - gap,
        });
    };

ShapeEditor.prototype.hitTestRuler = function (this: ShapeEditor, cx: number, cy: number) {

        // Returns the active ruler hit ({idx, kind}) or null. Walks rulers in
        // reverse order so the most-recently-added (drawn last, on top) wins
        // when two rulers overlap.
        const r = this.RULER_HANDLE_R + 4;
        for (let idx = this.rulers.length - 1; idx >= 0; idx--) {
            const ruler = this.rulers[idx];
            if (!ruler) continue;
            const [ax, ay] = this.toCanvasCoords(ruler.ax, ruler.ay);
            const [bx, by] = this.toCanvasCoords(ruler.bx, ruler.by);
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

        if (!this.overlayCtx || this.fitScale <= 0) return;
        if (this.rulers.length === 0) return;
        const ctx = this.overlayCtx;
        const pxPerCm = this.fitScale * this.camZoom;
        // Draw each ruler. The original implementation only had one; this loop
        // wraps the per-ruler drawing block below.
        for (const ruler of this.rulers) {
        const [ax, ay] = this.toCanvasCoords(ruler.ax, ruler.ay);
        const [bx, by] = this.toCanvasCoords(ruler.bx, ruler.by);
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
        ctx.fillStyle = withAlpha(gfxColors.bgPopover(), 0.8);
        ctx.fill();
        ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.15);
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

            ctx.strokeStyle = isMajor ? withAlpha(gfxColors.textStrong(), 0.6) : withAlpha(gfxColors.textStrong(), 0.25);
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
                ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.5);
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
        ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.75);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lenCm.toFixed(2) + ' cm', 0, 0);
        ctx.restore();

        // ── Handle circles ──
        for (const [hx, hy] of [[ax, ay], [bx, by]] as [number, number][]) {
            ctx.beginPath();
            ctx.arc(hx, hy, this.RULER_HANDLE_R, 0, Math.PI * 2);
            ctx.fillStyle = withAlpha(gfxColors.accentBlue(), 0.85);
            ctx.fill();
            ctx.strokeStyle = gfxColors.textStrong();
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // "0" label at A handle
        ctx.save();
        ctx.translate(ax + nx * (bandHalf + 10), ay + ny * (bandHalf + 10));
        ctx.rotate(Math.atan2(dy, dx));
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.5);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0', 0, 0);
        ctx.restore();

        ctx.restore();
        } // end for each ruler
    };

ShapeEditor.prototype._chainArrowCount = function (this: ShapeEditor) {

        if (!this.showChainArrows && this.editorMode !== 'chain') return 0;
        if (!this.stripInfo || this.stripInfo.strips.length <= 1) return 0;
        let drawable = 0;
        for (let s = 0; s < this.stripInfo.strips.length - 1; s++) {
            const a = this.nn(this.stripInfo.strips[s]), b = this.nn(this.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && this._pinOfStrip(a) === this._pinOfStrip(b)) drawable++;
        }
        return drawable;
    };

ShapeEditor.prototype._crossPinBadgeCount = function (this: ShapeEditor) {

        if (!this.showChainArrows && this.editorMode !== 'chain') return 0;
        if (!this.stripInfo || this.stripInfo.strips.length <= 1) return 0;
        let n = 0;
        for (let s = 0; s < this.stripInfo.strips.length - 1; s++) {
            const a = this.nn(this.stripInfo.strips[s]), b = this.nn(this.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && this._pinOfStrip(a) !== this._pinOfStrip(b)) n++;
        }
        return n;
    };

ShapeEditor.prototype.drawChainArrows = function (this: ShapeEditor, pts: [number, number][]) {

        const strips = this._si().strips;
        const ctx = this._octx();
        const pinOrder = this.stripStore.getPinOrder();
        const pinColors = getPinColors(pinOrder.length);
        const pinColorOf = (strip: StripEntry) => {
            const i = pinOrder.indexOf(this._pinOfStrip(strip));
            return pinColors[i >= 0 ? i : 0] ?? gfxColors.accentBlue();
        };
        // Refresh canvas-space geometry used by Chain-mode hit-tests.
        this._chainGeom.connectors.length = 0;
        this._chainGeom.starts.length = 0;
        this._chainGeom.ends.length = 0;
        this._chainGeom.crossBadges.length = 0;
        for (let s = 0; s < strips.length; s++) {
            const st = this.nn(strips[s]);
            if (st.count <= 0) continue;
            const si = st.offset;
            const ei = st.offset + st.count - 1;
            if (si >= pts.length || ei >= pts.length) continue;
            this._chainGeom.starts.push({ strip: s, x: this.nn(pts[si])[0], y: this.nn(pts[si])[1] });
            this._chainGeom.ends.push({ strip: s, x: this.nn(pts[ei])[0], y: this.nn(pts[ei])[1] });
        }
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = gfxColors.accentBlue();
        ctx.fillStyle = gfxColors.accentBlue();
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        let badgeN = 1;
        for (let s = 0; s < strips.length - 1; s++) {
            const a = this.nn(strips[s]), b = this.nn(strips[s + 1]);
            if (a.count <= 0 || b.count <= 0) continue;
            const aLast = a.offset + a.count - 1;
            const bFirst = b.offset;
            if (aLast >= pts.length || bFirst >= pts.length) continue;
            const [x1, y1] = this.nn(pts[aLast]);
            const [x2, y2] = this.nn(pts[bFirst]);
            if (this._pinOfStrip(a) !== this._pinOfStrip(b)) {
                // Cross-pin boundary: no arrow — pin-tinted dot near the next
                // strip's Start (§1.7).
                const tint = pinColorOf(b);
                ctx.setLineDash([]);
                ctx.fillStyle = tint;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.8);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = tint;
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(this._pinOfStrip(b), x2 + 21, y2 - 12);
                ctx.strokeStyle = gfxColors.accentBlue();
                ctx.fillStyle = gfxColors.accentBlue();
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                this._chainGeom.crossBadges.push({ up: s, down: s + 1, x: x2 + 12, y: y2 - 12 });
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
            ctx.fillStyle = gfxColors.bgPopoverStrong();
            ctx.beginPath();
            ctx.arc(mx, my, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = gfxColors.accentBlue();
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = gfxColors.accentBlue();
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(badgeN), mx, my);
            ctx.setLineDash([6, 4]);
            badgeN++;
            this._chainGeom.connectors.push({ x: x1, y: y1, up: s, down: s + 1, x1, y1, x2, y2, hx: x2, hy: y2 });
        }
        ctx.restore();
    };

ShapeEditor.prototype._drawChainDragGhost = function (this: ShapeEditor) {

        const ctx = this._octx();
        const drag = this.connectorDrag ?? this.startHandleDrag;
        if (!drag) return;
        let ax: number | null = null, ay: number | null = null;
        if (this.connectorDrag) {
            const cdrag = this.connectorDrag;
            const end = this._chainGeom.ends.find((e) => e.strip === cdrag.upIdx);
            if (end) { ax = end.x; ay = end.y; }
        } else if (this.startHandleDrag) {
            const shdrag = this.startHandleDrag;
            const start = this._chainGeom.starts.find((e) => e.strip === shdrag.stripIdx);
            if (start) { ax = start.x; ay = start.y; }
        }
        if (ax === null || ay === null) return;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = gfxColors.accentCyan();
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(drag.x, drag.y);
        ctx.stroke();
        if (drag.targetIdx !== null) {
            const handles = this.connectorDrag ? this._chainGeom.starts : this._chainGeom.ends;
            const h = handles.find((e) => e.strip === drag.targetIdx);
            if (h) {
                ctx.setLineDash([]);
                ctx.strokeStyle = gfxColors.accentCyan();
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(h.x, h.y, 13, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    };
