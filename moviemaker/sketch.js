
const dom_btn_submit = document.getElementById("btn_submit");
const dom_ta_shape_input = document.getElementById("ta_shape_input");
const dom_btn_start_capture = document.getElementById("btn_start_capture");
const dom_btn_end_capture = document.getElementById("btn_end_capture");
const dom_btn_start_record = document.getElementById("btn_start_record");
const dom_btn_end_record = document.getElementById("btn_end_record");

// For performance reasons, we reduce the size of the movie.
const movie_hw_ratio = 0.5625
const movie_width = 1280 / 2;
const movie_height = Math.round(movie_width * movie_hw_ratio);
const frame_rate = 30;

let canvas;
let capture;
let shape_pts = [];
let color_frames = [];  // this is our output data.
let target_zoom = 1.;
let curr_zoom = target_zoom;
let curr_rotate = 0;
let target_rotate = 0;

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

let video_download_index = 0;

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

dom_btn_submit.onclick = () => {
    shape_pts = [];
    target_zoom = 1.;
    curr_zoom = target_zoom;
    curr_rotate = 0;
    target_rotate = 0;

    target_translate = [movie_width / 2, movie_height / 2];
    curr_translate = [movie_width / 2, movie_height / 2];

    shape_pts = parse_shape_data(dom_ta_shape_input.value);
    if (shape_pts.length == 0) {
        return;
    }
    shape_pts = transform_to_center2(shape_pts);
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
        target_rotate += event.delta > 0 ? incr : -incr;
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
        circle(x, y, led_size);
    }
    pop();
}

// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
let last_time = time_now();
function draw() {
    const now = time_now();
    const frame_time = now - last_time;
    const fps = Number.parseInt(1000 / frame_time);
    last_time = now;
    background(0); // Set the background to black
    update_shape_parameters();
    const transformed_pts = create_transformed_shape();
    if (capturing_active) {
        const color_pts = [];
        let img = capture.get();
        img.loadPixels();
        transformed_pts.forEach(([x, y]) => {
            x = Number.parseInt(x);
            y = Number.parseInt(y);
            const idx = (x + y * width) * 4;
            if (idx >= 0 && idx < img.pixels.length) {
                const r = img.pixels[idx + 0];
                const g = img.pixels[idx + 1];
                const b = img.pixels[idx + 2];
                color_pts.push(r);
                color_pts.push(g);
                color_pts.push(b);
            } else {
                color_pts.push(0);
                color_pts.push(0);
                color_pts.push(0);
            }
            return;
        });
        image(img, 0, 0, movie_width, movie_height);
        draw_output_pixels_rect(transformed_pts, color_pts);
        if (recording_active) {
            color_frames.push(color_pts);
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
    text(`fps: ${fps}`, 10, 10);
}
