import * as THREE from 'three';
import Swal from 'sweetalert2';
import { parse_shape_data, download_binary_as_file } from '../common.js';
import { initNav } from '../nav.js';
import { transformToCenter, getFrameIndex, flattenColorFrames, parseResolution, computePreviewFactor, samplePixels, computeFps, estimateLedSize } from './logic.js';

initNav();

// ── DOM refs ────────────────────────────────────────────────────────────────
const dom_btn_preset_16x16 = document.getElementById('btn_preset_16x16');
const dom_btn_preset_8x8   = document.getElementById('btn_preset_8x8');
const dom_btn_preset_strip = document.getElementById('btn_preset_strip');
const dom_btn_preset_ring  = document.getElementById('btn_preset_ring');
const dom_btn_load_video   = document.getElementById('btn_load_video');
const dom_btn_start_webcam = document.getElementById('btn_start_webcam');
const dom_webcam_options   = document.getElementById('webcam-options');
const dom_video_playback   = document.getElementById('video-playback');
const dom_btn_play_pause   = document.getElementById('btn_play_pause');
const dom_btn_upload_shape = document.getElementById('btn_upload_shape');
const dom_btn_how_to       = document.getElementById('btn_how_to');
const dom_btn_toggle_record = document.getElementById('btn_toggle_record');
const dom_rng_rotation     = document.getElementById('rng_rotation');
const dom_rng_zoom         = document.getElementById('rng_zoom');
const dom_txt_curr_zoom    = document.getElementById('txt_curr_zoom');
const dom_rng_brightness   = document.getElementById('rng_brightness');
const dom_txt_curr_bri     = document.getElementById('txt_curr_bri');
const dom_rng_gamma        = document.getElementById('rng_gamma');
const dom_txt_curr_gamma   = document.getElementById('txt_curr_gamma');
const dom_rng_blur         = document.getElementById('rng_blur');
const dom_rng_blur_sigma   = document.getElementById('rng_blur_sigma');
const dom_chk_show_status  = document.getElementById('chk_show_status');
const dom_sel_resolution   = document.getElementById('sel_resolution');
const dom_sel_framerate    = document.getElementById('sel_framerate');

const videoPlayer    = document.getElementById('videoPlayer');
const renderCanvas   = document.getElementById('renderCanvas');
const overlayCanvas  = document.getElementById('overlayCanvas');
const overlayCtx     = overlayCanvas.getContext('2d');

// ── State ───────────────────────────────────────────────────────────────────
let shape_pts = [];
let shapeValid = false;
let sourceActive = false; // true once a video or webcam is providing frames
let sourceType = null;    // 'video' | 'webcam'
let webcamStream = null;
let isPlaying = false;

let target_zoom = 1, curr_zoom = 1;
let target_rotate = 0, curr_rotate = 0;
let target_translate = [0, 0], curr_translate = [0, 0];
let isDraggingRight = false;
let lastMouseY = 0;

let recording_active = false;
let g_recording = false;
let g_recording_start_time_us = 0;
let g_last_frame_idx = -1;
let gColorFrames = [];
let video_download_index = 0;
let show_render_status = false;

let frame_rate = 30;

let videoWidth = 640, videoHeight = 480;

// ── Three.js ────────────────────────────────────────────────────────────────
const scene    = new THREE.Scene();
const camera   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderer = new THREE.WebGLRenderer({ canvas: renderCanvas, antialias: false, preserveDrawingBuffer: true });

const geometry = new THREE.PlaneGeometry(2, 2);

// Separable two-pass Gaussian blur: horizontal then vertical.
// Cost: 2×(2r+1) texture lookups instead of (2r+1)² for a 2D kernel.
const BLUR_VERT = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const BLUR_FRAG = `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float blurRadius;
    uniform float sigma;
    uniform float brightness;
    uniform float gamma;
    uniform vec2 direction; // (1,0) = horizontal, (0,1) = vertical
    varying vec2 vUv;

    float gaussianPdf(in float x, in float s) {
        return 0.39894 * exp(-0.5 * x * x / (s * s)) / s;
    }

    void main() {
        vec2 invSize = 1.0 / resolution;
        vec3 diffuseSum = vec3(0.0);
        float weightSum = 0.0;
        float totalWeight = 0.0;

        for (float i = -100.0; i <= 100.0; i++) {
            if (i > blurRadius || i < -blurRadius) continue;
            float weight = gaussianPdf(abs(i), max(sigma, 0.001));
            totalWeight += weight;
            vec2 sampleUv = vUv + direction * i * invSize;
            // Treat out-of-bounds samples as black: count their weight
            // but don't add color. This makes edges fade to black naturally.
            if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 &&
                sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
                diffuseSum += texture2D(tDiffuse, sampleUv).rgb * weight;
            }
            weightSum += weight;
        }

        // Divide by total weight (including out-of-bounds) so edge pixels
        // fade toward black as more of the kernel falls outside the frame.
        vec3 color = diffuseSum / max(totalWeight, 0.001);
        color = pow(color, vec3(gamma)) * brightness;
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
`;

