import { parseScreenmapMultiStrip, centerAndFitPoints, getStripColors, stripStartEndLabels } from '../common.js';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop.js';
import { saveScreenmap, getScreenmap, savePresetSelection, getPresetSelection } from '../screenmap-store.js';
import { buildVideoChannelMap } from '../moviemaker/transforms.js';
import { loadPresetText, loadPresetManifest } from '../preset-loader.js';
import { createCircleTexture, createRendererAndScene, rebuildPointsMesh, wireDiameterSlider, createAnimationLoop } from '../three-utils.js';
import templateHtml from './template.html?raw';
export { default as css } from './movieplayer.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    const dom_btn_upload_screenmap = container.querySelector("#btn_upload_screenmap");
    const dom_btn_load_movie = container.querySelector("#btn_load_movie");
    const dom_btn_play = container.querySelector("#btn_play");
    const dom_rng_diameter = container.querySelector("#rng_diameter");
    const dom_txt_curr_diameter = container.querySelector("#txt_curr_diameter");
    const dom_screenmap_drop_target = container.querySelector("#screenmap_drop_target");
    const dom_movie_drop_target = container.querySelector("#movie_drop_target");
    const dom_preset_buttons = container.querySelector("#preset_buttons");

    dom_btn_load_movie.disabled = true;
    dom_btn_play.disabled = true;

    const CANVAS_SIZE = 1000;

    let screenmap_pts = [];
    let screenmap_strips = [];
    let videoChannelMap = null;   // flat LED index -> .rgb channel index (null = identity)
    let movie_frames = [];
    let playing = false;
    let curr_frame_idx = 0;
    let curr_frame;

    const INV_255 = 1 / 255;

    let pointsGeometry, pointsMaterial, pointsMesh;
    let colorAttribute;

    const circleTexture = createCircleTexture(64);

    const main = container.querySelector('main');
    const { renderer, scene, camera, overlayCanvas, overlayCtx } = createRendererAndScene({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        parent: main,
        enableOverlay: true,
    });
    // Labels only — let mouse events fall through to the renderer canvas.
    overlayCanvas.style.pointerEvents = 'none';

    const ac = new AbortController();
    const { signal } = ac;

    const getDiameter = wireDiameterSlider({
        slider: dom_rng_diameter,
        label: dom_txt_curr_diameter,
        getMaterial: () => pointsMaterial,
        signal,
    });

    function buildPoints() {
        const previous = pointsMesh ? { mesh: pointsMesh, geometry: pointsGeometry, material: pointsMaterial } : null;
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
    function drawStripLabels() {
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (screenmap_strips.length === 0 || screenmap_pts.length === 0) return;
        const colors = screenmap_strips.length > 1
            ? getStripColors(screenmap_strips.length)
            : ['white'];
        overlayCtx.font = 'bold 18px monospace';
        overlayCtx.textAlign = 'left';
        overlayCtx.textBaseline = 'bottom';
        for (let si = 0; si < screenmap_strips.length; si++) {
            const strip = screenmap_strips[si];
            const first = strip.offset;
            const last = strip.offset + strip.count - 1;
            if (strip.count === 0 || last >= screenmap_pts.length) continue;
            const { start, end } = stripStartEndLabels(strip, si);
            const targets = [[start, screenmap_pts[first]]];
            if (end !== null) targets.push([end, screenmap_pts[last]]);
            for (const [text, [x, y]] of targets) {
                const lx = Math.min(x + 8, CANVAS_SIZE - 120);
                const ly = Math.max(y - 8, 20);
                overlayCtx.lineWidth = 4;
                overlayCtx.strokeStyle = 'black';
                overlayCtx.strokeText(text, lx, ly);
                overlayCtx.fillStyle = colors[si];
                overlayCtx.fillText(text, lx, ly);
            }
        }
    }

    function load_screenmap_data(text, { persist = true } = {}) {
        let parsed;
        try {
            parsed = parseScreenmapMultiStrip(text);
        } catch (error) {
            console.error('Error parsing screenmap:', error);
            if (persist) alert(`Error parsing screenmap: ${error}`);
            parsed = null;
        }
        screenmap_pts = parsed ? parsed.allPoints : [];
        screenmap_strips = parsed ? parsed.strips : [];
        videoChannelMap = parsed ? buildVideoChannelMap(parsed.strips, parsed.totalCount) : null;
        dom_btn_load_movie.disabled = (screenmap_pts.length === 0);
        if (screenmap_pts.length === 0) return;
        if (persist) saveScreenmap(text);
        screenmap_pts = centerAndFitPoints(screenmap_pts, CANVAS_SIZE, CANVAS_SIZE);
        buildPoints();
        drawStripLabels();
    }

    function loadScreenmapFile(file) {
        if (!file) return;
        set_dom_btn_play(false);
        if (!fileHasExtension(file, ['.json'])) {
            alert('Please choose a .json screenmap file.');
            return;
        }
        file.text().then((text) => {
            load_screenmap_data(text);
            markActivePreset(null);
        }).catch((error) => {
            alert(`Error reading screenmap file: ${error}`);
        });
    }

    function markActivePreset(presetFile) {
        dom_preset_buttons.querySelectorAll('.preset-btn').forEach((btn) => {
            btn.classList.toggle('active-preset', btn.dataset.presetFile === presetFile);
        });
    }

    async function selectPreset(presetFile) {
        set_dom_btn_play(false);
        try {
            const text = await loadPresetText(presetFile);
            load_screenmap_data(text);
            savePresetSelection(presetFile);
            markActivePreset(presetFile);
        } catch (error) {
            alert(`Error loading preset: ${error}`);
        }
    }

    async function initPresetButtons() {
        let presets;
        try {
            presets = await loadPresetManifest();
        } catch (error) {
            console.error('Failed to load screenmap preset manifest:', error);
            return;
        }
        for (const preset of presets) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-btn';
            btn.textContent = preset.name;
            btn.dataset.presetFile = preset.file;
            btn.addEventListener('click', () => selectPreset(preset.file), { signal });
            dom_preset_buttons.appendChild(btn);
        }
        const storedPreset = getPresetSelection();
        if (storedPreset) markActivePreset(storedPreset);
    }

    initPresetButtons();

    function loadMovieFile(file) {
        if (!file) return;
        set_dom_btn_play(false);
        if (!fileHasExtension(file, ['.rgb'])) {
            alert('Please choose a .rgb video file.');
            return;
        }
        file.arrayBuffer().then(load_movie_data).catch((error) => {
            alert(`Error reading video file: ${error}`);
        });
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        loadScreenmapFile(dom_btn_upload_screenmap.files[0]);
    }, { signal });

    // Restore stored screenmap if available (without re-persisting, which
    // would clear the stored preset selection)
    const storedScreenmap = getScreenmap();
    if (storedScreenmap) load_screenmap_data(storedScreenmap, { persist: false });

    function set_dom_btn_play(on) {
        playing = on;
        dom_btn_play.value = playing ? "Pause" : "Play";
    }

    dom_btn_play.addEventListener('click', () => {
        set_dom_btn_play(!playing);
    }, { signal });

    function load_movie_data(array_buffer) {
        const uint8_array = new Uint8Array(array_buffer);
        if (screenmap_pts.length === 0) {
            alert("No screenmap is loaded!");
            return;
        }
        const num_pixels = uint8_array.length / 3;
        if (num_pixels % screenmap_pts.length !== 0) {
            alert("Frame size should be a multiple of the number of screenmap points!");
            return;
        }
        dom_btn_play.disabled = false;
        set_dom_btn_play(false);
        const frames = [];
        const n_frames = num_pixels / screenmap_pts.length;
        for (let i = 0; i < n_frames; ++i) {
            const start = i * screenmap_pts.length * 3;
            const end = (i + 1) * screenmap_pts.length * 3;
            const frame = uint8_array.slice(start, end);
            frames.push(frame);
        }
        movie_frames = frames;
        dom_btn_play.click();
    }

    dom_btn_load_movie.addEventListener('change', () => {
        loadMovieFile(dom_btn_load_movie.files[0]);
    }, { signal });

    wireFileDropTarget({
        target: dom_screenmap_drop_target,
        input: dom_btn_upload_screenmap,
        onFile: loadScreenmapFile,
        signal,
    });

    wireFileDropTarget({
        target: dom_movie_drop_target,
        input: dom_btn_load_movie,
        onFile: loadMovieFile,
        signal,
    });

    const animLoop = createAnimationLoop({
        targetFPS: 30,
        onFrame() {
            if (screenmap_pts.length === 0) return;

            if (movie_frames.length && playing) {
                if (curr_frame_idx >= movie_frames.length) curr_frame_idx = 0;
                curr_frame = movie_frames[curr_frame_idx++];
            } else {
                curr_frame = null;
            }

            if (curr_frame && colorAttribute) {
                const arr = colorAttribute.array;
                const count = screenmap_pts.length;
                // LED i reads frame channel videoChannelMap[i] when the
                // screenmap declares explicit video_offsets; identity otherwise.
                for (let i = 0; i < count; i++) {
                    const i3 = i * 3;
                    const c3 = (videoChannelMap ? videoChannelMap[i] : i) * 3;
                    arr[i3    ] = curr_frame[c3    ] * INV_255;
                    arr[i3 + 1] = curr_frame[c3 + 1] * INV_255;
                    arr[i3 + 2] = curr_frame[c3 + 2] * INV_255;
                }
                colorAttribute.needsUpdate = true;
            }

            renderer.render(scene, camera);
        }
    });

    return function destroy() {
        ac.abort();
        animLoop.stop();
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry.dispose();
            pointsMaterial.dispose();
        }
        circleTexture.dispose();
        renderer.dispose();
    };
}
