let capture;
let canvas;
const capture_width = 640;
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

dom_txt_rotate.oninput = () => {
    updateRotation(dom_txt_rotate.value);
};

dom_txt_rotate.onchange = () => {
    updateRotation(dom_txt_rotate.value);
};

dom_slider_rotate.oninput = () => {
    updateRotation(dom_slider_rotate.value);
};

// Synchronize zoom input and slider
function updateZoom(value) {
    value = parseFloat(value);
    value = isNaN(value) ? 1 : Math.max(1, Math.min(5, value));
    dom_txt_zoom.value = value.toFixed(2);
    dom_slider_zoom.value = value;
}

dom_txt_zoom.oninput = () => {
    updateZoom(dom_txt_zoom.value);
};

dom_txt_zoom.onchange = () => {
    updateZoom(dom_txt_zoom.value);
};

dom_slider_zoom.oninput = () => {
    updateZoom(dom_slider_zoom.value);
};

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

function mouseClicked(event) {
    // Check if the click occurred on a button or within the controls div
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('#controls')) {
        // If it's a button or within controls, don't process the click for the canvas
        return;
    }

    if (!pictureTaken) {
        alert("Please take a picture first before adding points.");
        return;
    }

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
    canvas = createCanvas(windowWidth, windowHeight);
    capture.size(capture_width, capture_height);
    capture.parent('captureContainer');
    capture.style('width', '100%');
    capture.style('height', '100%');
    capture.style('object-fit', 'cover');
}


let img_snapshot;
let pictureTaken = false;
dom_btn_snapshot.onclick = () => {
    img_snapshot = capture.get();
    pictureTaken = true;
    showPopup();
    dom_btn_snapshot.disabled = true;
};

dom_btn_clear.onclick = () => {
    if (confirm("Delete all?")) {
        points = [];
        pictureTaken = false;
        img_snapshot = null;
        dom_btn_snapshot.disabled = false;
    }
}

function showPopup() {
    const popup = document.getElementById('popup');
    popup.style.display = 'block';
    setTimeout(() => {
        popup.style.opacity = '1';
    }, 10);
    setTimeout(() => {
        popup.style.opacity = '0';
        setTimeout(() => {
            popup.style.display = 'none';
        }, 500);
    }, 3000);
}

function setup() {
    setup_gfx();
    windowResized(); // Call this to set initial canvas size
    
    // Add event listeners for mouse enter and leave
    const captureContainer = document.getElementById('captureContainer');
    captureContainer.addEventListener('mouseenter', () => {
        captureContainer.style.opacity = '0';
    });
    captureContainer.addEventListener('mouseleave', () => {
        captureContainer.style.opacity = '1';
    });
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}


let last_frame_time = time_now();
function draw() {
    dom_btn_download.disabled = !points.length;
    dom_btn_clear.disabled = !pictureTaken;
    dom_btn_delete_last.disabled = !points.length;
    let zoom = Number.parseFloat(dom_txt_zoom.value) || 1.0;
    let r = Number.parseFloat(dom_txt_rotate.value) || 0;
    const now = time_now();
    
    push();
    background(0);
    
    // Calculate scaling factor to fit the content to the canvas
    let scaleFactor = min(width / capture_width, height / capture_height);
    
    translate(width / 2, height / 2);
    rotate(radians(r));
    scale(scaleFactor * zoom);
    translate(-capture_width / 2, -capture_height / 2);
    
    if (img_snapshot) {
        image(img_snapshot, 0, 0, capture_width, capture_height);
    } else {
        const img = capture.get();
        image(img, 0, 0, capture_width, capture_height);
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