const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse:   { value: null },
        resolution: { value: new THREE.Vector2(640, 480) },
        blurRadius: { value: parseFloat(dom_rng_blur.value) },
        sigma:      { value: parseFloat(dom_rng_blur_sigma.value) },
        brightness: { value: 1.0 },
        gamma:      { value: 1.0 },
        direction:  { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: BLUR_VERT,
    fragmentShader: BLUR_FRAG,
});

const mesh = new THREE.Mesh(geometry, shaderMaterial);
scene.add(mesh);

let blurTarget = null;  // intermediate render target for horizontal blur pass
let readbackBuffer = null;
let videoTexture = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeMicros() {
    return Math.floor(performance.now() * 1000);
}

function setupForNewSource(w, h) {
    videoWidth = w;
    videoHeight = h;

    renderer.setSize(w, h);
    overlayCanvas.width = w;
    overlayCanvas.height = h;

    readbackBuffer = new Uint8Array(w * h * 4);

    if (blurTarget) blurTarget.dispose();
    blurTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    });

    if (videoTexture) videoTexture.dispose();
    videoTexture = new THREE.VideoTexture(videoPlayer);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    shaderMaterial.uniforms.tDiffuse.value = videoTexture;
    shaderMaterial.uniforms.resolution.value.set(w, h);

    const aspect = w / h;
    camera.left = -1;
    camera.right = 1;
    camera.top = 1 / aspect;
    camera.bottom = -1 / aspect;
    camera.updateProjectionMatrix();
    mesh.scale.set(1, 1 / aspect, 1);

    // Re-center screenmap if loaded
    if (shapeValid) {
        shape_pts = transformToCenter(rawShapePts, videoWidth, videoHeight);
        target_translate = [w / 2, h / 2];
        curr_translate = [w / 2, h / 2];
    }

    // Switch canvas-row layout based on video aspect ratio
    const canvasRow = document.querySelector('.canvas-row');
    if (canvasRow) canvasRow.dataset.layout = (w > h) ? 'landscape' : 'portrait';

    sourceActive = true;
    updateElementStates();

    // Hide welcome overlay once a source is active
    const welcomeEl = document.getElementById('welcome-overlay');
    if (welcomeEl) welcomeEl.classList.add('hidden');

    // Show canvas toolbar
    const toolbar = document.querySelector('.canvas-toolbar');
    if (toolbar) toolbar.classList.add('visible');
}

function updateElementStates() {
    const sliders = [
        dom_rng_rotation, dom_rng_brightness, dom_rng_gamma,
        dom_rng_blur, dom_rng_blur_sigma, dom_chk_show_status, dom_rng_zoom
    ];
    sliders.forEach(el => {
        el.disabled = !shapeValid;
        const cg = el.closest('.control-group');
        if (cg) cg.classList.toggle('disabled', !shapeValid);
    });
    dom_btn_toggle_record.disabled = !sourceActive || !shapeValid;
    const cg = dom_btn_toggle_record.closest('.control-group');
    if (cg) cg.classList.toggle('disabled', dom_btn_toggle_record.disabled);
}

updateElementStates();

// ── Shape presets ────────────────────────────────────────────────────────────

function generateGrid(cols, rows, spacing = 1) {
    const pts = [];
    for (let row = 0; row < rows; row++) {
        const forward = row % 2 === 0;
        for (let c = 0; c < cols; c++) {
            const col = forward ? c : cols - 1 - c;
            pts.push([col * spacing, row * spacing]);
        }
    }
    return pts;
}

function generateStrip(count, spacing = 1) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        pts.push([i * spacing, 0]);
    }
    return pts;
}

