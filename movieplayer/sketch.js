
const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_btn_load_movie = document.getElementById("btn_load_movie");
const dom_btn_play = document.getElementById("btn_play");

dom_btn_load_movie.disabled = true;
dom_btn_play.disabled = true;


let canvas;
let shape_pts = [];
let movie_frames = [];
let playing = false;

function parse_shape_data(text) {
    let out = [];
    text.split("\n").forEach((line) => {
        let d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseInt(d[0]);
        const y = Number.parseInt(d[1]);
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
        out.push([x,y]);
    });
    return out;
}

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    dom_btn_load_movie.disabled = shape_pts == 0;
    if (shape_pts.length == 0) {
        return;
    }
    // now format so that the entire thing is contained in the
    // canvas.
    const first_pt = shape_pts[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xmax = xmin;
    let ymax = ymin;
    let xavg = 0;
    let yavg = 0;
    shape_pts.forEach(([x,y]) => {
        xmin = min(x, xmin);
        ymin = min(y, ymin);
        xmax = max(x, xmax);
        ymax = max(y, ymax);
        xavg += x;
        yavg += y;
    });
    xavg /= shape_pts.length;
    yavg /= shape_pts.length;
    const width  = xmax - xmin;
    const height = ymax - ymin;
    const xscale = .8 * canvas.width / width;
    const yscale = .8 * canvas.height / height;
    const min_scale = yscale < xscale ? yscale : xscale;
    shape_pts.forEach((pt) => {
        // Add small offset so that the first point is near the
        // edge but not cut off down the middle.
        pt[0] -= xavg;
        pt[1] -= yavg;
        pt[0] *= min_scale;
        pt[1] *= min_scale;
        pt[0] += canvas.width / 2;
        pt[1] += canvas.height / 2;
    });
}

dom_btn_upload_shape.onchange = (evt) => {
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

dom_btn_play.onclick = (evt) => {
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
    let frames = [];
    const n_frames = num_pixels / shape_pts.length
    for (let i = 0; i < n_frames; ++i) {
        const start = i * shape_pts.length * 3;
        const end = (i+1) * shape_pts.length * 3;
        const frame = uint8_array.slice(start, end);
        frames.push(frame);
    }
    movie_frames = frames; 
}

dom_btn_load_movie.onchange = (evt) => {
    set_dom_btn_play(false);
    const file = dom_btn_load_movie.files[0];
    file.arrayBuffer().then(load_movie_data);
    //const reader = new FileReader();
    //reader.onload = (evt) => { load_movie_data(evt.target.result); };
    //reader.readAsArrayBuffer(file);
};

// The statements in the setup() function
// execute once when the program begins
function setup() {
  // createCanvas must be the first statement
  canvas = createCanvas(1000, 1000);
  stroke(255); // Set line drawing color to white
  frameRate(30);
}
// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
let curr_frame_idx = 0;
let curr_frame;
function draw() {
  background(0); // Set the background to black
  if (shape_pts.length == 0) {
      return;
  }
  //const zoom = Number.parseFloat(dom_txt_zoom.value) || 1.;
  const zoom = 1.0;
  let scaled_pts = [];
  shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });
  push();
  stroke(color('white'));
  if (movie_frames.length && playing) {
    if (curr_frame_idx >= movie_frames.length) {
        curr_frame_idx = 0;
      }
      curr_frame = movie_frames[curr_frame_idx++];
  } else {
    curr_frame = null;
  }
  for (let i = 0; i < scaled_pts.length; ++i) {
      let c = color(255, 255, 255, 0);
      if (curr_frame) {
        const r = curr_frame[i*3+0];
        const g = curr_frame[i*3+1];
        const b = curr_frame[i*3+2];
        c = color(r ,g, b, 255);
        noStroke();
      }
      fill(c);
      const [x, y] = scaled_pts[i];
      circle(x, y, 4);
  }
  pop();
}
