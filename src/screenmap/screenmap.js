import { download_text_as_file } from '../common.js';
import templateHtml from './template.html?raw';

export function init(container) {
    container.innerHTML = templateHtml;

    let videoElement;
    let canvas, ctx;
    const capture_width = 480;
    const capture_height = 480;

    const dom_btn_snapshot = container.querySelector("#btn_snapshot");
    const dom_btn_clear = container.querySelector("#btn_clear");
    const dom_btn_delete_last = container.querySelector("#btn_delete_last");
    const dom_btn_download = container.querySelector("#btn_download");
    const dom_txt_rotate = container.querySelector("#txt_rotate");
    const dom_slider_rotate = container.querySelector("#slider_rotate");
    const dom_txt_zoom = container.querySelector("#txt_zoom");
    const dom_slider_zoom = container.querySelector("#slider_zoom");

    const ac = new AbortController();
    const { signal } = ac;

    // Synchronize rotation input and slider
    function updateRotation(value) {
        value = parseFloat(value);
        value = isNaN(value) ? 0 : Math.max(-180, Math.min(180, value));
        dom_txt_rotate.value = value.toFixed(1);
        dom_slider_rotate.value = value;
    }

    dom_txt_rotate.addEventListener('input', () => { updateRotation(dom_txt_rotate.value); }, { signal });
    dom_txt_rotate.addEventListener('change', () => { updateRotation(dom_txt_rotate.value); }, { signal });
    dom_slider_rotate.addEventListener('input', () => { updateRotation(dom_slider_rotate.value); }, { signal });

    // Synchronize zoom input and slider
    function updateZoom(value) {
        value = parseFloat(value);
        value = isNaN(value) ? 1 : Math.max(1, Math.min(5, value));
        dom_txt_zoom.value = value.toFixed(2);
        dom_slider_zoom.value = value;
    }

    dom_txt_zoom.addEventListener('input', () => { updateZoom(dom_txt_zoom.value); }, { signal });
    dom_txt_zoom.addEventListener('change', () => { updateZoom(dom_txt_zoom.value); }, { signal });
    dom_slider_zoom.addEventListener('input', () => { updateZoom(dom_slider_zoom.value); }, { signal });

    const circle_diameter = 8;
    let points = [];

    dom_btn_delete_last.addEventListener('click', () => { points.pop(); }, { signal });
    dom_btn_download.addEventListener('click', () => { downloadShape(); }, { signal });

    let shift_active = false;
    document.addEventListener('keydown', (evt) => {
        if ("Shift" === evt.key) shift_active = true;
    }, { signal });
    document.addEventListener('keyup', (evt) => {
        if ("Shift" === evt.key) shift_active = false;
    }, { signal });

    function downloadShape() {
        const options = { type: 'application/json' };
        download_text_as_file(points_to_json_str(), `shape.json`, options);
    }

    function indexOfIntersectMostRecent(x, y, radius) {
        const radius2 = radius * radius;
        for (let i = points.length - 1; i >= 0; --i) {
            const [xx, yy] = points[i];
            const dist2 = Math.pow(x - xx, 2) + Math.pow(y - yy, 2);
            if (dist2 < radius2) return i;
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

    let snapshotCanvas = null;
    let pictureTaken = false;
    let rafId = null;

    function showPopup() {
        const popup = container.querySelector('#popup');
        popup.style.display = 'block';
        setTimeout(() => { popup.style.opacity = '1'; }, 10);
        setTimeout(() => {
            popup.style.opacity = '0';
            setTimeout(() => { popup.style.display = 'none'; }, 500);
        }, 3000);
    }

    // --- Webcam setup using native browser API ---
    function startWebcam() {
        const constraints = {
            video: {
                width: { ideal: capture_width },
                height: { ideal: capture_height }
            }
        };
        navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            videoElement = document.createElement('video');
            videoElement.srcObject = stream;
            videoElement.setAttribute('autoplay', '');
            videoElement.setAttribute('playsinline', '');
            videoElement.muted = true;
            videoElement.play().catch(() => {});

            const captureContainer = container.querySelector('#captureContainer');
            captureContainer.appendChild(videoElement);

            captureContainer.addEventListener('mouseenter', () => {
                captureContainer.style.opacity = '0';
            }, { signal });
            captureContainer.addEventListener('mouseleave', () => {
                captureContainer.style.opacity = '1';
            }, { signal });
        }).catch(err => {
            console.error('Webcam error:', err);
        });
    }

    // --- Canvas setup ---
    function initCanvas() {
        canvas = document.createElement('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx = canvas.getContext('2d');
        container.querySelector('main').appendChild(canvas);
    }

    function handleResize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', handleResize, { signal });

    // --- Snapshot ---
    dom_btn_snapshot.addEventListener('click', () => {
        if (!videoElement) return;
        snapshotCanvas = document.createElement('canvas');
        snapshotCanvas.width = videoElement.videoWidth || capture_width;
        snapshotCanvas.height = videoElement.videoHeight || capture_height;
        const snapCtx = snapshotCanvas.getContext('2d');
        snapCtx.drawImage(videoElement, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
        pictureTaken = true;
        showPopup();
        dom_btn_snapshot.disabled = true;
    }, { signal });

    // --- Clear ---
    dom_btn_clear.addEventListener('click', () => {
        if (confirm("Delete all?")) {
            points = [];
            snapshotCanvas = null;
            pictureTaken = false;
            dom_btn_snapshot.disabled = false;
        }
    }, { signal });

    // --- Click handling ---
    function handleClick(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.closest('#controls')) {
            return;
        }

        if (!pictureTaken) {
            alert("Please take a picture first before adding points.");
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(event.clientX - rect.left);
        const y = Math.floor(event.clientY - rect.top);

        if (x < 0 || y < 0) return;
        if (x > canvas.width || y > canvas.height) return;

        const idx = indexOfIntersectMostRecent(x, y, circle_diameter);
        if (shift_active) {
            if (idx !== -1) points.splice(idx, 1);
        } else {
            if (idx === -1) points.push([x, y]);
        }
    }

    // --- Render loop ---
    function draw() {
        rafId = requestAnimationFrame(draw);

        dom_btn_download.disabled = !points.length;
        dom_btn_clear.disabled = !pictureTaken;
        dom_btn_delete_last.disabled = !points.length;

        const w = canvas.width;
        const h = canvas.height;
        const zoom = Number.parseFloat(dom_txt_zoom.value) || 1.0;
        const r = Number.parseFloat(dom_txt_rotate.value) || 0;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        const scaleFactor = Math.min(w / capture_width, h / capture_height);

        // Draw background image (video or snapshot) with transforms
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(r * Math.PI / 180);
        ctx.scale(scaleFactor * zoom, scaleFactor * zoom);
        ctx.translate(-capture_width / 2, -capture_height / 2);

        if (snapshotCanvas) {
            ctx.drawImage(snapshotCanvas, 0, 0, capture_width, capture_height);
        } else if (videoElement && videoElement.readyState >= 2) {
            ctx.drawImage(videoElement, 0, 0, capture_width, capture_height);
        }
        ctx.restore();

        // Draw connection lines (in screen coordinates)
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        for (let i = 1; i < points.length; ++i) {
            const [x0, y0] = points[i - 1];
            const [x1, y1] = points[i];
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        // Draw points
        ctx.fillStyle = 'red';
        for (const [x, y] of points) {
            ctx.beginPath();
            ctx.arc(x, y, circle_diameter / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // --- Initialize ---
    initCanvas();
    startWebcam();
    canvas.addEventListener('click', handleClick, { signal });
    rafId = requestAnimationFrame(draw);

    return function destroy() {
        ac.abort();
        if (rafId) cancelAnimationFrame(rafId);
        // Stop webcam stream
        if (videoElement && videoElement.srcObject) {
            videoElement.srcObject.getTracks().forEach(t => t.stop());
        }
    };
}
