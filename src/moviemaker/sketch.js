import {
    Scene,
    OrthographicCamera,
    WebGLRenderer,
    PlaneGeometry,
    ShaderMaterial,
    Vector2,
    Mesh,
    WebGLRenderTarget,
    LinearFilter,
    VideoTexture,
} from 'three';
const Swal = import('sweetalert2').then(m => m.default);
import { parse_shape_data, download_binary_as_file } from '../common.js';
import { transformToCenter, getFrameIndex, flattenColorFrames, parseResolution, computePreviewFactor, samplePixels, computeFps, estimateLedSize } from './logic.js';
import templateHtml from './template.html?raw';

export function init(container) {
    container.innerHTML = templateHtml;

    // ── DOM refs ────────────────────────────────────────────────────────────────
    const dom_btn_preset_16x16 = container.querySelector('#btn_preset_16x16');
    const dom_btn_preset_8x8   = container.querySelector('#btn_preset_8x8');
    const dom_btn_preset_strip = container.querySelector('#btn_preset_strip');
    const dom_btn_preset_ring  = container.querySelector('#btn_preset_ring');
    const dom_btn_load_video   = container.querySelector('#btn_load_video');
    const dom_btn_start_webcam = container.querySelector('#btn_start_webcam');
    const dom_webcam_options   = container.querySelector('#webcam-options');
    const dom_video_playback   = container.querySelector('#video-playback');
    const dom_btn_play_pause   = container.querySelector('#btn_play_pause');
    const dom_btn_upload_shape = container.querySelector('#btn_upload_shape');
    const dom_btn_how_to       = container.querySelector('#btn_how_to');
    const dom_btn_toggle_record = container.querySelector('#btn_toggle_record');
    const dom_rng_rotation     = container.querySelector('#rng_rotation');
    const dom_rng_zoom         = container.querySelector('#rng_zoom');
    const dom_txt_curr_zoom    = container.querySelector('#txt_curr_zoom');
    const dom_rng_brightness   = container.querySelector('#rng_brightness');
    const dom_txt_curr_bri     = container.querySelector('#txt_curr_bri');
    const dom_rng_gamma        = container.querySelector('#rng_gamma');
    const dom_txt_curr_gamma   = container.querySelector('#txt_curr_gamma');
    const dom_rng_blur         = container.querySelector('#rng_blur');
    const dom_rng_blur_sigma   = container.querySelector('#rng_blur_sigma');
    const dom_chk_show_status  = container.querySelector('#chk_show_status');
    const dom_sel_resolution   = container.querySelector('#sel_resolution');
    const dom_sel_framerate    = container.querySelector('#sel_framerate');

    const videoPlayer    = container.querySelector('#videoPlayer');
    const renderCanvas   = container.querySelector('#renderCanvas');
    const overlayCanvas  = container.querySelector('#overlayCanvas');
    const overlayCtx     = overlayCanvas.getContext('2d');

    const ac = new AbortController();
    const { signal } = ac;

    // ── State ───────────────────────────────────────────────────────────────────
    let shape_pts = [];
    let shapeValid = false;
    let sourceActive = false;
    let sourceType = null;
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
    let rafId = null;

    // ── Three.js ────────────────────────────────────────────────────────────────
    const scene    = new Scene();
    const camera   = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new WebGLRenderer({ canvas: renderCanvas, antialias: false, preserveDrawingBuffer: true });

    const geometry = new PlaneGeometry(2, 2);

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
        uniform vec2 direction;
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
                if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 &&
                    sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
                    diffuseSum += texture2D(tDiffuse, sampleUv).rgb * weight;
                }
                weightSum += weight;
            }

            vec3 color = diffuseSum / max(totalWeight, 0.001);
            color = pow(color, vec3(gamma)) * brightness;
            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `;

    const shaderMaterial = new ShaderMaterial({
        uniforms: {
            tDiffuse:   { value: null },
            resolution: { value: new Vector2(640, 480) },
            blurRadius: { value: parseFloat(dom_rng_blur.value) },
            sigma:      { value: parseFloat(dom_rng_blur_sigma.value) },
            brightness: { value: 1.0 },
            gamma:      { value: 1.0 },
            direction:  { value: new Vector2(1, 0) },
        },
        vertexShader: BLUR_VERT,
        fragmentShader: BLUR_FRAG,
    });

    const mesh = new Mesh(geometry, shaderMaterial);
    scene.add(mesh);

    let blurTarget = null;
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
        blurTarget = new WebGLRenderTarget(w, h, {
            minFilter: LinearFilter,
            magFilter: LinearFilter,
        });

        if (videoTexture) videoTexture.dispose();
        videoTexture = new VideoTexture(videoPlayer);
        videoTexture.minFilter = LinearFilter;
        videoTexture.magFilter = LinearFilter;
        shaderMaterial.uniforms.tDiffuse.value = videoTexture;
        shaderMaterial.uniforms.resolution.value.set(w, h);

        const aspect = w / h;
        camera.left = -1;
        camera.right = 1;
        camera.top = 1 / aspect;
        camera.bottom = -1 / aspect;
        camera.updateProjectionMatrix();
        mesh.scale.set(1, 1 / aspect, 1);

        if (shapeValid) {
            shape_pts = transformToCenter(rawShapePts, videoWidth, videoHeight);
            target_translate = [w / 2, h / 2];
            curr_translate = [w / 2, h / 2];
        }

        const canvasRow = container.querySelector('.canvas-row');
        if (canvasRow) canvasRow.dataset.layout = (w > h) ? 'landscape' : 'portrait';

        sourceActive = true;
        updateElementStates();

        const welcomeEl = container.querySelector('#welcome-overlay');
        if (welcomeEl) welcomeEl.classList.add('hidden');

        const toolbar = container.querySelector('.canvas-toolbar');
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
            container.querySelector('#txt_curr_rotation').innerText = '0';
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

    dom_btn_preset_16x16.addEventListener('click', () => {
        clearPresetActive();
        dom_btn_preset_16x16.classList.add('active-preset');
        loadShapeFromPoints(generateGrid(16, 16));
    }, { signal });
    dom_btn_preset_8x8.addEventListener('click', () => {
        clearPresetActive();
        dom_btn_preset_8x8.classList.add('active-preset');
        loadShapeFromPoints(generateGrid(8, 8));
    }, { signal });
    dom_btn_preset_strip.addEventListener('click', () => {
        clearPresetActive();
        dom_btn_preset_strip.classList.add('active-preset');
        loadShapeFromPoints(generateStrip(60));
    }, { signal });
    dom_btn_preset_ring.addEventListener('click', () => {
        clearPresetActive();
        dom_btn_preset_ring.classList.add('active-preset');
        loadShapeFromPoints(generateRing(24));
    }, { signal });

    // ── Screenmap transform ─────────────────────────────────────────────────────
    let rawShapePts = [];

    // Auto-select 16x16 preset on load
    dom_btn_preset_16x16.click();

    // Wire welcome overlay buttons to sidebar buttons
    container.querySelectorAll('[data-trigger]').forEach(btn => {
        btn.addEventListener('click', () => container.querySelector('#' + btn.dataset.trigger).click(), { signal });
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

    function renderBlurred(destTarget) {
        const u = shaderMaterial.uniforms;
        const savedBri = u.brightness.value;
        const savedGamma = u.gamma.value;

        u.tDiffuse.value = videoTexture;
        u.direction.value.set(1, 0);
        u.brightness.value = 1.0;
        u.gamma.value = 1.0;
        renderer.setRenderTarget(blurTarget);
        renderer.render(scene, camera);

        u.tDiffuse.value = blurTarget.texture;
        u.direction.value.set(0, 1);
        u.brightness.value = savedBri;
        u.gamma.value = savedGamma;
        renderer.setRenderTarget(destTarget);
        renderer.render(scene, camera);

        u.tDiffuse.value = videoTexture;
    }

    function readbackAndSample(transformedPts) {
        const w = videoWidth, h = videoHeight;

        renderBlurred(null);

        const gl = renderer.getContext();
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, readbackBuffer);

        return samplePixels(readbackBuffer, transformedPts, w, h);
    }

    // ── Recording ───────────────────────────────────────────────────────────────

    async function endRecording() {
        const flat = flattenColorFrames(gColorFrames);
        if (flat === null) {
            (await Swal).fire('No Frames', 'No frames were captured during recording.', 'warning');
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

        overlayCtx.strokeStyle = 'white';
        overlayCtx.lineWidth = 1;
        for (let i = 0; i < transformedPts.length; i++) {
            const [x, y] = transformedPts[i];
            overlayCtx.beginPath();
            overlayCtx.arc(x, y, ledSize / 2, 0, Math.PI * 2);
            overlayCtx.stroke();
        }

        if (lastSample) {
            const side = 200;
            const left = videoWidth - side;
            const top = videoHeight - side;
            overlayCtx.fillStyle = 'black';
            overlayCtx.fillRect(left, top, side, side);
            overlayCtx.strokeStyle = 'white';
            overlayCtx.strokeRect(left, top, side, side);

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

        overlayCtx.fillStyle = 'white';
        overlayCtx.font = '12px monospace';
        overlayCtx.fillText(`FPS: ${fps}`, 10, 14);
        if (lastSample) {
            const pct = Math.round(lastSample.avgBri * 100);
            overlayCtx.fillText(`Avg Brightness: ${pct}%`, 10, 28);
        }
    }

    // ── Event handlers ──────────────────────────────────────────────────────────

    dom_btn_how_to.addEventListener('click', async () => {
        (await Swal).fire({
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
    }, { signal });

    // Video source: Load file
    dom_btn_load_video.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            stopWebcam();
            if (videoPlayer.src && videoPlayer.src.startsWith('blob:')) {
                URL.revokeObjectURL(videoPlayer.src);
            }
            const url = URL.createObjectURL(file);
            videoPlayer.src = url;
            videoPlayer.onloadedmetadata = () => {
                frame_rate = 30;
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
    }, { signal });

    // Video source: Webcam
    dom_btn_start_webcam.addEventListener('click', () => {
        startWebcam();
    }, { signal });

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
        }).catch(async err => {
            console.error('Webcam error:', err);
            (await Swal).fire('Webcam Error', err.message, 'error');
        });
    }

    function stopWebcam() {
        if (webcamStream) {
            webcamStream.getTracks().forEach(t => t.stop());
            webcamStream = null;
        }
        videoPlayer.srcObject = null;
    }

    dom_sel_resolution.addEventListener('change', () => {
        if (sourceType === 'webcam') startWebcam();
    }, { signal });
    dom_sel_framerate.addEventListener('change', () => {
        if (sourceType === 'webcam') startWebcam();
    }, { signal });

    // Play/Pause for video files
    dom_btn_play_pause.addEventListener('click', () => {
        if (isPlaying) {
            videoPlayer.pause();
            dom_btn_play_pause.textContent = 'Play';
        } else {
            videoPlayer.play();
            dom_btn_play_pause.textContent = 'Pause';
        }
        isPlaying = !isPlaying;
    }, { signal });

    // Screenmap upload
    dom_btn_upload_shape.addEventListener('change', () => {
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
                    container.querySelector('#txt_curr_rotation').innerText = '0';
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
    }, { signal });

    // Slider handlers
    function set_target_rotate(val) {
        target_rotate = parseInt(val);
        container.querySelector('#txt_curr_rotation').innerText = val;
    }
    dom_rng_rotation.addEventListener('input', () => set_target_rotate(dom_rng_rotation.value), { signal });

    dom_rng_brightness.addEventListener('input', () => {
        dom_txt_curr_bri.innerText = `${dom_rng_brightness.value}%`;
    }, { signal });
    dom_rng_gamma.addEventListener('input', () => {
        dom_txt_curr_gamma.innerText = `${(dom_rng_gamma.value / 10).toFixed(1)}`;
    }, { signal });
    dom_rng_blur.addEventListener('input', () => {
        container.querySelector('#txt_curr_blur').innerText = dom_rng_blur.value;
    }, { signal });
    dom_rng_blur_sigma.addEventListener('input', () => {
        container.querySelector('#txt_curr_blur_sigma').innerText = dom_rng_blur_sigma.value;
    }, { signal });
    dom_rng_zoom.addEventListener('input', () => {
        const v = parseFloat(dom_rng_zoom.value).toFixed(2);
        dom_rng_zoom.value = v;
        dom_txt_curr_zoom.innerText = v;
        target_zoom = parseFloat(v);
    }, { signal });

    dom_chk_show_status.addEventListener('change', () => {
        show_render_status = dom_chk_show_status.checked;
    }, { signal });

    // Recording toggle
    dom_btn_toggle_record.addEventListener('click', () => {
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
    }, { signal });

    // Mouse interaction on overlay canvas
    overlayCanvas.addEventListener('mousedown', (e) => {
        if (e.button === 2 && shape_pts.length > 0) {
            isDraggingRight = true;
            lastMouseY = e.offsetY;
            e.preventDefault();
        }
    }, { signal });
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
    }, { signal });
    overlayCanvas.addEventListener('mouseup', (e) => {
        if (e.button === 2) isDraggingRight = false;
    }, { signal });
    overlayCanvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });

    // ── Animation loop ──────────────────────────────────────────────────────────

    let lastTime = performance.now();
    let lastSample = null;

    function animationLoop() {
        rafId = requestAnimationFrame(animationLoop);

        if (!sourceActive) return;

        const now = performance.now();
        const fps = computeFps(now, lastTime);
        lastTime = now;

        shaderMaterial.uniforms.blurRadius.value = parseFloat(dom_rng_blur.value);
        shaderMaterial.uniforms.sigma.value = parseFloat(dom_rng_blur_sigma.value);
        shaderMaterial.uniforms.brightness.value = parseInt(dom_rng_brightness.value) / 100;
        shaderMaterial.uniforms.gamma.value = parseInt(dom_rng_gamma.value) / 10;

        update_shape_parameters(0, 0, false, -1);
        const transformedPts = create_transformed_shape();

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
            renderBlurred(null);
            if (g_recording) {
                g_recording = false;
                g_last_frame_idx = -1;
            }
        }

        drawOverlay(transformedPts, lastSample, fps);
    }

    rafId = requestAnimationFrame(animationLoop);

    return function destroy() {
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        stopWebcam();
        if (videoPlayer.src && videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        videoPlayer.src = '';
        videoPlayer.srcObject = null;
        if (blurTarget) blurTarget.dispose();
        if (videoTexture) videoTexture.dispose();
        shaderMaterial.dispose();
        geometry.dispose();
        renderer.dispose();
    };
}
