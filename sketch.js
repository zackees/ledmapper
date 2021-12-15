let capture;
const cam_ratio = 2160 / 3480;
const dom_capture_width = document.getElementById("txt_capture_width");
const dom_chk_draw_video = document.getElementById("chk_draw_capture");
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
    createCanvas(width, width * cam_ratio);
    capture.size(width, width * cam_ratio);
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

function draw() {
    background(0);
    const capture_w = capture.width;
    const capture_h = capture.height;
    let img = capture.get();
    img.loadPixels();
    const max_brightness = 255 * 3;
    let histogram = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            const idx = (x + y * width) * 4;
            let r = img.pixels[idx];
            let b = img.pixels[idx + 1];
            let g = img.pixels[idx + 2];
            let a = img.pixels[idx + 3];
            const bri = r + b + g;
            const bucket_idx = Number.parseInt(bri / (max_brightness + 1) * histogram.length);
            histogram[bucket_idx] += 1;
            //if (bucket_idx < histogram.length - 2) {
            //	img.pixels[idx] = img.pixels[idx+1] = img.pixels[idx+2] = img.pixels[idx+3] = 0;
            //}
            //print(c);
        }
    }
    //document.getElementById("print").innerText = "" + histogram;
    //print(histogram);
    //img.updatePixels();
    image(img, 0, 0);
}