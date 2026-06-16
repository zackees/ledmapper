import { parse_screenmap_data_json, parseScreenmapMultiStrip, getStripColors, stripStartEndLabels, download_blob_as_file } from '../common';
import { createLabelRenderer } from '../label-render';
import { wireFileDropTarget, wireFilePicker, fileHasExtension } from '../drag-drop';
import { errorDialog } from '../ui/dialogs';
import { createGfx, wireBloomUi } from '../gfx';
import { resolveLedDiameter, computeFitScale } from '../bloom-utils';
import { parseRgbFrames, prependFledHeader } from '../render/rgb-video';
import type { MultiStripParseResult, StripPoint } from '../types/domain';
import templateHtml from './template.html?raw';
export { default as css } from './demo.css?url';

function qe<T extends HTMLElement>(container: ParentNode, sel: string, _cast?: (e: Element) => T): T {
    const el = container.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el as T;
}

// Trivial placeholder so `createGfx` can instantiate before the real
// screenmap is fetched. Replaced via `gfx.setScreenmap` on first load.
const PLACEHOLDER_SCREENMAP = {
    map: { strip1: { x: [0], y: [0], diameter: 0.25 } },
};

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

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

    // Overlay state
    let showLines = false;

    const ac = new AbortController();
    const { signal } = ac;

    const main = qe<HTMLElement>(container, 'main');

    // The gfx package owns the renderer, points mesh, bloom controller,
    // overlay canvas, and animation loop. The seed screenmap is a
    // single-point placeholder that's replaced as soon as the real
    // screenmap fetch lands.
    const gfx = createGfx({
        screenmap: PLACEHOLDER_SCREENMAP,
        parent: main,
        paneSize: CANVAS_SIZE,
        enableOverlay: true,
        showFps: true,
        signal,
    });
    if (!gfx.overlayCanvas || !gfx.overlayCtx) {
        throw new Error('demo: gfx overlay not provisioned');
    }
    const overlayCanvas = gfx.overlayCanvas;
    const overlayCtx = gfx.overlayCtx;
    const wrapper = gfx.wrapper;

    // Debug hook for the perf snapshot test (issue #160). Only attaches
    // under `?debug=stats` so production builds don't expose internals
    // to scrapers / extensions reading window properties.
    if (new URLSearchParams(window.location.search).get('debug') === 'stats') {
        (window as unknown as { __gfxStats?: () => ReturnType<typeof gfx.getStats> }).__gfxStats = () => gfx.getStats();
    }

    // Wire the auto/manual bloom UI to the gfx instance.
    wireBloomUi({
        gfx,
        chk: dom_chk_auto_bloom,
        slider: dom_rng_bloom_strength,
        sliderWrap: dom_bloom_strength_slider,
        label: dom_txt_bloom_strength,
        lsKey: 'ledmapper.demo.autoBloom',
        signal,
    });

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
        const threshold = Math.max(gfx.getDiameter(), 10);
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

    // --- Screenmap data loading ---
    function load_screenmap_data(jsonBlob: Record<string, unknown>) {
        const rawPts = parse_screenmap_data_json(jsonBlob);
        if (rawPts.length === 0) {
            console.error('Failed to load screenmap data');
            return;
        }
        screenmap_pts_original = rawPts.map(([x, y]) => [x, y] as StripPoint);
        gfx.setScreenmap(jsonBlob);
        // Mirror the renderer's centered/fitted points for overlay + hit-test.
        screenmap_pts = gfx.screenmap.points.map(([x, y]) => [x, y] as StripPoint);
        stripInfo = parseScreenmapMultiStrip(jsonBlob);
        applyScreenmapDiameter();
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
        const scale = computeFitScale(screenmap_pts_original, screenmap_pts);
        const px = Math.round(declared * scale);
        const min = parseInt(dom_rng_diameter.min) || 1;
        const max = parseInt(dom_rng_diameter.max) || 64;
        dom_rng_diameter.value = String(Math.min(Math.max(px, min), max));
        dom_rng_diameter.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function loadScreenmapFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            void errorDialog('Wrong file type', 'Please choose a .json screenmap file.');
            return;
        }
        void file.text().then((text: string) => {
            // A new screenmap invalidates frames sized for the old LED count.
            movie_frames.length = 0;
            curr_frame_idx = 0;
            set_dom_btn_play(false);
            load_screenmap_data(JSON.parse(text) as Record<string, unknown>);
        }).catch((error: unknown) => {
            void errorDialog('Error reading screenmap file', String(error));
        });
    }

    function loadMovieFile(file: File | null | undefined) {
        if (!file) return;
        if (!fileHasExtension(file, ['.fled'])) {
            void errorDialog('Wrong file type', 'Please choose a .fled video file.');
            return;
        }
        void file.arrayBuffer().then(load_movie_data).catch((error: unknown) => {
            void errorDialog('Error reading video file', String(error));
        });
    }

    function load_movie_data(arrayBuffer: ArrayBuffer) {
        if (screenmap_pts.length === 0) {
            void errorDialog('No screenmap loaded', 'Load a screenmap before loading a video.');
            return;
        }
        const uint8_array = new Uint8Array(arrayBuffer);
        const { frames, notMultiple } = parseRgbFrames(uint8_array, screenmap_pts.length);
        if (notMultiple) {
            void errorDialog('Frame size mismatch', 'Frame size should be a multiple of the number of screenmap points.');
            return;
        }
        movie_frames.length = 0;
        curr_frame_idx = 0;
        for (const frame of frames) movie_frames.push(frame);
        dom_btn_play.disabled = false;
        set_dom_btn_play(true);
    }

    wireFilePicker({ input: dom_btn_upload_screenmap, onFile: loadScreenmapFile, signal });
    wireFilePicker({ input: dom_btn_load_movie, onFile: loadMovieFile, signal });

    wireFileDropTarget({
        target: main,
        onFile: (file) => {
            if (!file) return;
            if (fileHasExtension(file, ['.json'])) {
                loadScreenmapFile(file);
            } else if (fileHasExtension(file, ['.fled'])) {
                loadMovieFile(file);
            } else {
                void errorDialog('Wrong file type', 'Please drop a .json screenmap or .fled video file.');
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

    // --- Video load ---
    // The .fled file is self-describing (header + embedded screenmap +
    // payload), so we fetch it once and let parseRgbFrames slice frames
    // against the screenmap's LED count.
    async function fetchAndLoadVideo() {
        try {
            const response = await fetch('/demo/video.fled');
            if (!response.ok) throw new Error('Network response was not ok');
            const buffer = await response.arrayBuffer();
            load_movie_data(buffer);
            set_dom_btn_play(false);
            dom_btn_play.click();
        } catch (error) {
            console.error('Error loading video:', error);
        }
    }

    // --- Play/Pause ---
    function set_dom_btn_play(on: boolean) {
        playing = on;
        dom_btn_play.value = playing ? 'Pause' : 'Play';
    }

    dom_btn_play.addEventListener('click', () => { set_dom_btn_play(!playing); }, { signal });

    // --- Frame pump --- drives gfx.pushFrame from movie_frames at the
    // user-selected playback FPS. The gfx package runs its own internal
    // render loop at a higher rate; we just hand it the latest frame.
    let frameRafId: number | null = null;
    let lastPump = 0;
    function pump(t: number) {
        frameRafId = requestAnimationFrame(pump);
        const interval = 1000 / Math.max(parseInt(dom_sel_framerate.value), 1);
        if (t - lastPump < interval) return;
        lastPump = t;
        if (screenmap_pts.length === 0) return;
        if (movie_frames.length && playing) {
            if (curr_frame_idx >= movie_frames.length) curr_frame_idx = 0;
            const frame = movie_frames[curr_frame_idx++];
            if (frame) gfx.pushFrame(frame);
        }
    }
    frameRafId = requestAnimationFrame(pump);

    // --- Diameter slider --- bind directly to gfx.setDiameter.
    dom_rng_diameter.addEventListener('input', () => {
        const px = parseInt(dom_rng_diameter.value) || 1;
        gfx.setDiameter(px);
        dom_txt_curr_diameter.textContent = String(px);
    }, { signal });

    // --- Frame rate selector --- frame pump reads the dropdown directly,
    // so we just need to refresh on change for any UI that depends on it.
    dom_sel_framerate.addEventListener('change', () => { /* read by pump() */ }, { signal });

    // --- Download handlers ---
    dom_btn_download_screenmap.addEventListener('click', () => {
        if (screenmap_pts.length === 0) {
            void errorDialog('Nothing to download', 'No screenmap data available.');
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
            void errorDialog('Nothing to download', 'No video data available.');
            return;
        }
        const totalLength = movie_frames.reduce((sum, frame) => sum + frame.length, 0);
        const videoData = new Uint8Array(totalLength);
        let offset = 0;
        movie_frames.forEach((frame) => {
            videoData.set(frame, offset);
            offset += frame.length;
        });
        // Wrap the raw payload with the FLED self-describing header so
        // the file is portable: it carries its own screenmap and can be
        // replayed anywhere without a side-channel screenmap.json.
        const screenmapJson = JSON.stringify({
            map: {
                strip1: {
                    x: screenmap_pts.map((pt) => pt[0]),
                    y: screenmap_pts.map((pt) => pt[1]),
                    diameter: 0.25,
                },
            },
        });
        const fledBytes = prependFledHeader(videoData, screenmapJson);
        const blob = new Blob([fledBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
        download_blob_as_file(blob, 'video.fled');
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
            if (strip.count <= 0) continue;
            if (strip.offset >= pts.length) continue;
            const color = colors[s] ?? '#ffffff';
            overlayCtx.strokeStyle = color;

            const startIdx = strip.offset;
            const endIdx = Math.min(strip.offset + strip.count - 1, pts.length - 1);

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

    // --- Initialize ---
    fetchAndLoadJSON();

    return function destroy() {
        if (frameRafId !== null) cancelAnimationFrame(frameRafId);
        ac.abort();
        gfx.dispose();
    };
}
