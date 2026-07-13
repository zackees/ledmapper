import { errorDialog, fireDialog, getSwal } from '../ui/dialogs';
import type { ParsedStrip, MultiStripParseResult } from '../types/domain';
import { parseScreenmapMultiStrip } from '../common';
import { wireFileDropTarget, wireFileSource, fileHasExtension } from '../drag-drop';
import { saveScreenmap, savePresetScreenmap, getPresetSelection, getScreenmap } from '../screenmap-store';
import { analyzeCanonical64x64Divergence, CANONICAL_64X64_PRESET, getDefaultPresetFile, isCanonical64x64Geometry } from '../canonical-screenmap';
import { transformToCenter, parseResolution, extractGatherSample, computeFps, scaleToMaxDimension, buildVideoChannelMap } from './transforms';
import { resolveLedDiameter, computeFitScale } from '../bloom-utils';
import { loadPresetText } from '../preset-loader';
import screenmapManifest from 'virtual:screenmap-presets';
import { mountPresetPicker } from '../ui/preset-picker';
import { createBlurPipeline } from './blur-pipeline';
import { createVideoSource } from './video-source';
import { createRecording } from './recording';
import { drawMoviemakerOverlay } from './overlay';
import { createLedPreview } from './preview';
import { wireSliderReadout } from '../ui/sliders';
import { setupToggleButton } from '../ui/toggle-button';
import { createLogger } from '../debug-log';
import { createVideoStallWatchdog, createRafHeartbeat } from '../watchdogs';
import { createFpsEstimator } from './frame-pacing';
import { runOfflineCapture, isOfflineCaptureSupported } from './offline-capture';
import { registerDebugState, unregisterDebugState, type MoviemakerDebugState } from '../debug-registry';

const log = createLogger('moviemaker');
import { withPrefix } from '../services/storage';
import { createCanvasRecorder, dimensionsForAspect, type AspectPreset } from '../render/canvas-recorder';
import { PREVIEW_AUTO_MAX_SPARSE, PREVIEW_AUTO_FLOOR } from '../bloom-utils';
import { perfEnabled } from './perf';
import templateHtml from './template.html?raw';
export { default as css } from './moviemaker.css?url';

