import p5 from 'p5';
import { parse_shape_data, transform_to_center_of_canvas } from '../common.js';
import { initNav } from '../nav.js';

initNav();

const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_btn_load_movie = document.getElementById("btn_load_movie");
const dom_btn_play = document.getElementById("btn_play");
const dom_rng_diameter = document.getElementById("rng_diameter");
const dom_txt_curr_diameter = document.getElementById("txt_curr_diameter");

dom_btn_load_movie.disabled = true;
dom_btn_play.disabled = true;

let ledDiameter = 6;

function updateDiameter() {
    ledDiameter = parseInt(dom_rng_diameter.value);
    dom_txt_curr_diameter.innerText = ledDiameter;
}

dom_rng_diameter.addEventListener('input', updateDiameter);
let shape_pts = [];
let movie_frames = [];
let playing = false;

let myCanvas;

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    dom_btn_load_movie.disabled = (shape_pts.length === 0);
    if (shape_pts.length === 0) {
        return;
    }
    shape_pts = transform_to_center_of_canvas(shape_pts, myCanvas.width, myCanvas.height);
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
        const end = (i+1) * shape_pts.length * 3;
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

let curr_frame_idx = 0;
let curr_frame;

const sketch = (p) => {
    p.setup = () => {
        myCanvas = p.createCanvas(1000, 1000);
        p.stroke(255);
        p.frameRate(30);
    };

    p.draw = () => {
        p.background(0);
        if (shape_pts.length === 0) {
            return;
        }
        const zoom = 1.0;
        const scaled_pts = [];
        shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });
        p.push();
        p.stroke(p.color('white'));
        if (movie_frames.length && playing) {
            if (curr_frame_idx >= movie_frames.length) {
                curr_frame_idx = 0;
            }
            curr_frame = movie_frames[curr_frame_idx++];
        } else {
            curr_frame = null;
        }
        for (let i = 0; i < scaled_pts.length; ++i) {
            let c = p.color(255, 255, 255, 0);
            if (curr_frame) {
                const r = curr_frame[i*3+0];
                const g = curr_frame[i*3+1];
                const b = curr_frame[i*3+2];
                c = p.color(r, g, b, 255);
                p.noStroke();
            }
            p.fill(c);
            const [x, y] = scaled_pts[i];
            p.circle(x, y, ledDiameter);
        }
        p.pop();
    };
};

new p5(sketch);
