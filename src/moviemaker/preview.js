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
import {
    computeAutoBloomRange,
    bloomParamsForLedSize,
    PREVIEW_AUTO_FLOOR,
    PREVIEW_AUTO_MAX_DENSE,
    PREVIEW_AUTO_MAX_SPARSE,
} from '../bloom-utils.js';
import { estimateLedSize } from './transforms.js';

const INV_255 = 1 / 255;

// FastLED's aesthetic camera margin so edge LEDs aren't clipped.
const AESTHETIC_MARGIN = 1.05;

/** Preview profile constants for computeAutoBloomRange. */
const PREVIEW_PROFILE = {
    floor:     PREVIEW_AUTO_FLOOR,
    maxDense:  PREVIEW_AUTO_MAX_DENSE,
    maxSparse: PREVIEW_AUTO_MAX_SPARSE,
};

/**
 * Create the LED preview renderer inside `parent`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.parent - Container the WebGL canvas is appended to.
 * @param {number} [opts.side=200] - CSS pixel size of the (square) preview.
 * @param {number} [opts.maxBufferSize=1024] - Cap on the backing resolution.
 * @returns {{
 *   render: Function,
 *   dispose: Function,
 *   domElement: HTMLCanvasElement,
 *   setAutoBloom: (enabled: boolean) => void,
 *   setManualBloomStrength: (strength: number) => void,
 *   getCurrentBloomStrength: () => number,
 * }}
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
    });
    const irisState = { currentBrightness: 0 };

    // Auto-bloom state: density-based envelope, recomputed on screenmap change.
    let currentRange = { min: PREVIEW_AUTO_FLOOR * 0.5, max: PREVIEW_AUTO_MAX_DENSE };
    let autoBloomEnabled = true;
    let manualBloomStrength = null; // null = use auto
    // Strength range and bloom radius proportioned to the rendered LED size
    // in fitCamera() (bloomParamsForLedSize). The effective auto range is the
    // conservative combination of this and the density envelope above.
    const bloomRange = { min: 0, max: 0 };

    let meshData = null;
    let cachedPts = null;
    let cachedRotate = null;
    let cachedLedDiameter = null;
    let ledWorldRadius = 0.5;
    let ledSpacing = 1;
    let sceneExtent = 1;

    function rebuild(localPts, ledDiameter) {
        meshData = rebuildPointsMesh({
            scene,
            previous: meshData,
            points: localPts,
            circleTexture,
            diameter: 1, // real size set in fitCamera()
        });
        // The screenmap's declared diameter (already in localPts units)
        // always wins; the spacing heuristic is only a fallback for maps
        // that declare none.
        ledSpacing = estimateLedSize(localPts);
        const dia = (typeof ledDiameter === 'number' && ledDiameter > 0)
            ? ledDiameter
            : ledSpacing;
        ledWorldRadius = dia / 2;
        _recomputeAutoRange();
    }

    /**
     * Recompute the density-based bloom envelope whenever the screenmap
     * geometry changes. sceneExtent is set in fitCamera(); we call this
     * after ledSpacing is updated.
     */
    function _recomputeAutoRange() {
        currentRange = computeAutoBloomRange({
            ledSpacing,
            sceneExtent,
            profile: PREVIEW_PROFILE,
        });
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

        // Store scene extent so auto-bloom range can use it.
        sceneExtent = Math.max(xmax - xmin, ymax - ymin, 1e-6);

        camera.left = cx - half;
        camera.right = cx + half;
        camera.top = cy - half;     // y-down
        camera.bottom = cy + half;
        camera.updateProjectionMatrix();

        meshData.mesh.rotation.z = rad;
        // PointsMaterial.size is in CSS pixels: the renderer multiplies the
        // size uniform by its pixelRatio internally, so the world→pixel
        // mapping must use the CSS pane size, not the drawing-buffer size.
        meshData.material.size = Math.max((ledWorldRadius * 2 / (half * 2)) * side, 0.75);

        // Proportion the bloom kernel to the rendered dot size so sparse
        // small dots keep a tight halo and large dots don't white out.
        const params = bloomParamsForLedSize(meshData.material.size, side, localPts.length, { bloomResolution: side });
        bloom.bloomPass.radius = params.radius;
        bloomRange.min = params.minStrength;
        bloomRange.max = params.maxStrength;

        // Re-derive the density envelope now that sceneExtent is up to date.
        _recomputeAutoRange();
    }

    /**
     * Render one preview frame.
     *
     * @param {Array<[number,number]>} localPts - LED positions in screenmap-local coords (centered at origin).
     * @param {number} rotate - rotation in degrees.
     * @param {{rgbPts: Uint8Array}|null} lastSample - most recent GPU gather sample.
     * @param {number|null} [ledDiameter=null] - the screenmap's declared LED
     *        diameter, scaled into localPts units; null falls back to the
     *        spacing heuristic.
     */
    function render(localPts, rotate, lastSample, ledDiameter = null) {
        if (!localPts || localPts.length === 0 || !lastSample) {
            renderer.clear();
            return;
        }
        if (localPts !== cachedPts || ledDiameter !== cachedLedDiameter) {
            cachedPts = localPts;
            cachedLedDiameter = ledDiameter;
            rebuild(localPts, ledDiameter);
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

        // Effective auto range: conservative combination of the size-
        // proportional range and the density envelope — the floor stays
        // strictly positive (bloom never disabled) and neither ceiling is
        // exceeded.
        const effMin = Math.max(bloomRange.min, currentRange.min);
        const effMax = Math.max(Math.min(bloomRange.max, currentRange.max), effMin);
        // Pass manualStrength only when auto is disabled.
        const override = autoBloomEnabled ? null : manualBloomStrength;
        updateBloomIris(bloom.bloomPass, irisState, src, { min: effMin, max: effMax }, override);
        bloom.render();
    }

    /**
     * Enable or disable auto-bloom density scaling.
     * @param {boolean} enabled
     */
    function setAutoBloom(enabled) {
        autoBloomEnabled = enabled;
        if (enabled) {
            // Resume iris-guided envelope — no snap.
            manualBloomStrength = null;
        }
    }

    /**
     * Set the manual bloom strength (used when autoBloom is disabled).
     * @param {number} strength
     */
    function setManualBloomStrength(strength) {
        manualBloomStrength = strength;
    }

    /**
     * Return the current bloom pass strength (auto or manual).
     * @returns {number}
     */
    function getCurrentBloomStrength() {
        return bloom.bloomPass.strength;
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

    return { render, dispose, domElement: renderer.domElement, setAutoBloom, setManualBloomStrength, getCurrentBloomStrength };
}
