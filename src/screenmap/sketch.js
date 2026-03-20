import p5 from 'p5';
import { download_text_as_file } from '../common.js';
import { initNav } from '../nav.js';

// Expose p5 globally so its internal error handler can reference it
window.p5 = p5;

// Suppress autoplay restriction errors from p5's createCapture
const _origPlay = HTMLVideoElement.prototype.play;
HTMLVideoElement.prototype.play = function () {
    return _origPlay.call(this).catch(() => {});
};

initNav();

let capture;
let myCanvas;
let videoCheckInterval;
const capture_width = 480;
const capture_height = 480;
const dom_btn_snapshot = document.getElementById("btn_snapshot");
const dom_btn_clear = document.getElementById("btn_clear");
const dom_btn_delete_last = document.getElementById("btn_delete_last");
const dom_btn_download = document.getElementById("btn_download");
const dom_txt_rotate = document.getElementById("txt_rotate");
const dom_slider_rotate = document.getElementById("slider_rotate");
const dom_txt_zoom = document.getElementById("txt_zoom");
const dom_slider_zoom = document.getElementById("slider_zoom");

// Synchronize rotation input and slider
function updateRotation(value) {
    value = parseFloat(value);
    value = isNaN(value) ? 0 : Math.max(-180, Math.min(180, value));
    dom_txt_rotate.value = value.toFixed(1);
    dom_slider_rotate.value = value;
}

dom_txt_rotate.oninput = () => { updateRotation(dom_txt_rotate.value); };
dom_txt_rotate.onchange = () => { updateRotation(dom_txt_rotate.value); };
dom_slider_rotate.oninput = () => { updateRotation(dom_slider_rotate.value); };

// Synchronize zoom input and slider
function updateZoom(value) {
    value = parseFloat(value);
    value = isNaN(value) ? 1 : Math.max(1, Math.min(5, value));
    dom_txt_zoom.value = value.toFixed(2);
    dom_slider_zoom.value = value;
}

dom_txt_zoom.oninput = () => { updateZoom(dom_txt_zoom.value); };
dom_txt_zoom.onchange = () => { updateZoom(dom_txt_zoom.value); };
dom_slider_zoom.oninput = () => { updateZoom(dom_slider_zoom.value); };

const circle_diameter = 8;
let points = [];

function time_now() { return Date.now(); }

dom_btn_delete_last.onclick = () => { points.pop(); };
dom_btn_download.onclick = () => { downloadShape(); };

let shift_active = false;
document.onkeydown = (evt) => {
    if ("Shift" === evt.key) {
        shift_active = true;
    }
};

document.onkeyup = (evt) => {
    if ("Shift" === evt.key) {
        shift_active = false;
    }
};

function downloadShape() {
    const options = { type: 'application/json' };
    download_text_as_file(points_to_json_str(), `shape.json`, options);
}

function indexOfIntersectMostRecent(x, y, radius) {
    const radius2 = radius * radius;
    for (let i = points.length-1; i >= 0; --i) {
        const [xx, yy] = points[i];
        const dist2 = Math.pow(x-xx, 2) + Math.pow(y-yy, 2);
        if (dist2 < radius2) {
            return i;
        }
    }
    return -1;
}

function points_to_json_str() {
    const json = {
        map: {
            strip1: {
                x: points.map(([x]) => x),
                y: points.map(([, y]) => y),
                diameter: 0.5
            }
        }
    };
    return JSON.stringify(json);
}

function checkForVideo() {
    if (capture && capture.elt && capture.elt.readyState === 4) {
        console.log("Video dimensions:", {
            width: capture.width,
            height: capture.height,
            videoWidth: capture.elt.videoWidth,
            videoHeight: capture.elt.videoHeight
        });
        clearInterval(videoCheckInterval);
    }
}

let img_snapshot;
let pictureTaken = false;

function showPopup() {
    const popup = document.getElementById('popup');
    popup.style.display = 'block';
    setTimeout(() => { popup.style.opacity = '1'; }, 10);
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => { popup.style.display = 'none'; }, 500);
    }, 3000);
}

let last_frame_time = time_now();

const sketch = (p) => {
    function setup_gfx() {
        if (capture) {
            capture.remove();
        }
        const constraints = {
            video: {
                width: { ideal: capture_width },
                height: { ideal: capture_height }
            }
        };
        capture = p.createCapture(constraints);
        p.pixelDensity(1);
        myCanvas = p.createCanvas(p.windowWidth, p.windowHeight);
        capture.parent('captureContainer');
        capture.style('width', '100%');
        capture.style('height', '100%');
        capture.style('object-fit', 'cover');
        videoCheckInterval = setInterval(checkForVideo, 100);
    }

    dom_btn_snapshot.onclick = () => {
        img_snapshot = capture.get();
        pictureTaken = true;
        showPopup();
        dom_btn_snapshot.disabled = true;
    };

    dom_btn_clear.onclick = () => {
        if (confirm("Delete all?")) {
            points = [];
            img_snapshot = null;
            dom_btn_snapshot.disabled = false;
        }
    };

    p.setup = () => {
        setup_gfx();
        p.windowResized();

        const captureContainer = document.getElementById('captureContainer');
        captureContainer.addEventListener('mouseenter', () => {
            captureContainer.style.opacity = '0';
        });
        captureContainer.addEventListener('mouseleave', () => {
            captureContainer.style.opacity = '1';
        });
    };

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth, p.windowHeight);
    };

    p.mouseClicked = (event) => {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('#controls')) {
            return;
        }

        if (!pictureTaken) {
            alert("Please take a picture first before adding points.");
            return;
        }

        const x = Number.parseInt(p.mouseX);
        const y = Number.parseInt(p.mouseY);
        if (x < 0 || y < 0) {
            return;
        }
        if (myCanvas) {
            if (x > myCanvas.width || y > myCanvas.height) {
                return;
            }
        }
        const idx = indexOfIntersectMostRecent(x, y, circle_diameter);
        if (shift_active) {
            if (idx !== -1) {
                points.splice(idx, 1);
            }
        } else {
            if (idx === -1) {
                points.push([x, y]);
            }
        }
    };

    p.draw = () => {
        dom_btn_download.disabled = !points.length;
        dom_btn_clear.disabled = !pictureTaken;
        dom_btn_delete_last.disabled = !points.length;
        const zoom = Number.parseFloat(dom_txt_zoom.value) || 1.0;
        const r = Number.parseFloat(dom_txt_rotate.value) || 0;
        const now = time_now();

        p.push();
        p.background(0);

        const scaleFactor = Math.min(p.width / capture_width, p.height / capture_height);

        p.translate(p.width / 2, p.height / 2);
        p.rotate(p.radians(r));
        p.scale(scaleFactor * zoom);
        p.translate(-capture_width / 2, -capture_height / 2);

        if (img_snapshot) {
            p.image(img_snapshot, 0, 0, capture_width, capture_height);
        } else if (capture) {
            const img = capture.get();
            p.image(img, 0, 0, capture_width, capture_height);
        }
        p.pop();

        const c = p.color('green');
        p.fill(c);
        p.fill(p.color('red'));
        p.stroke(p.color('white'));
        for (let i = 1; i < points.length; ++i) {
            const [x0, y0] = points[i-1];
            const [x1, y1] = points[i];
            p.line(x0, y0, x1, y1);
        }
        points.forEach(([x,y]) => { p.circle(x, y, circle_diameter); });

        last_frame_time = now;
    };
};

new p5(sketch);
