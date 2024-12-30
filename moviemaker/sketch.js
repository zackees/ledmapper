const dom_rng_rotation = document.getElementById("rng_rotation");

const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_btn_start_capture = document.getElementById("btn_start_capture");
const dom_btn_end_capture = document.getElementById("btn_end_capture");
const dom_btn_start_record = document.getElementById("btn_start_record");
const dom_btn_end_record = document.getElementById("btn_end_record");

const dom_rng_brightness = document.getElementById("rng_brightness");
const dom_txt_curr_bri = document.getElementById("txt_curr_bri");

const dom_rng_gamma = document.getElementById("rng_gamma");
const dom_txt_curr_gamma = document.getElementById("txt_curr_gamma");

const dom_rng_blur = document.getElementById("rng_blur");
const dom_rng_blur_sigma = document.getElementById("rng_blur_sigma");
const dom_chk_show_status = document.getElementById("chk_show_status");
const dom_rng_zoom = document.getElementById("rng_zoom");
const dom_txt_curr_zoom = document.getElementById("txt_curr_zoom");
const dom_btn_how_to = document.getElementById("btn_how_to");

// We try and capture at 30 fps.
const FRAME_TIME_US = 30 * 1000;

dom_btn_how_to.onclick = () => {
    Swal.fire({
        title: 'How to get the best video',
        text: 'Hello World',
        confirmButtonText: 'Got it!',
        didOpen: () => {
            console.log('Hello world');
        }
    });
};

// We'll set these variables dynamically when we start the capture
let movie_width;
let movie_height;
const frame_rate = 60;

let blurWorker = null;
let canvas;
let capture;
let shape_pts = [];
let gColorFrames = [];  // this is our output data.
let target_zoom = 1.;
let curr_zoom = target_zoom;
let curr_rotate = 0;
let target_rotate = 0;
let video_download_index = 0;

let target_translate = [movie_width / 2, movie_height / 2];
let curr_translate = [movie_width / 2, movie_height / 2];
let shift_active = false;
let capturing_active = false;
let recording_active = false;
// Allows quick rotation.
let shape_rotate_events = [];

// Function to update element states based on shape validity
function updateElementStates() {
    const elements = [
        dom_btn_start_capture,
        dom_btn_end_capture,
        dom_btn_start_record,
        dom_btn_end_record,
        dom_rng_rotation,
        dom_rng_brightness,
        dom_rng_gamma,
        dom_rng_blur,
        dom_rng_blur_sigma,
        dom_chk_show_status,
        dom_rng_zoom
    ];
    
    elements.forEach(element => {
        element.disabled = !shapeValid;
        const controlGroup = element.closest('.control-group');
        if (controlGroup) {
            controlGroup.classList.toggle('disabled', !shapeValid);
        }
    });

    // Special cases
    dom_btn_end_capture.disabled = !capturing_active || !shapeValid;
    dom_btn_start_record.disabled = !capturing_active || !shapeValid;
    dom_btn_end_record.disabled = !recording_active || !shapeValid;
    
    // Update control groups for special cases
    const specialCases = [dom_btn_end_capture, dom_btn_start_record, dom_btn_end_record];
    specialCases.forEach(element => {
        const controlGroup = element.closest('.control-group');
        if (controlGroup) {
            controlGroup.classList.toggle('disabled', element.disabled);
        }
    });
}

// Initial state
updateElementStates();

let g_recording = false;
let g_recording_start_time_us = 0;
let g_last_frame_idx = -1;

let radius = Number.parseInt(dom_rng_blur.value);
let sigma = Number.parseInt(dom_rng_blur_sigma.value);
let g_gausian_blur = new GaussianBlur(radius, sigma);
let g_frame_id = 0;

function time_now() { return Date.now(); }



function set_target_rotate(val) {
    target_rotate = Number.parseInt(val);
    document.getElementById("txt_curr_rotation").innerText = val;
};

dom_rng_rotation.oninput = () => {
    const v = dom_rng_rotation.value;
    set_target_rotate(v);
}

