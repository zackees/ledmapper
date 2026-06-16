import { download_text_as_file, getStripColors, stripStartEndLabels } from '../common';
import { saveScreenmap } from '../screenmap-store';
import { wireFileSource } from '../drag-drop';
import { fireDialog, errorDialog } from '../ui/dialogs';
import templateHtml from './template.html?raw';
export { default as css } from './screenmap.css?url';

function qe<T extends HTMLElement>(parent: ParentNode, sel: string, _cast?: (e: Element) => T): T {
    const el = parent.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el as T;
}

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

    const ac = new AbortController();
    const { signal } = ac;

    const sourceSelect = qe<HTMLElement>(container, '#sourceSelect');
    const mappingUI = qe<HTMLElement>(container, '#mappingUI');
    const btnWebcam = qe<HTMLButtonElement>(container, '#btn_webcam');
    const btnUpload = qe<HTMLButtonElement>(container, '#btn_upload');
    const fileInput = qe<HTMLInputElement>(container, '#fileInput');

    // --- Source selection ---
    btnWebcam.addEventListener('click', () => {
        sourceSelect.style.display = 'none';
        mappingUI.style.display = '';
        startMapping();
    }, { signal });

    btnUpload.addEventListener('click', () => {
        fileInput.click();
    }, { signal });

    wireFileSource({
        input: fileInput,
        target: btnUpload,
        onFile: (file) => {
            // Only load image-typed files; dropping a non-image is silently
            // ignored to match the previous hand-rolled behavior.
            if (file?.type.startsWith('image/')) loadImageFile(file);
        },
        signal,
    });

    function loadImageFile(file: File) {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            // Release the blob URL once the image is decoded into the snapshot canvas
            URL.revokeObjectURL(objectUrl);
            // If destroy() ran while the image was decoding, bail out before
            // touching the (torn-down) DOM.
            if (signal.aborted) return;
            sourceSelect.style.display = 'none';
            mappingUI.style.display = '';
            startMappingWithImage(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
        };
        img.src = objectUrl;
    }

    // --- Mapping state ---
    let videoElement: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    const capture_width = 480;
    const capture_height = 480;
    let snapshotCanvas: HTMLCanvasElement | null = null;
    let pictureTaken = false;
    let rafId: number | null = null;
    const circle_diameter = 8;
    let strips: Record<string, [number, number][]> = { strip1: [] };
    let activeStrip = 'strip1';
    let shift_active = false;

    function getActivePoints(): [number, number][] { return strips[activeStrip] ?? []; }
    function getAllPointsFlat(): [number, number][] { return (Object.values(strips)).flat(); }
    function getStripNames(): string[] { return Object.keys(strips); }
    function getNextStripName(): string {
        let i = 1;
        while (strips[`strip${String(i)}`]) i++;
        return `strip${String(i)}`;
    }

    interface DomRefs {
        btn_snapshot: HTMLButtonElement | null;
        btn_clear: HTMLButtonElement | null;
        btn_delete_last: HTMLButtonElement | null;
        btn_download: HTMLButtonElement | null;
        txt_rotate: HTMLInputElement | null;
        slider_rotate: HTMLInputElement | null;
        txt_zoom: HTMLInputElement | null;
        slider_zoom: HTMLInputElement | null;
        sel_strip: HTMLSelectElement | null;
        btn_add_strip: HTMLButtonElement | null;
        btn_rename_strip: HTMLButtonElement | null;
        btn_delete_strip: HTMLButtonElement | null;
    }

    function getDom(): DomRefs {
        return {
            btn_snapshot: container.querySelector('#btn_snapshot'),
            btn_clear: container.querySelector('#btn_clear'),
            btn_delete_last: container.querySelector('#btn_delete_last'),
            btn_download: container.querySelector('#btn_download'),
            txt_rotate: container.querySelector('#txt_rotate'),
            slider_rotate: container.querySelector('#slider_rotate'),
            txt_zoom: container.querySelector('#txt_zoom'),
            slider_zoom: container.querySelector('#slider_zoom'),
            sel_strip: container.querySelector('#sel_strip'),
            btn_add_strip: container.querySelector('#btn_add_strip'),
            btn_rename_strip: container.querySelector('#btn_rename_strip'),
            btn_delete_strip: container.querySelector('#btn_delete_strip'),
        };
    }

    function refreshStripUI(dom: DomRefs) {
        if (!dom.sel_strip) return;
        const names = getStripNames();
        // Rebuild options
        dom.sel_strip.innerHTML = '';
        for (const name of names) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            dom.sel_strip.appendChild(opt);
        }
        dom.sel_strip.value = activeStrip;
        if (dom.btn_delete_strip) {
            dom.btn_delete_strip.disabled = names.length <= 1;
        }
    }

    function setupCommonControls(dom: DomRefs) {
        // Rotation sync
        function updateRotation(value: string) {
            let v = parseFloat(value);
            v = isNaN(v) ? 0 : Math.max(-180, Math.min(180, v));
            if (dom.txt_rotate) dom.txt_rotate.value = v.toFixed(1);
            if (dom.slider_rotate) dom.slider_rotate.value = String(v);
        }
        dom.txt_rotate?.addEventListener('input', () => { if (dom.txt_rotate) updateRotation(dom.txt_rotate.value); }, { signal });
        dom.txt_rotate?.addEventListener('change', () => { if (dom.txt_rotate) updateRotation(dom.txt_rotate.value); }, { signal });
        dom.slider_rotate?.addEventListener('input', () => { if (dom.slider_rotate) updateRotation(dom.slider_rotate.value); }, { signal });

        // Zoom sync
        function updateZoom(value: string) {
            let v = parseFloat(value);
            v = isNaN(v) ? 1 : Math.max(1, Math.min(5, v));
            if (dom.txt_zoom) dom.txt_zoom.value = v.toFixed(2);
            if (dom.slider_zoom) dom.slider_zoom.value = String(v);
        }
        dom.txt_zoom?.addEventListener('input', () => { if (dom.txt_zoom) updateZoom(dom.txt_zoom.value); }, { signal });
        dom.txt_zoom?.addEventListener('change', () => { if (dom.txt_zoom) updateZoom(dom.txt_zoom.value); }, { signal });
        dom.slider_zoom?.addEventListener('input', () => { if (dom.slider_zoom) updateZoom(dom.slider_zoom.value); }, { signal });

        // Buttons
        dom.btn_delete_last?.addEventListener('click', () => { getActivePoints().pop(); }, { signal });
        dom.btn_download?.addEventListener('click', () => { downloadScreenmap(); }, { signal });

        // Strip management
        if (dom.sel_strip) {
            dom.sel_strip.addEventListener('change', () => {
                const val = dom.sel_strip?.value ?? '';
                if (strips[val] !== undefined) {
                    activeStrip = val;
                }
                refreshStripUI(dom);
            }, { signal });
        }
        if (dom.btn_add_strip) {
            dom.btn_add_strip.addEventListener('click', () => {
                const name = getNextStripName();
                strips[name] = [];
                activeStrip = name;
                refreshStripUI(dom);
            }, { signal });
        }
        if (dom.btn_rename_strip) {
            dom.btn_rename_strip.addEventListener('click', () => { void (async () => {
                if (signal.aborted) return;
                const fireResult = await fireDialog<string>({
                    title: 'Rename Strip',
                    input: 'text',
                    inputValue: activeStrip,
                    inputLabel: `New name for "${activeStrip}"`,
                    showCancelButton: true,
                    inputValidator: (v: string) => {
                        const name = v.trim();
                        if (!name) return 'Strip name cannot be empty';
                        if (name !== activeStrip && strips[name] !== undefined) {
                            return `A strip named "${name}" already exists`;
                        }
                        return null;
                    },
                });
                const newName = typeof fireResult.value === 'string' ? fireResult.value.trim() : '';
                if (!newName || newName === activeStrip) return;
                renameStrip(activeStrip, newName);
                refreshStripUI(dom);
            })(); }, { signal });
        }
        if (dom.btn_delete_strip) {
            dom.btn_delete_strip.addEventListener('click', () => {
                const names = getStripNames();
                if (names.length <= 1) return;
                strips = Object.fromEntries(
                    Object.entries(strips).filter(([k]) => k !== activeStrip)
                );
                activeStrip = getStripNames()[0] ?? activeStrip;
                refreshStripUI(dom);
            }, { signal });
        }

        // Shift key tracking
        document.addEventListener('keydown', (evt) => {
            if ('Shift' === evt.key) shift_active = true;
        }, { signal });
        document.addEventListener('keyup', (evt) => {
            if ('Shift' === evt.key) shift_active = false;
        }, { signal });

        refreshStripUI(dom);
    }

    function renameStrip(oldName: string, newName: string) {
        // Rebuild the strips object so key order (and therefore strip
        // indices / colors / labels) is preserved across the rename.
        const next: Record<string, [number, number][]> = {};
        for (const key of Object.keys(strips)) {
            next[key === oldName ? newName : key] = strips[key] ?? [];
        }
        strips = next;
        if (activeStrip === oldName) activeStrip = newName;
    }

    function downloadScreenmap() {
        const jsonStr = points_to_json_str();
        saveScreenmap(jsonStr);
        const options = { type: 'application/json' };
        download_text_as_file(jsonStr, 'screenmap.json', options);
    }

    function indexOfIntersectMostRecent(x: number, y: number, radius: number): number {
        const radius2 = radius * radius;
        const activePoints = getActivePoints();
        for (let i = activePoints.length - 1; i >= 0; --i) {
            const [xx, yy] = activePoints[i] ?? [0, 0];
            const dist2 = Math.pow(x - xx, 2) + Math.pow(y - yy, 2);
            if (dist2 < radius2) return i;
        }
        return -1;
    }

    function points_to_json_str(): string {
        const map: Record<string, { x: number[]; y: number[]; diameter: number }> = {};
        // Only emit strips that have at least one point. If no strips have
        // points, fall back to a single empty strip so the output is still
        // a valid multi-strip envelope.
        const nonEmpty = getStripNames().filter(name => (strips[name]?.length ?? 0) > 0);
        const namesToEmit = nonEmpty.length > 0 ? nonEmpty : [activeStrip];
        for (const name of namesToEmit) {
            const pts = strips[name] ?? [];
            map[name] = {
                x: pts.map(([x]) => x),
                y: pts.map(p => p[1]),
                diameter: 0.5,
            };
        }
        return JSON.stringify({ map });
    }

    function showPopup() {
        const popup = container.querySelector<HTMLElement>('#popup');
        if (!popup) return;
        popup.style.display = 'block';
        setTimeout(() => { popup.style.opacity = '1'; }, 10);
        setTimeout(() => {
            popup.style.opacity = '0';
            setTimeout(() => { popup.style.display = 'none'; }, 500);
        }, 3000);
    }

    function initCanvas() {
        canvas = document.createElement('canvas');
        const main = container.querySelector<HTMLElement>('main');
        if (!main) throw new Error('Missing <main> element');
        canvas.width = main.clientWidth;
        canvas.height = main.clientHeight;
        ctx = canvas.getContext('2d');
        main.appendChild(canvas);
    }

    function handleResize() {
        if (!canvas) return;
        const main = container.querySelector<HTMLElement>('main');
        if (!main) return;
        canvas.width = main.clientWidth;
        canvas.height = main.clientHeight;
    }

    function showWebcamError(message: string) {
        const main = container.querySelector<HTMLElement>('main');
        if (!main) return;
        // Styles for the webcam-error panel live in src/screenmap/screenmap.css
        // (`.webcam-error*` classes). See #170 — keeping presentation in CSS.
        const errorDiv = document.createElement('div');
        errorDiv.className = 'webcam-error';

        const icon = document.createElement('div');
        icon.className = 'webcam-error-icon';
        icon.textContent = '⚠';

        const title = document.createElement('div');
        title.className = 'webcam-error-title';
        title.textContent = 'Camera Unavailable';

        const msg = document.createElement('div');
        msg.textContent = message;

        const hint = document.createElement('div');
        hint.className = 'webcam-error-hint';
        hint.textContent = 'Go back and use "Upload Image" instead.';

        errorDiv.append(icon, title, msg, hint);
        main.style.position = 'relative';
        main.appendChild(errorDiv);
    }

    function handleClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('#controls')) {
            return;
        }
        if (!pictureTaken) {
            void errorDialog('Take a picture first', 'Please take a picture first before adding points.');
            return;
        }
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(event.clientX - rect.left);
        const y = Math.floor(event.clientY - rect.top);
        if (x < 0 || y < 0) return;
        if (x > canvas.width || y > canvas.height) return;

        const idx = indexOfIntersectMostRecent(x, y, circle_diameter);
        const activePoints = getActivePoints();
        if (shift_active) {
            if (idx !== -1) activePoints.splice(idx, 1);
        } else {
            if (idx === -1) activePoints.push([x, y]);
        }
    }

    function draw(dom: DomRefs) {
        rafId = requestAnimationFrame(() => { draw(dom); });
        if (!canvas || !ctx) return;

        const allPoints = getAllPointsFlat();
        if (dom.btn_download) dom.btn_download.disabled = !allPoints.length;
        if (dom.btn_clear) dom.btn_clear.disabled = !pictureTaken;
        if (dom.btn_delete_last) dom.btn_delete_last.disabled = !getActivePoints().length;

        const w = canvas.width;
        const h = canvas.height;
        const zoom = Number.parseFloat(dom.txt_zoom?.value ?? '1') || 1.0;
        const r = Number.parseFloat(dom.txt_rotate?.value ?? '0') || 0;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        // Use actual source dimensions to preserve aspect ratio
        let srcW = capture_width, srcH = capture_height;
        if (snapshotCanvas) {
            srcW = snapshotCanvas.width;
            srcH = snapshotCanvas.height;
        } else if (videoElement && videoElement.readyState >= 2) {
            srcW = videoElement.videoWidth || capture_width;
            srcH = videoElement.videoHeight || capture_height;
        }

        const scaleFactor = Math.min(w / srcW, h / srcH);

        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(r * Math.PI / 180);
        ctx.scale(scaleFactor * zoom, scaleFactor * zoom);
        ctx.translate(-srcW / 2, -srcH / 2);

        if (snapshotCanvas) {
            ctx.drawImage(snapshotCanvas, 0, 0, srcW, srcH);
        } else if (videoElement && videoElement.readyState >= 2) {
            ctx.drawImage(videoElement, 0, 0, srcW, srcH);
        }
        ctx.restore();

        // Multi-strip drawing
        const names = getStripNames();
        const colors = getStripColors(names.length);

        // Connection lines per strip
        ctx.lineWidth = 1;
        for (let s = 0; s < names.length; ++s) {
            const name = names[s];
            if (!name) continue;
            const pts = strips[name] ?? [];
            const isActive = name === activeStrip;
            ctx.strokeStyle = colors[s] ?? '#ffffff';
            ctx.lineWidth = isActive ? 2 : 1;
            for (let i = 1; i < pts.length; ++i) {
                const [x0, y0] = pts[i - 1] ?? [0, 0];
                const [x1, y1] = pts[i] ?? [0, 0];
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            }
        }

        // Points per strip
        for (let s = 0; s < names.length; ++s) {
            const name = names[s];
            if (!name) continue;;
            const pts = strips[name] ?? [];
            const isActive = name === activeStrip;
            ctx.fillStyle = colors[s] ?? '#ffffff';
            const radius = isActive ? circle_diameter / 2 : (circle_diameter / 2) * 0.75;
            for (const [x, y] of pts) {
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                if (isActive) {
                    ctx.strokeStyle = 'white';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // Start/end markers + labels per strip
        ctx.font = 'bold 12px sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        for (let s = 0; s < names.length; ++s) {
            const name = names[s];
            if (!name) continue;
            const pts = strips[name] ?? [];
            if (!pts.length) continue;
            const labels = stripStartEndLabels({ name, count: pts.length }, s);
            const [sx, sy] = pts[0] ?? [0, 0];
            drawEndpointMarker(sx, sy, colors[s] ?? '#ffffff', 'start');
            drawEndpointLabel(labels.start, sx, sy);
            if (labels.end) {
                const [ex, ey] = pts[pts.length - 1] ?? [0, 0];
                drawEndpointMarker(ex, ey, colors[s] ?? '#ffffff', 'end');
                drawEndpointLabel(labels.end, ex, ey);
            }
        }
    }

    // Start marker: ring around the first LED. End marker: square outline
    // around the last LED. Both use the strip color over a dark halo so they
    // stay readable on any snapshot background.
    function drawEndpointMarker(x: number, y: number, color: string, kind: string) {
        if (!ctx) return;
        const r = circle_diameter / 2 + 4;
        ctx.lineWidth = 2;
        if (kind === 'start') {
            ctx.beginPath();
            ctx.arc(x, y, r + 1, 0, Math.PI * 2);
            ctx.strokeStyle = 'black';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'black';
            ctx.strokeRect(x - r - 1, y - r - 1, (r + 1) * 2, (r + 1) * 2);
            ctx.strokeStyle = color;
            ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        }
    }

    // Outlined text: black stroke under white fill so labels read against
    // both the dark page background and bright snapshot regions.
    function drawEndpointLabel(text: string, x: number, y: number) {
        if (!ctx) return;
        const lx = x + circle_diameter / 2 + 8;
        const ly = y - circle_diameter / 2 - 8;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'black';
        ctx.strokeText(text, lx, ly);
        ctx.fillStyle = 'white';
        ctx.fillText(text, lx, ly);
    }

    // --- Start mapping with webcam ---
    function startMapping() {
        const dom = getDom();
        setupCommonControls(dom);
        initCanvas();
        window.addEventListener('resize', handleResize, { signal });

        // Snapshot button
        dom.btn_snapshot?.addEventListener('click', () => {
            if (!videoElement) return;
            snapshotCanvas = document.createElement('canvas');
            snapshotCanvas.width = videoElement.videoWidth || capture_width;
            snapshotCanvas.height = videoElement.videoHeight || capture_height;
            const snapCtx = snapshotCanvas.getContext('2d');
            if (snapCtx) snapCtx.drawImage(videoElement, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
            pictureTaken = true;
            showPopup();
            if (dom.btn_snapshot) dom.btn_snapshot.disabled = true;
        }, { signal });

        // Clear button
        dom.btn_clear?.addEventListener('click', () => {
            if (confirm('Delete all?')) {
                strips = { strip1: [] };
                activeStrip = 'strip1';
                snapshotCanvas = null;
                pictureTaken = false;
                if (dom.btn_snapshot) dom.btn_snapshot.disabled = false;
                refreshStripUI(dom);
            }
        }, { signal });

        canvas?.addEventListener('click', handleClick, { signal });
        rafId = requestAnimationFrame(() => { draw(dom); });

        // Webcam init LAST — failures cannot break the controls or draw loop above
        try {
            // Feature-check before touching the API. #183.
            if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') {
                showWebcamError('Webcam not available in this browser context.');
                return;
            }
            const constraints = { video: true };
            void navigator.mediaDevices.getUserMedia(constraints).then(stream => {
                // If destroy() already ran while the permission prompt was open,
                // immediately stop the stream so we don't leak the camera.
                if (signal.aborted) {
                    stream.getTracks().forEach(t => { t.stop(); });
                    return;
                }
                videoElement = document.createElement('video');
                videoElement.srcObject = stream;
                videoElement.setAttribute('autoplay', '');
                videoElement.setAttribute('playsinline', '');
                videoElement.muted = true;
                void videoElement.play().catch((_e: unknown) => { /* autoplay policy */ });

                const captureContainer = container.querySelector<HTMLElement>('#captureContainer');
                if (captureContainer) {
                    captureContainer.appendChild(videoElement);
                    // Pointer-Events instead of mouseenter/mouseleave so the
                    // touch-tap path (iOS Safari has no hover) also gets the
                    // opacity fade. Issue #178.
                    const onIn = () => { captureContainer.style.opacity = '0'; };
                    const onOut = () => { captureContainer.style.opacity = '1'; };
                    captureContainer.addEventListener('pointerenter', onIn, { signal });
                    captureContainer.addEventListener('pointerleave', onOut, { signal });
                    captureContainer.addEventListener('pointercancel', onOut, { signal });
                }
            }).catch((err: unknown) => {
                if (signal.aborted) return;
                console.error('Webcam error:', err);
                showWebcamError(err instanceof Error ? (err.message || 'Could not access camera.') : 'Could not access camera.');
            });
        } catch (err) {
            console.error('Webcam error:', err);
            showWebcamError('Camera not available (requires HTTPS or localhost).');
        }
    }

    // --- Start mapping with uploaded image ---
    function startMappingWithImage(img: HTMLImageElement) {
        const dom = getDom();
        setupCommonControls(dom);
        initCanvas();
        window.addEventListener('resize', handleResize, { signal });

        // Hide webcam-only controls
        if (dom.btn_snapshot) dom.btn_snapshot.style.display = 'none';
        const captureContainer = container.querySelector<HTMLElement>('#captureContainer');
        if (captureContainer) captureContainer.style.display = 'none';

        // Create snapshot from the uploaded image immediately
        snapshotCanvas = document.createElement('canvas');
        snapshotCanvas.width = img.naturalWidth;
        snapshotCanvas.height = img.naturalHeight;
        const snapCtx = snapshotCanvas.getContext('2d');
        if (snapCtx) snapCtx.drawImage(img, 0, 0);
        pictureTaken = true;
        showPopup();

        // Clear button
        dom.btn_clear?.addEventListener('click', () => {
            if (confirm('Delete all points?')) {
                strips = { strip1: [] };
                activeStrip = 'strip1';
                refreshStripUI(dom);
            }
        }, { signal });

        canvas?.addEventListener('click', handleClick, { signal });
        rafId = requestAnimationFrame(() => { draw(dom); });
    }

    return function destroy() {
        if (getAllPointsFlat().length > 0) saveScreenmap(points_to_json_str());
        ac.abort();
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (videoElement?.srcObject) {
            try { videoElement.pause(); } catch { /* ignore */ }
            (videoElement.srcObject as MediaStream).getTracks().forEach(t => { t.stop(); });
            videoElement.srcObject = null;
        }
        videoElement = null;
        snapshotCanvas = null;
    };
}
