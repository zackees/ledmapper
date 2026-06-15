import { parseScreenmapMultiStrip, centerAndFitPoints, getStripColors, stripStartEndLabels } from '../common';
import { createLabelRenderer } from '../label-render';
import { wireFileSource, fileHasExtension } from '../drag-drop';
import { saveVideo, getVideo, clearVideo } from '../video-store';
import { buildVideoChannelMap } from '../moviemaker/transforms';
import { createCircleTexture, createRendererAndScene, rebuildPointsMesh, wireDiameterSlider, createAnimationLoop } from '../three-utils';
import { createCanvasRecorder } from './canvas-recorder';
import { applyBloomGeometry } from '../render/bloom-geometry';
import { setupDemoStyleBloom } from '../render/demo-bloom-setup';
import { parseRgbFrames, hasFledMagic } from '../render/rgb-video';
import { BLOOM_RENDER_PX } from '../bloom-utils';
import type { ParsedStrip, RendererContextWithOverlay } from '../types/domain';
import type { BufferGeometry, PointsMaterial, Points, Float32BufferAttribute } from 'three';
import templateHtml from './template.html?raw';
export { default as css } from './movieplayer.css?url';

function qe<T extends HTMLElement>(parent: ParentNode, sel: string, _cast?: (e: Element) => T): T {
    const el = parent.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el as T;
}

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

    const dom_btn_load_movie = qe<HTMLInputElement>(container, '#btn_load_movie');
    const dom_btn_play = qe<HTMLInputElement>(container, '#btn_play');
    const dom_btn_record = qe<HTMLInputElement>(container, '#btn_record');
    const dom_rng_diameter = qe<HTMLInputElement>(container, '#rng_diameter');
    const dom_txt_curr_diameter = qe<HTMLElement>(container, '#txt_curr_diameter');
    const dom_movie_drop_target = qe<HTMLElement>(container, '#movie_drop_target');
    const dom_screenmap_status = qe<HTMLElement>(container, '#screenmap_status');
    const dom_chk_auto_bloom        = qe<HTMLInputElement>(container, '#chk_auto_bloom');
    const dom_bloom_strength_slider = qe<HTMLElement>(container, '#bloom_strength_slider');
    const dom_rng_bloom_strength    = qe<HTMLInputElement>(container, '#rng_bloom_strength');
    const dom_txt_bloom_strength    = qe<HTMLElement>(container, '#txt_curr_bloom_strength');

    dom_btn_play.disabled = true;

    const CANVAS_SIZE = 1000;

    let screenmap_pts: [number, number][] = [];
    let screenmap_strips: ParsedStrip[] = [];
    let videoChannelMap: Int32Array | null = null;
    let movie_frames: Uint8Array[] = [];
    let playing = false;
    let curr_frame_idx = 0;
    let curr_frame: Uint8Array | null = null;

    const INV_255 = 1 / 255;

    let pointsGeometry: BufferGeometry | undefined;
    let pointsMaterial: PointsMaterial | undefined;
    let pointsMesh: Points | undefined;
    let colorAttribute: Float32BufferAttribute | undefined;

    const circleTexture = createCircleTexture(64);

    const main = qe<HTMLElement>(container, 'main');
    const { renderer, scene, camera, wrapper, overlayCanvas, overlayCtx } = createRendererAndScene({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        parent: main,
        enableOverlay: true,
        renderPx: BLOOM_RENDER_PX,
        // Keep the backbuffer readable so the recorder can drawImage() the
        // rendered frame into its 1080p capture canvas.
        preserveDrawingBuffer: true,
    }) as RendererContextWithOverlay;
    // Labels only — let mouse events fall through to the renderer canvas.
    overlayCanvas.style.pointerEvents = 'none';

    const ac = new AbortController();
    const { signal } = ac;

    // Size the wrapper to the largest square that fits the available area so the
    // canvas never overflows the viewport vertically (issue #66). The drawing
    // buffer is fixed (BLOOM_RENDER_PX); only the CSS display size changes, so
    // downscaling stays crisp. Both canvases fill the wrapper at 100%.
    function fitWrapper() {
        const cs = getComputedStyle(main);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        // Bound the height by the viewport (main's top is fixed by the nav +
        // control bar above it, independent of the canvas) so the square can
        // never push the page taller than the viewport.
        const rectTop = main.getBoundingClientRect().top;
        const availW = main.clientWidth - padX;
        const availH = window.innerHeight - rectTop - padY;
        const size = Math.max(Math.floor(Math.min(availW, availH)), 1);
        wrapper.style.width = `${String(size)}px`;
        wrapper.style.height = `${String(size)}px`;
    }
    fitWrapper();
    const resizeObserver = new ResizeObserver(() => { fitWrapper(); });
    resizeObserver.observe(main);
    window.addEventListener('resize', fitWrapper, { signal });

    // Canvas-overlay play/pause button — the primary playback affordance. It is
    // shown only once a video is loaded and mirrors the playing state.
    const dom_btn_play_overlay = document.createElement('button');
    dom_btn_play_overlay.type = 'button';
    dom_btn_play_overlay.id = 'btn_play_overlay';
    dom_btn_play_overlay.className = 'play-overlay';
    dom_btn_play_overlay.setAttribute('aria-label', 'Play');
    dom_btn_play_overlay.hidden = true;
    wrapper.appendChild(dom_btn_play_overlay);

    // FastLED-style bloom via the shared setup helper (see issue #119).
    const bloom = setupDemoStyleBloom({
        renderer, scene, camera,
        paneSize: CANVAS_SIZE,
        chk: dom_chk_auto_bloom,
        slider: dom_rng_bloom_strength,
        sliderWrap: dom_bloom_strength_slider,
        label: dom_txt_bloom_strength,
        lsKey: 'ledmapper.movieplayer.autoBloom',
        signal,
    });
    const getDiameter = wireDiameterSlider({
        slider: dom_rng_diameter,
        label: dom_txt_curr_diameter,
        getMaterial: () => pointsMaterial ?? null,
        signal,
    });

    // Reproportion the bloom kernel + density envelope to the current geometry.
    function updateBloomGeometry() {
        if (!pointsMaterial) return;
        applyBloomGeometry(bloom, screenmap_pts, { ledPx: pointsMaterial.size, panePx: CANVAS_SIZE });
    }
    dom_rng_diameter.addEventListener('input', updateBloomGeometry, { signal });

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

    // Draw per-strip Start/End labels over the LED view. Multi-strip maps get
    // one color per strip (matching the moviemaker overlay); single-strip maps
    // use white. Redrawn only on screenmap load — positions are static.
    const labelRenderer = createLabelRenderer();

    function drawStripLabels() {
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (screenmap_strips.length === 0 || screenmap_pts.length === 0) return;
        const colors = screenmap_strips.length > 1
            ? getStripColors(screenmap_strips.length)
            : ['white'];
        const items: { id: string; text: string; anchorX: number; anchorY: number; color: string }[] = [];
        for (let si = 0; si < screenmap_strips.length; si++) {
            const strip = screenmap_strips[si];
            if (!strip) continue;
            const first = strip.offset;
            const last = strip.offset + strip.count - 1;
            if (strip.count === 0 || last >= screenmap_pts.length) continue;
            const { start, end } = stripStartEndLabels(strip, si);
            const ptFirst = screenmap_pts[first] ?? [0, 0];
            const ptLast = screenmap_pts[last] ?? [0, 0];
            items.push({ id: `start:${String(si)}`, text: start, anchorX: ptFirst[0], anchorY: ptFirst[1], color: colors[si] ?? 'white' });
            if (end !== null) {
                items.push({ id: `end:${String(si)}`, text: end, anchorX: ptLast[0], anchorY: ptLast[1], color: colors[si] ?? 'white' });
            }
        }
        labelRenderer.draw(overlayCtx, items, {
            font: 'bold 18px monospace',
            bounds: { x: 0, y: 0, w: CANVAS_SIZE, h: CANVAS_SIZE },
            obstacles: () => screenmap_pts.map(([x, y]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });
    }

    // Strip lines + Start/End markers are hidden during playback; they are
    // revealed only while the pointer is over the canvas (issue #66).
    let overlayHovered = false;
    function refreshStripOverlay() {
        if (overlayHovered) drawStripLabels();
        else overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    wrapper.addEventListener('mouseenter', () => { overlayHovered = true; refreshStripOverlay(); }, { signal });
    wrapper.addEventListener('mouseleave', () => { overlayHovered = false; refreshStripOverlay(); }, { signal });

    function setStatus(text: string, loaded: boolean) {
        dom_screenmap_status.textContent = text;
        dom_screenmap_status.classList.toggle('loaded', loaded);
    }

    /**
     * Apply a screenmap parsed from a FLED file's embedded JSON to the scene.
     * Returns false (and surfaces no UI) if the JSON couldn't be parsed —
     * caller decides how to report.
     */
    function applyEmbeddedScreenmap(jsonText: string): boolean {
        let parsed;
        try {
            parsed = parseScreenmapMultiStrip(jsonText);
        } catch (error) {
            console.error('Error parsing embedded screenmap:', error);
            return false;
        }
        if (parsed.allPoints.length === 0) return false;
        screenmap_strips = parsed.strips;
        videoChannelMap = buildVideoChannelMap(parsed.strips, parsed.totalCount);
        screenmap_pts = centerAndFitPoints(parsed.allPoints, CANVAS_SIZE, CANVAS_SIZE);
        buildPoints();
        updateBloomGeometry();
        refreshStripOverlay();
        return true;
    }

    function loadMovieFile(file: File | null | undefined) {
        if (!file) return;
        set_dom_btn_play(false);
        if (!fileHasExtension(file, ['.fled'])) {
            alert('Please choose a .fled video file (recorded by the Mapped Video Maker).');
            return;
        }
        void file.arrayBuffer().then((buf) => { load_movie_data(buf); }).catch((error: unknown) => {
            alert(`Error reading video file: ${String(error)}`);
        });
    }

    // On startup, restore any previously-loaded video from IndexedDB. Legacy
    // headerless blobs (pre-FLED) are dropped silently — this player only
    // accepts videos with an embedded screenmap.
    void getVideo().then((bytes) => {
        if (!bytes) return;
        if (!hasFledMagic(bytes)) {
            void clearVideo();
            return;
        }
        load_movie_data(bytes.slice().buffer, { persist: false, autoplay: false, silent: true });
    });

    function set_dom_btn_play(on: boolean) {
        playing = on;
        dom_btn_play.value = playing ? "Pause" : "Play";
        // The overlay button only appears once a video is loaded; it reflects
        // the playing state (pause icon while playing, play icon while paused).
        dom_btn_play_overlay.hidden = movie_frames.length === 0;
        dom_btn_play_overlay.classList.toggle('is-playing', playing);
        dom_btn_play_overlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    dom_btn_play.addEventListener('click', () => {
        set_dom_btn_play(!playing);
    }, { signal });

    dom_btn_play_overlay.addEventListener('click', () => {
        if (movie_frames.length === 0) return;
        set_dom_btn_play(!playing);
    }, { signal });

    // Native canvas recording (issue: video player canvas capture). Encoding
    // runs off the main thread via MediaRecorder + captureStream, so the render
    // loop does zero extra work per frame — recording on vs. off is identical.
    const recorder = createCanvasRecorder({
        canvas: renderer.domElement,
        fps: 60,
        onError: (m) => { alert(m); },
    });
    if (!recorder.isSupported) dom_btn_record.disabled = true;

    function set_dom_btn_record(on: boolean) {
        dom_btn_record.value = on ? 'Stop' : 'Record';
        dom_btn_record.classList.toggle('recording', on);
    }

    dom_btn_record.addEventListener('click', () => {
        set_dom_btn_record(recorder.toggle());
    }, { signal });

    function load_movie_data(array_buffer: ArrayBuffer, { persist = true, autoplay = true, silent = false } = {}) {
        const uint8_array = new Uint8Array(array_buffer);

        // Two-pass parse: (1) peek the header to extract embedded JSON, derive
        // ledCount from it, (2) re-slice frames against the derived ledCount.
        const peek = parseRgbFrames(uint8_array, 0);
        if (!peek.isFled || peek.embeddedJson === null) {
            if (silent) { void clearVideo(); return; }
            alert('This video has no embedded screenmap. Re-record with the latest Mapped Video Maker.');
            return;
        }
        if (peek.fledError !== null) {
            if (silent) { void clearVideo(); return; }
            alert(`Unsupported video file (${peek.fledError}).`);
            return;
        }
        if (!applyEmbeddedScreenmap(peek.embeddedJson)) {
            if (silent) { void clearVideo(); return; }
            alert('Embedded screenmap in this video is invalid or empty.');
            return;
        }

        const parsed = parseRgbFrames(uint8_array, screenmap_pts.length);
        if (parsed.notMultiple) {
            if (silent) { void clearVideo(); return; }
            alert('Video payload does not match the embedded screenmap — file may be corrupted.');
            return;
        }
        movie_frames = parsed.frames;
        curr_frame_idx = 0;
        dom_btn_play.disabled = false;
        if (persist) void saveVideo(uint8_array);
        setStatus(`${String(screenmap_pts.length)} LEDs · ${String(movie_frames.length)} frames`, true);
        set_dom_btn_play(false);
        if (autoplay) dom_btn_play.click();
    }

    wireFileSource({
        input: dom_btn_load_movie,
        target: dom_movie_drop_target,
        onFile: loadMovieFile,
        signal,
    });

    const animLoop = createAnimationLoop({
        targetFPS: 30,
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
                // LED i reads frame channel videoChannelMap[i] when the
                // screenmap declares explicit video_offsets; identity otherwise.
                for (let i = 0; i < count; i++) {
                    const i3 = i * 3;
                    const c3 = (videoChannelMap ? (videoChannelMap[i] ?? i) : i) * 3;
                    arr[i3    ] = (curr_frame[c3    ] ?? 0) * INV_255;
                    arr[i3 + 1] = (curr_frame[c3 + 1] ?? 0) * INV_255;
                    arr[i3 + 2] = (curr_frame[c3 + 2] ?? 0) * INV_255;
                }
                colorAttribute.needsUpdate = true;
            }

            if (curr_frame) {
                bloom.frame(curr_frame);
            }
            // Iris diameter modulation: dots open up on bright frames in sparse maps.
            if (pointsMaterial) pointsMaterial.size = getDiameter() * bloom.getDiameterScale();
            bloom.render();
            // Blit the freshly rendered frame into the recorder's 1080p capture
            // canvas (no-op when not recording). Done here, in the same tick as
            // the GL draw, so the backbuffer is still intact for drawImage.
            recorder.captureFrame();
        }
    });

    return function destroy() {
        ac.abort();
        recorder.stop();
        resizeObserver.disconnect();
        animLoop.stop();
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