dom_rng_brightness.oninput = (evt) => {
    dom_txt_curr_bri.innerText = `${dom_rng_brightness.value}%`;
}

dom_rng_gamma.oninput = () => {
    const v = dom_rng_gamma.value / 10.;
    dom_txt_curr_gamma.innerText = `${v}`;
}

dom_btn_start_capture.onclick = () => {
    capturing_active = true;
    dom_btn_start_capture.disabled = true;
    dom_btn_end_capture.disabled = false;
    const constraints = {
        video: {},
        audio: false,
        optional: [
            {
                maxFrameRate: frame_rate,
                minFrameRate: frame_rate,
            }
        ]
    };
    capture = createCapture(constraints, function(stream) {
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        movie_width = settings.width;
        movie_height = settings.height;
        
        // Resize the canvas to match the capture dimensions
        resizeCanvas(movie_width, movie_height);
        
        // Update any UI elements that depend on canvas size
        updateUIForNewDimensions();
        
        capture.size(movie_width, movie_height);
        capture.hide(); // Hide the default video element
    });
    dom_btn_start_record.disabled = false;
};

dom_btn_end_capture.onclick = () => {
    capturing_active = false;
    recording_active = false;
    dom_btn_start_capture.disabled = false;
    dom_btn_end_capture.disabled = true;
    dom_btn_start_record.disabled = true;
    dom_btn_end_record.disabled = true;
    capture.remove();
};

dom_btn_start_record.onclick = () => {
    if (shape_pts.length < 2) {
        alert("Please load a valid shape first of size >= 2");
        return;
    }
    recording_active = true;
    dom_btn_start_record.disabled = true;
    dom_btn_end_record.disabled = false;
};


dom_rng_blur.oninput = () => {
    const v = dom_rng_blur.value;
    dom_rng_blur.value = v;
    document.getElementById("txt_curr_blur").innerText = v;
    updateGuassianBlur();
}


dom_rng_blur_sigma.oninput = () => {
    const v = dom_rng_blur_sigma.value;
    dom_rng_blur_sigma.value = v;
    document.getElementById("txt_curr_blur_sigma").innerText = v;
    updateGuassianBlur();
}

dom_rng_zoom.oninput = () => {
    const v = parseFloat(dom_rng_zoom.value).toFixed(1);
    dom_rng_zoom.value = v;
    dom_txt_curr_zoom.innerText = v;
    target_zoom = parseFloat(v);
}


dom_btn_end_record.onclick = () => {
    recording_active = false;
    dom_btn_end_record.disabled = true;
    dom_btn_start_record.disabled = false;
    //dom_btn_start_capture.disabled = true;
    //print(gColorFrames);

    let n = 0;
    gColorFrames.forEach((frame) => {
        frame.forEach((val) => {
            n++;
        });
    });

    let flat_uint8_array = new Uint8Array(n);
    let i = 0;
    gColorFrames.forEach((frame) => {
        if (i == 0) {
            console.log("frame.length: ", frame.length);
        }
        const n_pixels = frame.length / 3;
        if (n_pixels != shape_pts.length) {
            alert(`Assertion failed: frame.length(${n_pixels}) != (${shape_pts.length})shape_pts.length`)
            debugger;
        }
        frame.forEach((val) => {
            flat_uint8_array[i++] = val;
        });
    });
    download_binary_as_file(flat_uint8_array, `video${video_download_index}.rgb`);
    video_download_index++;
    gColorFrames = [];
}

document.onkeydown = (evt) => {
    if ("Shift" == evt.key) {
        shift_active = true;
    }
};

document.onkeyup = (evt) => {
    if ("Shift" == evt.key) {
        shift_active = false;
    }
};

let show_render_status = true;

dom_chk_show_status.onchange = (evt) => {
    const checked = dom_chk_show_status.checked;
    console.log("checked: ", checked);
    show_render_status = checked;
}

