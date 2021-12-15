let capture;
let canvas;
const cam_ratio = 2160 / 3480;
const dom_capture_width = document.getElementById("txt_capture_width");
const dom_chk_draw_video = document.getElementById("chk_draw_capture");
const dom_fps = document.getElementById("fps");
const dom_btn_start_capture = document.getElementById("btn_start_capture");
const dom_btn_end_capture = document.getElementById("btn_end_capture");
const dom_txt_threshold = document.getElementById("txt_threshold");
const dom_txtarea_capture_output = document.getElementById("txtarea_capture_output");
const dom_txt_bottom_margin = document.getElementById("txt_bottom_margin");
const dom_txt_top_margin = document.getElementById("txt_top_margin");
const dom_txt_right_margin = document.getElementById("txt_right_margin");
const dom_txt_left_margin = document.getElementById("txt_left_margin");


let capturing = false;
dom_btn_start_capture.onclick = (evt) => {
    capturing = true;
};
dom_btn_end_capture.onclick = () => {
    capturing = false;
    let s = "sample,xcoord,ycoord\n";
    let i = 0;
    resolved_leds.forEach(([x,y]) => {
        s += i + "," + x + "," + y + "\n";
        i++;
    });
    dom_txtarea_capture_output.innerText = s;
};

dom_chk_draw_video.onchange = (evt) => {
    if (!capture) {
        return;
    }
    if (dom_chk_draw_video.checked) {
        capture.show();
    } else {
        capture.hide();
    }
}

function setup_gfx(width) {
    if (capture) {
        capture.remove();
    }
    capture = createCapture(VIDEO);
    pixelDensity(1);  // Needed for retina displays.
    const h = Number.parseInt(width * cam_ratio);
    canvas = createCanvas(width, h);
    capture.size(width, h);
    if (!dom_chk_draw_video.checked) {
        capture.hide();
    }
}

dom_capture_width.onchange = (evt) => {
    const w = Number.parseInt(evt.target.value);
    console.log(evt.target.value);
    setup_gfx(w);
}

function setup() {
    const w = Number.parseInt(dom_capture_width.value);
    setup_gfx(w);
}

function time_now() {
    return Date.now();
}

let resolved_leds = [];
let tmp_sample_buffer = [];
let last_frame_time = time_now();
let time_last_hit = time_now();
function draw() {
    const now = time_now();
    const bottom_margin = Number.parseInt(dom_txt_bottom_margin.value) || 0;
    const top_margin = Number.parseInt(dom_txt_top_margin.value) || 0;
    const left_margin = Number.parseInt(dom_txt_left_margin.value) || 0;
    const right_margin = Number.parseInt(dom_txt_right_margin.value) || 0;
    background(0);
    const capture_w = capture.width;
    const capture_h = capture.height;
    //print(capture.width, capture.height, width, width * cam_ratio);
    let img = capture.get();
    img.loadPixels();
    let hits = [];
    function is_valid(x,y) {
        if (x < 0 || y < 0) return false;
        if (x >= img.width || y >= img.height) return false;
        return true;
    }
    function get_blue(x,y) {
        const idx = (x + y * width) * 4;
        let b = img.pixels[idx + 2];
        return b;
    }

    const t = Number.parseInt(dom_txt_threshold.value);

    for (let y = top_margin; y < img.height - bottom_margin; y++) {
        for (let x = left_margin; x < img.width - right_margin; x++) {
            let b = get_blue(x, y);
            function above_threshold(x,y) {
                let b = get_blue(x,y);
                return b >= t;
            }
            function is_on_edge() {
                for (let xx = x-1; xx <= x+1; xx++) {
                    for (let yy = y-1; yy <= y+1; yy++) {
                        if (!is_valid(xx,yy)) {
                            return true;
                        }
                    }
                }
                return false;
            }

            function all_neighbors_are_also_above_threshold() {
                for (let xx = x-1; xx <= x+1; xx++) {
                    for (let yy = y-1; yy <= y+1; yy++) {
                        if (!is_valid(xx,yy)) {
                            return false;
                        } else {
                            let b = get_blue(xx,yy);
                            if (b < t) {
                                return false;
                            }
                        }
                    }
                }
                return true;
            }
            if (b >= t) {
                //img.pixels[idx] = img.pixels[idx+1] = img.pixels[idx+2] = img.pixels[idx+3] = 0;
                if (all_neighbors_are_also_above_threshold()) {
                    hits.push([x, y]);
                }
            }
        }
    }
    let x_hit_array = [];
    let y_hit_array = [];
    hits.forEach(([x,y]) => {
        x_hit_array.push(x);
        y_hit_array.push(y);
    });

    // Reduce hits to just one x,y representing the center point of the blob.
    if (x_hit_array.length > 0 && y_hit_array.length > 0) {
        x_hit_array.sort();
        y_hit_array.sort();
        let x_med = x_hit_array[Number.parseInt(x_hit_array.length / 2)];
        let y_med = y_hit_array[Number.parseInt(y_hit_array.length / 2)];
        hits = [[x_med, y_med]];
    } else {
        hits = [];
    }

    //print(hits);
    

    //document.getElementById("print").innerText = "" + histogram;
    //print(histogram);
    hits.forEach(([x,y]) => {
        for (let yy = 0; yy < img.height; yy++) {
            const idx = (x + yy * width) * 4;
            img.pixels[idx] = img.pixels[idx+1] = img.pixels[idx+2] = 255;
        }
        for (let xx = 0; xx < img.width; xx++) {
            const idx = (xx + y * width) * 4;
            img.pixels[idx] = img.pixels[idx+1] = img.pixels[idx+2] = 255;
        }
    });

    if (hits.length) {
        time_last_hit = now;
        tmp_sample_buffer.push([now, hits[0]]);
    } else if (now - time_last_hit > 500 && tmp_sample_buffer.length) {
        // Threshold hit, empty buffer and compute.
        if (tmp_sample_buffer.length < 3) {
            console.log("discarding small buffer");
            tmp_sample_buffer = [];
        } else {
            let xarray = [];
            let yarray = [];
            tmp_sample_buffer.forEach(([time, [x,y]]) => {
                xarray.push(x);
                yarray.push(y);
            });
            xarray.sort();
            yarray.sort();
            const xmed = xarray[Number.parseInt(xarray.length / 2)];
            const ymed = yarray[Number.parseInt(yarray.length / 2)];
            //console.log("sample: ", xmed, ymed);
            tmp_sample_buffer = [];
            if (capturing) {
                resolved_leds.push([xmed, ymed]);
            }
        }
    }    

    //print(resolved_leds);
    // Print out on screen.
    resolved_leds.forEach(([x,y]) => {
        const idx = (x + y * width) * 4;
        img.pixels[idx + 0] = 255;
        img.pixels[idx + 1] = 255;
        img.pixels[idx + 2] = 255;
        img.pixels[idx + 3] = 255;
    });

    img.updatePixels();
    image(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
    stroke("red");

    line(0, top_margin, canvas.width, top_margin);
    line(0, canvas.height-bottom_margin, canvas.width, canvas.height-bottom_margin);
    line(left_margin, 0, left_margin, canvas.height);
    line(canvas.width-right_margin, 0, canvas.width-right_margin, canvas.height);
    const diff_time = now - last_frame_time;
    last_frame_time = now;
    dom_fps.innerText = "fps: " + Number.parseFloat(1000 / diff_time, 2).toFixed(2);
}