function generateRing(count, radius = 5) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        pts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return pts;
}

function loadShapeFromPoints(pts) {
    rawShapePts = pts;
    if (rawShapePts.length === 0) {
        shapeValid = false;
    } else {
        shape_pts = transformToCenter(rawShapePts, videoWidth, videoHeight);
        shapeValid = true;
        target_zoom = 1; curr_zoom = 1;
        curr_rotate = 0; target_rotate = 0;
        document.getElementById('txt_curr_rotation').innerText = '0';
        dom_rng_rotation.value = 0;
        target_translate = [videoWidth / 2, videoHeight / 2];
        curr_translate = [videoWidth / 2, videoHeight / 2];
    }
    updateElementStates();
}

const presetButtons = [dom_btn_preset_16x16, dom_btn_preset_8x8, dom_btn_preset_strip, dom_btn_preset_ring];

function clearPresetActive() {
    presetButtons.forEach(b => b.classList.remove('active-preset'));
}

dom_btn_preset_16x16.onclick = () => {
    clearPresetActive();
    dom_btn_preset_16x16.classList.add('active-preset');
    loadShapeFromPoints(generateGrid(16, 16));
};
dom_btn_preset_8x8.onclick = () => {
    clearPresetActive();
    dom_btn_preset_8x8.classList.add('active-preset');
    loadShapeFromPoints(generateGrid(8, 8));
};
dom_btn_preset_strip.onclick = () => {
    clearPresetActive();
    dom_btn_preset_strip.classList.add('active-preset');
    loadShapeFromPoints(generateStrip(60));
};
dom_btn_preset_ring.onclick = () => {
    clearPresetActive();
    dom_btn_preset_ring.classList.add('active-preset');
    loadShapeFromPoints(generateRing(24));
};

// ── Screenmap transform ─────────────────────────────────────────────────────
let rawShapePts = []; // original parsed points (before transform)

// Auto-select 16x16 preset on load (sane default)
dom_btn_preset_16x16.click();

// Wire welcome overlay buttons to sidebar buttons
document.querySelectorAll('[data-trigger]').forEach(btn => {
    btn.addEventListener('click', () => document.getElementById(btn.dataset.trigger).click());
});

// ── Camera position (smooth interpolation) ──────────────────────────────────

function update_shape_parameters(mouseX, mouseY, mousePressed, mouseButton) {
    if (mousePressed && mouseButton === 0 && mouseInCanvas(mouseX, mouseY)) {
        target_translate[0] = mouseX;
        target_translate[1] = mouseY;
    }
    const dx = target_translate[0] - curr_translate[0];
    const dy = target_translate[1] - curr_translate[1];
    curr_translate[0] += Math.abs(dx) < 0.05 ? dx : dx * 0.05;
    curr_translate[1] += Math.abs(dy) < 0.05 ? dy : dy * 0.05;

    if (curr_zoom !== target_zoom) {
        const dz = target_zoom - curr_zoom;
        curr_zoom += Math.abs(dz) < 0.0001 ? dz : dz * 0.1;
    }
    if (curr_rotate !== target_rotate) {
        const dr = target_rotate - curr_rotate;
        curr_rotate += Math.abs(dr) < 0.05 ? dr : dr * 0.1;
    }
}

function create_transformed_shape() {
    if (shape_pts.length === 0) return [];
    let pts = shape_pts.map(([x, y]) => [x, y]);
    if (curr_rotate !== 0) {
        const r = curr_rotate * Math.PI / 180;
        const cos_r = Math.cos(r), sin_r = Math.sin(r);
        pts = pts.map(([x, y]) => [x * cos_r - y * sin_r, x * sin_r + y * cos_r]);
    }
    pts = pts.map(([x, y]) => [
        x * curr_zoom + curr_translate[0],
        y * curr_zoom + curr_translate[1]
    ]);
    return pts;
}

function mouseInCanvas(mx, my) {
    return mx >= 0 && mx <= videoWidth && my >= 0 && my <= videoHeight;
}

// ── GPU readback & sampling ─────────────────────────────────────────────────

