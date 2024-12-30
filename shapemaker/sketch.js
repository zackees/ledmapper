let capture;
let canvas;
let capture_width = 640;
let capture_height = 480;
const dom_capture_width = document.getElementById("txt_capture_width");
const dom_capture_height = document.getElementById("txt_capture_height");
const dom_btn_snapshot = document.getElementById("btn_snapshot");
const dom_btn_clear = document.getElementById("btn_clear");
const dom_btn_delete_last = document.getElementById("btn_delete_last");
const dom_btn_download = document.getElementById("btn_download");
const dom_txt_rotate = document.getElementById("txt_rotate");
const dom_txt_zoom = document.getElementById("txt_zoom");


const dom_txt_x_translate = document.getElementById("txt_x_translate");
const dom_txt_y_translate = document.getElementById("txt_y_translate");
//<label for="txt_x_translate">X Translate:</label>
//<input id="txt_x_translate" type="text" value="0"></input><br>

const circle_diameter = 8;

let points = []

function time_now() { return Date.now(); }
dom_btn_clear.onclick = () => {
    if (confirm("Delete all?")) {
        points = [];
    }
}
dom_btn_delete_last.onclick = () => { points.pop(); };
dom_btn_download.onclick = () => { downloadShape(); };

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

function downloadShape() {
    download_text_as_file(points_to_csv_str(), `shape.csv`);
    download_text_as_file(points_to_json_str(), `shape.json`);
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

function points_to_csv_str() {
    let s = "index,x,y\n";
    for (let i = 0; i < points.length; ++i) {
        [x,y] = points[i];
        s += `${i},${x},${y}\n`;
    }
    return s;
}

function points_to_json_str() {
    let json = {}
    json["map"] = {};
    json["map"]["strip1"] = {};
    json["map"]["strip1"]["x"] = [];
    json["map"]["strip1"]["y"] = [];
    json["map"]["strip1"]["diameter"] = 0.5;
    for (let i = 0; i < points.length; ++i) {
        [x,y] = points[i];
        json["map"]["strip1"]["x"].push(x);
        json["map"]["strip1"]["y"].push(y);
    }
    return JSON.stringify(json);
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
}

function setup_gfx() {
    if (capture) {
        capture.remove();
    }
    capture = createCapture(VIDEO);
    pixelDensity(1);  // Needed for retina displays.
    canvas = createCanvas(capture_width, capture_height);
    capture.size(capture_width, capture_height);
    capture.parent('captureContainer');
}

dom_capture_width.onchange = (evt) => {
    capture_width = Number.parseInt(evt.target.value);
    setup_gfx();
}

dom_capture_height.onchange = (evt) => {
    capture_height = Number.parseInt(evt.target.value);
    setup_gfx();
}

let img_snapshot;
dom_btn_snapshot.onclick = () => {
    img_snapshot = capture.get();
};

function setup() {
    capture_width = Number.parseInt(dom_capture_width.value);
    capture_height = Number.parseInt(dom_capture_height.value);
    setup_gfx();
}


let last_frame_time = time_now();
function draw() {
    const y_translate = Number.parseInt(dom_txt_y_translate.value) || 0;
    const x_translate = Number.parseInt(dom_txt_x_translate.value) || 0;
    dom_btn_download.disabled = !points.length;
    dom_btn_clear.disabled = !points.length;
    dom_btn_delete_last.disabled = !points.length;
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
    fill(color('red'));
    stroke(color('white'));
    for (let i = 1; i < points.length; ++i) {
      const [x0, y0] = points[i-1];
      const [x1, y1] = points[i];
      line(x0, y0, x1, y1);
    }
    points.forEach(([x,y]) => { circle(x, y, circle_diameter); });


    const diff_time = now - last_frame_time;
    last_frame_time = now;
}
