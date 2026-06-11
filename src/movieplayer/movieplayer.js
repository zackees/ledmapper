import { parse_screenmap_data, centerAndFitPoints } from '../common.js';
import { saveScreenmap, getScreenmap, savePresetSelection, getPresetSelection } from '../screenmap-store.js';
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
    let movie_frames = [];
    let playing = false;
    let curr_frame_idx = 0;
    let curr_frame;

    const INV_255 = 1 / 255;

    let pointsGeometry, pointsMaterial, pointsMesh;
    let colorAttribute;

    const circleTexture = createCircleTexture(64);

    const main = container.querySelector('main');
    const { renderer, scene, camera } = createRendererAndScene({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        parent: main,
    });

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

    function load_screenmap_data(text, { persist = true } = {}) {
        screenmap_pts = parse_screenmap_data(text);
        dom_btn_load_movie.disabled = (screenmap_pts.length === 0);
        if (screenmap_pts.length === 0) return;
        if (persist) saveScreenmap(text);
        screenmap_pts = centerAndFitPoints(screenmap_pts, CANVAS_SIZE, CANVAS_SIZE);
        buildPoints();
    }

    function fileHasExtension(file, extensions) {
        const name = file.name.toLowerCase();
        return extensions.some((extension) => name.endsWith(extension));
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

    function wireFileDropTarget({ target, input, onFile }) {
        target.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = input.disabled ? 'none' : 'copy';
            }
            if (!input.disabled) {
                target.classList.add('drag-over');
            }
        }, { signal });

        target.addEventListener('dragleave', () => {
            target.classList.remove('drag-over');
        }, { signal });

        target.addEventListener('drop', (event) => {
            event.preventDefault();
            target.classList.remove('drag-over');
            if (input.disabled) return;
            const file = event.dataTransfer?.files?.[0];
            onFile(file);
        }, { signal });
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
    });

    wireFileDropTarget({
        target: dom_movie_drop_target,
        input: dom_btn_load_movie,
        onFile: loadMovieFile,
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
                for (let i = 0; i < count; i++) {
                    const i3 = i * 3;
                    arr[i3    ] = curr_frame[i3    ] * INV_255;
                    arr[i3 + 1] = curr_frame[i3 + 1] * INV_255;
                    arr[i3 + 2] = curr_frame[i3 + 2] * INV_255;
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
