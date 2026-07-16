// Named ShapeEditor method bundle: io.
import type { ShapeEditor } from './shapeeditor-class';
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, type Material } from "three";
import type { StripEntry, StripInfo } from "./strips-model";
import { centerAndFitPoints, computeCenterFitScale, download_text_as_file, parseScreenmapMultiStrip, parse_screenmap_data } from "../common";
import { formatCompactJson } from "../json-compact";
import { safeStorage } from "../services/storage";
import { errorDialog, fireDialog, getSwal } from "../ui/dialogs";
import { backfillMeta, buildScreenmapMultiStripJson, getBackup, getPresetSelection, getScreenmap, getScreenmapMeta, isDegenerate, notePinMutation, promoteToBackup, restoreBackup, savePresetScreenmap, saveScreenmap, saveScreenmapMultiStrip, type BackupMeta } from "../screenmap-store";
import { fileHasExtension } from "../drag-drop";
import { CANONICAL_64X64_PRESET, analyzeCanonical64x64Divergence, getDefaultPresetFile, isCanonical64x64Geometry } from "../canonical-screenmap";
import { mountPresetPicker, type PresetCategory } from "../ui/preset-picker";
import type { PresetEntry } from "./shapeeditor-types";
import type { PointArrayWithDiameter } from "../common";

