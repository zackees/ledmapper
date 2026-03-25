import { parse_screenmap_data, centerAndFitPoints, readFileAsText } from '../common.js';
import { saveScreenmap, getScreenmap } from '../screenmap-store.js';
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

    function load_screenmap_data(text) {
        screenmap_pts = parse_screenmap_data(text);
        dom_btn_load_movie.disabled = (screenmap_pts.length === 0);
        if (screenmap_pts.length === 0) return;
        saveScreenmap(text);
        screenmap_pts = centerAndFitPoints(screenmap_pts, CANVAS_SIZE, CANVAS_SIZE);
        buildPoints();
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        set_dom_btn_play(false);
        readFileAsText(dom_btn_upload_screenmap, load_screenmap_data);
    }, { signal });

    // Restore stored screenmap if available
    const storedScreenmap = getScreenmap();
    if (storedScreenmap) load_screenmap_data(storedScreenmap);

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
        set_dom_btn_play(false);
        const file = dom_btn_load_movie.files[0];
        file.arrayBuffer().then(load_movie_data);
    }, { signal });

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
