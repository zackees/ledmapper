
// Global variables
let videoReader = null;
let videoBuffer = new Uint8Array();
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

// DOM elements
const dom_btn_play = document.getElementById("btn_play");
const dom_rng_diameter = document.getElementById("rng_diameter");
const dom_txt_curr_diameter = document.getElementById("txt_curr_diameter");
const dom_btn_download_screenmap = document.getElementById("btn_download_screenmap");
const dom_btn_download_video = document.getElementById("btn_download_video");
const dom_sel_framerate = document.getElementById("sel_framerate");

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
        console.error("Failed to load shape data");
        return;
    }
    shape_pts = transform_to_center_of_canvas(shape_pts, canvas.width, canvas.height);
    dom_btn_play.disabled = false;  // Enable the play button when shape is loaded
}

// Function to fetch and load the JSON file
function fetchAndLoadJSON() {
    fetch('screenmap.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(jsonBlob => {
            console.log("Shape data loaded successfully");
            load_shape_data(jsonBlob);
            fetchAndLoadVideo();
        })
        .catch(error => {
            console.error("Error loading JSON:", error);
            alert("Error loading screenmap.json. Please check the file path and try again.");
        });
}

async function fetchAndLoadVideo() {
    try {
        const response = await fetch('color_line_bubbles.rgb');
        if (!response.ok) throw new Error('Network response was not ok');
        if (!response.body) throw new Error('ReadableStream not supported');

        videoReader = response.body.getReader();
        streamVideoData();
    } catch (error) {
        console.error("Error loading video:", error);
        alert("Error loading color_line_bubbles.rgb. Please check the file path and try again.");
    }
}

async function streamVideoData() {
    try {
        while (true) {
            const {done, value} = await videoReader.read();
            
            if (done) {
                console.log("Finished streaming video data");
                break;
            }

            // Append new chunk to buffer
            const newBuffer = new Uint8Array(videoBuffer.length + value.length);
            newBuffer.set(videoBuffer);
            newBuffer.set(value, videoBuffer.length);
            videoBuffer = newBuffer;

            // Process complete frames from buffer
            const frameSize = shape_pts.length * 3;
            const completeFrames = Math.floor(videoBuffer.length / frameSize);
            
            if (completeFrames > 0) {
                const frameData = videoBuffer.slice(0, completeFrames * frameSize);
                processNewFrames(frameData);
                
                // Keep remaining incomplete frame data in buffer
                videoBuffer = videoBuffer.slice(completeFrames * frameSize);
            }
        }
    } catch (error) {
        console.error("Error streaming video:", error);
    }
}

function processNewFrames(frameData) {
    const frameSize = shape_pts.length * 3;
    const numNewFrames = frameData.length / frameSize;
    
    for (let i = 0; i < numNewFrames; i++) {
        const start = i * frameSize;
        const end = start + frameSize;
        const frame = frameData.slice(start, end);
        movie_frames.push(frame);
    }

    // Enable play button if this is our first frame
    if (movie_frames.length === numNewFrames) {
        dom_btn_play.disabled = false;
        set_dom_btn_play(false);
        dom_btn_play.click();
    }
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

dom_sel_framerate.onchange = () => {
    const fps = parseInt(dom_sel_framerate.value);
    frameRate(fps);
};

dom_btn_download_screenmap.onclick = () => {
    if (!shape_pts || shape_pts.length === 0) {
        alert("No shape data available to download!");
        return;
    }
    const screenmap = {
        map: {
            strip1: {
                x: shape_pts.map(pt => pt[0]),
                y: shape_pts.map(pt => pt[1]),
                diameter: 0.25
            }
        }
    };
    const blob = new Blob([JSON.stringify(screenmap, null, 2)], {type: 'application/json'});
    download_blob_as_file(blob, 'screenmap.json');
};

dom_btn_download_video.onclick = () => {
    if (!movie_frames || movie_frames.length === 0) {
        alert("No video data available to download!");
        return;
    }
    // Concatenate all frames into a single Uint8Array
    const totalLength = movie_frames.reduce((sum, frame) => sum + frame.length, 0);
    const videoData = new Uint8Array(totalLength);
    let offset = 0;
    movie_frames.forEach(frame => {
        videoData.set(frame, offset);
        offset += frame.length;
    });
    const blob = new Blob([videoData], {type: 'application/octet-stream'});
    download_blob_as_file(blob, 'video.rgb');
};


// Removed dom_btn_load_movie.onchange event listener

// The statements in the setup() function
// execute once when the program begins
function setup() {
  // createCanvas must be the first statement
  canvas = createCanvas(800, 800);
  stroke(255); // Set line drawing color to white
  frameRate(parseInt(dom_sel_framerate.value));
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
