let capture;
let canvas;
const cam_ratio = 2160 / 3480;
const dom_capture_width = document.getElementById("txt_capture_width");
const dom_fps = document.getElementById("fps");
const dom_txtarea_capture_output = document.getElementById("txtarea_capture_output");
const dom_btn_snapshot = document.getElementById("btn_snapshot");
const dom_btn_clear = document.getElementById("btn_clear");
const dom_btn_delete_last = document.getElementById("btn_delete_last");
const dom_txt_rotate = document.getElementById("txt_rotate");
const dom_txt_zoom = document.getElementById("txt_zoom");

const dom_txt_x_translate = document.getElementById("txt_x_translate");
const dom_txt_y_translate = document.getElementById("txt_y_translate");
//<label for="txt_x_translate">X Translate:</label>
//<input id="txt_x_translate" type="text" value="0"></input><br>

const circle_diameter = 8;

let points = []

function time_now() { return Date.now(); }
dom_btn_clear.onclick = () => { points = []; }
dom_btn_delete_last.onclick = () => { points.pop(); };

let shift_active = false;
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

function mouseClicked() {
    let x = Number.parseInt(mouseX);
    let y = Number.parseInt(mouseY);
    if (x < 0 || y < 0) {
        return;
    }
    if (canvas) {
        if (x > canvas.width || y > canvas.height) {
            return;
        }
    }
    let idx = indexOfIntersectMostRecent(x, y, circle_diameter);
    if (shift_active) {
        if (idx !== -1) {
            // Remove.
            points.splice(idx, 1);
        }
    } else {
        if (idx === -1) {
            // No intersection so push.
            points.push([x,y]);
        }
    }
    let s = "index,x,y\n";
    for (let i = 0; i < points.length; ++i) {
        [x,y] = points[i];
        s += `${i},${x},${y}\n`;
    }
    dom_txtarea_capture_output.innerText = s;
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
}

dom_capture_width.onchange = (evt) => {
    const w = Number.parseInt(evt.target.value);
    console.log(evt.target.value);
    setup_gfx(w);
}

let img_snapshot;
dom_btn_snapshot.onclick = () => {
    img_snapshot = capture.get();
};

function setup() {
    const w = Number.parseInt(dom_capture_width.value);
    setup_gfx(w);
}


let last_frame_time = time_now();
function draw() {
    const y_translate = Number.parseInt(dom_txt_y_translate.value) || 0;
    const x_translate = Number.parseInt(dom_txt_x_translate.value) || 0;
    let zoom = Number.parseFloat(dom_txt_zoom.value) || 1.0;
    let r = Number.parseInt(dom_txt_rotate.value) || 0;
    const now = time_now();
    push();
    background(0);
    translate(canvas.width / 2, canvas.height / 2);
    rotate(radians(r));
    translate(-canvas.width / 2, -canvas.height / 2);
    scale(zoom);
    translate(x_translate, y_translate);
    if (img_snapshot) {
        image(img_snapshot,
              0, 0,
              img_snapshot.width, img_snapshot.height,
              0, 0,
              canvas.width, canvas.height);
    } else {
        const img = canvas.get();
        image(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
    }
    pop();

    let c = color('green');
    fill(c);
    points.forEach(([x,y]) => { circle(x, y, circle_diameter); });

    const diff_time = now - last_frame_time;
    last_frame_time = now;
    dom_fps.innerText = "fps: " + Number.parseFloat(1000 / diff_time, 2).toFixed(2);
}