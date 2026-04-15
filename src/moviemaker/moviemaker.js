const Swal = import('sweetalert2').then(m => m.default);
import { parse_screenmap_data, readFileAsText } from '../common.js';
import { saveScreenmap, getScreenmap } from '../screenmap-store.js';
import { transformToCenter, parseResolution, samplePixels, computeFps, scaleToMaxDimension } from './transforms.js';
import { loadPreset } from '../preset-loader.js';
import { createBlurPipeline } from './blur-pipeline.js';
import { createVideoSource } from './video-source.js';
import { createRecording } from './recording.js';
import { drawMoviemakerOverlay, drawPreview } from './overlay.js';
import templateHtml from './template.html?raw';
export { default as css } from './moviemaker.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    // ── DOM refs ────────────────────────────────────────────────────────────────
    const dom_btn_preset_16x16 = container.querySelector('#btn_preset_16x16');
    const dom_btn_preset_8x8   = container.querySelector('#btn_preset_8x8');
    const dom_btn_preset_strip = container.querySelector('#btn_preset_strip');
    const dom_btn_preset_ring  = container.querySelector('#btn_preset_ring');
    const dom_btn_preset_32x32  = container.querySelector('#btn_preset_32x32');
    const dom_btn_preset_spaceface = container.querySelector('#btn_preset_spaceface');
    const dom_btn_preset_piano = container.querySelector('#btn_preset_piano');
    const dom_btn_preset_keytar = container.querySelector('#btn_preset_keytar');
    const dom_btn_load_video    = container.querySelector('#btn_load_video');
    const dom_btn_start_webcam  = container.querySelector('#btn_start_webcam');
    const dom_btn_upload_screenmap  = container.querySelector('#btn_upload_screenmap');
    const dom_btn_unload_source = container.querySelector('#btn_unload_source');
    const dom_btn_play_pause    = container.querySelector('#btn_play_pause');
    const dom_video_progress    = container.querySelector('#video-progress');
    const dom_progress_track    = container.querySelector('#video-progress-track');
    const dom_progress_fill     = container.querySelector('#video-progress-fill');
    const dom_progress_thumb    = container.querySelector('#video-progress-thumb');
    const dom_time_current      = container.querySelector('#video-time-current');
    const dom_time_duration     = container.querySelector('#video-time-duration');
    const dom_btn_how_to       = container.querySelector('#btn_how_to');
    const dom_btn_toggle_record = container.querySelector('#btn_toggle_record');
    const dom_rng_rotation     = container.querySelector('#rng_rotation');
    const dom_rng_zoom         = container.querySelector('#rng_zoom');
    const dom_txt_curr_zoom    = container.querySelector('#txt_curr_zoom');
    const dom_rng_brightness   = container.querySelector('#rng_brightness');
    const dom_txt_curr_bri     = container.querySelector('#txt_curr_bri');
    const dom_chk_limit_bri    = container.querySelector('#chk_limit_brightness');
    const dom_rng_max_bri      = container.querySelector('#rng_max_brightness');
    const dom_txt_curr_max_bri = container.querySelector('#txt_curr_max_bri');
    const dom_rng_gamma        = container.querySelector('#rng_gamma');
    const dom_txt_curr_gamma   = container.querySelector('#txt_curr_gamma');
    const dom_rng_blur         = container.querySelector('#rng_blur');
    const dom_rng_blur_sigma   = container.querySelector('#rng_blur_sigma');
    const dom_chk_sigma_lock   = container.querySelector('#chk_sigma_lock');
    const dom_sel_resolution   = container.querySelector('#sel_resolution');
    const dom_sel_framerate    = container.querySelector('#sel_framerate');
    const dom_sel_max_resolution = container.querySelector('#sel_max_resolution');
    const dom_txt_curr_resolution = container.querySelector('#txt_curr_resolution');
    const dom_chk_show_leds    = container.querySelector('#chk_show_leds');

    const videoPlayer    = container.querySelector('#videoPlayer');
    const renderCanvas   = container.querySelector('#renderCanvas');
    const overlayCanvas  = container.querySelector('#overlayCanvas');
    const overlayCtx     = overlayCanvas.getContext('2d');
    const previewCanvas  = container.querySelector('#previewCanvas');
    const previewCtx     = previewCanvas.getContext('2d');

    const ac = new AbortController();
    const { signal } = ac;

    // ── State ───────────────────────────────────────────────────────────────────
    let screenmap_pts = [];
    let rawScreenmapPts = [];
    let screenmapValid = false;
    let sourceActive = false;

    let target_zoom = 1, curr_zoom = 1;
    let target_rotate = 0, curr_rotate = 0;
    let target_translate = [0, 0], curr_translate = [0, 0];
    let isDraggingRight = false;
    let lastMouseY = 0;

    let frame_rate = 30;
    let nativeVideoWidth = 640, nativeVideoHeight = 480;
    let videoWidth = 640, videoHeight = 480;
    let rafId = null;
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
        onSourceReady(w, h, type) {
            setupForNewSource(w, h);
            if (type === 'video') {
                frame_rate = 30;
            }
        },
        async onError(message) {
            (await Swal).fire('Webcam Error', message, 'error');
        },
    });

    const recording = createRecording({
        getSwal: () => Swal,
    });

    // ── Helpers ─────────────────────────────────────────────────────────────────

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function getMaxResolution() {
        return parseInt(dom_sel_max_resolution.value);
    }

    function applyResolution(nativeW, nativeH) {
        const { width: w, height: h } = scaleToMaxDimension(nativeW, nativeH, getMaxResolution());

        videoWidth = w;
        videoHeight = h;

        blurPipeline.setupForResolution(w, h);
        overlayCanvas.width = w;
        overlayCanvas.height = h;

        if (screenmapValid) {
            screenmap_pts = transformToCenter(rawScreenmapPts, videoWidth, videoHeight);
            target_translate = [w / 2, h / 2];
            curr_translate = [w / 2, h / 2];
        }

        const canvasRow = container.querySelector('.canvas-row');
        if (canvasRow) canvasRow.dataset.layout = (w > h) ? 'landscape' : 'portrait';

        dom_txt_curr_resolution.textContent = `${w}×${h}`;
    }

    function setupForNewSource(nativeW, nativeH) {
        nativeVideoWidth = nativeW;
        nativeVideoHeight = nativeH;

        applyResolution(nativeW, nativeH);

        sourceActive = true;
        updateElementStates();

        const welcomeEl = container.querySelector('#welcome-overlay');
        if (welcomeEl) welcomeEl.classList.add('hidden');

        const toolbar = container.querySelector('.canvas-toolbar');
        if (toolbar) toolbar.classList.add('visible');

        previewCanvas.classList.add('visible');

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
        sliders.forEach(el => {
            el.disabled = !screenmapValid;
            const cg = el.closest('.control-group');
            if (cg) cg.classList.toggle('disabled', !screenmapValid);
        });
        dom_btn_toggle_record.disabled = !sourceActive || !screenmapValid;
        const cg = dom_btn_toggle_record.closest('.control-group');
        if (cg) cg.classList.toggle('disabled', dom_btn_toggle_record.disabled);
    }

    updateElementStates();

    // ── Screenmap presets ────────────────────────────────────────────────────────

    function loadScreenmapFromPoints(pts) {
        rawScreenmapPts = pts;
        if (rawScreenmapPts.length === 0) {
            screenmapValid = false;
        } else {
            screenmap_pts = transformToCenter(rawScreenmapPts, videoWidth, videoHeight);
            screenmapValid = true;
            target_zoom = 1; curr_zoom = 1;
            curr_rotate = 0; target_rotate = 0;
            container.querySelector('#txt_curr_rotation').innerText = '0';
            dom_rng_rotation.value = 0;
            target_translate = [videoWidth / 2, videoHeight / 2];
            curr_translate = [videoWidth / 2, videoHeight / 2];
        }
        updateElementStates();
    }

    const presetButtons = [dom_btn_preset_16x16, dom_btn_preset_8x8, dom_btn_preset_strip, dom_btn_preset_ring, dom_btn_preset_32x32, dom_btn_preset_spaceface, dom_btn_preset_piano, dom_btn_preset_keytar];

    function clearPresetActive() {
        presetButtons.forEach(b => b.classList.remove('active-preset'));
    }

    dom_btn_preset_16x16.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_16x16.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('16x16_grid.json'));
    }, { signal });
    dom_btn_preset_8x8.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_8x8.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('8x8_grid.json'));
    }, { signal });
    dom_btn_preset_strip.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_strip.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('strip_60.json'));
    }, { signal });
    dom_btn_preset_ring.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_ring.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('ring_24.json'));
    }, { signal });
    dom_btn_preset_32x32.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_32x32.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('32x32_quad_serpentine.json'));
    }, { signal });
    dom_btn_preset_spaceface.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_spaceface.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('spaceface.json'));
    }, { signal });
    dom_btn_preset_piano.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_piano.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('piano_grand.json'));
    }, { signal });
    dom_btn_preset_keytar.addEventListener('click', async () => {
        clearPresetActive();
        dom_btn_preset_keytar.classList.add('active-preset');
        loadScreenmapFromPoints(await loadPreset('keytar.json'));
    }, { signal });

    // Restore stored screenmap, or fall back to 16x16 preset
    const storedScreenmap = getScreenmap();
    if (storedScreenmap) {
        loadScreenmapFromPoints(parse_screenmap_data(storedScreenmap));
    } else {
        dom_btn_preset_16x16.click();
    }

    // Wire welcome overlay buttons to sidebar buttons
    container.querySelectorAll('[data-trigger]').forEach(btn => {
        btn.addEventListener('click', () => container.querySelector('#' + btn.dataset.trigger).click(), { signal });
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

    function create_transformed_screenmap() {
        if (screenmap_pts.length === 0) return [];
        let pts = screenmap_pts.map(([x, y]) => [x, y]);
        if (curr_rotate !== 0) {
            const r = curr_rotate * Math.PI / 180;
            const cos_r = Math.cos(r), sin_r = Math.sin(r);
            pts = pts.map(([x, y]) => [x * cos_r - y * sin_r, x * sin_r + y * cos_r]);
        }
        pts = pts.map(([x, y]) => [
            x * curr_zoom + curr_translate[0],
            y * curr_zoom + curr_translate[1]
        ]);
        return pts;
    }

    function mouseInCanvas(mx, my) {
        return mx >= 0 && mx <= videoWidth && my >= 0 && my <= videoHeight;
    }

    // ── Event handlers ──────────────────────────────────────────────────────────

    dom_btn_how_to.addEventListener('click', async () => {
        (await Swal).fire({
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
            customClass: { popup: 'custom-popup-class', content: 'custom-content-class' },
        });
    }, { signal });

    // Video source: Load file
    dom_btn_load_video.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
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
    function seekToPosition(clientX) {
        const rect = dom_progress_track.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const seekTime = fraction * videoPlayer.duration;
        videoPlayer.currentTime = seekTime;
        const pct = fraction * 100;
        dom_progress_fill.style.width = `${pct}%`;
        dom_progress_thumb.style.left = `${pct}%`;
        dom_time_current.textContent = formatTime(seekTime);
    }

    dom_progress_track.addEventListener('mousedown', (e) => {
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
        previewCanvas.classList.remove('visible');

        const welcomeEl = container.querySelector('#welcome-overlay');
        if (welcomeEl) welcomeEl.classList.remove('hidden');

        const toolbar = container.querySelector('.canvas-toolbar');
        if (toolbar) toolbar.classList.remove('visible');

        const canvasRow = container.querySelector('.canvas-row');
        if (canvasRow) delete canvasRow.dataset.layout;
    }, { signal });

    // Screenmap upload
    dom_btn_upload_screenmap.addEventListener('change', () => {
        clearPresetActive();
        screenmapValid = false;
        updateElementStates();
        readFileAsText(dom_btn_upload_screenmap, (text) => {
            loadScreenmapFromPoints(parse_screenmap_data(text));
            saveScreenmap(text);
        });
    }, { signal });

    // Slider handlers
    const SNAP_STEP = 45;
    const SNAP_THRESHOLD = 5;
    function snap_rotation(val) {
        const nearest = Math.round(val / SNAP_STEP) * SNAP_STEP;
        return Math.abs(val - nearest) <= SNAP_THRESHOLD ? nearest : val;
    }
    function set_target_rotate(val) {
        const snapped = snap_rotation(parseInt(val));
        target_rotate = snapped;
        dom_rng_rotation.value = snapped;
        container.querySelector('#txt_curr_rotation').innerText = snapped;
    }
    dom_rng_rotation.addEventListener('input', () => set_target_rotate(dom_rng_rotation.value), { signal });

    dom_rng_brightness.addEventListener('input', () => {
        dom_txt_curr_bri.innerText = `${dom_rng_brightness.value}%`;
    }, { signal });
    const dom_max_bri_slider = container.querySelector('#max_bri_slider');
    dom_chk_limit_bri.addEventListener('change', () => {
        const enabled = dom_chk_limit_bri.checked;
        dom_rng_max_bri.disabled = !enabled;
        dom_max_bri_slider.classList.toggle('disabled', !enabled);
    }, { signal });
    dom_rng_max_bri.addEventListener('input', () => {
        dom_txt_curr_max_bri.innerText = `${dom_rng_max_bri.value}%`;
    }, { signal });
    dom_rng_gamma.addEventListener('input', () => {
        dom_txt_curr_gamma.innerText = `${(dom_rng_gamma.value / 10).toFixed(1)}`;
    }, { signal });
    dom_rng_blur.addEventListener('input', () => {
        container.querySelector('#txt_curr_blur').innerText = dom_rng_blur.value;
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur_sigma.value = dom_rng_blur.value;
            container.querySelector('#txt_curr_blur_sigma').innerText = dom_rng_blur.value;
        }
    }, { signal });
    dom_rng_blur_sigma.addEventListener('input', () => {
        container.querySelector('#txt_curr_blur_sigma').innerText = dom_rng_blur_sigma.value;
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur.value = dom_rng_blur_sigma.value;
            container.querySelector('#txt_curr_blur').innerText = dom_rng_blur_sigma.value;
        }
    }, { signal });
    dom_chk_sigma_lock.addEventListener('change', () => {
        if (dom_chk_sigma_lock.checked) {
            dom_rng_blur_sigma.value = dom_rng_blur.value;
            container.querySelector('#txt_curr_blur_sigma').innerText = dom_rng_blur.value;
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


    // Recording toggle
    dom_btn_toggle_record.addEventListener('click', async () => {
        if (!recording.isActive && screenmap_pts.length < 2) {
            alert('Please load a valid screenmap first of size >= 2');
            return;
        }
        const active = await recording.toggle();
        dom_btn_toggle_record.value = active ? 'Stop Recording' : 'Start Recording';
        dom_btn_toggle_record.classList.toggle('recording', active);
    }, { signal });

    // Mouse interaction on overlay canvas
    overlayCanvas.addEventListener('mousedown', (e) => {
        if (e.button === 2 && screenmap_pts.length > 0) {
            isDraggingRight = true;
            lastMouseY = e.offsetY;
            e.preventDefault();
        }
    }, { signal });
    overlayCanvas.addEventListener('mousemove', (e) => {
        if (e.buttons & 1 && screenmap_pts.length > 0 && mouseInCanvas(e.offsetX, e.offsetY)) {
            target_translate[0] = e.offsetX;
            target_translate[1] = e.offsetY;
        }
        if (isDraggingRight && screenmap_pts.length > 0) {
            const dy = e.offsetY - lastMouseY;
            target_zoom -= dy * 0.01;
            target_zoom = Math.max(Math.min(target_zoom, 3), 0.15);
            dom_rng_zoom.value = target_zoom.toFixed(2);
            dom_txt_curr_zoom.innerText = target_zoom.toFixed(2);
            lastMouseY = e.offsetY;
        }
    }, { signal });
    overlayCanvas.addEventListener('mouseup', (e) => {
        if (e.button === 2) isDraggingRight = false;
    }, { signal });
    overlayCanvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });

    // ── Animation loop ──────────────────────────────────────────────────────────

    let lastTime = performance.now();
    let lastSample = null;

    function animationLoop() {
        rafId = requestAnimationFrame(animationLoop);

        if (!sourceActive) return;

        const now = performance.now();
        const fps = computeFps(now, lastTime);
        lastTime = now;

        blurPipeline.updateUniforms({
            blurRadius: parseFloat(dom_rng_blur.value),
            sigma: parseFloat(dom_rng_blur_sigma.value),
            brightness: dom_chk_limit_bri.checked
                ? Math.min(parseInt(dom_rng_brightness.value), parseInt(dom_rng_max_bri.value)) / 100
                : parseInt(dom_rng_brightness.value) / 100,
            gamma: parseInt(dom_rng_gamma.value) / 10,
        });

        update_screenmap_parameters();
        const transformedPts = create_transformed_screenmap();

        const needReadback = screenmapValid && transformedPts.length > 0;

        if (needReadback) {
            const readback = blurPipeline.readbackPixels(videoWidth, videoHeight);
            const sample = samplePixels(readback, transformedPts, videoWidth, videoHeight);
            lastSample = sample;
            recording.processFrame(sample, frame_rate);
        } else {
            blurPipeline.renderBlurred(null);
            recording.resetCapture();
        }

        drawMoviemakerOverlay(overlayCtx, transformedPts, lastSample, videoWidth, videoHeight, fps);
        drawPreview(previewCtx, transformedPts, lastSample, 200);

        // Update progress bar for video sources
        if (videoSource.sourceType === 'video' && !isScrubbing) {
            const t = videoPlayer.currentTime;
            const d = videoPlayer.duration;
            if (isFinite(d) && d > 0) {
                const pct = (t / d) * 100;
                dom_progress_fill.style.width = `${pct}%`;
                dom_progress_thumb.style.left = `${pct}%`;
                dom_time_current.textContent = formatTime(t);
            }
        }
    }

    rafId = requestAnimationFrame(animationLoop);

    return function destroy() {
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        videoSource.dispose();
        blurPipeline.dispose();
    };
}