/** Two-pass separable Gaussian blur: horizontal → blurTarget, vertical → dest. */
function renderBlurred(destTarget) {
    const u = shaderMaterial.uniforms;
    const savedBri = u.brightness.value;
    const savedGamma = u.gamma.value;

    // Pass 1: horizontal blur (video → blurTarget)
    // Apply brightness/gamma=1 in pass 1 to avoid double-application
    u.tDiffuse.value = videoTexture;
    u.direction.value.set(1, 0);
    u.brightness.value = 1.0;
    u.gamma.value = 1.0;
    renderer.setRenderTarget(blurTarget);
    renderer.render(scene, camera);

    // Pass 2: vertical blur (blurTarget → dest)
    // Apply brightness/gamma here in the final pass
    u.tDiffuse.value = blurTarget.texture;
    u.direction.value.set(0, 1);
    u.brightness.value = savedBri;
    u.gamma.value = savedGamma;
    renderer.setRenderTarget(destTarget);
    renderer.render(scene, camera);

    // Restore video texture for next frame
    u.tDiffuse.value = videoTexture;
}

function readbackAndSample(transformedPts) {
    const w = videoWidth, h = videoHeight;

    // Two-pass blur → screen
    renderBlurred(null);

    // Read post-blur pixels directly from the canvas
    // (preserveDrawingBuffer is enabled on the renderer)
    const gl = renderer.getContext();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, readbackBuffer);

    return samplePixels(readbackBuffer, transformedPts, w, h);
}

// ── Recording ───────────────────────────────────────────────────────────────

function endRecording() {
    const flat = flattenColorFrames(gColorFrames);
    if (flat === null) {
        Swal.fire('No Frames', 'No frames were captured during recording.', 'warning');
    } else {
        download_binary_as_file(flat, `video${video_download_index}.rgb`);
        video_download_index++;
    }
    gColorFrames = [];
}

// ── Overlay drawing (2D canvas) ─────────────────────────────────────────────

function drawOverlay(transformedPts, lastSample, fps) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (transformedPts.length === 0) return;

    const ledSize = estimateLedSize(transformedPts);

    // Draw LED position circles
    overlayCtx.strokeStyle = 'white';
    overlayCtx.lineWidth = 1;
    for (let i = 0; i < transformedPts.length; i++) {
        const [x, y] = transformedPts[i];
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, ledSize / 2, 0, Math.PI * 2);
        overlayCtx.stroke();
    }

    // Draw output preview rectangle
    if (lastSample) {
        const side = 200;
        const left = videoWidth - side;
        const top = videoHeight - side;
        overlayCtx.fillStyle = 'black';
        overlayCtx.fillRect(left, top, side, side);
        overlayCtx.strokeStyle = 'white';
        overlayCtx.strokeRect(left, top, side, side);

        // Fit points into preview box
        let xavg = 0, yavg = 0;
        transformedPts.forEach(([x, y]) => {
            xavg += x; yavg += y;
        });
        xavg /= transformedPts.length;
        yavg /= transformedPts.length;
        const factor = computePreviewFactor(transformedPts, side);

        const previewLedSize = estimateLedSize(transformedPts) * factor;
        for (let i = 0; i < transformedPts.length; i++) {
            const px = (transformedPts[i][0] - xavg) * factor + left + side / 2;
            const py = (transformedPts[i][1] - yavg) * factor + top + side / 2;
            const idx = i * 3;
            const r = lastSample.rgbPts[idx];
            const g = lastSample.rgbPts[idx + 1];
            const b = lastSample.rgbPts[idx + 2];
            overlayCtx.fillStyle = `rgb(${r},${g},${b})`;
            overlayCtx.fillRect(px - previewLedSize / 2, py - previewLedSize / 2, previewLedSize, previewLedSize);
        }
    }

    // FPS + brightness
    overlayCtx.fillStyle = 'white';
    overlayCtx.font = '12px monospace';
    overlayCtx.fillText(`FPS: ${fps}`, 10, 14);
    if (lastSample) {
        const pct = Math.round(lastSample.avgBri * 100);
        overlayCtx.fillText(`Avg Brightness: ${pct}%`, 10, 28);
    }
}

// ── Event handlers ──────────────────────────────────────────────────────────

