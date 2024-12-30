
// Removed upload shape button
const dom_btn_play = document.getElementById("btn_play");
const dom_rng_diameter = document.getElementById("rng_diameter");
const dom_txt_curr_diameter = document.getElementById("txt_curr_diameter");

dom_btn_play.disabled = true;

let canvas;
let ledDiameter = 6;

// Function to update LED diameter
function updateDiameter() {
    ledDiameter = parseInt(dom_rng_diameter.value);
    dom_txt_curr_diameter.innerText = ledDiameter;
}

// Add event listener for diameter slider
dom_rng_diameter.addEventListener('input', updateDiameter);
let shape_pts = [];
let movie_frames = [];
let playing = false;


function load_shape_data(jsonBlob) {
    shape_pts = parse_shape_data_json(jsonBlob);
    if (shape_pts.length == 0) {
        return;
    }
    shape_pts = transform_to_center_of_canvas(shape_pts, canvas.width, canvas.height);
}

// Function to fetch and load the JSON file
function fetchAndLoadJSON() {
    fetch('/demo/screenmap.json')
        .then(response => response.json())
        .then(jsonBlob => {
            load_shape_data(jsonBlob);
            fetchAndLoadVideo();
        })
        .catch(error => {
            console.error("Error loading JSON:", error);
            alert("Error loading screenmap.json. Please check the file path and try again.");
        });
}

function fetchAndLoadVideo() {
    fetch('/demo/color_line_bubbles.rgb')
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => {
            load_movie_data(arrayBuffer);
        })
        .catch(error => {
            console.error("Error loading video:", error);
            alert("Error loading color_line_bubbles.rgb. Please check the file path and try again.");
        });
}

// Call the function when the page loads
window.onload = fetchAndLoadJSON;

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
    dom_btn_play.click();
}

// Removed dom_btn_load_movie.onchange event listener

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
      circle(x, y, ledDiameter);
  }
  pop();
}
