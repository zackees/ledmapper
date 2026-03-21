import {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    BufferGeometry,
    Float32BufferAttribute,
    LineSegments,
    LineBasicMaterial,
    Line,
} from 'three';
import { parse_shape_data, centerAndFitPoints, readFileAsText, download_text_as_file } from '../common.js';
import { createCircleTexture, buildPointsMesh } from '../three-utils.js';
import templateHtml from './template.html?raw';
export { default as css } from './shapeeditor.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    const dom_btn_upload_shape = container.querySelector("#btn_upload_shape");
    const dom_sel_preset = container.querySelector("#sel_preset");
    const dom_rng_scale = container.querySelector("#rng_scale");
    const dom_txt_scale = container.querySelector("#txt_scale");
    const dom_rng_scale_x = container.querySelector("#rng_scale_x");
    const dom_txt_scale_x = container.querySelector("#txt_scale_x");
    const dom_rng_scale_y = container.querySelector("#rng_scale_y");
    const dom_txt_scale_y = container.querySelector("#txt_scale_y");
    const dom_rng_rotate = container.querySelector("#rng_rotate");
    const dom_txt_rotate = container.querySelector("#txt_rotate");
    const dom_chk_flip_h = container.querySelector("#chk_flip_h");
    const dom_chk_flip_v = container.querySelector("#chk_flip_v");
    const dom_btn_save = container.querySelector("#btn_save_as");

    const ac = new AbortController();
    const { signal } = ac;

    // ── Save As ────────────────────────────────────────────────────────────

    function saveAs() {
        if (rawPts.length === 0) return;

        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const flipH = dom_chk_flip_h.checked ? -1 : 1;
        const flipV = dom_chk_flip_v.checked ? -1 : 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal * flipH;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal * flipV;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);

        const xArr = [];
        const yArr = [];
        rawPts.forEach(([x, y]) => {
            const rx = x * sX;
            const ry = y * sY;
            xArr.push(+(rx * cosR - ry * sinR).toFixed(4));
            yArr.push(+(rx * sinR + ry * cosR).toFixed(4));
        });

        // Estimate diameter from first two transformed points
        let diameter = 0.25;
        if (xArr.length >= 2) {
            const dx = xArr[1] - xArr[0];
            const dy = yArr[1] - yArr[0];
            diameter = +Math.max(Math.sqrt(dx * dx + dy * dy), 0.01).toFixed(4);
        }

        const json = JSON.stringify({
            map: { strip1: { x: xArr, y: yArr, diameter } }
        }, null, 2);

        download_text_as_file(json, 'screenmap.json', { type: 'application/json' });
    }

    dom_btn_save.addEventListener('click', saveAs, { signal });

    // ── Quadratic slider mapping ─────────────────────────────────────────

    const SCALE_MIN = 0.1;
    const SCALE_MAX = 10;
    const SLIDER_MAX = 1000;

    function sliderToScale(sliderVal) {
        const t = sliderVal / SLIDER_MAX;
        return SCALE_MIN + t * t * (SCALE_MAX - SCALE_MIN);
    }

    function scaleToSlider(scale) {
        const t = Math.sqrt((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN));
        return Math.round(t * SLIDER_MAX);
    }

    function clampScale(v) {
        v = parseFloat(v);
        return isNaN(v) ? 1 : Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
    }

    // ── Scale helpers ────────────────────────────────────────────────────

    function writeScale(rng, txt, val) {
        val = clampScale(val);
        rng.value = scaleToSlider(val);
        txt.value = val.toFixed(2);
    }

    function wireScale(rng, txt) {
        rng.addEventListener('input', () => {
            txt.value = sliderToScale(parseInt(rng.value)).toFixed(2);
        }, { signal });
        txt.addEventListener('input', () => writeScale(rng, txt, clampScale(txt.value)), { signal });
        txt.addEventListener('change', () => writeScale(rng, txt, clampScale(txt.value)), { signal });
    }

    wireScale(dom_rng_scale, dom_txt_scale);
    wireScale(dom_rng_scale_x, dom_txt_scale_x);
    wireScale(dom_rng_scale_y, dom_txt_scale_y);

    // ── Rotate ───────────────────────────────────────────────────────────────

    function clampRotate(v) {
        v = parseInt(v);
        return isNaN(v) ? 0 : Math.max(-180, Math.min(180, v));
    }

    function setRotate(rawVal) {
        const val = clampRotate(rawVal);
        dom_rng_rotate.value = val;
        dom_txt_rotate.value = val;
    }

    dom_rng_rotate.addEventListener('input', () => setRotate(dom_rng_rotate.value), { signal });
    dom_txt_rotate.addEventListener('input', () => setRotate(dom_txt_rotate.value), { signal });
    dom_txt_rotate.addEventListener('change', () => setRotate(dom_txt_rotate.value), { signal });

    // ── Shape state ──────────────────────────────────────────────────────────

    let shape_pts = [];
    let rawPts = [];
    let origWidth = 0, origHeight = 0;

    // Three.js objects
    let renderer, scene, camera;
    let wrapper;
    let pointsMesh, pointsGeometry, pointsMaterial;
    const circleTexture = createCircleTexture(64);

    // Grid line objects
    let gridLines;
    // Shape outline
    let shapeOutline;

    // DOM-based labels
    let startLabel, infoDiv, placeholderDiv;

    let rafId = null;

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

        const hw = width / 2, hh = height / 2;
        camera = new OrthographicCamera(-hw, hw, -hh, hh, -1, 1);
        camera.position.z = 1;

        const main = container.querySelector('#main');
        wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = width + 'px';
        wrapper.style.margin = '0 auto';
        main.appendChild(wrapper);

        renderer.domElement.style.display = 'block';
        wrapper.appendChild(renderer.domElement);

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
        return centerAndFitPoints(pts, canvasW, canvasH, { margin: 0.95, center: 'origin' });
    }

    function load_shape_data(text) {
        shape_pts = parse_shape_data(text);
        if (shape_pts.length === 0) return;

        rawPts = shape_pts.map(([x, y]) => [x, y]);

        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        shape_pts.forEach(([x, y]) => {
            xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
            ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        });
        origWidth = xmax - xmin;
        origHeight = ymax - ymin;

        const { width, height } = getCanvasSize();
        shape_pts = center_and_fit(shape_pts, width, height);
    }

    dom_btn_upload_shape.addEventListener('change', () => {
        dom_sel_preset.value = '';
        readFileAsText(dom_btn_upload_shape, load_shape_data);
    }, { signal });

    dom_sel_preset.addEventListener('change', async () => {
        const file = dom_sel_preset.value;
        if (!file) return;
        try {
            const resp = await fetch(`/screenmaps/${file}`);
            const text = await resp.text();
            load_shape_data(text);
        } catch (e) {
            console.log("Failed to load preset:", e);
        }
    }, { signal });

    async function loadPresetsFromManifest() {
        try {
            const resp = await fetch('/screenmaps/manifest.json');
            const manifest = await resp.json();
            dom_sel_preset.innerHTML = '<option value="">-- Select preset --</option>';
            for (const preset of manifest.presets) {
                const opt = document.createElement('option');
                opt.value = preset.file;
                opt.textContent = preset.name;
                dom_sel_preset.appendChild(opt);
            }
            // Auto-select the first preset
            if (manifest.presets.length > 0) {
                dom_sel_preset.value = manifest.presets[0].file;
                dom_sel_preset.dispatchEvent(new Event('change'));
            }
        } catch (e) {
            console.log("Failed to load preset manifest:", e);
            dom_sel_preset.innerHTML = '<option value="">No presets available</option>';
        }
    }

    function buildShape(transformedPts) {
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

        const lineVerts = [];
        transformedPts.forEach(([x, y]) => lineVerts.push(x, y, 0));
        const lineGeom = new BufferGeometry();
        lineGeom.setAttribute('position', new Float32BufferAttribute(lineVerts, 3));
        shapeOutline = new Line(lineGeom, new LineBasicMaterial({ color: 0x2196F3 }));
        scene.add(shapeOutline);

        const result = buildPointsMesh({
            points: transformedPts,
            circleTexture,
            diameter: 6,
            defaultColor: [244 / 255, 67 / 255, 54 / 255],
        });

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

    function updateLabels(transformedPts) {
        if (transformedPts.length === 0) {
            placeholderDiv.style.display = '';
            startLabel.style.display = 'none';
            infoDiv.textContent = '';
            return;
        }

        placeholderDiv.style.display = 'none';

        const { width, height } = getCanvasSize();
        const hw = width / 2, hh = height / 2;
        const sx = transformedPts[0][0] + hw + 15;
        const sy = transformedPts[0][1] + hh;
        startLabel.style.display = '';
        startLabel.style.left = sx + 'px';
        startLabel.style.top = sy + 'px';
        startLabel.textContent = 'Start';

        const scaleG = parseFloat(dom_txt_scale.value) || 1;
        const sX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleG;
        const sY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleG;
        const physW = (origWidth * sX).toFixed(2);
        const physH = (origHeight * sY).toFixed(2);

        infoDiv.innerHTML = `Points: ${shape_pts.length}<br>Size: ${physW} &times; ${physH} cm`;
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

    window.addEventListener('resize', handleResize, { signal });

    function animate() {
        rafId = requestAnimationFrame(animate);

        const scaleGlobal = parseFloat(dom_txt_scale.value) || 1;
        const flipH = dom_chk_flip_h.checked ? -1 : 1;
        const flipV = dom_chk_flip_v.checked ? -1 : 1;
        const scaleX = (parseFloat(dom_txt_scale_x.value) || 1) * scaleGlobal * flipH;
        const scaleY = (parseFloat(dom_txt_scale_y.value) || 1) * scaleGlobal * flipV;
        const rotateDeg = parseInt(dom_txt_rotate.value) || 0;
        const rotateRad = rotateDeg * Math.PI / 180;
        const cosR = Math.cos(rotateRad);
        const sinR = Math.sin(rotateRad);

        if (shape_pts.length > 0) {
            const transformedPts = shape_pts.map(([x, y]) => {
                const sx = x * scaleX;
                const sy = y * scaleY;
                return [
                    sx * cosR - sy * sinR,
                    sx * sinR + sy * cosR,
                ];
            });
            buildShape(transformedPts);
            updateLabels(transformedPts);
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
    loadPresetsFromManifest();
    rafId = requestAnimationFrame(animate);

    return function destroy() {
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
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
        if (gridLines) {
            scene.remove(gridLines);
            gridLines.geometry.dispose();
            gridLines.material.dispose();
        }
        circleTexture.dispose();
        renderer.dispose();
    };
}
