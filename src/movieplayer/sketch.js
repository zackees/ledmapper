import { parse_shape_data, transform_to_center_of_canvas } from '../common.js';
import { createCircleTexture, createRendererAndScene, buildPointsMesh, createAnimationLoop } from '../three-utils.js';
import { initNav } from '../nav.js';

initNav();

const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_btn_load_movie = document.getElementById("btn_load_movie");
const dom_btn_play = document.getElementById("btn_play");
const dom_rng_diameter = document.getElementById("rng_diameter");
const dom_txt_curr_diameter = document.getElementById("txt_curr_diameter");

dom_btn_load_movie.disabled = true;
dom_btn_play.disabled = true;

const CANVAS_SIZE = 1000;
let ledDiameter = 6;

let shape_pts = [];
let movie_frames = [];
let playing = false;
let curr_frame_idx = 0;
let curr_frame;

// Pre-computed inverse for byte-to-float conversion
const INV_255 = 1 / 255;

// Three.js objects
let pointsGeometry, pointsMaterial, pointsMesh;
let colorAttribute;

const circleTexture = createCircleTexture(64);

const main = document.querySelector('main');
const { renderer, scene, camera } = createRendererAndScene({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    parent: main,
});

function updateDiameter() {
    ledDiameter = parseInt(dom_rng_diameter.value);
    dom_txt_curr_diameter.innerText = ledDiameter;
    if (pointsMaterial) {
        pointsMaterial.size = ledDiameter;
    }
}

dom_rng_diameter.addEventListener('input', updateDiameter);

function buildPoints() {
    if (pointsMesh) {
        scene.remove(pointsMesh);
        pointsGeometry.dispose();
        pointsMaterial.dispose();
    }

    const result = buildPointsMesh({
        points: shape_pts,
        circleTexture,
        diameter: ledDiameter,
    });

    pointsGeometry = result.geometry;
    pointsMaterial = result.material;
    pointsMesh = result.mesh;
    colorAttribute = result.colorAttribute;

    scene.add(pointsMesh);
}

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    dom_btn_load_movie.disabled = (shape_pts.length === 0);
    if (shape_pts.length === 0) return;
    shape_pts = transform_to_center_of_canvas(shape_pts, CANVAS_SIZE, CANVAS_SIZE);
    buildPoints();
}

dom_btn_upload_shape.onchange = () => {
    set_dom_btn_play(false);
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
};

function set_dom_btn_play(on) {
    playing = on;
    dom_btn_play.value = playing ? "Pause" : "Play";
}

dom_btn_play.onclick = () => {
    set_dom_btn_play(!playing);
};

function load_movie_data(array_buffer) {
    const uint8_array = new Uint8Array(array_buffer);
    if (shape_pts.length === 0) {
        alert("No shape is loaded!");
        return;
    }
    const num_pixels = uint8_array.length / 3;
    if (num_pixels % shape_pts.length !== 0) {
        alert("Frame size should be a multiple of the number of shape pts!");
        return;
    }
    dom_btn_play.disabled = false;
    set_dom_btn_play(false);
    const frames = [];
    const n_frames = num_pixels / shape_pts.length;
    for (let i = 0; i < n_frames; ++i) {
        const start = i * shape_pts.length * 3;
        const end = (i + 1) * shape_pts.length * 3;
        const frame = uint8_array.slice(start, end);
        frames.push(frame);
    }
    movie_frames = frames;
    dom_btn_play.click();
}

dom_btn_load_movie.onchange = () => {
    set_dom_btn_play(false);
    const file = dom_btn_load_movie.files[0];
    file.arrayBuffer().then(load_movie_data);
};

// --- Animation loop ---
createAnimationLoop({
    targetFPS: 30,
    onFrame() {
        if (shape_pts.length === 0) return;

        if (movie_frames.length && playing) {
            if (curr_frame_idx >= movie_frames.length) curr_frame_idx = 0;
            curr_frame = movie_frames[curr_frame_idx++];
        } else {
            curr_frame = null;
        }

        if (curr_frame && colorAttribute) {
            const arr = colorAttribute.array;
            const count = shape_pts.length;
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
