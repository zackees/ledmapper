import { parse_screenmap_data_json, centerAndFitPoints, download_blob_as_file, parseScreenmapMultiStrip, getStripColors, stripStartEndLabels } from '../common';
import { createLabelRenderer } from '../label-render';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop';
import { createCircleTexture, createRendererAndScene, rebuildPointsMesh, wireDiameterSlider, createAnimationLoop } from '../three-utils';
import { createBloomComposer, updateBloomIris } from '../three-bloom';
import {
    computeAutoBloomRange,
    resolveLedDiameter,
    computeFitScale,
    bloomParamsForLedSize,
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_DENSE,
    DEMO_AUTO_MAX_SPARSE,
    DEMO_BLOOM_MAX_STRENGTH,
    DEMO_BLOOM_RADIUS,
    DEMO_BLOOM_AREA_REF,
    BLOOM_MIN_STRENGTH,
} from '../bloom-utils';
import { estimateLedSize } from '../moviemaker/transforms';
import type { MultiStripParseResult, StripPoint, RendererContextWithOverlay } from '../types/domain';
import type { BufferGeometry, PointsMaterial, Points, Float32BufferAttribute } from 'three';
import templateHtml from './template.html?raw';
export { default as css } from './demo.css?url';

function qe<T extends HTMLElement>(container: ParentNode, sel: string, _cast?: (e: Element) => T): T {
    const el = container.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el as T;
}

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

    // Global variables
    let videoReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let videoBuffer = new Uint8Array();

    // DOM elements
    const dom_btn_upload_screenmap = qe<HTMLInputElement>(container, '#btn_upload_screenmap');
    const dom_btn_load_movie = qe<HTMLInputElement>(container, '#btn_load_movie');
    const dom_btn_play = qe<HTMLInputElement>(container, '#btn_play');
    const dom_rng_diameter = qe<HTMLInputElement>(container, '#rng_diameter');
    const dom_txt_curr_diameter = qe<HTMLElement>(container, '#txt_curr_diameter');
    const dom_btn_download_screenmap = qe<HTMLButtonElement>(container, '#btn_download_screenmap');
    const dom_btn_download_video = qe<HTMLButtonElement>(container, '#btn_download_video');
    const dom_sel_framerate = qe<HTMLSelectElement>(container, '#sel_framerate');
    const dom_btn_download_screenmap_16x16_serpentine = qe<HTMLButtonElement>(container, '#btn_download_screenmap_16x16_serpentine');
    const dom_chk_auto_bloom        = qe<HTMLInputElement>(container, '#chk_auto_bloom');
    const dom_bloom_strength_slider = qe<HTMLElement>(container, '#bloom_strength_slider');
    const dom_rng_bloom_strength    = qe<HTMLInputElement>(container, '#rng_bloom_strength');
    const dom_txt_bloom_strength    = qe<HTMLElement>(container, '#txt_curr_bloom_strength');

    dom_btn_play.disabled = true;

    const CANVAS_SIZE = 800;
    let screenmap_pts: StripPoint[] = [];
    let screenmap_pts_original: StripPoint[] = [];
    let stripInfo: MultiStripParseResult | null = null;
    const movie_frames: Uint8Array[] = [];
    let playing = false;
    let curr_frame_idx = 0;
    let curr_frame: Uint8Array | null = null;

    // Three.js objects
    let pointsGeometry: BufferGeometry | undefined;
    let pointsMaterial: PointsMaterial | undefined;
    let pointsMesh: Points | undefined;
    let colorAttribute: Float32BufferAttribute | undefined;

    // Overlay state
    let showLines = false;

    // Pre-computed inverse for byte-to-float conversion
    const INV_255 = 1 / 255;

    const ac = new AbortController();
    const { signal } = ac;

    // --- Three.js Initialization ---
    const circleTexture = createCircleTexture(64);

    const main = qe<HTMLElement>(container, 'main');
    const { renderer, scene, camera, wrapper, overlayCanvas, overlayCtx } = createRendererAndScene({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        parent: main,
        enableOverlay: true,
    }) as RendererContextWithOverlay;

    // FastLED-style bloom: UnrealBloomPass with auto-bloom iris.
    const bloom = createBloomComposer({
        renderer, scene, camera,
        width: CANVAS_SIZE, height: CANVAS_SIZE,
    });
    const irisState = { currentBrightness: 0 };
    // Strength range / radius proportioned to the rendered dot size
    // (updated in updateBloomParams whenever the diameter changes).
    const bloomRange = { min: 0, max: 0 };

    // Proportion the bloom kernel to the rendered LED size so small dots
    // keep a tight halo and large dots don't white out the canvas.
    function updateBloomParams() {
        if (!pointsMaterial) return;
        // PointsMaterial.size is in CSS pixels (the renderer applies its
        // pixelRatio to the size uniform internally). baseMax is the demo's
        // full-open iris ceiling (the manual sweet spot); size scaling still
        // drops it for large dots to prevent white-out.
        const params = bloomParamsForLedSize(pointsMaterial.size, CANVAS_SIZE, screenmap_pts.length, {
            baseMax: DEMO_BLOOM_MAX_STRENGTH,
            baseRadius: DEMO_BLOOM_RADIUS,
            refArea: DEMO_BLOOM_AREA_REF,
        });
        bloom.bloomPass.radius = params.radius;
        bloomRange.min = params.minStrength;
        bloomRange.max = params.maxStrength;
    }

    /** Demo bloom profile constants. */
    const DEMO_PROFILE = { floor: DEMO_AUTO_FLOOR, maxDense: DEMO_AUTO_MAX_DENSE, maxSparse: DEMO_AUTO_MAX_SPARSE };
    let demoBloomRange = { min: Math.max(BLOOM_MIN_STRENGTH, DEMO_AUTO_FLOOR * 0.5), max: DEMO_AUTO_MAX_DENSE };
    let demoAutoBloomEnabled = true;
    let demoManualBloomStrength: number | null = null;

    /** Recompute bloom envelope from the current screenmap geometry. */
    function _recomputeDemoBloomRange() {
        if (screenmap_pts.length < 2) return;
        const spacing = estimateLedSize(screenmap_pts);
        // sceneExtent: bounding box max dimension of screen-space pts
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of screenmap_pts) {
            if (x < xmin) xmin = x; if (x > xmax) xmax = x;
            if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        }
        const extent = Math.max(xmax - xmin, ymax - ymin, 1e-6);
        demoBloomRange = computeAutoBloomRange({ ledSpacing: spacing, sceneExtent: extent, profile: DEMO_PROFILE });
    }

    const DEMO_BLOOM_LS_KEY = 'ledmapper.demo.autoBloom';

    function _sliderToDemoBloomStrength(rngVal: number): number {
        const t = (rngVal / 100) ** 2;
        const S_MIN = Math.max(BLOOM_MIN_STRENGTH, DEMO_AUTO_FLOOR * 0.5);
        const S_MAX = DEMO_BLOOM_MAX_STRENGTH;
        return S_MIN + (S_MAX - S_MIN) * t;
    }

    function _applyDemoBloomAutoState(enabled: boolean) {
        dom_rng_bloom_strength.disabled = enabled;
        if (enabled) {
            dom_bloom_strength_slider.classList.add('opacity-50', 'pointer-events-none');
            dom_bloom_strength_slider.classList.remove('opacity-100');
        } else {
            dom_bloom_strength_slider.classList.remove('opacity-50', 'pointer-events-none');
            dom_bloom_strength_slider.classList.add('opacity-100');
        }
        demoAutoBloomEnabled = enabled;
        if (enabled) demoManualBloomStrength = null;
    }

    // Restore persisted auto-bloom state (default: on).
    const _demoAutoStored = localStorage.getItem(DEMO_BLOOM_LS_KEY);
    const _demoAutoInit = _demoAutoStored === null ? true : _demoAutoStored === 'true';
    dom_chk_auto_bloom.checked = _demoAutoInit;
    _applyDemoBloomAutoState(_demoAutoInit);

    dom_chk_auto_bloom.addEventListener('change', () => {
        const enabled = dom_chk_auto_bloom.checked;
        localStorage.setItem(DEMO_BLOOM_LS_KEY, String(enabled));
        if (!enabled) {
            // Seed slider from current bloom strength.
            const curr = bloom.bloomPass.strength;
            const S_MIN = Math.max(BLOOM_MIN_STRENGTH, DEMO_AUTO_FLOOR * 0.5);
            const S_MAX = DEMO_AUTO_MAX_SPARSE * 1.5;
            const raw = (curr - S_MIN) / (S_MAX - S_MIN);
            const rngVal = Math.round(Math.sqrt(Math.max(raw, 0)) * 100);
            dom_rng_bloom_strength.value = String(Math.min(Math.max(rngVal, 0), 100));
            demoManualBloomStrength = _sliderToDemoBloomStrength(parseInt(dom_rng_bloom_strength.value));
            dom_txt_bloom_strength.innerText = demoManualBloomStrength.toFixed(2);
        }
        _applyDemoBloomAutoState(enabled);
    }, { signal });

    dom_rng_bloom_strength.addEventListener('input', () => {
        demoManualBloomStrength = _sliderToDemoBloomStrength(parseInt(dom_rng_bloom_strength.value));
        dom_txt_bloom_strength.innerText = demoManualBloomStrength.toFixed(2);
    }, { signal });

    // Configure overlay for hover/touch fade behavior
    overlayCanvas.style.opacity = '0';
    overlayCanvas.style.transition = 'opacity 0.3s';

    function showOverlay() {
        if (!showLines) { showLines = true; drawOverlay(); }
        overlayCanvas.style.opacity = '1';
    }
    function hideOverlay() {
        overlayCanvas.style.opacity = '0';
    }
    overlayCanvas.addEventListener('mouseenter', showOverlay, { signal });
    overlayCanvas.addEventListener('mouseleave', hideOverlay, { signal });
    overlayCanvas.addEventListener('touchstart', showOverlay, { passive: true, signal });
    overlayCanvas.addEventListener('touchend', hideOverlay, { passive: true, signal });
    overlayCanvas.addEventListener('touchcancel', hideOverlay, { passive: true, signal });

    // LED index tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText =
        'position:absolute;pointer-events:none;' +
        'background:rgba(0,0,0,0.85);color:#fff;' +
        'padding:4px 8px;border-radius:4px;font:12px monospace;white-space:nowrap;' +
        'opacity:0;transition:opacity 0.15s;';
    wrapper.appendChild(tooltip);

    let tooltipLedIdx = -1;

    function hitTestLED(canvasX: number, canvasY: number): number {
        if (screenmap_pts.length === 0) return -1;
        const threshold = Math.max(getDiameter(), 10);
        const threshSq = threshold * threshold;
        let bestIdx = -1, bestDist = threshSq;
        for (let i = 0; i < screenmap_pts.length; i++) {
            const pt = screenmap_pts[i] ?? [0, 0];
            const dx = canvasX - pt[0];
            const dy = canvasY - pt[1];
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        return bestIdx;
    }

    function onPointerMove(e: MouseEvent) {
        const rect = overlayCanvas.getBoundingClientRect();
        const scaleX = CANVAS_SIZE / rect.width;
        const scaleY = CANVAS_SIZE / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top) * scaleY;
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            if (idx !== tooltipLedIdx) {
                tooltipLedIdx = idx;
                const [ox, oy] = screenmap_pts_original[idx] ?? [0, 0];
                tooltip.textContent = `LED #${String(idx)}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const tx = Math.min(cx + 14, CANVAS_SIZE - tooltip.offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            tooltip.style.left = `${String(tx)}px`;
            tooltip.style.top = `${String(ty)}px`;
            tooltip.style.opacity = '1';
        } else {
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        }
    }

    function onPointerLeave() {
        tooltipLedIdx = -1;
        tooltip.style.opacity = '0';
    }

    overlayCanvas.addEventListener('mousemove', onPointerMove, { signal });
    overlayCanvas.addEventListener('mouseleave', onPointerLeave, { signal });
    overlayCanvas.addEventListener('touchmove', (e: TouchEvent) => {
        if (e.touches.length) onPointerMove(e.touches[0] as unknown as MouseEvent);
    }, { passive: true, signal });
    overlayCanvas.addEventListener('touchend', onPointerLeave, { passive: true, signal });
    overlayCanvas.addEventListener('touchcancel', onPointerLeave, { passive: true, signal });

    // --- Build Three.js Points from screenmap data ---
    function buildPoints() {
        const previous = (pointsMesh && pointsGeometry && pointsMaterial && colorAttribute) ? { mesh: pointsMesh, geometry: pointsGeometry, material: pointsMaterial, colorAttribute } : null;
        const result = rebuildPointsMesh({
            scene, previous,
            points: screenmap_pts,
            circleTexture,
            diameter: getDiameter(),
        });

        pointsGeometry = result.geometry;
        pointsMaterial = result.material;
        pointsMesh = result.mesh;
        colorAttribute = result.colorAttribute;
    }

    // --- Screenmap data loading ---
    function load_screenmap_data(jsonBlob: Record<string, unknown>) {
        screenmap_pts = parse_screenmap_data_json(jsonBlob);
        if (screenmap_pts.length === 0) {
            console.error('Failed to load screenmap data');
            return;
        }
        screenmap_pts_original = screenmap_pts.map(([x, y]) => [x, y] as StripPoint);
        screenmap_pts = centerAndFitPoints(screenmap_pts, CANVAS_SIZE, CANVAS_SIZE);
        stripInfo = parseScreenmapMultiStrip(jsonBlob);
        buildPoints();
        _recomputeDemoBloomRange();
        applyScreenmapDiameter();
        updateBloomParams();
        drawOverlay();
        dom_btn_play.disabled = false;
    }

    // The screenmap's declared LED diameter (world units) defines the
    // rendered dot size: scale it into canvas pixels and drive the diameter
    // slider with it. The user can still override via the slider. Maps that
    // declare no diameter keep the slider's current value.
    function applyScreenmapDiameter() {
        const declared = resolveLedDiameter(stripInfo ? (stripInfo.strips as unknown as Record<string, unknown>[]) : null);
        if (declared === null) return;
        // Canvas world units map 1:1 to CSS pixels (and PointsMaterial.size
        // is in CSS pixels), so no pixelRatio term here.
        const scale = computeFitScale(screenmap_pts_original, screenmap_pts);
        const px = Math.round(declared * scale);
        const min = parseInt(dom_rng_diameter.min) || 1;
        const max = parseInt(dom_rng_diameter.max) || 64;
        dom_rng_diameter.value = String(Math.min(Math.max(px, min), max));
        dom_rng_diameter.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function stopVideoStream() {
        if (videoReader) {
            void videoReader.cancel().catch((_e: unknown) => { /* ignore cancel errors */ });
            videoReader = null;
        }
        videoBuffer = new Uint8Array();
    }

    function loadScreenmapFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            alert('Please choose a .json screenmap file.');
            return;
        }
        void file.text().then((text: string) => {
            // A new screenmap invalidates frames sized for the old LED count
            stopVideoStream();
            movie_frames.length = 0;
            curr_frame_idx = 0;
            set_dom_btn_play(false);
            load_screenmap_data(JSON.parse(text) as Record<string, unknown>);
        }).catch((error: unknown) => {
            alert(`Error reading screenmap file: ${String(error)}`);
        });
    }

    function loadMovieFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.rgb'])) {
            alert('Please choose a .rgb video file.');
            return;
        }
        void file.arrayBuffer().then(load_movie_data).catch((error: unknown) => {
            alert(`Error reading video file: ${String(error)}`);
        });
    }

    function load_movie_data(arrayBuffer: ArrayBuffer) {
        if (screenmap_pts.length === 0) {
            alert('No screenmap is loaded!');
            return;
        }
        const uint8_array = new Uint8Array(arrayBuffer);
        const num_pixels = uint8_array.length / 3;
        if (num_pixels % screenmap_pts.length !== 0) {
            alert('Frame size should be a multiple of the number of screenmap points!');
            return;
        }
        stopVideoStream();
        movie_frames.length = 0;
        curr_frame_idx = 0;
        const frameSize = screenmap_pts.length * 3;
        const n_frames = num_pixels / screenmap_pts.length;
        for (let i = 0; i < n_frames; i++) {
            movie_frames.push(uint8_array.slice(i * frameSize, (i + 1) * frameSize));
        }
        dom_btn_play.disabled = false;
        set_dom_btn_play(true);
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        loadScreenmapFile(dom_btn_upload_screenmap.files?.[0]);
    }, { signal });

    dom_btn_load_movie.addEventListener('change', () => {
        loadMovieFile(dom_btn_load_movie.files?.[0]);
    }, { signal });

    wireFileDropTarget({
        target: main,
        onFile: (file) => {
            if (!file) return;
            if (fileHasExtension(file, ['.json'])) {
                loadScreenmapFile(file);
            } else if (fileHasExtension(file, ['.rgb'])) {
                loadMovieFile(file);
            } else {
                alert('Please drop a .json screenmap or .rgb video file.');
            }
        },
        signal,
    });

    function fetchAndLoadJSON() {
        fetch('/screenmaps/32x32_quad_serpentine.json')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then((jsonBlob: Record<string, unknown>) => {
                console.warn('Screenmap data loaded successfully');
                load_screenmap_data(jsonBlob);
                void fetchAndLoadVideo();
            })
            .catch((error: unknown) => { console.error('Error loading JSON:', error); });
    }

    // --- Video streaming ---
    async function fetchAndLoadVideo() {
        try {
            const response = await fetch('/demo/video.rgb');
            if (!response.ok) throw new Error('Network response was not ok');
            if (!response.body) throw new Error('ReadableStream not supported');
            videoReader = response.body.getReader();
            void streamVideoData();
        } catch (error) {
            console.error('Error loading video:', error);
        }
    }

    async function streamVideoData() {
        try {
            for (;;) {
                if (!videoReader) break;
                const { done, value } = await videoReader.read();
                if (done) {
                    console.warn('Finished streaming video data');
                    break;
                }
                const newBuffer = new Uint8Array(videoBuffer.length + value.length);
                newBuffer.set(videoBuffer);
                newBuffer.set(value, videoBuffer.length);
                videoBuffer = newBuffer;

                const frameSize = screenmap_pts.length * 3;
                const completeFrames = Math.floor(videoBuffer.length / frameSize);
                if (completeFrames > 0) {
                    const frameData = videoBuffer.slice(0, completeFrames * frameSize);
                    processNewFrames(frameData);
                    videoBuffer = videoBuffer.slice(completeFrames * frameSize);
                }
            }
        } catch (error) {
            console.error('Error streaming video:', error);
        }
    }

    function processNewFrames(frameData: Uint8Array) {
        const frameSize = screenmap_pts.length * 3;
        const numNewFrames = frameData.length / frameSize;
        for (let i = 0; i < numNewFrames; i++) {
            const start = i * frameSize;
            movie_frames.push(frameData.slice(start, start + frameSize));
        }
        if (movie_frames.length === numNewFrames) {
            dom_btn_play.disabled = false;
            set_dom_btn_play(false);
            dom_btn_play.click();
        }
    }

    // --- Play/Pause ---
    function set_dom_btn_play(on: boolean) {
        playing = on;
        dom_btn_play.value = playing ? 'Pause' : 'Play';
    }

    dom_btn_play.addEventListener('click', () => { set_dom_btn_play(!playing); }, { signal });

    // --- Diameter slider ---
    const getDiameter = wireDiameterSlider({
        slider: dom_rng_diameter,
        label: dom_txt_curr_diameter,
        getMaterial: () => pointsMaterial ?? null,
        signal,
    });
    // Re-proportion the bloom after wireDiameterSlider applies the new size.
    dom_rng_diameter.addEventListener('input', updateBloomParams, { signal });

    // --- Frame rate ---
    let targetFPS = parseInt(dom_sel_framerate.value);
    dom_sel_framerate.addEventListener('change', () => {
        targetFPS = parseInt(dom_sel_framerate.value);
        animLoop.setTargetFPS(targetFPS);
    }, { signal });

    // --- Download handlers ---
    dom_btn_download_screenmap.addEventListener('click', () => {
        if (screenmap_pts.length === 0) {
            alert('No screenmap data available to download!');
            return;
        }
        const screenmap = {
            map: {
                strip1: {
                    x: screenmap_pts.map(pt => pt[0]),
                    y: screenmap_pts.map(pt => pt[1]),
                    diameter: 0.25,
                },
            },
        };
        const blob = new Blob([JSON.stringify(screenmap, null)], { type: 'application/json' });
        download_blob_as_file(blob, 'screenmap.json');
    }, { signal });

    dom_btn_download_video.addEventListener('click', () => {
        if (movie_frames.length === 0) {
            alert('No video data available to download!');
            return;
        }
        const totalLength = movie_frames.reduce((sum, frame) => sum + frame.length, 0);
        const videoData = new Uint8Array(totalLength);
        let offset = 0;
        movie_frames.forEach((frame) => {
            videoData.set(frame, offset);
            offset += frame.length;
        });
        const blob = new Blob([videoData], { type: 'application/octet-stream' });
        download_blob_as_file(blob, 'video.rgb');
    }, { signal });

    dom_btn_download_screenmap_16x16_serpentine.addEventListener('click', () => {
        fetch('/screenmaps/16x16_serpentine.json')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then((jsonData: unknown) => {
                const blob = new Blob([JSON.stringify(jsonData, null)], { type: 'application/json' });
                download_blob_as_file(blob, '16x16_serpentine.json');
            })
            .catch((error: unknown) => { console.error('Error loading 16x16 serpentine JSON:', error); });
    }, { signal });

    // Initialize diameter to 16 on load
    dom_rng_diameter.value = '16';
    dom_rng_diameter.dispatchEvent(new Event('input', { bubbles: true }));

    // --- Overlay drawing for LED connection visualization ---
    function drawOverlay() {
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (!showLines || screenmap_pts.length === 0) return;

        const pts = screenmap_pts;
        const isMultiStrip = stripInfo && stripInfo.strips.length > 1;

        if (isMultiStrip) {
            drawOverlayMultiStrip(pts);
        } else {
            drawOverlaySingleStrip(pts);
        }
    }

    function drawOverlaySingleStrip(pts: StripPoint[]) {
        // Connecting lines with rainbow colors
        overlayCtx.lineWidth = 2;
        for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i] ?? [0, 0];
            const [x2, y2] = pts[i + 1] ?? [0, 0];
            const hue = (120 + i * 2) % 360;
            overlayCtx.strokeStyle = `hsl(${String(hue)}, 100%, 50%)`;
            overlayCtx.beginPath();
            overlayCtx.moveTo(x1, y1);
            overlayCtx.lineTo(x2, y2);
            overlayCtx.stroke();

            if (i % 10 === 1 || i === pts.length - 2) {
                drawArrowHead(x1, y1, x2, y2);
            }
        }

        const pt0 = pts[0] ?? [0, 0];
        const pt1 = pts[1] ?? [0, 0];
        const ptLast = pts[pts.length - 1] ?? [0, 0];
        fillCircle(pt0[0], pt0[1], 8, 'rgba(0,255,0,1)');
        if (pts.length > 1) fillCircle(pt1[0], pt1[1], 6, 'rgba(0,255,0,0.5)');
        fillCircle(ptLast[0], ptLast[1], 8, 'rgba(255,0,0,1)');
        for (let i = 2; i < pts.length - 1; i++) {
            const pt = pts[i] ?? [0, 0];
            fillCircle(pt[0], pt[1], 4, 'rgba(255,255,255,0.5)');
        }

        const strip = (stripInfo?.strips[0]) ?? { name: '', count: pts.length };
        const labels = stripStartEndLabels(strip, 0);
        const items = [{ id: 'start:0', text: labels.start, anchorX: pt0[0], anchorY: pt0[1], color: 'rgba(0,255,0,1)', dotRadius: 4 }];
        if (labels.end) {
            items.push({ id: 'end:0', text: labels.end, anchorX: ptLast[0], anchorY: ptLast[1], color: 'rgba(255,0,0,1)', dotRadius: 4 });
        }
        drawLabelItems(items, pts);
    }

    function drawOverlayMultiStrip(pts: StripPoint[]) {
        if (!stripInfo) return;
        const strips = stripInfo.strips;
        const colors = getStripColors(strips.length);
        const labelItems: { id: string; text: string; anchorX: number; anchorY: number; color: string; dotRadius: number }[] = [];

        overlayCtx.lineWidth = 2;
        for (let s = 0; s < strips.length; s++) {
            const strip = strips[s];
            if (!strip) continue;
            // Skip empty strips and strips that fall outside the available points
            if (strip.count <= 0) continue;
            if (strip.offset >= pts.length) continue;
            const color = colors[s] ?? '#ffffff';
            overlayCtx.strokeStyle = color;

            const startIdx = strip.offset;
            const endIdx = Math.min(strip.offset + strip.count - 1, pts.length - 1);

            // Draw connection lines within this strip
            for (let i = startIdx; i < endIdx; i++) {
                const [x1, y1] = pts[i] ?? [0, 0];
                const [x2, y2] = pts[i + 1] ?? [0, 0];
                overlayCtx.beginPath();
                overlayCtx.moveTo(x1, y1);
                overlayCtx.lineTo(x2, y2);
                overlayCtx.stroke();

                const local = i - startIdx;
                if (local % 10 === 1 || i === endIdx - 1) {
                    drawArrowHead(x1, y1, x2, y2);
                }
            }

            // Draw LED circles for this strip
            const ptStart = pts[startIdx] ?? [0, 0];
            const ptEnd = pts[endIdx] ?? [0, 0];
            fillCircle(ptStart[0], ptStart[1], 8, color);
            if (endIdx > startIdx) {
                if (endIdx > startIdx + 1) {
                    const ptStart1 = pts[startIdx + 1] ?? [0, 0];
                    fillCircle(ptStart1[0], ptStart1[1], 6, color);
                }
                fillCircle(ptEnd[0], ptEnd[1], 8, color);
            }
            for (let i = startIdx + 2; i < endIdx; i++) {
                const pt = pts[i] ?? [0, 0];
                fillCircle(pt[0], pt[1], 4, color);
            }

            // Label start/end of each strip (single label for 1-LED strips)
            const labels = stripStartEndLabels({ name: strip.name, count: endIdx - startIdx + 1 }, s);
            labelItems.push({ id: `start:${String(s)}`, text: labels.start, anchorX: ptStart[0], anchorY: ptStart[1], color, dotRadius: 4 });
            if (labels.end) {
                labelItems.push({ id: `end:${String(s)}`, text: labels.end, anchorX: ptEnd[0], anchorY: ptEnd[1], color, dotRadius: 4 });
            }
        }
        drawLabelItems(labelItems, pts);
    }

    const labelRenderer = createLabelRenderer();

    function drawLabelItems(items: { id: string; text: string; anchorX: number; anchorY: number; color: string; dotRadius?: number }[], pts: StripPoint[]) {
        labelRenderer.draw(overlayCtx, items, {
            font: '12px sans-serif',
            textColor: 'white',
            bounds: { x: 0, y: 0, w: CANVAS_SIZE, h: CANVAS_SIZE },
            obstacles: () => pts.map(([x, y]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });
    }

    function drawArrowHead(x1: number, y1: number, x2: number, y2: number) {
        const dx = x2 - x1, dy = y2 - y1;
        const angle = Math.atan2(dy, dx);
        const t = 0.2;
        const ax = x1 + dx * t, ay = y1 + dy * t;
        overlayCtx.beginPath();
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
        overlayCtx.stroke();
    }

    function fillCircle(x: number, y: number, diameter: number, color: string) {
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, diameter / 2, 0, Math.PI * 2);
        overlayCtx.fill();
    }

    // --- Main render loop ---
    const animLoop = createAnimationLoop({
        targetFPS,
        onFrame() {
            if (screenmap_pts.length === 0) return;

            if (movie_frames.length && playing) {
                if (curr_frame_idx >= movie_frames.length) curr_frame_idx = 0;
                curr_frame = movie_frames[curr_frame_idx++] ?? null;
            } else {
                curr_frame = null;
            }

            if (curr_frame && colorAttribute) {
                const arr = colorAttribute.array as Float32Array;
                const count = screenmap_pts.length;
                for (let i = 0; i < count; i++) {
                    const i3 = i * 3;
                    arr[i3    ] = (curr_frame[i3    ] ?? 0) * INV_255;
                    arr[i3 + 1] = (curr_frame[i3 + 1] ?? 0) * INV_255;
                    arr[i3 + 2] = (curr_frame[i3 + 2] ?? 0) * INV_255;
                }
                colorAttribute.needsUpdate = true;
            }

            if (curr_frame) {
                // Conservative combination of the size-proportional range and
                // the density envelope: neither ceiling is exceeded, and the
                // floor stays strictly positive without rising above it.
                const effMax = Math.min(bloomRange.max, demoBloomRange.max);
                const effMin = Math.min(bloomRange.min, effMax);
                const override = demoAutoBloomEnabled ? null : demoManualBloomStrength;
                updateBloomIris(bloom.bloomPass, irisState, curr_frame, { min: effMin, max: effMax }, override);
            }
            bloom.render();
        },
    });

    // --- Initialize ---
    fetchAndLoadJSON();

    return function destroy() {
        ac.abort();
        animLoop.stop();
        if (videoReader) {
            void videoReader.cancel().catch((_e: unknown) => { /* ignore cancel errors */ });
        }
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry?.dispose();
            pointsMaterial?.dispose();
        }
        circleTexture.dispose();
        bloom.dispose();
        renderer.dispose();
    };
}