function escapeForTextarea(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface EditorIoMethods {
    doNewScreenmap: () => void;
    saveAs: () => void;
    _buildCurrentScreenmapJson: () => string;
    _openInspectJsonDialog: () => Promise<void>;
    _toastFreshDegenerate: (backupMeta: BackupMeta | null | undefined) => Promise<void>;
    _toastSilentRestored: (restoredMeta: BackupMeta | null | undefined, degenerateJson: string | null) => Promise<void>;
    _autoloadOnLaunch: () => boolean;
    _persistMultiStrip: () => void;
    renderBackupRow: () => void;
    doRestoreBackupFromButton: () => void;
    buildGrid: (width: number, height: number) => void;
    center_and_fit: (pts: [number, number][], canvasW: number, canvasH: number) => PointArrayWithDiameter;
    load_screenmap_data: (text: string, persist?: boolean) => void;
    loadScreenmapFile: (file: File | null | undefined) => void;
    loadPresetsFromManifest: () => Promise<void>;
}

export const editorIoMethods: EditorIoMethods & ThisType<ShapeEditor> = {
    doNewScreenmap(this: ShapeEditor){

        // Promote current working copy (if any) into the backup slot BEFORE
        // we wipe it, so the prior layout stays restorable. Then drop the
        // working copy entirely instead of writing a degenerate
        // single-LED screenmap that would auto-load on next launch.
        const hadBackupPromote = promoteToBackup();
        this.clearEditingState();
        this.presetPicker?.setActive('');
        this.screenmap_pts = [[0, 0]];
        this.rawPts = [[0, 0]];
        this.stripInfo = null;
        this.stripStore.load(null);
        this.renderStripsPanel();
        this.origDiameter = 0.5;
        this.dom_txt_diameter.value = String(this.origDiameter);
        this.origWidth = 0;
        this.origHeight = 0;
        this.fitScale = 1;
        this.resetTransforms();
        this.setNeedsGeometryUpdate();
        safeStorage.remove('lm:screenmap');
        safeStorage.remove('lm:screenmap-meta');
        safeStorage.remove('lm:screenmap-preset');
        try { this.renderBackupRow(); } catch { /* render is best-effort */ }
        if (hadBackupPromote) {
            void this._toastInfo('New layout — previous layout kept as backup').catch(() => { /* toast is best effort */ });
        }
    },
    _buildCurrentScreenmapJson(this: ShapeEditor): string{

    if (this.rawPts.length === 0) return '';

    const scaleGlobal = parseFloat(this.dom_txt_scale.value) || 1;
    const sX = (parseFloat(this.dom_txt_scale_x.value) || 1) * scaleGlobal;
    const sY = (parseFloat(this.dom_txt_scale_y.value) || 1) * scaleGlobal;
    const rotateDeg = parseInt(this.dom_txt_rotate.value) || 0;
    const rotateRad = rotateDeg * Math.PI / 180;
    const cosR = Math.cos(rotateRad);
    const sinR = Math.sin(rotateRad);
    // Translation is in world-pixel space; convert to cm for export
    const txCm = (parseFloat(this.dom_txt_translate_x.value) || 0) / this.fitScale;
    const tyCm = (parseFloat(this.dom_txt_translate_y.value) || 0) / this.fitScale;
    const fallbackDiameter = parseFloat(this.dom_txt_diameter.value) || 0.25;

    const transformPoint = ([x, y]: [number, number]) => {
        const rx = x * sX;
        const ry = y * sY;
        return [
            +(rx * cosR - ry * sinR + txCm).toFixed(4),
            +(rx * sinR + ry * cosR + tyCm).toFixed(4),
        ];
    };

    if (this.stripInfo && this.stripInfo.strips.length >= 1
        && this.stripInfo.totalCount === this.rawPts.length) {
        const stripsOut = this.stripInfo.strips.map((strip: StripEntry) => {
            const pts = [];
            for (let i = strip.offset; i < strip.offset + strip.count; i++) {
                pts.push(transformPoint(this.rawPts[i] ?? [0, 0]));
            }
            const d = typeof strip.diameter === 'number' ? strip.diameter : fallbackDiameter;
            return {
                name: strip.name,
                points: pts,
                diameter: d,
                offset: strip.offset,
                count: strip.count,
                video_offset: typeof strip.video_offset === 'number' ? strip.video_offset : strip.offset,
                pin: typeof strip.pin === 'string' ? strip.pin : 'pin1',
                videoOffsetOverride: strip.videoOffsetOverride,
            };
        });
        return buildScreenmapMultiStripJson(stripsOut);
    }

    const xArr = [];
    const yArr = [];
    for (const pt of this.rawPts) {
        const [tx, ty] = transformPoint(pt);
        xArr.push(tx);
        yArr.push(ty);
    }
    const map = { strip1: { x: xArr, y: yArr, diameter: fallbackDiameter } };
    return JSON.stringify({ map }, null, 2);
},
    saveAs(this: ShapeEditor){

    const json = this._buildCurrentScreenmapJson();
    if (!json) return;

    saveScreenmap(json);
    download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
    this.clearDirty();
    try { this.renderBackupRow(); } catch { /* render is best-effort */ }
},
    async _openInspectJsonDialog(this: ShapeEditor): Promise<void>{

    let json = this._buildCurrentScreenmapJson();
    if (!json) {
        json = '{\n  "map": {}\n}\n';
    }

    // Reformat with the compact-aware pretty printer so per-LED numeric arrays
    // (x[], y[], z[]) stay inline rather than blowing up into one line per LED.
    try {
        json = formatCompactJson(JSON.parse(json));
    } catch {
        // Leave the original `json` as-is if it isn't parseable for any reason
        // (shouldn't happen, but keep the dialog functional).
    }

    if (this.signal.aborted) return;
    let Swal;
    try {
        Swal = await getSwal();
    } catch {
        return;
    }

    const res = await fireDialog({
        title: 'Inspect / Edit Screenmap JSON',
        html: `
            <div class="inspect-json-help">
                Edit and Apply to reload the editor with the modified JSON, or Copy to clipboard.
            </div>
            <textarea id="inspect_json_text" class="inspect-json-text" rows="22">${escapeForTextarea(json)}</textarea>
        `,
        width: '80vw',
        showConfirmButton: true,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Apply',
        denyButtonText: 'Copy to clipboard',
        cancelButtonText: 'Close',
        focusCancel: true,
        preConfirm: () => {
            const ta = document.getElementById('inspect_json_text') as HTMLTextAreaElement | null;
            const next = ta?.value ?? '';
            try {
                JSON.parse(next);
            } catch (e) {
                Swal.showValidationMessage(`Invalid JSON: ${String(e instanceof Error ? e.message : e)}`);
                return false;
            }
            return next;
        },
    });

    if (res.isConfirmed && typeof res.value === 'string') {
        try {
            this.load_screenmap_data(res.value);
        } catch (e) {
            console.warn('Inspect JSON: failed to load edited JSON', e);
        }
    } else if (res.isDenied) {
        const ta = document.getElementById('inspect_json_text') as HTMLTextAreaElement | null;
        const text = ta?.value ?? json;
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            console.warn('Inspect JSON: clipboard write failed', e);
        }
    }
},
    async _toastFreshDegenerate(this: ShapeEditor, backupMeta: BackupMeta | null | undefined){

        const ledCount = (backupMeta && typeof backupMeta.ledCount === 'number')
            ? backupMeta.ledCount : 0;
        try {
            if (this.signal.aborted) return;
            const res = await fireDialog({
                toast: true,
                position: 'top',
                icon: 'info',
                title: 'Looks like an empty edit',
                html: `Your last good layout had <b>${String(ledCount)} LED${ledCount === 1 ? '' : 's'}</b>.`,
                showConfirmButton: true,
                showCancelButton: true,
                confirmButtonText: 'Restore previous layout',
                cancelButtonText: 'Dismiss',
                timer: 12000,
                timerProgressBar: true,
            });
            if (res.isConfirmed) {
                const json = restoreBackup();
                if (json) {
                    this.load_screenmap_data(json);
                    this.renderBackupRow();
                }
            }
        } catch { /* ignore */ }
    },
    async _toastSilentRestored(this: ShapeEditor, restoredMeta: BackupMeta | null | undefined, degenerateJson: string | null){

        const ledCount = (restoredMeta && typeof restoredMeta.ledCount === 'number')
            ? restoredMeta.ledCount : 0;
        const when: string = (restoredMeta && typeof restoredMeta.savedAt === 'number')
            ? this._relativeTime(restoredMeta.savedAt) : 'recently';
        try {
            if (this.signal.aborted) return;
            const res = await fireDialog({
                toast: true,
                position: 'top',
                icon: 'success',
                title: 'Restored your last good layout',
                html: `${String(ledCount)} LED${ledCount === 1 ? '' : 's'}, saved ${when}`,
                showConfirmButton: true,
                confirmButtonText: 'Undo',
                showCancelButton: false,
                timer: 8000,
                timerProgressBar: true,
            });
            if (res.isConfirmed && typeof degenerateJson === 'string') {
                // Put the degenerate copy back as the working copy. We bypass
                // the save gate by writing directly to the store keys.
                safeStorage.set('lm:screenmap', degenerateJson);
                safeStorage.remove('lm:screenmap-meta');
                this.load_screenmap_data(degenerateJson);
                this.renderBackupRow();
            }
        } catch { /* ignore */ }
    },
    _autoloadOnLaunch(this: ShapeEditor){

        backfillMeta();
        const stored = getScreenmap();
        const meta = getScreenmapMeta();
        const backup = getBackup();
        const STALE_MS = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        if (stored && !isDegenerate(stored)) {
            // Valid working copy — load it; if stale, show passive toast.
            this.load_screenmap_data(stored);
            if (meta && typeof meta.savedAt === 'number'
                && (now - meta.savedAt) > STALE_MS) {
                void this._toastInfo(`Loaded layout from ${this._relativeTime(meta.savedAt)}`);
            }
            return true;
        }

        if (stored && isDegenerate(stored)) {
            // Working copy is degenerate. Decide based on staleness + backup.
            const stale = !meta || typeof meta.savedAt !== 'number'
                || (now - meta.savedAt) > STALE_MS;
            if (stale && backup) {
                // Silent restore + Undo toast.
                const restored = restoreBackup();
                if (restored) {
                    this.load_screenmap_data(restored);
                    void this._toastSilentRestored(backup.meta, stored);
                    return true;
                }
            } else if (!stale && backup) {
                // Fresh degenerate — load the degenerate copy and show banner.
                this.load_screenmap_data(stored);
                void this._toastFreshDegenerate(backup.meta);
                return true;
            }
            // Degenerate, no backup — fall through to default behavior.
            return false;
        }

        // Missing/corrupt JSON — try backup, otherwise fall through.
        if (backup) {
            const restored = restoreBackup();
            if (restored) {
                this.load_screenmap_data(restored);
                void this._toastSuccess('Restored your last good layout');
                return true;
            }
        }
        return false;
    },
    _persistMultiStrip(this: ShapeEditor){

        if (!this.stripInfo || this.stripInfo.strips.length === 0) return;
        try {
            const fallbackDiameter = parseFloat(this.dom_txt_diameter.value) || 0.25;
            const strips = this.stripInfo.strips.map((s) => {
                const pts: [number, number][] = [];
                for (let i = s.offset; i < s.offset + s.count; i++) {
                    const rp = this.rawPts[i] ?? [0, 0];
                    pts.push([rp[0], rp[1]]);
                }
                return {
                    name: s.name,
                    points: pts,
                    diameter: typeof s.diameter === 'number' ? s.diameter : fallbackDiameter,
                    offset: s.offset,
                    count: s.count,
                    video_offset: typeof s.video_offset === 'number' ? s.video_offset : s.offset,
                    pin: typeof s.pin === 'string' ? s.pin : 'pin1',
                    videoOffsetOverride: s.videoOffsetOverride,
                };
            });
            saveScreenmapMultiStrip(strips);
        } catch { /* persistence is best-effort */ }
        try { this.renderBackupRow(); } catch { /* render is best-effort */ }
    },
    renderBackupRow(this: ShapeEditor){

        const b = getBackup();
        if (!b?.meta) {
            this.dom_strips_backup_row.style.display = 'none';
            this.dom_strips_btn_restore_backup.disabled = true;
            return;
        }
        const m = b.meta;
        const stripCount = typeof m.stripCount === 'number' ? m.stripCount : 0;
        const ledCount = typeof m.ledCount === 'number' ? m.ledCount : 0;
        const when: string = typeof m.savedAt === 'number' ? this._relativeTime(m.savedAt) : '';
        const summary = `${String(stripCount)} strip${stripCount === 1 ? '' : 's'} · ${String(ledCount)} LED${ledCount === 1 ? '' : 's'} · ${when}`;
        this.dom_strips_backup_summary.textContent = summary;
        this.dom_strips_backup_row.style.display = '';
        this.dom_strips_btn_restore_backup.disabled = false;
    },
    doRestoreBackupFromButton(this: ShapeEditor){

        const b = getBackup();
        if (!b) return;
        const beforeJson = getScreenmap();
        const restored = restoreBackup();
        if (!restored) return;
        this.pushUndo({
            type: 'restore-backup',
            beforeJson: typeof beforeJson === 'string' ? beforeJson : null,
            afterJson: restored,
        });
        this.load_screenmap_data(restored);
        this.renderBackupRow();
        void this._toastSuccess('Backup restored');
    },
    buildGrid(this: ShapeEditor, width: number, height: number){

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
    },
    center_and_fit(this: ShapeEditor, pts: [number, number][], canvasW: number, canvasH: number){

        return centerAndFitPoints(pts, canvasW, canvasH, {
            margin: 0.95,
            center: 'origin',
            pixelAlignScale: true,
        });
    },
    load_screenmap_data(this: ShapeEditor, text: string, persist = true){

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
        const fitViewport = this.getFitViewport();
        const { width: fitW, height: fitH } = fitViewport;
        this.fitScale = computeCenterFitScale(this.rawPts, fitW, fitH, {
            margin: 0.95,
            center: 'origin',
            pixelAlignScale: true,
        });
        this.screenmap_pts = this.center_and_fit(this.screenmap_pts, fitW, fitH);
        this.camPanX = fitViewport.centerOffsetX;
        this.camPanY = fitViewport.centerOffsetY;
        this.positionRulerAboveBBox();
        // A loaded map is a document you can export straight away (#292).
        this._refreshSaveEnabled();
    },
    loadScreenmapFile(this: ShapeEditor, file: File | null | undefined){

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
    },
    async loadPresetsFromManifest(this: ShapeEditor){
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
    },
};