/** Typed DOM-query-or-throw. Throws if `sel` does not match. */
function qeFrom(root: ParentNode, sel: string): Element {
    const el = root.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el;
}

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

    // ── DOM refs ────────────────────────────────────────────────────────────────
    // Shorthand DOM query helper scoped to this component's container.
    // The type parameter T appears in the return; `_cast` makes it appear twice.
    function qe<T extends Element>(sel: string, _cast?: (e: Element) => T): T {
        return qeFrom(container, sel) as T;
    }
    const qei = (sel: string) => qe<HTMLInputElement>(sel);

    const dom_btn_load_video    = qe<HTMLButtonElement>('#btn_load_video');
    const dom_btn_start_webcam  = qe<HTMLButtonElement>('#btn_start_webcam');
    const dom_btn_upload_screenmap  = qei('#btn_upload_screenmap');
    const dom_txt_screenmap_filename = qe<HTMLElement>('#txt_screenmap_filename');
    const dom_preset_mount = container.querySelector<HTMLElement>('.preset-picker-mount');
    const dom_screenmap_group = dom_preset_mount?.closest('.control-group');
    const dom_source_hint = container.querySelector('#screenmap_gate_hint');
    // Screenmap band collapse (issue #248): compact summary row + "Change
    // layout" affordance shown once a layout is active, expandable back to
    // the full picker.
    const dom_sidebar = container.querySelector<HTMLElement>('#sidebar');
    const dom_screenmap_collapsed_row = container.querySelector<HTMLElement>('#screenmap_collapsed_row');
    const dom_screenmap_expanded_panel = container.querySelector<HTMLElement>('#screenmap_expanded_panel');
    const dom_txt_active_layout = container.querySelector<HTMLElement>('#txt_active_layout');
    const dom_txt_active_led_count = container.querySelector<HTMLElement>('#txt_active_led_count');
    const dom_btn_change_layout = container.querySelector<HTMLButtonElement>('#btn_change_layout');
    const dom_btn_collapse_layout = container.querySelector<HTMLButtonElement>('#btn_collapse_layout');
    const dom_btn_unload_source = qe<HTMLButtonElement>('#btn_unload_source');
    const dom_btn_change_video = qe<HTMLButtonElement>('#btn_change_video');
    const dom_video_file_input = qe<HTMLInputElement>('#video_file_input');
    const dom_video_source_menu = qe<HTMLElement>('#video_source_menu');
    const dom_btn_play_pause    = qe<HTMLButtonElement>('#btn_play_pause');
    const dom_video_progress    = qe<HTMLElement>('#video-progress');
    const dom_progress_track    = qe<HTMLElement>('#video-progress-track');
    const dom_progress_thumb    = qe<HTMLElement>('#video-progress-thumb');
    const dom_time_current      = qe<HTMLElement>('#video-time-current');
    const dom_time_duration     = qe<HTMLElement>('#video-time-duration');
    const dom_btn_how_to       = qe<HTMLButtonElement>('#btn_how_to');
    const dom_btn_toggle_record = qe<HTMLInputElement>('#btn_toggle_record');
    const dom_sel_record_format = qe<HTMLSelectElement>('#sel_record_format');
    const dom_sel_record_aspect = qe<HTMLSelectElement>('#sel_record_aspect');
    const dom_rng_rotation     = qei('#rng_rotation');
    const dom_rng_zoom         = qei('#rng_zoom');
    const dom_txt_curr_zoom    = qe<HTMLElement>('#txt_curr_zoom');
    const dom_rng_brightness   = qei('#rng_brightness');
    const dom_txt_curr_bri     = qe<HTMLElement>('#txt_curr_bri');
    const dom_chk_limit_bri    = qei('#chk_limit_brightness');
    const dom_rng_max_bri      = qei('#rng_max_brightness');
    const dom_txt_curr_max_bri = qe<HTMLElement>('#txt_curr_max_bri');
    const dom_rng_gamma        = qei('#rng_gamma');
    const dom_txt_curr_gamma   = qe<HTMLElement>('#txt_curr_gamma');
    const dom_rng_blur         = qei('#rng_blur');
    const dom_rng_blur_sigma   = qei('#rng_blur_sigma');
    const dom_chk_sigma_lock   = qei('#chk_sigma_lock');
    const dom_sel_resolution   = qe<HTMLSelectElement>('#sel_resolution');
    const dom_sel_framerate    = qe<HTMLSelectElement>('#sel_framerate');
    const dom_sel_max_resolution = qe<HTMLSelectElement>('#sel_max_resolution');
    const dom_txt_curr_resolution = qe<HTMLElement>('#txt_curr_resolution');
    const dom_chk_show_leds    = qei('#chk_show_leds');
    const dom_chk_show_labels  = qei('#chk_show_labels');
    const dom_chk_auto_bloom       = qei('#chk_auto_bloom');
    const dom_bloom_strength_slider = qe('#bloom_strength_slider');
    const dom_rng_bloom_strength   = qei('#rng_bloom_strength');
    const dom_txt_bloom_strength   = qe<HTMLElement>('#txt_curr_bloom_strength');

    const videoPlayer    = qe<HTMLVideoElement>('#videoPlayer');
    const renderCanvas   = qe<HTMLCanvasElement>('#renderCanvas');
    const overlayCanvas  = qe<HTMLCanvasElement>('#overlayCanvas');
    const overlayCtxRaw  = overlayCanvas.getContext('2d');
    if (!overlayCtxRaw) throw new Error('moviemaker: overlay canvas 2d context unavailable');
    const overlayCtx     = overlayCtxRaw;
    const previewPanel   = qe<HTMLElement>('#previewPanel');
    const preview        = createLedPreview({ parent: previewPanel, side: 400 });
    const dom_preview_options = qe<HTMLElement>('#preview-options');
    const dom_chk_preview_rotate = qei('#chk_preview_rotate');
    const dom_chk_preview_bloom  = qei('#chk_preview_bloom');

    const ac = new AbortController();
    const { signal } = ac;

    // Play/Pause toggle — set up early so `updateElementStates()` can call
    // `playPauseCtl.setState('off')` before any user interaction. Glyph
    // lives in moviemaker.css under `.btn-play-pause[data-state="..."]`
    // (#192).
    const playPauseCtl = setupToggleButton(dom_btn_play_pause, {
        off: { state: 'paused', label: 'Play' },
        on:  { state: 'playing', label: 'Pause' },
    }, 'off', () => { videoSource.playPause(); }, { signal });

    // Debug/test seams for the realtime capture fallback (#266). The offline
    // WebCodecs pass handles file sources by default; these force the
    // realtime path so it can be exercised: `forceRealtimeCapture` skips the
    // offline route, `noRvfc` ignores rVFC so pacing falls to the media-clock
    // source-frame index (the true no-rVFC-engine path).
    const _urlParams = (() => {
        try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
    })();
    const forceRealtimeCapture = _urlParams.has('forceRealtimeCapture');
    const ignoreRvfc = _urlParams.has('noRvfc');

    // ── State ───────────────────────────────────────────────────────────────────
    let screenmap_pts: [number, number][] = [];
    let rawScreenmapPts: [number, number][] = [];
    let screenmapStrips: ParsedStrip[] = [];
    let videoChannelMap: Int32Array | null = null;   // flat LED index -> .rgb channel index (null = identity)
    let previewLedDiameter: number | null = null; // screenmap-declared diameter in screenmap_pts units (null = heuristic)
    let screenmapValid = false;
    let sourceActive = false;
    // Screenmap band collapse (issue #248). The band is collapsed by default
    // whenever a layout is active; `screenmapBandExpanded` is a transient
    // manual override set by "Change layout" and cleared by "Done".
    let screenmapBandExpanded = false;
    // Display label for the compact row: active preset name, uploaded
    // filename, or a generic fallback when the origin is unknown (e.g. a
    // screenmap restored from storage across a reload).
    let activeLayoutLabel: string | null = null;

    let target_zoom = 1, curr_zoom = 1;
    let target_rotate = 0, curr_rotate = 0;
    let target_translate: [number, number] = [0, 0], curr_translate: [number, number] = [0, 0];
    // Drag state: null when idle, or { kind: 'translate'|'zoom', pointerId, lastY }
    let drag: { kind: 'translate' | 'zoom'; pointerId: number; lastY: number; startX: number; startY: number; moved: boolean } | null = null;
    let suppressNextContextMenu = false;
    let sourceMenuInvoker: HTMLElement | null = null;

    let frame_rate = 30;
    let nativeVideoWidth = 640, nativeVideoHeight = 480;
    let videoWidth = 640, videoHeight = 480;
    let rafId: number | null = null;
    let isScrubbing = false;

    // ── Extracted modules ────────────────────────────────────────────────────────
    const blurPipeline = createBlurPipeline({
        canvas: renderCanvas,
        videoPlayer,
        initialUniforms: {
            blurRadius: parseFloat(dom_rng_blur.value),
            sigma: parseFloat(dom_rng_blur_sigma.value),
        },
    });

    const videoSource = createVideoSource({
        videoPlayer,
        parseResolution,
        onSourceReady(w: number, h: number, type: string) {
            log.info('source-ready', { type, w, h });
            setupForNewSource(w, h);
            // Baseline 30 fps until the rVFC estimator locks onto the real
            // source rate (issue #256) — applies to files and webcams alike.
            frame_rate = 30;
            fpsEstimator.reset();
            lastPresentedFrames = null;
        },
        onError(message: string) {
            log.info('source-error', { message });
            void errorDialog('Webcam Error', message);
        },
    });

    // Raw JSON text of the screenmap currently driving the render, whatever
    // its origin (preset, upload, or store restore). Recording embeds this in
    // the .fled header — it must always match the live map, so it cannot come
    // from the shared localStorage store: presets are deliberately never
    // persisted there (that would clobber the user's editor map), which left
    // getScreenmap() returning null and killed preset recordings at save time.
    let currentScreenmapJson: string | null = null;

    const recording = createRecording({
        getSwal,
        getScreenmapJson: () => currentScreenmapJson ?? getScreenmap(),
        onSaved: () => {
            void getSwal().then((swal) => swal.fire({
                title: 'Recording ready',
                text: 'Your LED video is saved. Open it in Video Player now?',
                icon: 'success',
                showCancelButton: true,
                confirmButtonText: 'Play video',
                cancelButtonText: 'Stay here',
            }).then((result) => {
                if (result.isConfirmed) window.location.href = '/movieplayer/';
            }));
        },
    });

    // ── Helpers ─────────────────────────────────────────────────────────────────

    function formatTime(seconds: number) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${String(m)}:${s.toString().padStart(2, '0')}`;
    }

    function getMaxResolution() {
        return parseInt(dom_sel_max_resolution.value);
    }

    function applyResolution(nativeW: number, nativeH: number) {
        const { width: w, height: h } = scaleToMaxDimension(nativeW, nativeH, getMaxResolution());

        videoWidth = w;
        videoHeight = h;

        blurPipeline.setupForResolution(w, h);
        overlayCanvas.width = w;
        overlayCanvas.height = h;

        if (screenmapValid) {
            screenmap_pts = transformToCenter(rawScreenmapPts, videoWidth, videoHeight);
            updatePreviewLedDiameter();
            target_translate = [w / 2, h / 2];
            curr_translate = [w / 2, h / 2];
        }

        const canvasRow = container.querySelector<HTMLElement>('.canvas-row');
        if (canvasRow) canvasRow.dataset.layout = (w > h) ? 'landscape' : 'portrait';

        dom_txt_curr_resolution.textContent = `${String(w)}×${String(h)}`;

        // Fit now (bounds the canvas immediately so a full-res backing store
        // never flashes at native size) and again next frame, since layout may
        // not have settled — the toolbar/preview may have just become visible
        // or data-layout may have just flipped.
        fitCanvasDisplay();
        requestAnimationFrame(fitCanvasDisplay);
    }

    // Size the render canvas's DISPLAY box to fit the available area while
    // preserving the source aspect ratio (issue #278 follow-up). The backing
    // store stays full-res; only the on-screen box is set. Explicit px sizing
    // — rather than CSS max-width/max-height, which a block replaced element
    // clamps per-axis and so distorts the ratio (a 16:9 source rendered ~2:1).
    // The overlay fills the same wrapper, so it tracks the render canvas 1:1.
    const dom_canvas_area = container.querySelector<HTMLElement>('.canvas-area');
    const dom_canvas_container = container.querySelector<HTMLElement>('#canvas-container');
    const dom_canvas_with_preview = container.querySelector<HTMLElement>('.canvas-with-preview');
    const dom_preview_column = container.querySelector<HTMLElement>('.preview-column');
    function fitCanvasDisplay() {
        const area = dom_canvas_area;
        const cc = dom_canvas_container;
        const cwp = dom_canvas_with_preview;
        if (!area || !cc || !cwp || videoWidth === 0 || videoHeight === 0) return;

        const areaCS = getComputedStyle(area);
        let availW = area.clientWidth - parseFloat(areaCS.paddingLeft) - parseFloat(areaCS.paddingRight);
        let availH = area.clientHeight - parseFloat(areaCS.paddingTop) - parseFloat(areaCS.paddingBottom);

        // The preview column sits beside the canvas — reserve its width.
        if (dom_preview_column && dom_preview_column.offsetParent !== null) {
            const rowGap = parseFloat(getComputedStyle(cwp).columnGap) || 0;
            availW -= dom_preview_column.offsetWidth + rowGap;
        }
        // The toolbar / progress bar / layout bar stack above the canvas.
        const colGap = parseFloat(getComputedStyle(cc).rowGap) || 0;
        let visibleSiblings = 0;
        for (const child of Array.from(cc.children)) {
            const el = child as HTMLElement;
            if (el === cwp || el.offsetParent === null) continue;
            availH -= el.offsetHeight;
            visibleSiblings++;
        }
        availH -= colGap * visibleSiblings;

        if (availW <= 0 || availH <= 0) return;

        // Contain the source ratio within the available box.
        const ratio = videoWidth / videoHeight;
        let dispW = availW;
        let dispH = availW / ratio;
        if (dispH > availH) { dispH = availH; dispW = availH * ratio; }
        renderCanvas.style.width = `${String(Math.max(1, Math.floor(dispW)))}px`;
        renderCanvas.style.height = `${String(Math.max(1, Math.floor(dispH)))}px`;
    }
    window.addEventListener('resize', fitCanvasDisplay, { signal });

    function setupForNewSource(nativeW: number, nativeH: number) {
        const previousSize: [number, number] = [videoWidth, videoHeight];
        const targetRatio: [number, number] = [target_translate[0] / previousSize[0], target_translate[1] / previousSize[1]];
        const currentRatio: [number, number] = [curr_translate[0] / previousSize[0], curr_translate[1] / previousSize[1]];
        const replacingSource = sourceActive;
        nativeVideoWidth = nativeW;
        nativeVideoHeight = nativeH;

        applyResolution(nativeW, nativeH);
        if (replacingSource) {
            target_translate = [targetRatio[0] * videoWidth, targetRatio[1] * videoHeight];
            curr_translate = [currentRatio[0] * videoWidth, currentRatio[1] * videoHeight];
        }

        sourceActive = true;
        updateElementStates();

        const welcomeEl = container.querySelector('#welcome-overlay');
        if (welcomeEl) welcomeEl.classList.add('hidden');

        const toolbar = container.querySelector('.canvas-toolbar');
        if (toolbar) toolbar.classList.add('visible');

        previewPanel.classList.add('visible');
        dom_preview_options.classList.add('visible');

        // Show/hide video-only controls (play button is inside progress bar)
        const isVideo = videoSource.sourceType === 'video';
        dom_video_progress.classList.toggle('visible', isVideo);
        if (isVideo) {
            dom_time_duration.textContent = formatTime(videoPlayer.duration);
            dom_time_current.textContent = '0:00';
            setVideoProgress(0);
            // Autoplay the (muted, looping) source so the workspace comes alive
            // the instant a video is chosen, instead of parking on a black,
            // paused frame 0 that reads as a broken pipeline (issue #288).
            // Recording stays a separate, explicit action.
            videoSource.play();
            playPauseCtl.setState('on');
        }
    }

    function updateElementStates() {
        const sliders = [
            dom_rng_rotation, dom_rng_brightness, dom_rng_gamma,
            dom_rng_blur, dom_rng_blur_sigma, dom_rng_zoom
        ];
        const ready = sourceActive && screenmapValid;
        sliders.forEach(el => {
            el.disabled = !ready;
            const cg = el.closest('.control-group');
            if (cg) cg.classList.toggle('disabled', !ready);
        });
        dom_btn_toggle_record.disabled = !sourceActive || !screenmapValid;
        const cg = dom_btn_toggle_record.closest('.control-group');
        if (cg) cg.classList.toggle('disabled', dom_btn_toggle_record.disabled);
        // Gate the Screenmap presets + upload until a source is loaded. The
        // default screenmap still auto-loads via presetButtons[0].click() since
        // pointer-events does not block programmatic clicks.
        dom_screenmap_group?.classList.toggle('disabled', !sourceActive);
        dom_source_hint?.classList.toggle('hidden', sourceActive);
        updateScreenmapBandUI();
    }

    /** Anchor the fixed picker popover as a dropdown directly under the
     *  "Change layout" button (issue #273 follow-up) — so the menu reads as
     *  belonging to the button that opened it, rather than dropping from the
     *  far edge of the bar. Left-aligned with the button, shifted left only
     *  if it would overflow the viewport. Inline top/left/width so opening
     *  never reflows the page; `position: fixed` because ancestors' overflow
     *  would otherwise clip it. */
    function positionLayoutPopover() {
        const panel = dom_screenmap_expanded_panel;
        const anchor = dom_btn_change_layout;
        if (!panel || !anchor) return;
        const r = anchor.getBoundingClientRect();
        const margin = 8;
        const width = Math.max(280, Math.min(560, window.innerWidth - margin * 2));
        // Prefer left-aligned with the button; pull left if it would spill
        // off the right edge, and never past the left margin.
        let left = r.left;
        if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
        if (left < margin) left = margin;
        panel.style.top = `${String(Math.round(r.bottom + 6))}px`;
        panel.style.left = `${String(Math.round(left))}px`;
        panel.style.width = `${String(Math.round(width))}px`;
    }

    /**
     * Sync the screenmap band (issues #248 / #273).
     * - Before a source loads: only the gate hint speaks (one message, no
     *   contradiction). The summary row + picker stay hidden.
     * - Source active: the compact summary row shows the active layout.
     *   "Change layout" opens the picker as a select-to-dismiss popover that
     *   floats over the canvas — picking a preset / uploading auto-closes it,
     *   as do Esc and click-outside. The picker stays mounted (off-screen
     *   when closed, never `display:none`) so `#btn_upload_screenmap` /
     *   `.preset-btn` remain addressable for `setInputFiles()` and clicks.
     */
    function updateScreenmapBandUI() {
        const showSummary = sourceActive && screenmapValid;
        const open = screenmapBandExpanded && showSummary;
        // Once a source loads the layout control moves above the canvas, so
        // the top band (now only the no-source gate hint) collapses away —
        // reclaiming the vertical space and un-stranding the affordance.
        dom_sidebar?.classList.toggle('hidden', sourceActive);
        dom_screenmap_collapsed_row?.classList.toggle('hidden', !showSummary);
        dom_screenmap_expanded_panel?.classList.toggle('screenmap-offscreen', !open);
        if (dom_screenmap_expanded_panel) {
            if (open) {
                positionLayoutPopover();
            } else {
                // Clear the inline anchor so the .screenmap-offscreen rule wins.
                dom_screenmap_expanded_panel.style.top = '';
                dom_screenmap_expanded_panel.style.left = '';
                dom_screenmap_expanded_panel.style.width = '';
            }
        }
        dom_btn_change_layout?.setAttribute('aria-expanded', String(open));
        if (dom_txt_active_layout) dom_txt_active_layout.textContent = activeLayoutLabel ?? 'Custom layout';
        if (dom_txt_active_led_count) {
            const n = rawScreenmapPts.length;
            dom_txt_active_led_count.textContent = `${String(n)} LED${n === 1 ? '' : 's'}`;
        }
    }

    function closeLayoutPicker() {
        screenmapBandExpanded = false;
        updateScreenmapBandUI();
    }

    dom_btn_change_layout?.addEventListener('click', () => {
        screenmapBandExpanded = !screenmapBandExpanded;
        updateScreenmapBandUI();
    }, { signal });

    dom_btn_collapse_layout?.addEventListener('click', closeLayoutPicker, { signal });

    // Light-dismiss (issue #273): Esc and pointer-down outside the popover
    // (and its toggle button) close it with no change.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && screenmapBandExpanded) closeLayoutPicker();
    }, { signal });
    document.addEventListener('pointerdown', (e) => {
        if (!screenmapBandExpanded) return;
        const t = e.target as Node | null;
        if (dom_screenmap_expanded_panel?.contains(t)) return;
        if (dom_btn_change_layout?.contains(t)) return; // its own handler toggles
        closeLayoutPicker();
    }, { signal });
    window.addEventListener('resize', () => { if (screenmapBandExpanded) positionLayoutPopover(); }, { signal });

    updateElementStates();

    // ── Screenmap presets ────────────────────────────────────────────────────────

    // The screenmap's declared diameter (world units) defines the rendered
    // LED size; scale it into screenmap_pts units for the preview pane.
    // Stays null when no strip declares one (preview falls back to the
    // spacing heuristic).
    function updatePreviewLedDiameter() {
        const declared = resolveLedDiameter(screenmapStrips as unknown as Record<string, unknown>[]);
        previewLedDiameter = (declared !== null && screenmap_pts.length > 0)
            ? declared * computeFitScale(rawScreenmapPts, screenmap_pts)
            : null;
    }

    function loadScreenmapFromParsed(parsed: MultiStripParseResult | null | undefined) {
        screenmapStrips = parsed ? parsed.strips : [];
        videoChannelMap = parsed ? buildVideoChannelMap(parsed.strips, parsed.totalCount) : null;
        rawScreenmapPts = parsed ? parsed.allPoints : [];
        if (rawScreenmapPts.length === 0) {
            screenmapValid = false;
            previewLedDiameter = null;
        } else {
            screenmap_pts = transformToCenter(rawScreenmapPts, videoWidth, videoHeight);
            updatePreviewLedDiameter();
            screenmapValid = true;
            target_zoom = 1; curr_zoom = 1;
            curr_rotate = 0; target_rotate = 0;
            const rotTxt = container.querySelector<HTMLElement>('#txt_curr_rotation');
            if (rotTxt) rotTxt.innerText = '0';
            dom_rng_rotation.value = '0';
            target_translate = [videoWidth / 2, videoHeight / 2];
            curr_translate = [videoWidth / 2, videoHeight / 2];
        }
        updateElementStates();
    }

    /** Parse + apply screenmap text, keeping currentScreenmapJson in sync. */
    function applyScreenmapText(text: string, source: string) {
        loadScreenmapFromParsed(parseScreenmapMultiStrip(text));
        currentScreenmapJson = screenmapValid ? text : null;
        log.info('screenmap-load', {
            source,
            leds: rawScreenmapPts.length,
            strips: screenmapStrips.length,
            valid: screenmapValid,
        });
    }

    let layoutLoadGeneration = 0;
    const isStaleLayoutLoad = (generation: number) => signal.aborted || generation !== layoutLoadGeneration;
    const presetPicker = dom_preset_mount
        ? mountPresetPicker(dom_preset_mount, {
            mode: 'compact',
            storageKey: 'lm.presetPicker.openCategory.moviemaker',
            signal,
            onChoose: async (presetFile: string) => {
                try {
                    const generation = ++layoutLoadGeneration;
                    const applied = await applyPreset(presetFile, `preset:${presetFile}`, generation);
                    if (!applied) return;
                    // Picking a layout IS choosing it — auto-dismiss the
                    // popover (issue #273); no separate "Done" step.
                    screenmapBandExpanded = false;
                    updateScreenmapBandUI();
                } catch (error) {
                    if (signal.aborted) return;
                    log.info('screenmap-load-error', { source: `preset:${presetFile}`, error: String(error) });
                    void errorDialog('Error loading preset', String(error));
                }
            },
        })
        : null;

    async function applyPreset(presetFile: string, source: string, generation: number) {
        const text = await loadPresetText(presetFile, signal);
        if (isStaleLayoutLoad(generation)) return false;
        if (!savePresetScreenmap(text, presetFile)) throw new Error(`Could not persist preset ${presetFile}`);
        applyScreenmapText(text, source);
        presetPicker?.setActive(presetFile);
        setUploadFilename('');
        activeLayoutLabel = screenmapManifest.presets.find((p) => p.file === presetFile)?.name ?? presetFile;
        updateScreenmapBandUI();
        return true;
    }

    // Restore a canonical preset by provenance, otherwise inspect a custom
    // working copy before falling back to the manifest-declared default.
    const storedScreenmap = getScreenmap();
    const storedPreset = getPresetSelection();
    const defaultPresetFile = getDefaultPresetFile(screenmapManifest);
    const startupGeneration = layoutLoadGeneration;
    void (async () => {
        try {
            if (storedPreset && screenmapManifest.presets.some((preset) => preset.file === storedPreset)) {
                await applyPreset(storedPreset, `store-preset:${storedPreset}`, startupGeneration);
                return;
            }
            if (isStaleLayoutLoad(startupGeneration)) return;
            if (storedScreenmap) {
                applyScreenmapText(storedScreenmap, 'store-restore');
                activeLayoutLabel = null;
                updateScreenmapBandUI();
                if (defaultPresetFile === CANONICAL_64X64_PRESET) {
                    const canonicalText = await loadPresetText(CANONICAL_64X64_PRESET, signal);
                    if (isStaleLayoutLoad(startupGeneration)) return;
                    if (isCanonical64x64Geometry(storedScreenmap, canonicalText)) {
                        await applyPreset(CANONICAL_64X64_PRESET, 'canonical-fold', startupGeneration);
                        return;
                    }
                    const divergence = analyzeCanonical64x64Divergence(storedScreenmap, canonicalText);
                    if (divergence) {
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
                            await applyPreset(CANONICAL_64X64_PRESET, 'canonical-reset', startupGeneration);
                        }
                    }
                }
                return;
            }
            if (presetPicker && defaultPresetFile) {
                await applyPreset(defaultPresetFile, `autoload:${defaultPresetFile}`, startupGeneration);
            }
        } catch (error) {
            if (signal.aborted) return;
            log.error('initialize-screenmap-failed', { error: String(error) });
        }
    })();

    // Wire welcome overlay buttons to sidebar buttons
    container.querySelectorAll('[data-trigger]').forEach((btn) => {
        const b = btn as HTMLElement;
        b.addEventListener('click', () => { container.querySelector<HTMLElement>(`#${b.dataset.trigger ?? ''}`)?.click(); }, { signal });
    });

    // ── Camera position (smooth interpolation) ──────────────────────────────────

    function update_screenmap_parameters() {
        const dx = target_translate[0] - curr_translate[0];
        const dy = target_translate[1] - curr_translate[1];
        curr_translate[0] += Math.abs(dx) < 0.05 ? dx : dx * 0.05;
        curr_translate[1] += Math.abs(dy) < 0.05 ? dy : dy * 0.05;

        if (curr_zoom !== target_zoom) {
            const dz = target_zoom - curr_zoom;
            curr_zoom += Math.abs(dz) < 0.0001 ? dz : dz * 0.1;
        }
        if (curr_rotate !== target_rotate) {
            const dr = target_rotate - curr_rotate;
            curr_rotate += Math.abs(dr) < 0.05 ? dr : dr * 0.1;
        }
    }

    // ── Event handlers ──────────────────────────────────────────────────────────

    dom_btn_how_to.addEventListener('click', () => {
        void fireDialog({
            title: 'How to get the best video',
            html: `
                <div class="movie-help-dialog">
                    <h3>Best Practices:</h3>
                    <ul>
                        <li>Load MP4/WebM video files for best quality, or use webcam for live capture.</li>
                        <li>For WS2812 LEDs, increase gamma correction to avoid under-saturation.</li>
                        <li>APA102/Dotstar performs best in APA102HD mode.</li>
                        <li>Use smaller frame sizes (e.g., 640p) for better performance at higher frame rates.</li>
                        <li>GPU-accelerated blur processes in real time — adjust radius and sigma for effect.</li>
                    </ul>
                    <p><strong>Note:</strong> Downloaded binary contains raw stream of pixels represented as uint8_t of r, g, b.</p>
                </div>
            `,
            confirmButtonText: 'Got it!',
            customClass: { popup: 'custom-popup-class', htmlContainer: 'custom-content-class' },
        });
    }, { signal });

    function sourceActionsLocked() {
        return recording.isActive || (mp4Recorder?.isActive ?? false) || offlineActive;
    }

    function syncSourceActionState() {
        const locked = sourceActionsLocked();
        dom_btn_change_video.disabled = locked;
        dom_btn_unload_source.disabled = locked;
        dom_sel_resolution.disabled = locked;
        dom_sel_framerate.disabled = locked;
        for (const item of dom_video_source_menu.querySelectorAll<HTMLButtonElement>('button')) item.disabled = locked;
        if (locked) closeSourceMenu();
    }

    function openVideoChooser() {
        if (sourceActionsLocked()) return;
        dom_video_file_input.value = '';
        dom_video_file_input.click();
    }

    function closeSourceMenu(restoreFocus = false) {
        if (dom_video_source_menu.hidden) return;
        dom_video_source_menu.hidden = true;
        if (restoreFocus) sourceMenuInvoker?.focus();
        sourceMenuInvoker = null;
    }

    function startWebcamSource() {
        if (sourceActionsLocked()) return;
        frame_rate = parseInt(dom_sel_framerate.value);
        videoSource.startWebcam(dom_sel_resolution.value, frame_rate);
    }

    function unloadSource() {
        if (sourceActionsLocked()) return;
        closeSourceMenu();
        videoSource.dispose();
        sourceActive = false;
        isScrubbing = false;
        updateElementStates();
        dom_video_progress.classList.remove('visible');
        previewPanel.classList.remove('visible');
        dom_preview_options.classList.remove('visible');
        container.querySelector('#welcome-overlay')?.classList.remove('hidden');
        container.querySelector('.canvas-toolbar')?.classList.remove('visible');
        const canvasRow = container.querySelector<HTMLElement>('.canvas-row');
        if (canvasRow) delete canvasRow.dataset.layout;
    }

    dom_btn_load_video.addEventListener('click', openVideoChooser, { signal });
    dom_btn_change_video.addEventListener('click', openVideoChooser, { signal });
    dom_video_file_input.addEventListener('change', () => {
        const file = dom_video_file_input.files?.[0];
        if (file && !sourceActionsLocked()) videoSource.loadVideoFile(file);
    }, { signal });

    // Video source: Webcam
    dom_btn_start_webcam.addEventListener('click', () => {
        startWebcamSource();
    }, { signal });

    dom_sel_resolution.addEventListener('change', () => {
        if (sourceActionsLocked()) return;
        if (videoSource.sourceType === 'webcam') {
            frame_rate = parseInt(dom_sel_framerate.value);
            videoSource.startWebcam(dom_sel_resolution.value, frame_rate);
        }
    }, { signal });
    dom_sel_framerate.addEventListener('change', () => {
        if (sourceActionsLocked()) return;
        if (videoSource.sourceType === 'webcam') {
            frame_rate = parseInt(dom_sel_framerate.value);
            videoSource.startWebcam(dom_sel_resolution.value, frame_rate);
        }
    }, { signal });

    dom_sel_max_resolution.addEventListener('change', () => {
        if (sourceActive) {
            applyResolution(nativeVideoWidth, nativeVideoHeight);
        }
    }, { signal });

    // Play/Pause toggle was set up at the top of init (see #192) so
    // updateElementStates() can flip it via playPauseCtl.setState. The
    // click handler is already registered; nothing to wire here.

    // Progress bar scrubbing.
    // Cache the track's bounding rect at pointerdown so every pointermove
    // doesn't force a synchronous layout recalc (one of the worst drag-jank
    // sources we caught in the #181 perf audit). The rect can't change
    // mid-drag because the user is interacting with this element — any
    // layout shift would cancel the pointer capture.
    let scrubRect: DOMRect | null = null;
    function setVideoProgress(percent: number) {
        dom_video_progress.style.setProperty('--mm-progress-pct', `${String(percent)}%`);
    }
    function seekToPosition(clientX: number) {
        const rect = scrubRect ?? dom_progress_track.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekTime = fraction * videoPlayer.duration;
        videoPlayer.currentTime = seekTime;
        setVideoProgress(fraction * 100);
        dom_time_current.textContent = formatTime(seekTime);
    }

    // Pointer Events (covers mouse + touch + stylus uniformly) so the
    // video scrubber works on touch devices. Issue #178.
    dom_progress_track.addEventListener('pointerdown', (e: PointerEvent) => {
        if (videoSource.sourceType !== 'video') return;
        isScrubbing = true;
        dom_progress_thumb.classList.add('dragging');
        // Capture the pointer so move/up still fire when the user drags off
        // the track. PointerEvents handles this with one method call.
        dom_progress_track.setPointerCapture(e.pointerId);
        scrubRect = dom_progress_track.getBoundingClientRect();
        seekToPosition(e.clientX);
    }, { signal });

    dom_progress_track.addEventListener('pointermove', (e: PointerEvent) => {
        if (!isScrubbing) return;
        seekToPosition(e.clientX);
    }, { signal });

    function endScrub(e: PointerEvent) {
        if (!isScrubbing) return;
        isScrubbing = false;
        scrubRect = null;
        dom_progress_thumb.classList.remove('dragging');
        dom_progress_track.releasePointerCapture(e.pointerId);
    }
    dom_progress_track.addEventListener('pointerup', endScrub, { signal });
    dom_progress_track.addEventListener('pointercancel', endScrub, { signal });

    // Unload source — return to welcome screen
    dom_btn_unload_source.addEventListener('click', unloadSource, { signal });

    // Screenmap upload
    /** Update the filename readout next to the styled upload button (issue #249). */
    function setUploadFilename(name: string) {
        dom_txt_screenmap_filename.textContent = name || 'No file chosen';
    }

    function loadScreenmapFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.csv', '.json'])) {
            void errorDialog('Wrong file type', 'Please choose a .csv or .json screenmap file.');
            return;
        }
        const generation = ++layoutLoadGeneration;
        setUploadFilename(file.name);
        presetPicker?.setActive('');
        screenmapValid = false;
        updateElementStates();
        file.text().then((text: string) => {
            if (isStaleLayoutLoad(generation)) return;
            applyScreenmapText(text, `upload:${file.name}`);
            activeLayoutLabel = file.name;
            // Successful upload completes the layout choice — close the
            // popover (issue #273).
            screenmapBandExpanded = false;
            updateScreenmapBandUI();
            saveScreenmap(text);
        }).catch((error: unknown) => {
            log.info('screenmap-load-error', { source: `upload:${file.name}`, error: String(error) });
            void errorDialog('Error reading screenmap file', String(error));
        });
    }

    wireFileSource({
        input: dom_btn_upload_screenmap,
        target: qeFrom(container, '#screenmap_drop_target'),
        onFile: loadScreenmapFile,
        signal,
    });

    wireFileDropTarget({
        target: qeFrom(container, '.canvas-area'),
        onFile: (file) => {
            if (!file) return;
            if (!file.type.startsWith('video/')) {
                void errorDialog('Wrong file type', 'Please drop a video file.');
                return;
            }
            videoSource.loadVideoFile(file);
        },
        signal,
    });

    // Slider handlers
    const SNAP_STEP = 45;
    const SNAP_THRESHOLD = 5;
    function snap_rotation(val: number) {
        const nearest = Math.round(val / SNAP_STEP) * SNAP_STEP;
        return Math.abs(val - nearest) <= SNAP_THRESHOLD ? nearest : val;
    }
    function set_target_rotate(val: string | number) {
        const snapped = snap_rotation(parseInt(String(val)));
        target_rotate = snapped;
        dom_rng_rotation.value = String(snapped);
        const rotTxt2 = container.querySelector<HTMLElement>('#txt_curr_rotation');
        if (rotTxt2) rotTxt2.innerText = String(snapped);
    }
    wireSliderReadout({
        slider: dom_rng_rotation,
        signal,
        onChange: (raw) => { set_target_rotate(raw); },
    });

    wireSliderReadout({
        slider: dom_rng_brightness,
        readout: dom_txt_curr_bri,
        format: (raw) => `${raw}%`,
        signal,
    });
    const dom_max_bri_slider = container.querySelector('#max_bri_slider');
    dom_chk_limit_bri.addEventListener('change', () => {
        const enabled = dom_chk_limit_bri.checked;
        dom_rng_max_bri.disabled = !enabled;
        dom_max_bri_slider?.classList.toggle('disabled', !enabled);
    }, { signal });
    wireSliderReadout({
        slider: dom_rng_max_bri,
        readout: dom_txt_curr_max_bri,
        format: (raw) => `${raw}%`,
        signal,
    });
    wireSliderReadout({
        slider: dom_rng_gamma,
        readout: dom_txt_curr_gamma,
        format: (raw) => (parseFloat(raw) / 10).toFixed(1),
        signal,
    });
    const dom_txt_curr_blur = container.querySelector<HTMLElement>('#txt_curr_blur');
    const dom_txt_curr_blur_sigma = container.querySelector<HTMLElement>('#txt_curr_blur_sigma');
    wireSliderReadout({
        slider: dom_rng_blur,
        readout: dom_txt_curr_blur,
        signal,
        onChange: (raw) => {
            if (dom_chk_sigma_lock.checked) {
                dom_rng_blur_sigma.value = raw;
                if (dom_txt_curr_blur_sigma) dom_txt_curr_blur_sigma.innerText = raw;
            }
        },
    });
    wireSliderReadout({
        slider: dom_rng_blur_sigma,
        readout: dom_txt_curr_blur_sigma,
        signal,
        onChange: (raw) => {
            if (dom_chk_sigma_lock.checked) {
                dom_rng_blur.value = raw;
                if (dom_txt_curr_blur) dom_txt_curr_blur.innerText = raw;
            }
        },
    });
    dom_chk_sigma_lock.addEventListener('change', () => {
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur_sigma.value = dom_rng_blur.value;
            if (dom_txt_curr_blur_sigma) dom_txt_curr_blur_sigma.innerText = dom_rng_blur.value;
        }
    }, { signal });
    wireSliderReadout({
        slider: dom_rng_zoom,
        readout: dom_txt_curr_zoom,
        format: (raw) => parseFloat(raw).toFixed(2),
        signal,
        onChange: (raw) => {
            const v = parseFloat(raw).toFixed(2);
            // Re-canonicalize the input so subsequent reads round-trip cleanly.
            dom_rng_zoom.value = v;
            target_zoom = parseFloat(v);
        },
    });

    dom_chk_show_leds.addEventListener('change', () => {
        overlayCanvas.classList.toggle('leds-hidden', !dom_chk_show_leds.checked);
    }, { signal });

    // ── Bloom controls ──────────────────────────────────────────────────────────
    // All moviemaker persisted state lives under `ledmapper.moviemaker.*`;
    // route every read/write through a namespaced sub-store so the prefix
    // appears in exactly one place.
    const mmStore = withPrefix('ledmapper.moviemaker.');

    // Restore persisted state (default: auto on).
    const _bloomAutoInit = mmStore.getBool('autoBloom', true);
    dom_chk_auto_bloom.checked = _bloomAutoInit;

    function _applyBloomAutoState(enabled: boolean) {
        dom_rng_bloom_strength.disabled = enabled;
        dom_bloom_strength_slider.classList.toggle('disabled', enabled);
        preview.setAutoBloom(enabled);
    }

    /** Compute manual strength from slider value (0-100) → bloom strength.
     *  Mapping: strength = lerp(S_MIN, sparseCeil * 1.5, (rng/100)^2)
     */
    function _sliderToBloomStrength(rngVal: number) {
        const t = (rngVal / 100) ** 2;
        const S_MIN   = Math.max(PREVIEW_AUTO_FLOOR * 0.5, 0.05);
        const S_MAX   = PREVIEW_AUTO_MAX_SPARSE * 1.5;
        return S_MIN + (S_MAX - S_MIN) * t;
    }

    function _bloomStrengthToLabel(s: number) {
        return s.toFixed(2);
    }

    function _syncBloomReadout() {
        const s = dom_chk_auto_bloom.checked
            ? preview.getCurrentBloomStrength()
            : _sliderToBloomStrength(parseInt(dom_rng_bloom_strength.value));
        dom_txt_bloom_strength.innerText = _bloomStrengthToLabel(s);
    }

    _applyBloomAutoState(_bloomAutoInit);

    dom_chk_auto_bloom.addEventListener('change', () => {
        const enabled = dom_chk_auto_bloom.checked;
        mmStore.setBool('autoBloom', enabled);
        if (!enabled) {
            // Seed slider from current auto strength so there's no visual jump.
            const curr = preview.getCurrentBloomStrength();
            const S_MIN = Math.max(PREVIEW_AUTO_FLOOR * 0.5, 0.05);
            const S_MAX = PREVIEW_AUTO_MAX_SPARSE * 1.5;
            const raw = (curr - S_MIN) / (S_MAX - S_MIN);
            const rngVal = Math.round(Math.sqrt(Math.max(raw, 0)) * 100);
            dom_rng_bloom_strength.value = String(Math.min(Math.max(rngVal, 0), 100));
            preview.setManualBloomStrength(_sliderToBloomStrength(parseInt(dom_rng_bloom_strength.value)));
        }
        _applyBloomAutoState(enabled);
        _syncBloomReadout();
    }, { signal });

    dom_rng_bloom_strength.addEventListener('input', () => {
        const s = _sliderToBloomStrength(parseInt(dom_rng_bloom_strength.value));
        preview.setManualBloomStrength(s);
        dom_txt_bloom_strength.innerText = _bloomStrengthToLabel(s);
    }, { signal });

    // ── Preview panel options (rotate view / bloom) ─────────────────────────────
    // Rotate view is opt-in: the preview stays locked to the screenmap's
    // native orientation unless the user explicitly enables rotation.
    dom_chk_preview_rotate.checked = mmStore.getBool('previewRotate', false);

    const _prevBloomInit = mmStore.getBool('previewBloom', true);
    dom_chk_preview_bloom.checked = _prevBloomInit;
    preview.setBloomEnabled(_prevBloomInit);

    dom_chk_preview_rotate.addEventListener('change', () => {
        mmStore.setBool('previewRotate', dom_chk_preview_rotate.checked);
    }, { signal });

    dom_chk_preview_bloom.addEventListener('change', () => {
        mmStore.setBool('previewBloom', dom_chk_preview_bloom.checked);
        preview.setBloomEnabled(dom_chk_preview_bloom.checked);
    }, { signal });

    // MP4 social-media recorder. Captures the preview canvas (the styled LED
    // bloom that users actually want to share), letterboxed into the selected
    // aspect-ratio preset. The .fled recorder above remains the LED-data path;
    // both can run together when the format selector is set to "both".
    let mp4Recorder: ReturnType<typeof createCanvasRecorder> | null = null;
    function buildMp4Recorder(aspect: AspectPreset) {
        if (mp4Recorder) return mp4Recorder; // already built for this drag — start() reads its current width/height once
        const dims = dimensionsForAspect(aspect);
        mp4Recorder = createCanvasRecorder({
            canvas: preview.domElement,
            width: dims.width,
            height: dims.height,
            fps: 30,
            onError: (m) => { void errorDialog('Recording error', m); },
        });
        return mp4Recorder;
    }

    // Gate the aspect selector: enabled only when MP4 (alone or with .fled).
    function syncRecordFormatUi() {
        const wantsMp4 = dom_sel_record_format.value !== 'fled';
        dom_sel_record_aspect.disabled = !wantsMp4;
    }
    syncRecordFormatUi();
    dom_sel_record_format.addEventListener('change', syncRecordFormatUi, { signal });

    // Offline every-frame capture state (#257): while a render pass runs,
    // the record button becomes its progress/cancel control and the RAF
    // loop's realtime sampling is suspended (both paths share the gather
    // pipeline).
    let offlineActive = false;
    let offlineCancelRequested = false;

    async function runOfflineRecordPass(file: File): Promise<void> {
        offlineActive = true;
        syncSourceActionState();
        offlineCancelRequested = false;
        dom_btn_toggle_record.value = 'Rendering…';
        dom_btn_toggle_record.classList.add('recording');
        let offlineSampleBuf: Uint8Array | null = null;
        let fallbackToRealtime = false;
        try {
            const result = await runOfflineCapture({
                file,
                captureFrame: async (frame) => {
                    const s = await blurPipeline.captureFrameSample(frame);
                    if (s?.numPts !== screenmap_pts.length) return null;
                    if (offlineSampleBuf?.length !== s.numPts * 3) {
                        offlineSampleBuf = new Uint8Array(s.numPts * 3);
                    }
                    const es = extractGatherSample(s.buffer, s.numPts, offlineSampleBuf);
                    // Drive the LED preview from the offline pass so the user
                    // watches the actual render progress.
                    const previewRotate = dom_chk_preview_rotate.checked ? curr_rotate : 0;
                    preview.render(screenmap_pts, previewRotate, es, previewLedDiameter);
                    const rec = toRecordingSample(es, s.numPts);
                    return new Uint8Array(rec.rgbPts);
                },
                onProgress: (done, total) => {
                    dom_btn_toggle_record.value = `Rendering ${String(done)}/${String(total)} — click to cancel`;
                },
                isCancelled: () => offlineCancelRequested,
            });
            if (result === null) {
                // Container/codec not decodable here — realtime fallback.
                fallbackToRealtime = true;
            } else if (result.cancelled) {
                log.info('offline-capture-cancelled', { captured: result.frames.length, total: result.total });
            } else {
                await recording.saveFrames(result.frames, result.fps);
                const sourceMs = (result.total / result.fps) * 1000;
                log.info('offline-capture-saved', {
                    frames: result.frames.length,
                    total: result.total,
                    fps: result.fps,
                    elapsedMs: result.elapsedMs,
                    xRealtime: Math.round((sourceMs / Math.max(result.elapsedMs, 1)) * 10) / 10,
                });
            }
        } catch (error) {
            log.error('offline-capture-failed', { error: String(error) });
            void errorDialog('Offline capture failed', String(error));
        } finally {
            offlineActive = false;
            syncSourceActionState();
            offlineCancelRequested = false;
            dom_btn_toggle_record.value = 'Start Recording';
            dom_btn_toggle_record.classList.remove('recording');
            dom_sel_record_format.disabled = false;
            syncRecordFormatUi();
        }
        if (fallbackToRealtime && !recording.isActive) {
            log.warn('offline-unavailable-realtime-fallback', { file: file.name });
            void recording.toggle();
            dom_sel_record_format.disabled = true;
            dom_sel_record_aspect.disabled = true;
            dom_btn_toggle_record.value = 'Stop Recording';
            dom_btn_toggle_record.classList.add('recording');
        }
    }

    // Recording toggle — drives the .fled recorder, the .mp4 recorder, or
    // both depending on the format selector.
    dom_btn_toggle_record.addEventListener('click', () => {
        if (offlineActive) {
            offlineCancelRequested = true;
            return;
        }
        const fledActive = recording.isActive;
        const mp4Active = mp4Recorder?.isActive ?? false;
        const anyActive = fledActive || mp4Active;
        if (!anyActive && screenmap_pts.length < 2) {
            log.info('record-blocked', { reason: 'no-screenmap', pts: screenmap_pts.length });
            void errorDialog('Screenmap required', 'Please load a valid screenmap first (size >= 2).');
            return;
        }
        log.info(anyActive ? 'record-stop' : 'record-start', {
            format: dom_sel_record_format.value,
            leds: rawScreenmapPts.length,
        });
        const format = dom_sel_record_format.value;
        const aspect = dom_sel_record_aspect.value as AspectPreset;
        const wantFled = !anyActive && (format === 'fled' || format === 'both');
        const wantMp4  = !anyActive && (format === 'mp4'  || format === 'both');
        // Lock the format selectors while a recording is in flight.
        dom_sel_record_format.disabled = !anyActive;
        dom_sel_record_aspect.disabled = !anyActive || dom_sel_record_format.value === 'fled';

        if (anyActive) {
            // Stop whichever is running.
            if (fledActive) {
                recording.toggle().catch((error: unknown) => {
                    log.error('stop-recording-failed', { error: String(error) });
                    void errorDialog('Stop recording error', String(error));
                });
            }
            if (mp4Active && mp4Recorder) mp4Recorder.stop();
            mp4Recorder = null;
            dom_btn_toggle_record.value = 'Start Recording';
            dom_btn_toggle_record.classList.remove('recording');
            syncSourceActionState();
            return;
        }

        // Offline every-frame pass (#257): a file source with WebCodecs
        // available takes the deterministic decode-every-frame path instead
        // of racing playback. fled-only — MP4 capture films the live preview
        // canvas and is inherently realtime.
        const offlineFile = videoSource.sourceFile;
        if (wantFled && !wantMp4 && offlineFile && isOfflineCaptureSupported() && !forceRealtimeCapture) {
            void runOfflineRecordPass(offlineFile);
            return;
        }

        let startedAny = false;
        if (wantFled) {
            recording.toggle().catch((error: unknown) => {
                log.error('start-recording-failed', { error: String(error) });
                void errorDialog('Start recording error', String(error));
            });
            startedAny = true;
        }
        if (wantMp4) {
            const rec = buildMp4Recorder(aspect);
            const ok = rec.start();
            if (ok) startedAny = true;
            else mp4Recorder = null;
        }
        if (!startedAny) {
            // Re-enable the selectors since nothing actually started.
            dom_sel_record_format.disabled = false;
            syncRecordFormatUi();
            return;
        }
        dom_btn_toggle_record.value = 'Stop Recording';
        dom_btn_toggle_record.classList.add('recording');
        syncSourceActionState();
    }, { signal });

    // Pointer-Events drag on overlay canvas.
    // Using setPointerCapture so pointerup fires even when the pointer is
    // released outside the element — fixes the stale isDraggingRight state
    // that occurred when the user released outside the canvas (issue #31).
    function cancelDrag() {
        if (!drag) return;
        const { pointerId, kind, moved } = drag;
        if (kind === 'zoom' && moved) suppressNextContextMenu = true;
        drag = null;
        try { overlayCanvas.releasePointerCapture(pointerId); } catch { /* already released */ }
    }

    overlayCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (screenmap_pts.length === 0) return;
        if (e.button === 0) {
            drag = { kind: 'translate', pointerId: e.pointerId, lastY: e.offsetY, startX: e.clientX, startY: e.clientY, moved: false };
            overlayCanvas.setPointerCapture(e.pointerId);
        } else if (e.button === 2) {
            drag = { kind: 'zoom', pointerId: e.pointerId, lastY: e.offsetY, startX: e.clientX, startY: e.clientY, moved: false };
            overlayCanvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }, { signal });

    overlayCanvas.addEventListener('pointermove', (e: PointerEvent) => {
        if (!drag || screenmap_pts.length === 0) return;
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
        if (drag.kind === 'translate') {
            target_translate[0] = e.offsetX;
            target_translate[1] = e.offsetY;
        } else {
            const dy = e.offsetY - drag.lastY;
            target_zoom -= dy * 0.01;
            target_zoom = Math.max(Math.min(target_zoom, 3), 0.15);
            dom_rng_zoom.value = target_zoom.toFixed(2);
            dom_txt_curr_zoom.innerText = target_zoom.toFixed(2);
            drag.lastY = e.offsetY;
        }
    }, { signal });

    overlayCanvas.addEventListener('pointerup', cancelDrag, { signal });
    overlayCanvas.addEventListener('pointercancel', cancelDrag, { signal });
    overlayCanvas.addEventListener('lostpointercapture', cancelDrag, { signal });
    function openSourceMenu(e: MouseEvent) {
        if (suppressNextContextMenu) {
            suppressNextContextMenu = false;
            return;
        }
        syncSourceActionState();
        sourceMenuInvoker = overlayCanvas;
        dom_video_source_menu.hidden = false;
        const rect = dom_video_source_menu.getBoundingClientRect();
        dom_video_source_menu.style.left = `${String(Math.max(4, Math.min(e.clientX, innerWidth - rect.width - 4)))}px`;
        dom_video_source_menu.style.top = `${String(Math.max(4, Math.min(e.clientY, innerHeight - rect.height - 4)))}px`;
        dom_video_source_menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    overlayCanvas.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        openSourceMenu(e);
    }, { signal });
    dom_video_source_menu.addEventListener('click', (e: MouseEvent) => {
        const action = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-source-action]')?.dataset.sourceAction;
        if (!action || sourceActionsLocked()) return;
        closeSourceMenu();
        if (action === 'video') openVideoChooser();
        else if (action === 'webcam') startWebcamSource();
        else if (action === 'unload') unloadSource();
    }, { signal });
    document.addEventListener('pointerdown', (e: PointerEvent) => {
        if (!dom_video_source_menu.hidden && !dom_video_source_menu.contains(e.target as Node) && e.target !== overlayCanvas) closeSourceMenu();
    }, { signal });
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (dom_video_source_menu.hidden) return;
        if (e.key === 'Escape') { e.preventDefault(); closeSourceMenu(true); return; }
        const items = Array.from(dom_video_source_menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
        let next: number | null = null;
        if (e.key === 'ArrowDown') next = (current + 1) % items.length;
        else if (e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next !== null) { e.preventDefault(); items[next]?.focus(); }
    }, { signal });

    // Safety net: cancel any in-progress drag on window blur or tab hide.
    window.addEventListener('blur', cancelDrag, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); }, { signal });

    // ── Animation loop ──────────────────────────────────────────────────────────

    let lastTime = performance.now();
    let lastSample: { rgbPts: Uint8Array; avgBri: number; oobCount: number } | null = null;
    let sampleRgbPts: Uint8Array | null = null;
    let recordRgbPts: Uint8Array | null = null;
    let rafFrameCount = 0;
    // Last LOGGED out-of-bounds LED count — the warn fires on transitions
    // (0 -> N, N -> M, N -> 0 clears), never per frame (#250).
    let loggedOobCount = 0;

    // ── Watchdogs (issue #226) ───────────────────────────────────────────────
    // Log-only via createLogger('watchdog') inside src/watchdogs.ts; never
    // auto-remediate. Armed only while the tab is visible and the activity
    // being watched is actually expected; reset on pause/visibilitychange.
    const videoStallWatchdog = createVideoStallWatchdog();
    const rafHeartbeat = createRafHeartbeat({ loop: 'moviemaker' });

    function videoHeartbeatArmed(): boolean {
        return document.visibilityState === 'visible'
            && sourceActive
            && videoSource.sourceType !== null
            && videoSource.isPlaying
            && !isScrubbing;
    }

    // requestVideoFrameCallback marks real composited frames; feature-detect
    // with a `timeupdate` fallback for engines that lack it. The DOM lib
    // types the method as always present, which is optimistic about actual
    // browser support (same situation as navigator.mediaDevices in
    // video-source.ts) — widen to an optional-method type locally to read
    // it honestly, then gate on a plain runtime boolean (rather than relying
    // on TS narrowing, which collapses the optional back to required once
    // intersected with HTMLVideoElement). Native `stalled`/`waiting` events
    // are not used as the primary signal — unreliable per video.js history.
    type MaybeRvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number };
    const hasRvfc = typeof (videoPlayer as MaybeRvfcVideo).requestVideoFrameCallback === 'function' && !ignoreRvfc;
    let watchdogsDisposed = false;
    // Frame pacing (issue #256 / #255 Phase 1): the rVFC loop doubles as the
    // recording pacemaker. `lastPresentedFrames` keys recorded samples (one
    // per PRESENTED source frame — gaps become explicit skips), and the fps
    // estimator replaces the old hardcoded 30 fps assumption that dropped
    // half of every 60 fps video.
    let lastPresentedFrames: number | null = null;
    // fps at which we last emitted an info-tier log. The estimator refines
    // toward the true rate in tiny sub-fps steps, so logging every change at
    // info drowned the event trail with ~140 near-duplicate lines per session
    // (issue #296). Only meaningful jumps (>= 1 fps from the last logged value)
    // go to info; the incremental creep is demoted to the debug tier.
    let lastLoggedFps: number | null = null;
    const fpsEstimator = createFpsEstimator();
    function scheduleVideoFrameCallback(): void {
        if (watchdogsDisposed || !hasRvfc) return;
        videoPlayer.requestVideoFrameCallback((_now, meta) => {
            videoStallWatchdog.noteFrame();
            lastPresentedFrames = meta.presentedFrames;
            fpsEstimator.sample(meta.presentedFrames, meta.mediaTime);
            const detected = fpsEstimator.estimate();
            if (detected !== null && detected !== frame_rate) {
                const prev = frame_rate;
                frame_rate = detected;
                if (lastLoggedFps === null || Math.abs(detected - lastLoggedFps) >= 1) {
                    log.info('fps-detected', { fps: detected, was: prev });
                    lastLoggedFps = detected;
                } else {
                    log.debug('fps-detected', { fps: detected, was: prev });
                }
            }
            scheduleVideoFrameCallback();
        });
    }
    if (hasRvfc) {
        scheduleVideoFrameCallback();
    } else {
        videoPlayer.addEventListener('timeupdate', () => { videoStallWatchdog.noteFrame(); }, { signal });
    }

    const videoHeartbeatIntervalId = setInterval(() => {
        videoStallWatchdog.check(videoHeartbeatArmed(), videoPlayer.currentTime, videoPlayer.readyState, videoPlayer.networkState);
    }, 2000);

    const rafHeartbeatIntervalId = setInterval(() => {
        rafHeartbeat.check(document.visibilityState === 'visible' && sourceActive, rafFrameCount);
    }, 3000);

    // Reset stall tracking on transitions so a background tab or a paused
    // video never accrues false stall time that fires the instant it resumes.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) videoStallWatchdog.reset();
    }, { signal });
    videoPlayer.addEventListener('pause', () => { videoStallWatchdog.reset(); }, { signal });

    // Debug hook always exposed for e2e tests (drag state needed for issue #31 tests).
    window.__mmDebug ??= {};
    window.__mmDebug.getDragState = () => drag ? { kind: drag.kind } : null;

    // Live per-tool debug state on window.__lmDebug, ships always-on (prod
    // included) — consumed by the copy-diagnostics payload and by
    // Playwright assertions in place of brittle DOM/class probes. #225.
    function getMoviemakerDebugState(): MoviemakerDebugState {
        return {
            screenmapValid,
            ledCount: rawScreenmapPts.length,
            stripCount: screenmapStrips.length,
            sourceActive,
            sourceType: videoSource.sourceType,
            sourceName: videoSource.sourceFile?.name ?? null,
            playing: videoSource.isPlaying,
            recordingActive: recording.isActive,
            recordFormat: dom_sel_record_format.value,
            oobLeds: lastSample?.oobCount ?? 0,
            detectedFps: frame_rate,
            captureStats: recording.getStats(),
        };
    }
    registerDebugState('moviemaker', { getState: getMoviemakerDebugState });

    if (perfEnabled) {
        // Extended debug hook for e2e correctness tests: exposes the exact transform
        // state and latest GPU-gathered sample for CPU-reference comparison.
        window.__mmDebug.getState = () => ({
            localPts: screenmap_pts.map(([x, y]: [number, number]) => [x, y]),
            rotate: curr_rotate,
            zoom: curr_zoom,
            translate: [curr_translate[0], curr_translate[1]],
            videoWidth,
            videoHeight,
            sample: lastSample ? Array.from(lastSample.rgbPts) : null,
        });
    }

    // The .rgb stream is channel-ordered. When a screenmap declares explicit
    // video_offset values that differ from flat point order, remap the flat
    // sample into channel order for recording (overlay/preview stay flat).
    function toRecordingSample(sample: { rgbPts: Uint8Array; avgBri: number }, numPts: number) {
        if (videoChannelMap?.length !== numPts) return sample;
        if (recordRgbPts?.length !== numPts * 3) {
            recordRgbPts = new Uint8Array(numPts * 3);
        }
        const src = sample.rgbPts;
        for (let i = 0; i < numPts; i++) {
            const ch = (videoChannelMap[i] ?? 0) * 3;
            const o = i * 3;
            recordRgbPts[ch]     = src[o] ?? 0;
            recordRgbPts[ch + 1] = src[o + 1] ?? 0;
            recordRgbPts[ch + 2] = src[o + 2] ?? 0;
        }
        return { rgbPts: recordRgbPts, avgBri: sample.avgBri };
    }

    // Backpressure for the realtime capture fallback (#266). The offline
    // WebCodecs pass is inherently one-in/one-out; the realtime path (webcam,
    // or a file when WebCodecs is unavailable) instead has the source running
    // on its own clock. For a PAUSABLE source (a file, not a webcam), when the
    // gather-readback pipeline saturates we pause the element so the source
    // can't race past capture and lose frames — the source slows to the
    // pipeline's drain rate. Webcam streams can't be paused; their skips are
    // surfaced (skip counter / HUD / frames-skipped warn) instead.
    let backpressurePaused = false;
    function applyCaptureBackpressure(): void {
        // Only the no-rVFC fallback needs this. When rVFC is available its
        // presentedFrames key already paces capture correctly, and churning
        // pause()/play() there just makes the decoder resume-jump — observed
        // as ADDED skips on the 60fps realtime path. Scope to the fallback,
        // which is exactly what #266 specified ("on this fallback path").
        const pausable = recording.isActive && videoSource.sourceType === 'video' && !hasRvfc;
        if (!pausable) {
            if (backpressurePaused) { backpressurePaused = false; void videoPlayer.play(); }
            return;
        }
        if (blurPipeline.isSampleBusy()) {
            if (!videoPlayer.paused) { videoPlayer.pause(); backpressurePaused = true; }
        } else if (backpressurePaused) {
            backpressurePaused = false;
            void videoPlayer.play();
        }
    }

    function animationLoop() {
        rafId = requestAnimationFrame(animationLoop);

        if (!sourceActive) return;
        // Offline render pass owns the pipeline + canvas while it runs
        // (#257) — suspend realtime rendering/sampling so the two paths
        // never interleave on the shared gather targets.
        if (offlineActive) return;

        rafFrameCount++;

        const now = performance.now();
        const fps = computeFps(now, lastTime);
        lastTime = now;

        blurPipeline.updateUniforms({
            blurRadius: parseFloat(dom_rng_blur.value),
            sigma: parseFloat(dom_rng_blur_sigma.value),
            brightness: parseInt(dom_rng_brightness.value) / 100,
            maxBrightness: dom_chk_limit_bri.checked
                ? parseInt(dom_rng_max_bri.value) / 100
                : 1.0,
            gamma: parseInt(dom_rng_gamma.value) / 10,
        });

        update_screenmap_parameters();

        blurPipeline.renderFrame();

        const needSample = screenmapValid && screenmap_pts.length > 0;

        if (needSample) {
            // Positions upload once per screenmap/resolution; the transform
            // is a per-frame uniform update, so dragging stays cheap.
            blurPipeline.setSamplePoints(screenmap_pts, videoWidth, videoHeight);
            blurPipeline.setSampleTransform(curr_rotate, curr_zoom, curr_translate[0], curr_translate[1]);
            applyCaptureBackpressure();
            blurPipeline.requestSample();
            // Consume the latest resolved async readback (1-2 frames behind)
            const gather = blurPipeline.getLatestSample();
            if (gather?.numPts === screenmap_pts.length) {
                if (sampleRgbPts?.length !== gather.numPts * 3) {
                    sampleRgbPts = new Uint8Array(gather.numPts * 3);
                }
                lastSample = extractGatherSample(gather.buffer, gather.numPts, sampleRgbPts);
                if (lastSample.oobCount !== loggedOobCount) {
                    if (lastSample.oobCount > 0) {
                        log.warn('leds-out-of-bounds', {
                            count: lastSample.oobCount,
                            total: gather.numPts,
                            zoom: curr_zoom,
                        });
                    } else {
                        log.info('leds-back-in-bounds', { total: gather.numPts });
                    }
                    loggedOobCount = lastSample.oobCount;
                }
                // Source-frame key (#266): rVFC presentedFrames when live,
                // else the media-clock source-frame index. Both are SOURCE
                // signals, so a paused/frozen source yields an unchanged key
                // and its repeat is dropped as a duplicate (never a
                // data comparison).
                const mediaKey = frame_rate > 0 ? Math.floor(videoPlayer.currentTime * frame_rate) : null;
                const frameKey = lastPresentedFrames ?? mediaKey;
                recording.processFrame(toRecordingSample(lastSample, gather.numPts), frame_rate, videoStallWatchdog.isHealthy(), frameKey);
            }
        } else {
            recording.resetCapture();
        }

        drawMoviemakerOverlay(overlayCtx, screenmap_pts, curr_rotate, curr_zoom, curr_translate[0], curr_translate[1], lastSample, videoWidth, videoHeight, fps, dom_chk_show_leds.checked, screenmapStrips, previewLedDiameter, recording.isActive ? recording.getStats() : null, videoSource.sourceType !== null ? frame_rate : null, dom_chk_show_labels.checked);
        const previewRotate = dom_chk_preview_rotate.checked ? curr_rotate : 0;
        preview.render(screenmap_pts, previewRotate, lastSample, previewLedDiameter);

        // While recording MP4, blit the just-rendered preview canvas into the
        // recorder's intermediate. No-op when not recording.
        if (mp4Recorder) mp4Recorder.captureFrame();

        // Update progress bar for video sources
        if (videoSource.sourceType === 'video' && !isScrubbing) {
            const t = videoPlayer.currentTime;
            const d = videoPlayer.duration;
            if (isFinite(d) && d > 0) {
                const pct = (t / d) * 100;
                setVideoProgress(pct);
                dom_time_current.textContent = formatTime(t);
            }
        }
    }

    rafId = requestAnimationFrame(animationLoop);

    return function destroy() {
        closeSourceMenu();
        unregisterDebugState('moviemaker');
        if (perfEnabled) delete window.__mmDebug;
        watchdogsDisposed = true;
        clearInterval(videoHeartbeatIntervalId);
        clearInterval(rafHeartbeatIntervalId);
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        videoSource.dispose();
        blurPipeline.dispose();
        preview.dispose();
    };
}
