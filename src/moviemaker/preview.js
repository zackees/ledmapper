/**
 * Three.js LED preview pane for the Video Maker.
 *
 * Replaces the old Canvas2D fillRect preview with a points mesh using the
 * shared circle sprite (same look as the demo page) plus FastLED-style
 * UnrealBloomPass bloom with an auto-bloom iris.
 *
 * The mesh is rebuilt only when the screenmap points change (array identity);
 * per frame only the color attribute is updated from the GPU gather sample.
 * The preview self-centers and self-scales, so translation and zoom of the
 * editor view cancel out — only rotation affects the rendered layout.
 */

import { WebGLRenderer, Scene, OrthographicCamera } from 'three';
import { createCircleTexture, rebuildPointsMesh } from '../three-utils.js';
import { createBloomComposer, updateBloomIris } from '../three-bloom.js';
import { estimateLedSize } from './transforms.js';

const INV_255 = 1 / 255;

// FastLED's aesthetic camera margin so edge LEDs aren't clipped.
const AESTHETIC_MARGIN = 1.05;

// FastLED's bloom numbers are tuned for a large render surface (the demo
// page uses 800px). UnrealBloomPass blur mips cover a proportionally larger
// area on a small pane — with radius 1 the largest mips dominate, so the
// FastLED strengths white out / smear the whole 200px preview. The iris
// curve shape is kept but its strength range is scaled down empirically.
const PREVIEW_BLOOM_MIN = 0.1;
const PREVIEW_BLOOM_MAX = 0.6;
const PREVIEW_BLOOM_RADIUS = 0.3;

/**
 * Create the LED preview renderer inside `parent`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.parent - Container the WebGL canvas is appended to.
 * @param {number} [opts.side=200] - CSS pixel size of the (square) preview.
 * @param {number} [opts.maxBufferSize=1024] - Cap on the backing resolution.
 * @returns {{ render: Function, dispose: Function, domElement: HTMLCanvasElement }}
 */
export function createLedPreview({ parent, side = 200, maxBufferSize = 1024 }) {
    // Supersample at 2x devicePixelRatio (capped) so circles stay crisp.
    const pixelRatio = Math.min((window.devicePixelRatio || 1) * 2, maxBufferSize / side);

    const renderer = new WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(side, side);
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.display = 'block';
    parent.appendChild(renderer.domElement);

    const scene = new Scene();
    // y-down camera (top < bottom) matching screenmap/canvas conventions;
    // bounds are refit to the rotated point bbox in fitCamera().
    const camera = new OrthographicCamera(-1, 1, -1, 1, -1, 1);
    camera.position.z = 1;

    const circleTexture = createCircleTexture(64);
    const bloom = createBloomComposer({
        renderer, scene, camera,
        width: side, height: side,
        radius: PREVIEW_BLOOM_RADIUS,
    });
    const irisState = { currentBrightness: 0 };
    const bloomRange = { min: PREVIEW_BLOOM_MIN, max: PREVIEW_BLOOM_MAX };

    let meshData = null;
    let cachedPts = null;
    let cachedRotate = null;
    let ledWorldRadius = 0.5;

    function rebuild(localPts) {
        meshData = rebuildPointsMesh({
            scene,
            previous: meshData,
            points: localPts,
            circleTexture,
            diameter: 1, // real size set in fitCamera()
        });
        ledWorldRadius = estimateLedSize(localPts) / 2;
    }

    /**
     * Fit the orthographic camera to the rotated point bbox, FastLED-style:
     * half-extent = (extent/2 + maxLedVisualRadius) * 1.05.
     * Rotation is applied via mesh.rotation.z (same x/y math as the editor's
     * y-down transform since the camera maps world y downward).
     */
    function fitCamera(localPts, rotate) {
        const rad = rotate * Math.PI / 180;
        const cos_r = Math.cos(rad), sin_r = Math.sin(rad);
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x0, y0] of localPts) {
            const x = x0 * cos_r - y0 * sin_r;
            const y = x0 * sin_r + y0 * cos_r;
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const cx = (xmin + xmax) / 2;
        const cy = (ymin + ymax) / 2;
        const extent = Math.max(xmax - xmin, ymax - ymin);
        const half = Math.max((extent / 2 + ledWorldRadius) * AESTHETIC_MARGIN, 1e-6);

        camera.left = cx - half;
        camera.right = cx + half;
        camera.top = cy - half;     // y-down
        camera.bottom = cy + half;
        camera.updateProjectionMatrix();

        meshData.mesh.rotation.z = rad;
        // PointsMaterial size is in drawing-buffer pixels.
        const bufferPx = side * pixelRatio;
        meshData.material.size = Math.max((ledWorldRadius * 2 / (half * 2)) * bufferPx, 1);
    }

    /**
     * Render one preview frame.
     *
     * @param {Array<[number,number]>} localPts - LED positions in screenmap-local coords (centered at origin).
     * @param {number} rotate - rotation in degrees.
     * @param {{rgbPts: Uint8Array}|null} lastSample - most recent GPU gather sample.
     */
    function render(localPts, rotate, lastSample) {
        if (!localPts || localPts.length === 0 || !lastSample) {
            renderer.clear();
            return;
        }
        if (localPts !== cachedPts) {
            cachedPts = localPts;
            rebuild(localPts);
            cachedRotate = null; // force camera refit
        }
        if (rotate !== cachedRotate) {
            cachedRotate = rotate;
            fitCamera(localPts, rotate);
        }

        // Per-frame color update: Uint8 0-255 → Float32 0-1.
        const src = lastSample.rgbPts;
        const arr = meshData.colorAttribute.array;
        const count = Math.min(localPts.length, Math.floor(src.length / 3));
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            arr[i3    ] = src[i3    ] * INV_255;
            arr[i3 + 1] = src[i3 + 1] * INV_255;
            arr[i3 + 2] = src[i3 + 2] * INV_255;
        }
        meshData.colorAttribute.needsUpdate = true;

        updateBloomIris(bloom.bloomPass, irisState, src, bloomRange);
        bloom.render();
    }

    function dispose() {
        if (meshData) {
            scene.remove(meshData.mesh);
            meshData.geometry.dispose();
            meshData.material.dispose();
            meshData = null;
        }
        circleTexture.dispose();
        bloom.dispose();
        renderer.dispose();
        renderer.domElement.remove();
    }

    return { render, dispose, domElement: renderer.domElement };
}
