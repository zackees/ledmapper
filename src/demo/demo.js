import { parse_screenmap_data_json, centerAndFitPoints, download_blob_as_file, parseScreenmapMultiStrip, getStripColors, stripStartEndLabels } from '../common.js';
import { wireFileDropTarget, fileHasExtension } from '../drag-drop.js';
import { createCircleTexture, createRendererAndScene, rebuildPointsMesh, wireDiameterSlider, createAnimationLoop } from '../three-utils.js';
import templateHtml from './template.html?raw';
export { default as css } from './demo.css?url';

export function init(container) {
    container.innerHTML = templateHtml;

    // Global variables
    let videoReader = null;
    let videoBuffer = new Uint8Array();

    // DOM elements
    const dom_btn_upload_screenmap = container.querySelector("#btn_upload_screenmap");
    const dom_btn_load_movie = container.querySelector("#btn_load_movie");
    const dom_btn_play = container.querySelector("#btn_play");
    const dom_rng_diameter = container.querySelector("#rng_diameter");
    const dom_txt_curr_diameter = container.querySelector("#txt_curr_diameter");
    const dom_btn_download_screenmap = container.querySelector("#btn_download_screenmap");
    const dom_btn_download_video = container.querySelector("#btn_download_video");
    const dom_sel_framerate = container.querySelector("#sel_framerate");
    const dom_btn_download_screenmap_16x16_serpentine = container.querySelector("#btn_download_screenmap_16x16_serpentine");

    dom_btn_play.disabled = true;

    const CANVAS_SIZE = 800;
    let screenmap_pts = [];
    let screenmap_pts_original = [];
    let stripInfo = null;
    const movie_frames = [];
    let playing = false;
    let curr_frame_idx = 0;
    let curr_frame;

    // Three.js objects
    let pointsGeometry, pointsMaterial, pointsMesh;
    let colorAttribute;

    // Overlay state
    let showLines = false;

    // Pre-computed inverse for byte-to-float conversion
    const INV_255 = 1 / 255;

    const ac = new AbortController();
    const { signal } = ac;

    // --- Three.js Initialization ---
    const circleTexture = createCircleTexture(64);

    const main = container.querySelector('main');
    const { renderer, scene, camera, wrapper, overlayCanvas, overlayCtx } = createRendererAndScene({
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        parent: main,
        enableOverlay: true,
    });

    // Configure overlay for hover/touch fade behavior
    overlayCanvas.style.opacity = '0';
    overlayCanvas.style.transition = 'opacity 0.3s';

    function showOverlay() {
        if (!showLines) { showLines = true; drawOverlay(); }
        overlayCanvas.style.opacity = '1';
    }
    function hideOverlay() {
        overlayCanvas.style.opacity = '0';
    }
    overlayCanvas.addEventListener('mouseenter', showOverlay, { signal });
    overlayCanvas.addEventListener('mouseleave', hideOverlay, { signal });
    overlayCanvas.addEventListener('touchstart', showOverlay, { passive: true, signal });
    overlayCanvas.addEventListener('touchend', hideOverlay, { passive: true, signal });
    overlayCanvas.addEventListener('touchcancel', hideOverlay, { passive: true, signal });

    // LED index tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText =
        'position:absolute;pointer-events:none;' +
        'background:rgba(0,0,0,0.85);color:#fff;' +
        'padding:4px 8px;border-radius:4px;font:12px monospace;white-space:nowrap;' +
        'opacity:0;transition:opacity 0.15s;';
    wrapper.appendChild(tooltip);

    let tooltipLedIdx = -1;

    function hitTestLED(canvasX, canvasY) {
        if (screenmap_pts.length === 0) return -1;
        const threshold = Math.max(getDiameter(), 10);
        const threshSq = threshold * threshold;
        let bestIdx = -1, bestDist = threshSq;
        for (let i = 0; i < screenmap_pts.length; i++) {
            const dx = canvasX - screenmap_pts[i][0];
            const dy = canvasY - screenmap_pts[i][1];
            const d = dx * dx + dy * dy;
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        return bestIdx;
    }

    function onPointerMove(e) {
        const rect = overlayCanvas.getBoundingClientRect();
        const scaleX = CANVAS_SIZE / rect.width;
        const scaleY = CANVAS_SIZE / rect.height;
        const cx = (e.clientX - rect.left) * scaleX;
        const cy = (e.clientY - rect.top) * scaleY;
        const idx = hitTestLED(cx, cy);
        if (idx >= 0) {
            if (idx !== tooltipLedIdx) {
                tooltipLedIdx = idx;
                const [ox, oy] = screenmap_pts_original[idx];
                tooltip.textContent = `LED #${idx}  (${ox.toFixed(1)}, ${oy.toFixed(1)}) cm`;
            }
            const tx = Math.min(cx + 14, CANVAS_SIZE - tooltip.offsetWidth - 4);
            const ty = Math.max(cy - 28, 4);
            tooltip.style.left = tx + 'px';
            tooltip.style.top = ty + 'px';
            tooltip.style.opacity = '1';
        } else {
            tooltipLedIdx = -1;
            tooltip.style.opacity = '0';
        }
    }

    function onPointerLeave() {
        tooltipLedIdx = -1;
        tooltip.style.opacity = '0';
    }

    overlayCanvas.addEventListener('mousemove', onPointerMove, { signal });
    overlayCanvas.addEventListener('mouseleave', onPointerLeave, { signal });
    overlayCanvas.addEventListener('touchmove', (e) => {
        if (e.touches.length) onPointerMove(e.touches[0]);
    }, { passive: true, signal });
    overlayCanvas.addEventListener('touchend', onPointerLeave, { passive: true, signal });
    overlayCanvas.addEventListener('touchcancel', onPointerLeave, { passive: true, signal });

    // --- Build Three.js Points from screenmap data ---
    function buildPoints() {
        const previous = pointsMesh ? { mesh: pointsMesh, geometry: pointsGeometry, material: pointsMaterial } : null;
        const result = rebuildPointsMesh({
            scene, previous,
            points: screenmap_pts,
            circleTexture,
            diameter: getDiameter(),
        });

        pointsGeometry = result.geometry;
        pointsMaterial = result.material;
        pointsMesh = result.mesh;
        colorAttribute = result.colorAttribute;
    }

    // --- Screenmap data loading ---
    function load_screenmap_data(jsonBlob) {
        screenmap_pts = parse_screenmap_data_json(jsonBlob);
        if (screenmap_pts.length === 0) {
            console.error("Failed to load screenmap data");
            return;
        }
        screenmap_pts_original = screenmap_pts.map(([x, y]) => [x, y]);
        screenmap_pts = centerAndFitPoints(screenmap_pts, CANVAS_SIZE, CANVAS_SIZE);
        stripInfo = parseScreenmapMultiStrip(jsonBlob);
        buildPoints();
        drawOverlay();
        dom_btn_play.disabled = false;
    }

    function stopVideoStream() {
        if (videoReader) {
            videoReader.cancel().catch(() => {});
            videoReader = null;
        }
        videoBuffer = new Uint8Array();
    }

    function loadScreenmapFile(file) {
        if (!file) return;
        if (!fileHasExtension(file, ['.json'])) {
            alert('Please choose a .json screenmap file.');
            return;
        }
        file.text().then((text) => {
            // A new screenmap invalidates frames sized for the old LED count
            stopVideoStream();
            movie_frames.length = 0;
            curr_frame_idx = 0;
            set_dom_btn_play(false);
            load_screenmap_data(JSON.parse(text));
        }).catch((error) => {
            alert(`Error reading screenmap file: ${error}`);
        });
    }

    function loadMovieFile(file) {
        if (!file) return;
        if (!fileHasExtension(file, ['.rgb'])) {
            alert('Please choose a .rgb video file.');
            return;
        }
        file.arrayBuffer().then(load_movie_data).catch((error) => {
            alert(`Error reading video file: ${error}`);
        });
    }

    function load_movie_data(arrayBuffer) {
        if (screenmap_pts.length === 0) {
            alert("No screenmap is loaded!");
            return;
        }
        const uint8_array = new Uint8Array(arrayBuffer);
        const num_pixels = uint8_array.length / 3;
        if (num_pixels % screenmap_pts.length !== 0) {
            alert("Frame size should be a multiple of the number of screenmap points!");
            return;
        }
        stopVideoStream();
        movie_frames.length = 0;
        curr_frame_idx = 0;
        const frameSize = screenmap_pts.length * 3;
        const n_frames = num_pixels / screenmap_pts.length;
        for (let i = 0; i < n_frames; i++) {
            movie_frames.push(uint8_array.slice(i * frameSize, (i + 1) * frameSize));
        }
        dom_btn_play.disabled = false;
        set_dom_btn_play(true);
    }

    dom_btn_upload_screenmap.addEventListener('change', () => {
        loadScreenmapFile(dom_btn_upload_screenmap.files[0]);
    }, { signal });

    dom_btn_load_movie.addEventListener('change', () => {
        loadMovieFile(dom_btn_load_movie.files[0]);
    }, { signal });

    wireFileDropTarget({
        target: main,
        onFile: (file) => {
            if (!file) return;
            if (fileHasExtension(file, ['.json'])) {
                loadScreenmapFile(file);
            } else if (fileHasExtension(file, ['.rgb'])) {
                loadMovieFile(file);
            } else {
                alert('Please drop a .json screenmap or .rgb video file.');
            }
        },
        signal,
    });

    function fetchAndLoadJSON() {
        fetch('/screenmaps/32x32_quad_serpentine.json')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(jsonBlob => {
                console.log("Screenmap data loaded successfully");
                load_screenmap_data(jsonBlob);
                fetchAndLoadVideo();
            })
            .catch(error => console.error("Error loading JSON:", error));
    }

    // --- Video streaming ---
    async function fetchAndLoadVideo() {
        try {
            const response = await fetch('/demo/video.rgb');
            if (!response.ok) throw new Error('Network response was not ok');
            if (!response.body) throw new Error('ReadableStream not supported');
            videoReader = response.body.getReader();
            streamVideoData();
        } catch (error) {
            console.error("Error loading video:", error);
        }
    }

    async function streamVideoData() {
        try {
            for (;;) {
                const { done, value } = await videoReader.read();
                if (done) {
                    console.log("Finished streaming video data");
                    break;
                }
                const newBuffer = new Uint8Array(videoBuffer.length + value.length);
                newBuffer.set(videoBuffer);
                newBuffer.set(value, videoBuffer.length);
                videoBuffer = newBuffer;

                const frameSize = screenmap_pts.length * 3;
                const completeFrames = Math.floor(videoBuffer.length / frameSize);
                if (completeFrames > 0) {
                    const frameData = videoBuffer.slice(0, completeFrames * frameSize);
                    processNewFrames(frameData);
                    videoBuffer = videoBuffer.slice(completeFrames * frameSize);
                }
            }
        } catch (error) {
            console.error("Error streaming video:", error);
        }
    }

    function processNewFrames(frameData) {
        const frameSize = screenmap_pts.length * 3;
        const numNewFrames = frameData.length / frameSize;
        for (let i = 0; i < numNewFrames; i++) {
            const start = i * frameSize;
            movie_frames.push(frameData.slice(start, start + frameSize));
        }
        if (movie_frames.length === numNewFrames) {
            dom_btn_play.disabled = false;
            set_dom_btn_play(false);
            dom_btn_play.click();
        }
    }

    // --- Play/Pause ---
    function set_dom_btn_play(on) {
        playing = on;
        dom_btn_play.value = playing ? "Pause" : "Play";
    }

    dom_btn_play.addEventListener('click', () => set_dom_btn_play(!playing), { signal });

    // --- Diameter slider ---
    const getDiameter = wireDiameterSlider({
        slider: dom_rng_diameter,
        label: dom_txt_curr_diameter,
        getMaterial: () => pointsMaterial,
        signal,
    });

    // --- Frame rate ---
    let targetFPS = parseInt(dom_sel_framerate.value);
    dom_sel_framerate.addEventListener('change', () => {
        targetFPS = parseInt(dom_sel_framerate.value);
        animLoop.setTargetFPS(targetFPS);
    }, { signal });

    // --- Download handlers ---
    dom_btn_download_screenmap.addEventListener('click', () => {
        if (!screenmap_pts || screenmap_pts.length === 0) {
            alert("No screenmap data available to download!");
            return;
        }
        const screenmap = {
            map: {
                strip1: {
                    x: screenmap_pts.map(pt => pt[0]),
                    y: screenmap_pts.map(pt => pt[1]),
                    diameter: 0.25
                }
            }
        };
        const blob = new Blob([JSON.stringify(screenmap, null)], { type: 'application/json' });
        download_blob_as_file(blob, 'screenmap.json');
    }, { signal });

    dom_btn_download_video.addEventListener('click', () => {
        if (!movie_frames || movie_frames.length === 0) {
            alert("No video data available to download!");
            return;
        }
        const totalLength = movie_frames.reduce((sum, frame) => sum + frame.length, 0);
        const videoData = new Uint8Array(totalLength);
        let offset = 0;
        movie_frames.forEach(frame => {
            videoData.set(frame, offset);
            offset += frame.length;
        });
        const blob = new Blob([videoData], { type: 'application/octet-stream' });
        download_blob_as_file(blob, 'video.rgb');
    }, { signal });

    dom_btn_download_screenmap_16x16_serpentine.addEventListener('click', () => {
        fetch('/screenmaps/16x16_serpentine.json')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(jsonData => {
                const blob = new Blob([JSON.stringify(jsonData, null)], { type: 'application/json' });
                download_blob_as_file(blob, '16x16_serpentine.json');
            })
            .catch(error => console.error("Error loading 16x16 serpentine JSON:", error));
    }, { signal });

    // Initialize diameter to 16 on load
    dom_rng_diameter.value = 16;
    dom_rng_diameter.dispatchEvent(new Event('input', { bubbles: true }));

    // --- Overlay drawing for LED connection visualization ---
    function drawOverlay() {
        if (!overlayCtx) return;
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (!showLines || screenmap_pts.length === 0) return;

        const pts = screenmap_pts;
        const isMultiStrip = stripInfo && stripInfo.strips.length > 1;

        if (isMultiStrip) {
            drawOverlayMultiStrip(pts);
        } else {
            drawOverlaySingleStrip(pts);
        }
    }

    function drawOverlaySingleStrip(pts) {
        // Connecting lines with rainbow colors
        overlayCtx.lineWidth = 2;
        for (let i = 0; i < pts.length - 1; i++) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[i + 1];
            const hue = (120 + i * 2) % 360;
            overlayCtx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
            overlayCtx.beginPath();
            overlayCtx.moveTo(x1, y1);
            overlayCtx.lineTo(x2, y2);
            overlayCtx.stroke();

            if (i % 10 === 1 || i === pts.length - 2) {
                drawArrowHead(x1, y1, x2, y2);
            }
        }

        fillCircle(pts[0][0], pts[0][1], 8, 'rgba(0,255,0,1)');
        if (pts.length > 1) fillCircle(pts[1][0], pts[1][1], 6, 'rgba(0,255,0,0.5)');
        fillCircle(pts[pts.length - 1][0], pts[pts.length - 1][1], 8, 'rgba(255,0,0,1)');
        for (let i = 2; i < pts.length - 1; i++) {
            fillCircle(pts[i][0], pts[i][1], 4, 'rgba(255,255,255,0.5)');
        }

        const strip = (stripInfo && stripInfo.strips[0]) || { name: '', count: pts.length };
        const labels = stripStartEndLabels(strip, 0);
        drawOutlinedLabel(labels.start, pts[0][0] + 4, pts[0][1]);
        if (labels.end) {
            drawOutlinedLabel(labels.end, pts[pts.length - 1][0] + 4, pts[pts.length - 1][1]);
        }
    }

    function drawOverlayMultiStrip(pts) {
        const strips = stripInfo.strips;
        const colors = getStripColors(strips.length);

        overlayCtx.lineWidth = 2;
        for (let s = 0; s < strips.length; s++) {
            const strip = strips[s];
            // Skip empty strips and strips that fall outside the available points
            if (strip.count <= 0) continue;
            if (strip.offset >= pts.length) continue;
            const color = colors[s];
            overlayCtx.strokeStyle = color;

            const startIdx = strip.offset;
            const endIdx = Math.min(strip.offset + strip.count - 1, pts.length - 1);

            // Draw connection lines within this strip
            for (let i = startIdx; i < endIdx; i++) {
                const [x1, y1] = pts[i];
                const [x2, y2] = pts[i + 1];
                overlayCtx.beginPath();
                overlayCtx.moveTo(x1, y1);
                overlayCtx.lineTo(x2, y2);
                overlayCtx.stroke();

                const local = i - startIdx;
                if (local % 10 === 1 || i === endIdx - 1) {
                    drawArrowHead(x1, y1, x2, y2);
                }
            }

            // Draw LED circles for this strip
            fillCircle(pts[startIdx][0], pts[startIdx][1], 8, color);
            if (endIdx > startIdx) {
                if (endIdx > startIdx + 1) {
                    fillCircle(pts[startIdx + 1][0], pts[startIdx + 1][1], 6, color);
                }
                fillCircle(pts[endIdx][0], pts[endIdx][1], 8, color);
            }
            for (let i = startIdx + 2; i < endIdx; i++) {
                fillCircle(pts[i][0], pts[i][1], 4, color);
            }

            // Label start/end of each strip (single label for 1-LED strips)
            const labels = stripStartEndLabels({ name: strip.name, count: endIdx - startIdx + 1 }, s);
            drawOutlinedLabel(labels.start, pts[startIdx][0] + 4, pts[startIdx][1]);
            if (labels.end) {
                drawOutlinedLabel(labels.end, pts[endIdx][0] + 4, pts[endIdx][1]);
            }
        }
    }

    function drawArrowHead(x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const angle = Math.atan2(dy, dx);
        const t = 0.2;
        const ax = x1 + dx * t, ay = y1 + dy * t;
        overlayCtx.beginPath();
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
        overlayCtx.moveTo(ax, ay);
        overlayCtx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
        overlayCtx.stroke();
    }

    function fillCircle(x, y, diameter, color) {
        overlayCtx.fillStyle = color;
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, diameter / 2, 0, Math.PI * 2);
        overlayCtx.fill();
    }

    function drawOutlinedLabel(text, x, y) {
        overlayCtx.font = '12px sans-serif';
        overlayCtx.textBaseline = 'middle';
        overlayCtx.fillStyle = 'black';
        for (let a = 0; a < 360; a += 45) {
            const rad = a * Math.PI / 180;
            for (const r of [2, 1.5, 1]) {
                overlayCtx.fillText(text, x + Math.cos(rad) * r, y + Math.sin(rad) * r);
            }
        }
        overlayCtx.fillStyle = 'white';
        overlayCtx.fillText(text, x, y);
    }

    // --- Main render loop ---
    const animLoop = createAnimationLoop({
        targetFPS,
        onFrame() {
            if (screenmap_pts.length === 0) return;

            if (movie_frames.length && playing) {
                if (curr_frame_idx >= movie_frames.length) curr_frame_idx = 0;
                curr_frame = movie_frames[curr_frame_idx++];
            } else {
                curr_frame = null;
            }

            if (curr_frame && colorAttribute) {
                const arr = colorAttribute.array;
                const count = screenmap_pts.length;
                for (let i = 0; i < count; i++) {
                    const i3 = i * 3;
                    arr[i3    ] = curr_frame[i3    ] * INV_255;
                    arr[i3 + 1] = curr_frame[i3 + 1] * INV_255;
                    arr[i3 + 2] = curr_frame[i3 + 2] * INV_255;
                }
                colorAttribute.needsUpdate = true;
            }

            renderer.render(scene, camera);
        }
    });

    // --- Initialize ---
    fetchAndLoadJSON();

    return function destroy() {
        ac.abort();
        animLoop.stop();
        if (videoReader) {
            videoReader.cancel().catch(() => {});
        }
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry.dispose();
            pointsMaterial.dispose();
        }
        circleTexture.dispose();
        renderer.dispose();
    };
}
