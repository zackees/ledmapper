import type SweetAlert2 from 'sweetalert2';
const Swal: Promise<typeof SweetAlert2> = import('sweetalert2').then(m => m.default);
import type { ParsedStrip, MultiStripParseResult } from '../types/domain';
import { parseScreenmapMultiStrip } from '../common';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop';
import { saveScreenmap, getScreenmap } from '../screenmap-store';
import { transformToCenter, parseResolution, extractGatherSample, computeFps, scaleToMaxDimension, buildVideoChannelMap } from './transforms';
import { resolveLedDiameter, computeFitScale } from '../bloom-utils';
import { loadPresetText } from '../preset-loader';
import screenmapPresets from 'virtual:screenmap-presets';
import { createBlurPipeline } from './blur-pipeline';
import { createVideoSource } from './video-source';
import { createRecording } from './recording';
import { drawMoviemakerOverlay } from './overlay';
import { createLedPreview } from './preview';
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
    const dom_preset_buttons = container.querySelector('.preset-buttons');
    const dom_screenmap_group = dom_preset_buttons?.closest('.control-group');
    const dom_source_hint = container.querySelector('#screenmap_gate_hint');
    const dom_btn_unload_source = qe<HTMLButtonElement>('#btn_unload_source');
    const dom_btn_play_pause    = qe<HTMLButtonElement>('#btn_play_pause');
    const dom_video_progress    = qe('#video-progress');
    const dom_progress_track    = qe<HTMLElement>('#video-progress-track');
    const dom_progress_fill     = qe<HTMLElement>('#video-progress-fill');
    const dom_progress_thumb    = qe<HTMLElement>('#video-progress-thumb');
    const dom_time_current      = qe<HTMLElement>('#video-time-current');
    const dom_time_duration     = qe<HTMLElement>('#video-time-duration');
    const dom_btn_how_to       = qe<HTMLButtonElement>('#btn_how_to');
    const dom_btn_toggle_record = qe<HTMLInputElement>('#btn_toggle_record');
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

    // ── State ───────────────────────────────────────────────────────────────────
    let screenmap_pts: [number, number][] = [];
    let rawScreenmapPts: [number, number][] = [];
    let screenmapStrips: ParsedStrip[] = [];
    let videoChannelMap: Int32Array | null = null;   // flat LED index -> .rgb channel index (null = identity)
    let previewLedDiameter: number | null = null; // screenmap-declared diameter in screenmap_pts units (null = heuristic)
    let screenmapValid = false;
    let sourceActive = false;

    let target_zoom = 1, curr_zoom = 1;
    let target_rotate = 0, curr_rotate = 0;
    let target_translate: [number, number] = [0, 0], curr_translate: [number, number] = [0, 0];
    // Drag state: null when idle, or { kind: 'translate'|'zoom', pointerId, lastY }
    let drag: { kind: 'translate' | 'zoom'; pointerId: number; lastY: number } | null = null;

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
            setupForNewSource(w, h);
            if (type === 'video') {
                frame_rate = 30;
            }
        },
        onError(message: string) {
            void Swal.then(s => s.fire('Webcam Error', message, 'error'));
        },
    });

    const recording = createRecording({
        getSwal: () => Swal,
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
    }

    function setupForNewSource(nativeW: number, nativeH: number) {
        nativeVideoWidth = nativeW;
        nativeVideoHeight = nativeH;

        applyResolution(nativeW, nativeH);

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
            dom_progress_fill.style.width = '0%';
            dom_progress_thumb.style.left = '0%';
            dom_btn_play_pause.innerHTML = '&#9654;';
            dom_btn_play_pause.title = 'Play';
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
    }

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

    let presetButtons: HTMLButtonElement[] = [];

    function clearPresetActive() {
        presetButtons.forEach((b) => { b.classList.remove('active-preset'); });
    }

    if (dom_preset_buttons) {
        for (const preset of screenmapPresets as { file: string; name: string }[]) {
            const btn = document.createElement('button');
            btn.id = `btn_preset_${preset.file.replace(/\.json$/i, '')}`;
            btn.type = 'button';
            btn.className = 'preset-btn';
            btn.dataset.presetFile = preset.file;
            btn.textContent = preset.name;
            dom_preset_buttons.appendChild(btn);
        }
        presetButtons = Array.from(dom_preset_buttons.querySelectorAll('button[data-preset-file]'));
        for (const btn of presetButtons) {
            const presetFile = btn.dataset.presetFile;
            if (!presetFile) continue;

            btn.addEventListener('click', () => {
                void (async () => {
                    clearPresetActive();
                    btn.classList.add('active-preset');
                    try {
                        loadScreenmapFromParsed(parseScreenmapMultiStrip(await loadPresetText(presetFile)));
                    } catch (error) {
                        alert(`Error loading preset: ${String(error)}`);
                    }
                })();
            }, { signal });
        }
    }

    // Restore stored screenmap, or fall back to 16x16 preset
    const storedScreenmap = getScreenmap();
    let restoredFromStore = false;
    if (storedScreenmap) {
        try {
            loadScreenmapFromParsed(parseScreenmapMultiStrip(storedScreenmap));
            restoredFromStore = true;
        } catch (error) {
            console.error('Failed to restore stored screenmap:', error);
        }
    }
    if (!restoredFromStore && presetButtons.length > 0) {
        presetButtons[0]?.click();
    }

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
        void Swal.then(s => s.fire({
            title: 'How to get the best video',
            html: `
                <div style="text-align: left; margin-bottom: 15px;">
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
        }));
    }, { signal });

    // Video source: Load file
    dom_btn_load_video.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) videoSource.loadVideoFile(file);
        };
        input.click();
    }, { signal });

    // Video source: Webcam
    dom_btn_start_webcam.addEventListener('click', () => {
        frame_rate = parseInt(dom_sel_framerate.value);
        videoSource.startWebcam(dom_sel_resolution.value, frame_rate);
    }, { signal });

    dom_sel_resolution.addEventListener('change', () => {
        if (videoSource.sourceType === 'webcam') {
            frame_rate = parseInt(dom_sel_framerate.value);
            videoSource.startWebcam(dom_sel_resolution.value, frame_rate);
        }
    }, { signal });
    dom_sel_framerate.addEventListener('change', () => {
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

    // Play/Pause
    dom_btn_play_pause.addEventListener('click', () => {
        const nowPlaying = videoSource.playPause();
        dom_btn_play_pause.innerHTML = nowPlaying ? '&#9646;&#9646;' : '&#9654;';
        dom_btn_play_pause.title = nowPlaying ? 'Pause' : 'Play';
    }, { signal });

    // Progress bar scrubbing
    function seekToPosition(clientX: number) {
        const rect = dom_progress_track.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekTime = fraction * videoPlayer.duration;
        videoPlayer.currentTime = seekTime;
        const pct = fraction * 100;
        dom_progress_fill.style.width = `${String(pct)}%`;
        dom_progress_thumb.style.left = `${String(pct)}%`;
        dom_time_current.textContent = formatTime(seekTime);
    }

    dom_progress_track.addEventListener('mousedown', (e: MouseEvent) => {
        if (videoSource.sourceType !== 'video') return;
        isScrubbing = true;
        dom_progress_thumb.classList.add('dragging');
        seekToPosition(e.clientX);
    }, { signal });

    document.addEventListener('mousemove', (e) => {
        if (!isScrubbing) return;
        seekToPosition(e.clientX);
    }, { signal });

    document.addEventListener('mouseup', () => {
        if (!isScrubbing) return;
        isScrubbing = false;
        dom_progress_thumb.classList.remove('dragging');
    }, { signal });

    // Unload source — return to welcome screen
    dom_btn_unload_source.addEventListener('click', () => {
        videoSource.dispose();
        sourceActive = false;
        isScrubbing = false;
        updateElementStates();

        dom_video_progress.classList.remove('visible');
        previewPanel.classList.remove('visible');
        dom_preview_options.classList.remove('visible');

        const welcomeEl = container.querySelector('#welcome-overlay');
        if (welcomeEl) welcomeEl.classList.remove('hidden');

        const toolbar = container.querySelector('.canvas-toolbar');
        if (toolbar) toolbar.classList.remove('visible');

        const canvasRow = container.querySelector<HTMLElement>('.canvas-row');
        if (canvasRow) delete canvasRow.dataset.layout;
    }, { signal });

    // Screenmap upload
    function loadScreenmapFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.csv', '.json'])) {
            alert('Please choose a .csv or .json screenmap file.');
            return;
        }
        clearPresetActive();
        screenmapValid = false;
        updateElementStates();
        file.text().then((text: string) => {
            loadScreenmapFromParsed(parseScreenmapMultiStrip(text));
            saveScreenmap(text);
        }).catch((error: unknown) => {
            alert(`Error reading screenmap file: ${String(error)}`);
        });
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        loadScreenmapFile(dom_btn_upload_screenmap.files?.[0] ?? null);
    }, { signal });

    wireFileDropTarget({
        target: qeFrom(container, '#screenmap_drop_target'),
        input: dom_btn_upload_screenmap,
        onFile: loadScreenmapFile,
        signal,
    });

    wireFileDropTarget({
        target: qeFrom(container, '.canvas-area'),
        onFile: (file) => {
            if (!file) return;
            if (!file.type.startsWith('video/')) {
                alert('Please drop a video file.');
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
    dom_rng_rotation.addEventListener('input', () => { set_target_rotate(dom_rng_rotation.value); }, { signal });

    dom_rng_brightness.addEventListener('input', () => {
        dom_txt_curr_bri.innerText = `${dom_rng_brightness.value}%`;
    }, { signal });
    const dom_max_bri_slider = container.querySelector('#max_bri_slider');
    dom_chk_limit_bri.addEventListener('change', () => {
        const enabled = dom_chk_limit_bri.checked;
        dom_rng_max_bri.disabled = !enabled;
        dom_max_bri_slider?.classList.toggle('disabled', !enabled);
    }, { signal });
    dom_rng_max_bri.addEventListener('input', () => {
        dom_txt_curr_max_bri.innerText = `${dom_rng_max_bri.value}%`;
    }, { signal });
    dom_rng_gamma.addEventListener('input', () => {
        dom_txt_curr_gamma.innerText = (parseFloat(dom_rng_gamma.value) / 10).toFixed(1);
    }, { signal });
    const dom_txt_curr_blur = container.querySelector<HTMLElement>('#txt_curr_blur');
    const dom_txt_curr_blur_sigma = container.querySelector<HTMLElement>('#txt_curr_blur_sigma');
    dom_rng_blur.addEventListener('input', () => {
        if (dom_txt_curr_blur) dom_txt_curr_blur.innerText = dom_rng_blur.value;
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur_sigma.value = dom_rng_blur.value;
            if (dom_txt_curr_blur_sigma) dom_txt_curr_blur_sigma.innerText = dom_rng_blur.value;
        }
    }, { signal });
    dom_rng_blur_sigma.addEventListener('input', () => {
        if (dom_txt_curr_blur_sigma) dom_txt_curr_blur_sigma.innerText = dom_rng_blur_sigma.value;
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur.value = dom_rng_blur_sigma.value;
            if (dom_txt_curr_blur) dom_txt_curr_blur.innerText = dom_rng_blur_sigma.value;
        }
    }, { signal });
    dom_chk_sigma_lock.addEventListener('change', () => {
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur_sigma.value = dom_rng_blur.value;
            if (dom_txt_curr_blur_sigma) dom_txt_curr_blur_sigma.innerText = dom_rng_blur.value;
        }
    }, { signal });
    dom_rng_zoom.addEventListener('input', () => {
        const v = parseFloat(dom_rng_zoom.value).toFixed(2);
        dom_rng_zoom.value = v;
        dom_txt_curr_zoom.innerText = v;
        target_zoom = parseFloat(v);
    }, { signal });

    dom_chk_show_leds.addEventListener('change', () => {
        overlayCanvas.classList.toggle('leds-hidden', !dom_chk_show_leds.checked);
    }, { signal });

    // ── Bloom controls ──────────────────────────────────────────────────────────
    const BLOOM_LS_KEY = 'ledmapper.moviemaker.autoBloom';

    // Restore persisted state (default: auto on).
    const _bloomAutoStored = localStorage.getItem(BLOOM_LS_KEY);
    const _bloomAutoInit = _bloomAutoStored === null ? true : _bloomAutoStored === 'true';
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
        localStorage.setItem(BLOOM_LS_KEY, String(enabled));
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
    const PREVIEW_ROTATE_LS_KEY = 'ledmapper.moviemaker.previewRotate';
    const PREVIEW_BLOOM_LS_KEY  = 'ledmapper.moviemaker.previewBloom';

    // Rotate view is opt-in: the preview stays locked to the screenmap's
    // native orientation unless the user explicitly enables rotation.
    const _prevRotateStored = localStorage.getItem(PREVIEW_ROTATE_LS_KEY);
    dom_chk_preview_rotate.checked = _prevRotateStored === null ? false : _prevRotateStored === 'true';

    const _prevBloomStored = localStorage.getItem(PREVIEW_BLOOM_LS_KEY);
    const _prevBloomInit = _prevBloomStored === null ? true : _prevBloomStored === 'true';
    dom_chk_preview_bloom.checked = _prevBloomInit;
    preview.setBloomEnabled(_prevBloomInit);

    dom_chk_preview_rotate.addEventListener('change', () => {
        localStorage.setItem(PREVIEW_ROTATE_LS_KEY, String(dom_chk_preview_rotate.checked));
    }, { signal });

    dom_chk_preview_bloom.addEventListener('change', () => {
        localStorage.setItem(PREVIEW_BLOOM_LS_KEY, String(dom_chk_preview_bloom.checked));
        preview.setBloomEnabled(dom_chk_preview_bloom.checked);
    }, { signal });

    // Recording toggle
    dom_btn_toggle_record.addEventListener('click', () => {
        if (!recording.isActive && screenmap_pts.length < 2) {
            alert('Please load a valid screenmap first of size >= 2');
            return;
        }
        void recording.toggle().then(active => {
            dom_btn_toggle_record.value = active ? 'Stop Recording' : 'Start Recording';
            dom_btn_toggle_record.classList.toggle('recording', active);
        });
    }, { signal });

    // Pointer-Events drag on overlay canvas.
    // Using setPointerCapture so pointerup fires even when the pointer is
    // released outside the element — fixes the stale isDraggingRight state
    // that occurred when the user released outside the canvas (issue #31).
    function cancelDrag() {
        if (!drag) return;
        const { pointerId } = drag;
        drag = null;
        try { overlayCanvas.releasePointerCapture(pointerId); } catch { /* already released */ }
    }

    overlayCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (screenmap_pts.length === 0) return;
        if (e.button === 0) {
            drag = { kind: 'translate', pointerId: e.pointerId, lastY: e.offsetY };
            overlayCanvas.setPointerCapture(e.pointerId);
        } else if (e.button === 2) {
            drag = { kind: 'zoom', pointerId: e.pointerId, lastY: e.offsetY };
            overlayCanvas.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }, { signal });

    overlayCanvas.addEventListener('pointermove', (e: PointerEvent) => {
        if (!drag || screenmap_pts.length === 0) return;
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
    overlayCanvas.addEventListener('contextmenu', (e: Event) => { e.preventDefault(); }, { signal });

    // Safety net: cancel any in-progress drag on window blur or tab hide.
    window.addEventListener('blur', cancelDrag, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelDrag(); }, { signal });

    // ── Animation loop ──────────────────────────────────────────────────────────

    let lastTime = performance.now();
    let lastSample: { rgbPts: Uint8Array; avgBri: number } | null = null;
    let sampleRgbPts: Uint8Array | null = null;
    let recordRgbPts: Uint8Array | null = null;

    // Debug hook always exposed for e2e tests (drag state needed for issue #31 tests).
    window.__mmDebug ??= {};
    window.__mmDebug.getDragState = () => drag ? { kind: drag.kind } : null;

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

    function animationLoop() {
        rafId = requestAnimationFrame(animationLoop);

        if (!sourceActive) return;

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
            blurPipeline.requestSample();
            // Consume the latest resolved async readback (1-2 frames behind)
            const gather = blurPipeline.getLatestSample();
            if (gather?.numPts === screenmap_pts.length) {
                if (sampleRgbPts?.length !== gather.numPts * 3) {
                    sampleRgbPts = new Uint8Array(gather.numPts * 3);
                }
                lastSample = extractGatherSample(gather.buffer, gather.numPts, sampleRgbPts);
                recording.processFrame(toRecordingSample(lastSample, gather.numPts), frame_rate);
            }
        } else {
            recording.resetCapture();
        }

        drawMoviemakerOverlay(overlayCtx, screenmap_pts, curr_rotate, curr_zoom, curr_translate[0], curr_translate[1], lastSample, videoWidth, videoHeight, fps, dom_chk_show_leds.checked, screenmapStrips, previewLedDiameter);
        const previewRotate = dom_chk_preview_rotate.checked ? curr_rotate : 0;
        preview.render(screenmap_pts, previewRotate, lastSample, previewLedDiameter);

        // Update progress bar for video sources
        if (videoSource.sourceType === 'video' && !isScrubbing) {
            const t = videoPlayer.currentTime;
            const d = videoPlayer.duration;
            if (isFinite(d) && d > 0) {
                const pct = (t / d) * 100;
                dom_progress_fill.style.width = `${String(pct)}%`;
                dom_progress_thumb.style.left = `${String(pct)}%`;
                dom_time_current.textContent = formatTime(t);
            }
        }
    }

    rafId = requestAnimationFrame(animationLoop);

    return function destroy() {
        if (perfEnabled) delete window.__mmDebug;
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        videoSource.dispose();
        blurPipeline.dispose();
        preview.dispose();
    };
}