function transform_to_center2(shape_pts) {
    // now format so that the entire thing is contained in the
    // canvas.
    let out = [];
    shape_pts.forEach(([x,y]) => { out.push([x,y]); });
    const first_pt = out[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xavg = 0;
    let yavg = 0;
    out.forEach(([x, y]) => {
        xavg += x;
        yavg += y;
        if (x < xmin) { xmin = x; }
        if (y < ymin) { ymin = y; }
    });
    xavg /= shape_pts.length;
    yavg /= shape_pts.length;
    out.forEach((pt) => {
        // Add small offset so that the first point is near the
        // edge but not cut off down the middle.
        pt[0] = pt[0] - xavg;
        pt[1] = pt[1] - yavg;
    });
    return out;
}


function load_shape_data(data) {
    shape_pts = parse_shape_data(data);
    if (shape_pts.length === 0) {
        shapeValid = false;
    } else {
        shape_pts = transform_to_center2(shape_pts);
        shapeValid = true;
        
        // Reset transformation parameters
        target_zoom = 1;
        curr_zoom = 1;
        curr_rotate = 0;
        set_target_rotate(0);
        
        // Center the shape
        const canvasCenter = [width / 2, height / 2];
        target_translate = [...canvasCenter];
        curr_translate = [...canvasCenter];
    }
    updateElementStates();
}

dom_btn_upload_shape.onchange = (evt) => {
    shapeValid = false;
    updateElementStates();
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
};


function mouse_in_canvas_area() {
    // Return false if the mouse is outside the canvas.
    if (mouseY < 0 || mouseY > movie_height || mouseX < 0 || mouseX > movie_width) {
        return false;
    }
    // Return false if the mouse is on the scrollbar.
    if (mouseX >= document.documentElement.offsetWidth - canvas.canvas.offsetLeft) {
        return false;
    }
    return true;
}


function mouseWheel(event) {
    // Change the red value according
    // to the scroll delta value
    if (!mouse_in_canvas_area() || shape_pts.length === 0) {
        return true;
    }
    if (shift_active) {
        const now = time_now();
        let num_events = 0;
        shape_rotate_events.forEach((ts) => {
            if (now - ts < 250) {
                num_events++;
            }
        });
        let incr = num_events > 3 ? 4 : 1;
        set_target_rotate(target_rotate + event.delta > 0 ? incr : -incr);
        shape_rotate_events.push(now);
        while (shape_rotate_events.length > 10) {
            shape_rotate_events.splice(0, 1);
        }
        return false;
    }
    target_zoom -= event.delta / 10000;  // Typical scroll amount is 200.
    target_zoom = Math.max(Math.min(target_zoom, 30), 0.1);
    dom_rng_zoom.value = target_zoom.toFixed(1);
    dom_txt_curr_zoom.innerText = target_zoom.toFixed(1);
    return false;
}


// The statements in the setup() function
// execute once when the program begins
function setup() {
    // createCanvas must be the first statement
    pixelDensity(1);  // Needed for retina displays.
    canvas = createCanvas(640, 480); // Default size, will be updated later
    stroke(255); // Set line drawing color to white
    frameRate(frame_rate);
    initWorkers();
}

function updateUIForNewDimensions() {
    // Update any UI elements that depend on canvas size
    // For example, you might need to adjust the position of buttons or sliders
    // This function can be expanded as needed
}

function update_shape_parameters() {
    if (mouseIsPressed && mouse_in_canvas_area()) {
        target_translate[0] = mouseX;
        target_translate[1] = mouseY;
    }
    if (target_translate !== curr_translate) {
        const diff_x = target_translate[0] - curr_translate[0];
        const diff_y = target_translate[1] - curr_translate[1];
        if (Math.abs(diff_x) < .05) {
            curr_translate[0] = target_translate[0];
        } else {
            curr_translate[0] += diff_x * .05;
        }
        if (Math.abs(diff_y) < .05) {
            curr_translate[1] = target_translate[1];
        } else {
            curr_translate[1] += diff_y * .05;
        }
    }

    if (curr_zoom !== target_zoom) {
        const diff = target_zoom - curr_zoom;
        if (Math.abs(diff) < .00010) {
            curr_zoom = target_zoom;
        } else {
            curr_zoom += diff * .1;
        }
    }

    if (shape_pts.length == 0) {
        return;  // nothing left to draw
    }

    if (curr_rotate !== target_rotate) {
        const diff_r = target_rotate - curr_rotate;
        if (Math.abs(diff_r) < .05) {
            curr_rotate = target_rotate;
        } else {
            curr_rotate += diff_r * .1;
        }
    }
}

function create_transformed_shape() {
    if (shape_pts.length === 0) {
        return [];
    }
    // Deep copy.
    let transformed_pts = shape_pts.map(([x, y]) => [x, y]);
    
    if (curr_rotate !== 0) {
        const r = radians(curr_rotate);
        const cos_r = Math.cos(r);
        const sin_r = Math.sin(r);
        transformed_pts = transformed_pts.map(([x, y]) => {
            const xx = x * cos_r - y * sin_r;
            const yy = x * sin_r + y * cos_r;
            return [xx, yy];
        });
    }
    
    transformed_pts = transformed_pts.map(([x, y]) => [
        x * curr_zoom + curr_translate[0],
        y * curr_zoom + curr_translate[1]
    ]);
    
    return transformed_pts;
}

function draw_output_pixels_rect(transformed_pts, color_pts) {
    push();
    stroke(color('white'));
    let c = color('black');
    const side = 200;
    const width = side;
    const height = side;
    const left = movie_width - width;
    const top = movie_height - height;
    fill(c);
    rect(left, top, width, height);
    if (transformed_pts.length == 0) {
        return;
    }
    let xavg = 0;
    let yavg = 0;
    let xmin = Number.MAX_VALUE;
    let xmax = -Number.MAX_VALUE;
    let ymin = Number.MAX_VALUE;
    let ymax = -Number.MAX_VALUE;
    transformed_pts.forEach(([x, y]) => {
        xavg += x;
        yavg += y;
        xmin = min(x, xmin);
        ymin = min(y, ymin);
        xmax = max(x, xmax);
        ymax = max(y, ymax);
    });
    xavg = xavg / transformed_pts.length;
    yavg = yavg / transformed_pts.length;
    const xspan = xmax - xmin;
    const yspan = ymax - ymin;
    let factor = 1.0;
    if (xspan > 0 && yspan > 0) {
        factor = xspan > yspan ? width / xspan : height / yspan;
    }
    factor *= .8;  // center everything slightly.
    let pts = [];
    transformed_pts.forEach(([x, y]) => {
        let xx = x;
        let yy = y;
        xx -= xavg;
        yy -= yavg;
        xx = xx * factor + left + width / 2;
        yy = yy * factor + top + height / 2;
        pts.push([xx, yy]);
    });
    stroke(color(0, 0, 0, 0));
    const led_size = estimate_led_size(pts);
    for (let i = 0; i < pts.length; ++i) {
        const x = pts[i][0];
        const y = pts[i][1];
        const idx = i * 3;
        const r = color_pts[idx + 0];
        const g = color_pts[idx + 1];
        const b = color_pts[idx + 2];
        fill(color(r, g, b, 255));
        //circle(x, y, led_size);
        rect(x - led_size / 2, y - led_size / 2, led_size, led_size);
    }
    pop();
}

function timeMicros() {
    const timeInMicroseconds = performance.now() * 1000
    return Number.parseInt(timeInMicroseconds);
}

class OrderedMap {
    constructor() {
        this.map = new Map();
    }

    set(key, value) {
        this.map.set(key, value);
    }

    popLowestValue() {
        // pop it if it exists. else undefined
        const lowestKey = this.map.keys().next().value;
        if (lowestKey === undefined) {
            return null;
        }
        const lowestValue = this.map.get(lowestKey);
        if (lowestValue === undefined || lowestValue === null) {
            return null;
        }
        this.map.delete(lowestKey);
        return lowestValue;
    }

}


// list map of frameId = optional OutputFrame
let gFinishedFrames = new OrderedMap();

function initWorkers() {
    if (window.Worker) {
        blurWorker = new Worker('blurWorker.js');
    
        blurWorker.onmessage = function(e) {
            const data = e.data;
            const frameId = data.frameId;
            // console.log('Message received from worker:', data);
            gFinishedFrames.set(frameId, data);
        };
    
        blurWorker.onerror = function(e) {
            console.error('Error in worker:', e);
        };
    } else {
        alert('Your browser doesn\'t support web workers.');
    }
}



function getFrame(now_us) {
    const frame_idx = Number.parseInt((now_us - g_recording_start_time_us) / FRAME_TIME_US);
    return frame_idx;
}


function updateGuassianBlur() {
    radius = Number.parseInt(dom_rng_blur.value);
    sigma = Number.parseInt(dom_rng_blur_sigma.value);
    // g_gausian_blur = new GaussianBlur(radius, sigma);
    g_gausian_blur.set(radius, sigma);
}

let gLastProcessedFrame = null;

// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
let last_time = time_now();
function draw() {
    const frameId = g_frame_id;
    g_frame_id++;

    const bri_bias = Number.parseInt(dom_rng_brightness.value) / 100.;
    const now = time_now();
    const now_us = timeMicros();
    const frame_time = now - last_time;
    const fps = Number.parseInt(1000 / frame_time);
    last_time = now;
    background(0); // Set the background to black
    update_shape_parameters();
    const transformed_pts = create_transformed_shape();

    const gamm_val = dom_rng_gamma.value / 10.;
    if (capturing_active) {
        let img = capture.get();
        img.loadPixels();
        const blurContext = new BlurContext(
            frameId, now_us, img.pixels,
            bri_bias, gamm_val, width, height, transformed_pts,
            radius, sigma
        );
        blurWorker.postMessage({context: blurContext});
        image(img, 0, 0, width, height);
    }

    let processedFrames = []
    while (true) {
        const doneFrame = gFinishedFrames.popLowestValue();
        if (doneFrame === null) {
            break;
        }
        gLastProcessedFrame = doneFrame;
        processedFrames.push(doneFrame);
    }

    // Always draw the shape, regardless of capturing status
    noFill();
    stroke(color('white'));
    const led_size = estimate_led_size(transformed_pts);
    transformed_pts.forEach(([x, y]) => {
        circle(x, y, led_size);
    });

    if (show_render_status && gLastProcessedFrame) {
        const pts = gLastProcessedFrame.pts;
        const rgbPts = gLastProcessedFrame.rgbPts;
        draw_output_pixels_rect(pts, rgbPts);
    }

    if (processedFrames.length && recording_active) {
        if (!g_recording) {
            g_recording = true;
            g_recording_start_time_us = now_us;
        }
        for (let i = 0; i < processedFrames.length; ++i) {
            const doneFrame = processedFrames[i];
            const frame_idx = getFrame(doneFrame.frameTime);
            if (frame_idx > g_last_frame_idx) {
                g_last_frame_idx = frame_idx;
                gColorFrames.push(doneFrame.rgbPts);
            }
        }
    } else if (g_recording) {
        g_recording = false;
        const recording_time = timeMicros() - g_recording_start_time_us;
        console.log(`Recording time: ${recording_time} us`);
        g_last_frame_idx = -1;
    }

    stroke(0);
    fill(255);
    text(`FPS: ${fps}`, 10, 10);

    if (gLastProcessedFrame) {
        let averageBrightness = gLastProcessedFrame.averageBrightness;
        const pts = gLastProcessedFrame.pts;
        if (averageBrightness > 0.) {
            averageBrightness /= pts.length * 3;
            averageBrightness /= 255;
        }
        averageBrightness = Number.parseFloat(averageBrightness).toFixed(2);
        const perc_bri = Number.parseInt(averageBrightness * 100);
        text(`Avg Brightness: ${perc_bri}%`, 10, 20);
    }
}



// initWorkers();