dom_btn_how_to.onclick = () => {
    Swal.fire({
        title: 'How to get the best video',
        html: `
            <div style="text-align: left; margin-bottom: 15px;">
                <h3>Best Practices:</h3>
                <ul>
                    <li>Load MP4/WebM video files for best quality, or use webcam for live capture.</li>
                    <li>For WS2812 LEDs, increase gamma correction to avoid under-saturation.</li>
                    <li>APA102/Dotstar performs best in APA102HD mode.</li>
                    <li>Use smaller frame sizes (e.g., 640p) for better performance at higher frame rates.</li>
                    <li>GPU-accelerated blur processes in real time — adjust radius and sigma for effect.</li>
                </ul>
                <p><strong>Note:</strong> Downloaded binary contains raw stream of pixels represented as uint8_t of r, g, b.</p>
            </div>
        `,
        confirmButtonText: 'Got it!',
        customClass: { popup: 'custom-popup-class', content: 'custom-content-class' },
    });
};

// Video source: Load file
dom_btn_load_video.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Stop webcam if active
        stopWebcam();
        // Revoke previous blob URL to avoid memory leak
        if (videoPlayer.src && videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        videoPlayer.onloadedmetadata = () => {
            frame_rate = 30; // Reset to default for video file recording
            setupForNewSource(videoPlayer.videoWidth, videoPlayer.videoHeight);
            sourceType = 'video';
            dom_btn_load_video.classList.add('active-source');
            dom_btn_start_webcam.classList.remove('active-source');
            dom_webcam_options.style.display = 'none';
            dom_video_playback.style.display = '';
            dom_btn_play_pause.disabled = false;
            dom_btn_play_pause.textContent = 'Play';
            isPlaying = false;
        };
    };
    input.click();
};

// Video source: Webcam
dom_btn_start_webcam.onclick = () => {
    startWebcam();
};

function startWebcam() {
    stopWebcam();
    const res = parseResolution(dom_sel_resolution.value);
    frame_rate = parseInt(dom_sel_framerate.value);
    const constraints = {
        video: { width: res.width, height: res.height, frameRate: frame_rate },
        audio: false
    };
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        webcamStream = stream;
        videoPlayer.srcObject = stream;
        videoPlayer.play();
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        setupForNewSource(settings.width || res.width, settings.height || res.height);
        sourceType = 'webcam';
        dom_btn_start_webcam.classList.add('active-source');
        dom_btn_load_video.classList.remove('active-source');
        dom_webcam_options.style.display = '';
        dom_video_playback.style.display = 'none';
        isPlaying = true;
    }).catch(err => {
        console.error('Webcam error:', err);
        Swal.fire('Webcam Error', err.message, 'error');
    });
}

function stopWebcam() {
    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }
    videoPlayer.srcObject = null;
}

dom_sel_resolution.onchange = () => {
    if (sourceType === 'webcam') startWebcam();
};
dom_sel_framerate.onchange = () => {
    if (sourceType === 'webcam') startWebcam();
};

// Play/Pause for video files
dom_btn_play_pause.onclick = () => {
    if (isPlaying) {
        videoPlayer.pause();
        dom_btn_play_pause.textContent = 'Play';
    } else {
        videoPlayer.play();
        dom_btn_play_pause.textContent = 'Pause';
    }
    isPlaying = !isPlaying;
};

// Screenmap upload
dom_btn_upload_shape.onchange = () => {
    clearPresetActive();
    shapeValid = false;
    updateElementStates();
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    try {
        reader.onload = (evt) => {
            rawShapePts = parse_shape_data(evt.target.result);
            if (rawShapePts.length === 0) {
                shapeValid = false;
            } else {
                shape_pts = transformToCenter(rawShapePts, videoWidth, videoHeight);
                shapeValid = true;
                target_zoom = 1; curr_zoom = 1;
                curr_rotate = 0; target_rotate = 0;
                document.getElementById('txt_curr_rotation').innerText = '0';
                dom_rng_rotation.value = 0;
                target_translate = [videoWidth / 2, videoHeight / 2];
                curr_translate = [videoWidth / 2, videoHeight / 2];
            }
            updateElementStates();
        };
        reader.readAsText(file);
    } catch (e) {
        alert('Error loading shape file: ' + e);
    }
};

// Slider handlers
function set_target_rotate(val) {
    target_rotate = parseInt(val);
    document.getElementById('txt_curr_rotation').innerText = val;
}
dom_rng_rotation.oninput = () => set_target_rotate(dom_rng_rotation.value);

