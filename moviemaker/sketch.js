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

// We try and capture at 30 fps.
const FRAME_TIME_US = 30 * 1000;

// For performance reasons, we reduce the size of the movie.
const movie_hw_ratio = 0.5625
const movie_width = 1280 / 2;
const movie_height = Math.round(movie_width * movie_hw_ratio);
const frame_rate = 60;

let blurWorker = null;
let canvas;
let capture;
let shape_pts = [];
let color_frames = [];  // this is our output data.
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

dom_btn_end_capture.disabled = true;
dom_btn_start_record.disabled = true;
dom_btn_end_record.disabled = true;

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
    capture = createCapture(constraints);
    capture.size(movie_width, movie_height);
    capture.hide();
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


dom_btn_end_record.onclick = () => {
    recording_active = false;
    dom_btn_end_record.disabled = true;
    dom_btn_start_record.disabled = false;
    //dom_btn_start_capture.disabled = true;
    //print(color_frames);

    let n = 0;
    color_frames.forEach((frame) => {
        frame.forEach((val) => {
            n++;
        });
    });

    let flat_uint8_array = new Uint8Array(n);
    let i = 0;
    color_frames.forEach((frame) => {
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
    download_binary_as_file(flat_uint8_array, `video${video_download_index}.dat`);
    video_download_index++;
    color_frames = [];
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
    shape_pts = [];
    target_zoom = 1.;
    curr_zoom = target_zoom;
    curr_rotate = 0;
    set_target_rotate(0);

    target_translate = [movie_width / 2, movie_height / 2];
    curr_translate = [movie_width / 2, movie_height / 2];

    shape_pts = parse_shape_data(data);
    if (shape_pts.length == 0) {
        return;
    }
    shape_pts = transform_to_center2(shape_pts);
}

dom_btn_upload_shape.onchange = (evt) => {
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
    target_zoom = Math.max(target_zoom, 0.05);
    return false;
}


// The statements in the setup() function
// execute once when the program begins
function setup() {
    // createCanvas must be the first statement
    pixelDensity(1);  // Needed for retina displays.
    canvas = createCanvas(movie_width, movie_height);
    stroke(255); // Set line drawing color to white
    frameRate(frame_rate);
    initWorkers();
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
    // Deep copy.
    let transformed_pts = [];
    shape_pts.forEach(([x, y]) => { transformed_pts.push([x, y]); });
    if (curr_rotate != 0) {
        // apply 2d rotation.
        transformed_pts.forEach((pt) => {
            const r = radians(curr_rotate);
            // get magnitude of said point.
            const mag = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
            if (mag == 0) {
                return;
            }
            // project point onto sphere.
            let x = pt[0] / mag;
            let y = pt[1] / mag;
            const cos_r = Math.cos(r);
            const sin_r = Math.sin(r);
            // Apply matrix rotation.
            const xx = x * cos_r + y * sin_r;
            const yy = -(x * sin_r) + y * cos_r;
            // Project back to real space from the unit sphere.
            pt[0] = xx * mag;
            pt[1] = yy * mag;
        });
    }
    transformed_pts.forEach((pt) => {
        pt[0] *= curr_zoom;
        pt[1] *= curr_zoom;
        pt[0] += curr_translate[0];
        pt[1] += curr_translate[1];
    });
    return transformed_pts;
}

function draw_output_pixels_rect(transformed_pts, color_pts) {
    push();
    stroke(color('white'));
    let c = color('black');
    const side = 200 * movie_width / 1280;
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

function initWorkers() {
    if (window.Worker) {
        blurWorker = new Worker('blurWorker.js');
    
        blurWorker.onmessage = function(e) {
            console.log('Message received from worker:', e.data);
        };
    
        blurWorker.onerror = function(e) {
            console.error('Error in worker:', e);
        };
    } else {
        alert('Your browser doesn\'t support web workers.');
    }
}



let g_recording = false;
let g_recording_start_time_us = 0;
let g_last_frame_idx = -1;

function getFrame(now_us) {
    const frame_idx = Number.parseInt((now_us - g_recording_start_time_us) / FRAME_TIME_US);
    return frame_idx;
}


let radius = Number.parseInt(dom_rng_blur.value);
let sigma = Number.parseInt(dom_rng_blur_sigma.value);
let g_gausian_blur = new GaussianBlur(radius, sigma);

function updateGuassianBlur() {
    radius = Number.parseInt(dom_rng_blur.value);
    sigma = Number.parseInt(dom_rng_blur_sigma.value);
    // g_gausian_blur = new GaussianBlur(radius, sigma);
    g_gausian_blur.set(radius, sigma);
}

function processPixels(pixels, gamm_val, bri_bias, transformed_pts, out_color_pts, avg_brightness, width, height, gausianBlur) {
    const gamma = (v_u8) => { return Math.pow(v_u8/255., gamm_val) * 255; };
    transformed_pts.forEach(([x, y]) => {
        x = Number.parseInt(x);
        y = Number.parseInt(y);
        const idx = (x + y * width) * 4;
        if (idx >= 0 && idx < pixels.length) {
            let [r, g, b] = gausianBlur.applyBlur(pixels, x, y, width, height);
            r = Number.parseInt(gamma(r) * bri_bias);
            g = Number.parseInt(gamma(g) * bri_bias);
            b = Number.parseInt(gamma(b) * bri_bias);
            out_color_pts.push(r);
            out_color_pts.push(g);
            out_color_pts.push(b);
            avg_brightness += r + b + g;
        } else {
            out_color_pts.push(0);
            out_color_pts.push(0);
            out_color_pts.push(0);
        }
        return;
    });
}


let g_frame_id = 0;

// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
let last_time = time_now();
function draw() {
    // blurWorker.postMessage('Hello, worker!');
    const frame_id = g_frame_id;
    g_frame_id++;

    const bri_bias = Number.parseInt(dom_rng_brightness.value) / 100.;
    let avg_brightness = 0.;
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
        image(capture, 0, 0, movie_width, movie_height);
        const color_pts = [];
        let img = capture.get();
        img.loadPixels();
        processPixels(
            img.pixels,
            gamm_val,
            bri_bias,
            transformed_pts,
            color_pts,
            avg_brightness,
            width,
            height,
            g_gausian_blur
        );
        const blurContext = new BlurContext(frame_id, g_gausian_blur, img.pixels);
        blurWorker.postMessage({context: blurContext});
        if (show_render_status) {
            draw_output_pixels_rect(transformed_pts, color_pts);
        }
        if (recording_active) {
            if (!g_recording) {
                g_recording = true;
                g_recording_start_time_us = now_us;
                //g_last_frame_idx = 0;
            }
            const frame_idx = getFrame(now_us);
            if (frame_idx > g_last_frame_idx) {
                //console.log(`frame_idx: ${frame_idx}`);
                g_last_frame_idx = frame_idx;
                color_frames.push(color_pts);
            }
        } else {
            if (g_recording) {
                g_recording = false;
                const recording_time = timeMicros() - g_recording_start_time_us;
                console.log(`Recording time: ${recording_time} us`);
                g_last_frame_idx = -1;
            }
        }
    }
    noFill();
    stroke(color('white'));
    // Draw points.
    const led_size = estimate_led_size(transformed_pts);
    //print("led_size: ", led_size);
    transformed_pts.forEach(([x, y]) => {
        circle(x, y, led_size);
    });
    stroke(0);
    fill(255);
    text(`FPS: ${fps}`, 10, 10);

    if (avg_brightness > 0.) {
        avg_brightness /= transformed_pts.length * 3;
        avg_brightness /= 255;
    }
    avg_brightness = Number.parseFloat(avg_brightness).toFixed(2);
    const perc_bri = Number.parseInt(avg_brightness * 100);
    text(`Avg Brightness: ${perc_bri}%`, 10, 20);
}



// initWorkers();