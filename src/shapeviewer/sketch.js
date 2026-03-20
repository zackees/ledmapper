import p5 from 'p5';
import { parse_shape_data } from '../common.js';
import { initNav } from '../nav.js';

initNav();

const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_txt_zoom = document.getElementById("txt_zoom");
const dom_slider_zoom = document.getElementById("slider_zoom");

// Synchronize zoom input and slider
function updateZoom(value) {
    value = parseFloat(value);
    value = isNaN(value) ? 1 : Math.max(0.1, Math.min(10, value));
    dom_txt_zoom.value = value.toFixed(1);
    dom_slider_zoom.value = value;
}

dom_txt_zoom.oninput = () => { updateZoom(dom_txt_zoom.value); };
dom_txt_zoom.onchange = () => { updateZoom(dom_txt_zoom.value); };
dom_slider_zoom.oninput = () => { updateZoom(dom_slider_zoom.value); };

let myCanvas;
let shape_pts = [];
let minX, minY, maxX, maxY;

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    if (shape_pts.length === 0) {
        return;
    }
    calculateBounds();
    shape_pts = center_and_fit(shape_pts, myCanvas.width, myCanvas.height);
}

// Center shape on its barycentric centroid (mean of all points) and
// scale uniformly so 100% of the shape fits within the display plane.
// Points are placed around (0,0) since draw() translates to canvas center.
function center_and_fit(pts, canvasW, canvasH) {
    const n = pts.length;
    let cx = 0, cy = 0;
    pts.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= n;
    cy /= n;

    // Center on barycentric centroid
    const centered = pts.map(([x, y]) => [x - cx, y - cy]);

    // Find max absolute extent from the centroid
    let maxAbsX = 0, maxAbsY = 0;
    centered.forEach(([x, y]) => {
        maxAbsX = Math.max(maxAbsX, Math.abs(x));
        maxAbsY = Math.max(maxAbsY, Math.abs(y));
    });

    // Scale to fit within 95% of the half-canvas on each axis
    const halfW = canvasW / 2;
    const halfH = canvasH / 2;
    const margin = 0.95;
    let scale = 1;
    if (maxAbsX > 0 && maxAbsY > 0) {
        scale = Math.min(halfW * margin / maxAbsX, halfH * margin / maxAbsY);
    } else if (maxAbsX > 0) {
        scale = halfW * margin / maxAbsX;
    } else if (maxAbsY > 0) {
        scale = halfH * margin / maxAbsY;
    }

    return centered.map(([x, y]) => [x * scale, y * scale]);
}

function calculateBounds() {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    shape_pts.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });
}

dom_btn_upload_shape.onchange = () => {
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
};

async function fetchScreenMap() {
    try {
        console.log("Fetching screen map");
        const response = await fetch('/demo/screenmap.json');
        const text = await response.text();
        load_shape_data(text);
    } catch (e) {
        console.log("No default screenmap found:", e);
    }
}

const sketch = (p) => {
    p.setup = () => {
        myCanvas = p.createCanvas(p.windowWidth * 0.9, p.windowHeight * 0.8);
        myCanvas.parent('main');
        p.strokeWeight(2);
        p.frameRate(60);
        fetchScreenMap();
    };

    p.draw = () => {
        p.background(18, 18, 18);

        if (shape_pts.length === 0) {
            p.fill(255);
            p.textAlign(p.CENTER, p.CENTER);
            p.textSize(24);
            p.text("Upload a shape file to begin", p.width / 2, p.height / 2);
            return;
        }

        const zoom = Number.parseFloat(dom_txt_zoom.value) || 1;
        const scaled_pts = [];
        shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });

        p.push();
        p.translate(p.width / 2, p.height / 2);

        // Draw grid
        drawGrid(p);

        // Draw shape
        drawShape(p, scaled_pts);

        // Draw points
        drawPoints(p, scaled_pts);

        // Draw labels
        drawLabels(p, scaled_pts);

        p.pop();

        // Draw info
        drawInfo(p);
    };

    p.windowResized = () => {
        p.resizeCanvas(p.windowWidth * 0.9, p.windowHeight * 0.8);
    };
};

function drawGrid(p) {
    p.stroke(50);
    p.strokeWeight(0.5);
    const gridSize = 50;
    for (let x = -p.width; x < p.width; x += gridSize) {
        p.line(x, -p.height, x, p.height);
    }
    for (let y = -p.height; y < p.height; y += gridSize) {
        p.line(-p.width, y, p.width, y);
    }
}

function drawShape(p, scaled_pts) {
    p.noFill();
    p.stroke(33, 150, 243);
    p.strokeWeight(2);
    p.beginShape();
    scaled_pts.forEach(([x, y]) => {
        p.vertex(x, y);
    });
    p.endShape(p.CLOSE);
}

function drawPoints(p, scaled_pts) {
    for (let i = 0; i < scaled_pts.length; ++i) {
        let r = 6;
        if (i === 0) {
            p.fill(76, 175, 80);
            r = 10;
        } else {
            p.fill(244, 67, 54);
        }
        const [x, y] = scaled_pts[i];
        p.circle(x, y, r);
    }
}

function drawLabels(p, scaled_pts) {
    p.fill(255);
    p.noStroke();
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(14);
    p.text('Start', scaled_pts[0][0] + 15, scaled_pts[0][1]);
}

function drawInfo(p) {
    p.fill(255);
    p.noStroke();
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(14);
    p.text(`Points: ${shape_pts.length}`, 10, 10);
    p.text(`Bounds: (${minX.toFixed(2)}, ${minY.toFixed(2)}) to (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`, 10, 30);
}

new p5(sketch);