dom_rng_brightness.oninput = () => {
    dom_txt_curr_bri.innerText = `${dom_rng_brightness.value}%`;
};
dom_rng_gamma.oninput = () => {
    dom_txt_curr_gamma.innerText = `${(dom_rng_gamma.value / 10).toFixed(1)}`;
};
dom_rng_blur.oninput = () => {
    document.getElementById('txt_curr_blur').innerText = dom_rng_blur.value;
};
dom_rng_blur_sigma.oninput = () => {
    document.getElementById('txt_curr_blur_sigma').innerText = dom_rng_blur_sigma.value;
};
dom_rng_zoom.oninput = () => {
    const v = parseFloat(dom_rng_zoom.value).toFixed(2);
    dom_rng_zoom.value = v;
    dom_txt_curr_zoom.innerText = v;
    target_zoom = parseFloat(v);
};

dom_chk_show_status.onchange = () => {
    show_render_status = dom_chk_show_status.checked;
};

// Recording toggle
dom_btn_toggle_record.onclick = () => {
    if (!recording_active && shape_pts.length < 2) {
        alert('Please load a valid shape first of size >= 2');
        return;
    }
    recording_active = !recording_active;
    dom_btn_toggle_record.value = recording_active ? 'Stop Recording' : 'Start Recording';
    dom_btn_toggle_record.classList.toggle('recording', recording_active);
    if (!recording_active) {
        endRecording();
    }
};

// Mouse interaction on overlay canvas
overlayCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 && shape_pts.length > 0) {
        isDraggingRight = true;
        lastMouseY = e.offsetY;
        e.preventDefault();
    }
});
overlayCanvas.addEventListener('mousemove', (e) => {
    if (e.buttons & 1 && shape_pts.length > 0 && mouseInCanvas(e.offsetX, e.offsetY)) {
        target_translate[0] = e.offsetX;
        target_translate[1] = e.offsetY;
    }
    if (isDraggingRight && shape_pts.length > 0) {
        const dy = e.offsetY - lastMouseY;
        target_zoom -= dy * 0.01;
        target_zoom = Math.max(Math.min(target_zoom, 3), 0.15);
        dom_rng_zoom.value = target_zoom.toFixed(2);
        dom_txt_curr_zoom.innerText = target_zoom.toFixed(2);
        lastMouseY = e.offsetY;
    }
});
overlayCanvas.addEventListener('mouseup', (e) => {
    if (e.button === 2) isDraggingRight = false;
});
overlayCanvas.addEventListener('contextmenu', e => e.preventDefault());


// ── Animation loop ──────────────────────────────────────────────────────────

let lastTime = performance.now();
let lastSample = null;

function animationLoop() {
    requestAnimationFrame(animationLoop);

    if (!sourceActive) return;

    const now = performance.now();
    const fps = computeFps(now, lastTime);
    lastTime = now;

    // Update shader uniforms from sliders
    shaderMaterial.uniforms.blurRadius.value = parseFloat(dom_rng_blur.value);
    shaderMaterial.uniforms.sigma.value = parseFloat(dom_rng_blur_sigma.value);
    shaderMaterial.uniforms.brightness.value = parseInt(dom_rng_brightness.value) / 100;
    shaderMaterial.uniforms.gamma.value = parseInt(dom_rng_gamma.value) / 10;

    update_shape_parameters(0, 0, false, -1);
    const transformedPts = create_transformed_shape();

    // Always do readback when shape is valid — powers the always-on preview
    const needReadback = shapeValid && transformedPts.length > 0;

    if (needReadback) {
        const sample = readbackAndSample(transformedPts);
        lastSample = sample;

        if (recording_active) {
            const now_us = timeMicros();
            if (!g_recording) {
                g_recording = true;
                g_recording_start_time_us = now_us;
                g_last_frame_idx = -1;
            }
            const frameIdx = getFrameIndex(now_us, g_recording_start_time_us, frame_rate);
            if (frameIdx > g_last_frame_idx) {
                g_last_frame_idx = frameIdx;
                gColorFrames.push(new Uint8Array(sample.rgbPts));
            }
        } else if (g_recording) {
            g_recording = false;
            g_last_frame_idx = -1;
        }
    } else {
        // Just render to screen (no readback)
        renderBlurred(null);
        if (g_recording) {
            g_recording = false;
            g_last_frame_idx = -1;
        }
    }

    // Draw overlay — always pass lastSample for the always-on preview
    drawOverlay(transformedPts, lastSample, fps);
}

animationLoop();
