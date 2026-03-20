import {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    BufferGeometry,
    Float32BufferAttribute,
    LineSegments,
    LineBasicMaterial,
    LineLoop,
} from 'three';
import { parse_shape_data } from '../common.js';
import { createCircleTexture, buildPointsMesh } from '../three-utils.js';
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

let shape_pts = [];
let minX, minY, maxX, maxY;

// Three.js objects
let renderer, scene, camera;
let wrapper;
let pointsMesh, pointsGeometry, pointsMaterial;
const circleTexture = createCircleTexture(64);

// Grid line objects
let gridLines;
// Shape outline
let shapeOutline;

// DOM-based labels (no overlay canvas needed)
let startLabel, infoDiv, placeholderDiv;

function getCanvasSize() {
    return {
        width: Math.floor(window.innerWidth * 0.9),
        height: Math.floor(window.innerHeight * 0.8),
    };
}

function initRenderer() {
    const { width, height } = getCanvasSize();

    renderer = new WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x121212, 1);

    scene = new Scene();

    // Orthographic camera centered at (0,0) — points from center_and_fit are around (0,0)
    const hw = width / 2, hh = height / 2;
    camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
    camera.position.z = 1;

    const main = document.getElementById('main');
    wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = width + 'px';
    wrapper.style.margin = '0 auto';
    main.appendChild(wrapper);

    renderer.domElement.style.display = 'block';
    wrapper.appendChild(renderer.domElement);

    // DOM-based labels instead of overlay canvas
    const labelStyle = 'position:absolute;pointer-events:none;color:#fff;font:14px sans-serif;';

    startLabel = document.createElement('div');
    startLabel.style.cssText = labelStyle + 'display:none;';
    wrapper.appendChild(startLabel);

    infoDiv = document.createElement('div');
    infoDiv.style.cssText = labelStyle + 'top:10px;left:10px;font-size:14px;line-height:1.6;';
    wrapper.appendChild(infoDiv);

    placeholderDiv = document.createElement('div');
    placeholderDiv.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;color:#fff;font:24px sans-serif;';
    placeholderDiv.textContent = 'Upload a shape file to begin';
    wrapper.appendChild(placeholderDiv);

    buildGrid(width, height);
}

function buildGrid(width, height) {
    if (gridLines) {
        scene.remove(gridLines);
        gridLines.geometry.dispose();
        gridLines.material.dispose();
    }

    const hw = width / 2, hh = height / 2;
    const gridSize = 50;
    const vertices = [];

    for (let x = -Math.ceil(hw / gridSize) * gridSize; x <= hw; x += gridSize) {
        vertices.push(x, -hh, 0, x, hh, 0);
    }
    for (let y = -Math.ceil(hh / gridSize) * gridSize; y <= hh; y += gridSize) {
        vertices.push(-hw, y, 0, hw, y, 0);
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    gridLines = new LineSegments(geom, new LineBasicMaterial({ color: 0x323232 }));
    scene.add(gridLines);
}

function center_and_fit(pts, canvasW, canvasH) {
    const n = pts.length;
    let cx = 0, cy = 0;
    pts.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= n;
    cy /= n;

    const centered = pts.map(([x, y]) => [x - cx, y - cy]);

    let maxAbsX = 0, maxAbsY = 0;
    centered.forEach(([x, y]) => {
        maxAbsX = Math.max(maxAbsX, Math.abs(x));
        maxAbsY = Math.max(maxAbsY, Math.abs(y));
    });

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

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    if (shape_pts.length === 0) return;
    const { width, height } = getCanvasSize();
    calculateBounds();
    shape_pts = center_and_fit(shape_pts, width, height);
}

dom_btn_upload_shape.onchange = () => {
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
};

async function fetchScreenMap() {
    try {
        const response = await fetch('/demo/screenmap.json');
        const text = await response.text();
        load_shape_data(text);
    } catch (e) {
        console.log("No default screenmap found:", e);
    }
}

function buildShape(scaledPts) {
    // Clean up previous shape
    if (shapeOutline) {
        scene.remove(shapeOutline);
        shapeOutline.geometry.dispose();
        shapeOutline.material.dispose();
    }
    if (pointsMesh) {
        scene.remove(pointsMesh);
        pointsGeometry.dispose();
        pointsMaterial.dispose();
    }

    // Shape outline (closed loop)
    const lineVerts = [];
    scaledPts.forEach(([x, y]) => lineVerts.push(x, y, 0));
    const lineGeom = new BufferGeometry();
    lineGeom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
    shapeOutline = new LineLoop(lineGeom, new LineBasicMaterial({ color: 0x2196F3 }));
    scene.add(shapeOutline);

    // LED points — green for first, red for rest
    const result = buildPointsMesh({
        points: scaledPts,
        circleTexture,
        diameter: 6,
        defaultColor: [244 / 255, 67 / 255, 54 / 255],
    });

    // Override first point color to green
    const colorArr = result.colorAttribute.array;
    colorArr[0] = 76 / 255;
    colorArr[1] = 175 / 255;
    colorArr[2] = 80 / 255;
    result.colorAttribute.needsUpdate = true;

    pointsGeometry = result.geometry;
    pointsMaterial = result.material;
    pointsMesh = result.mesh;
    scene.add(pointsMesh);
}

function updateLabels(scaledPts) {
    if (scaledPts.length === 0) {
        placeholderDiv.style.display = '';
        startLabel.style.display = 'none';
        infoDiv.textContent = '';
        return;
    }

    placeholderDiv.style.display = 'none';

    // Position "Start" label relative to first point
    const { width, height } = getCanvasSize();
    const hw = width / 2, hh = height / 2;
    const sx = scaledPts[0][0] + hw + 15;
    const sy = scaledPts[0][1] + hh;
    startLabel.style.display = '';
    startLabel.style.left = sx + 'px';
    startLabel.style.top = sy + 'px';
    startLabel.textContent = 'Start';

    // Info text
    infoDiv.innerHTML = `Points: ${shape_pts.length}<br>Bounds: (${minX.toFixed(2)}, ${minY.toFixed(2)}) to (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`;
}

function handleResize() {
    const { width, height } = getCanvasSize();
    renderer.setSize(width, height);

    const hw = width / 2, hh = height / 2;
    camera.left = -hw;
    camera.right = hw;
    camera.top = -hh;
    camera.bottom = hh;
    camera.updateProjectionMatrix();

    wrapper.style.width = width + 'px';

    buildGrid(width, height);
}

window.addEventListener('resize', handleResize);

// --- Animation loop ---
function animate() {
    requestAnimationFrame(animate);

    const zoom = Number.parseFloat(dom_txt_zoom.value) || 1;

    if (shape_pts.length > 0) {
        const scaledPts = shape_pts.map(([x, y]) => [x * zoom, y * zoom]);
        buildShape(scaledPts);
        updateLabels(scaledPts);
    } else {
        if (shapeOutline) {
            scene.remove(shapeOutline);
            shapeOutline.geometry.dispose();
            shapeOutline.material.dispose();
            shapeOutline = null;
        }
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry.dispose();
            pointsMaterial.dispose();
            pointsMesh = null;
        }
        updateLabels([]);
    }

    renderer.render(scene, camera);
}

// --- Initialize ---
initRenderer();
fetchScreenMap();
requestAnimationFrame(animate);
