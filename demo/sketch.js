
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
const dom_chk_show_lines = document.getElementById("chk_show_lines");

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
            const { done, value } = await videoReader.read();

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
    const blob = new Blob([JSON.stringify(screenmap, null, 2)], { type: 'application/json' });
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
    const blob = new Blob([videoData], { type: 'application/octet-stream' });
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
    const zoom = 1.0;
    let scaled_pts = [];
    shape_pts.forEach(([x, y]) => { scaled_pts.push([x * zoom, y * zoom]); });
    push();

    // Draw the LED points first
    if (movie_frames.length && playing) {
        if (curr_frame_idx >= movie_frames.length) {
            curr_frame_idx = 0;
        }
        curr_frame = movie_frames[curr_frame_idx++];
    } else {
        curr_frame = null;
    }
    for (let i = 0; i < scaled_pts.length; ++i) {
        // Draw the LED color/animation
        let c = color(255, 255, 255, 0);
        if (curr_frame) {
            const r = curr_frame[i * 3 + 0];
            const g = curr_frame[i * 3 + 1];
            const b = curr_frame[i * 3 + 2];
            c = color(r, g, b, 255);
            noStroke();
        }
        fill(c);
        const [x, y] = scaled_pts[i];
        circle(x, y, ledDiameter);

        // Draw small dot at center of each LED
        if (dom_chk_show_lines.checked) {
            noStroke();
            if (i === 0 || i === 1) {
                fill(0, 255, 0, i === 0 ? 255 : 128); // Green for first LED
                circle(x, y, i == 0 ? 8 : 6); // Small 4-pixel radius dot
            } else if (i === scaled_pts.length - 1) {
                fill(255, 0, 0, 255); // Red for last LED
                circle(x, y, 8); // Same size as start LED
            } else {
                fill(255, 255, 255, 128); // Semi-transparent white
                circle(x, y, 4); // Small 4-pixel radius dot
            }
        }
    }

    let counter = 0;

    // Only draw lines if checkbox is checked
    if (dom_chk_show_lines.checked) {
        strokeWeight(2); // Thicker lines for better visibility

        // Function to draw an arrow at a point
        function drawArrow(x, y, angle) {
            push();
            translate(x, y);
            rotate(angle);
            // Draw the arrow head
            line(0, 0, -8, -4);
            line(0, 0, -8, 4);
            pop();
        }
        
        for (let i = 0; i < scaled_pts.length - 1; i++) {
            const doDrawArray = i % 10 === 1;
            const [x1, y1] = scaled_pts[i];
            const [x2, y2] = scaled_pts[i + 1];
            
            // Calculate hue based on position in sequence, starting from green (120)
            const hue = (120 + i * 2) % 360;
            stroke(color(`hsl(${hue}, 100%, 50%)`));
            
            // Draw the main line
            line(x1, y1, x2, y2);
            
            if (doDrawArray) {
                const dx = x2 - x1;
                const dy = y2 - y1;
                const angle = Math.atan2(dy, dx);
                const t = 0.2; // Draw arrow 20% along the line
                const arrowX = x1 + dx * t;
                const arrowY = y1 + dy * t;
                drawArrow(arrowX, arrowY, angle);
            }
        }
        
        // Connect last point to first point
        const [firstX, firstY] = scaled_pts[0];
        const [lastX, lastY] = scaled_pts[scaled_pts.length - 1];
        const finalHue = (120 + scaled_pts.length * 2) % 360;
        stroke(color(`hsl(${finalHue}, 100%, 50%)`));
        line(lastX, lastY, firstX, firstY);
        
        // Add "Start LED" text near the first LED with thick black outline
        const [startX, startY] = scaled_pts[0];
        textSize(12);
        textAlign(LEFT, CENTER);
        
        // Draw thick black outline
        noStroke();
        fill(0); // Black
        // Outer ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i) * 2;
            const dy = sin(i) * 2;
            text("Start LED", startX + 4 + dx, startY + dy);
        }
        // Middle ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i) * 1.5;
            const dy = sin(i) * 1.5;
            text("Start LED", startX + 4 + dx, startY + dy);
        }
        // Inner ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i);
            const dy = sin(i);
            text("Start LED", startX + 4 + dx, startY + dy);
        }
        
        // Draw white text on top
        fill(255); // White text
        text("Start LED", startX + 4, startY);

        // Add "End LED" text near the last LED with thick black outline
        const [endX, endY] = scaled_pts[scaled_pts.length - 1];
        textSize(12);
        textAlign(LEFT, CENTER);
        
        // Draw thick black outline
        noStroke();
        fill(0); // Black
        // Outer ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i) * 2;
            const dy = sin(i) * 2;
            text("End LED", endX + 4 + dx, endY + dy);
        }
        // Middle ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i) * 1.5;
            const dy = sin(i) * 1.5;
            text("End LED", endX + 4 + dx, endY + dy);
        }
        // Inner ring
        for (let i = 0; i < 360; i += 45) {
            const dx = cos(i);
            const dy = sin(i);
            text("End LED", endX + 4 + dx, endY + dy);
        }
        
        // Draw white text on top
        fill(255); // White text
        text("End LED", endX + 4, endY);
    }


    pop();
}
