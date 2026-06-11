/**
 * Three.js two-pass Gaussian blur rendering pipeline for video processing.
 *
 * Rendering goes to an offscreen target which is blitted to the canvas, so
 * LED sampling never touches the (slow) default framebuffer. LED colors are
 * gathered on the GPU into a tiny ceil(sqrt(N))² target and read back
 * asynchronously (PBO + fence via readRenderTargetPixelsAsync), keeping the
 * render loop free of synchronous pipeline stalls.
 */

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
    NearestFilter,
    VideoTexture,
    DataTexture,
    RGBAFormat,
    FloatType,
} from 'three';
import { BLUR_VERT, BLUR_FRAG, COPY_FRAG, GATHER_FRAG } from './shaders.js';

/**
 * Create a blur pipeline bound to the given canvas and video element.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas - The WebGL render canvas.
 * @param {HTMLVideoElement} opts.videoPlayer - The video source element.
 * @param {{ blurRadius: number, sigma: number }} opts.initialUniforms
 * @returns {Object} Pipeline API
 */
export function createBlurPipeline({ canvas, videoPlayer, initialUniforms }) {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    const geometry = new PlaneGeometry(2, 2);

    const shaderMaterial = new ShaderMaterial({
        uniforms: {
            tDiffuse:   { value: null },
            resolution: { value: new Vector2(640, 480) },
            blurRadius: { value: initialUniforms.blurRadius },
            sigma:      { value: initialUniforms.sigma },
            brightness: { value: 1.0 },
            maxBrightness: { value: 1.0 },
            gamma:      { value: 1.0 },
            direction:  { value: new Vector2(1, 0) },
        },
        vertexShader: BLUR_VERT,
        fragmentShader: BLUR_FRAG,
    });

    const mesh = new Mesh(geometry, shaderMaterial);
    scene.add(mesh);

    // Fullscreen quad scene shared by the copy (blit) and gather passes.
    const quadScene = new Scene();
    const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new PlaneGeometry(2, 2);
    const copyMaterial = new ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: BLUR_VERT,
        fragmentShader: COPY_FRAG,
    });
    const gatherMaterial = new ShaderMaterial({
        uniforms: {
            tPositions: { value: null },
            tSource:    { value: null },
        },
        vertexShader: BLUR_VERT,
        fragmentShader: GATHER_FRAG,
    });
    const quadMesh = new Mesh(quadGeometry, copyMaterial);
    quadScene.add(quadMesh);

    let blurTarget = null;
    let outputTarget = null;
    let videoTexture = null;

    // ── LED gather state ──────────────────────────────────────────────────
    let positionTexture = null;
    let gatherTargets = [null, null];
    let gatherBuffers = [null, null];
    const slotBusy = [false, false];
    let nextSlot = 0;
    let gatherW = 0, gatherH = 0;
    let gatherNumPts = 0;
    let lastPtsRef = null;
    let lastPtsW = 0, lastPtsH = 0;
    let latestSample = null;

    function disposeGatherResources() {
        if (positionTexture) { positionTexture.dispose(); positionTexture = null; }
        gatherTargets.forEach(t => t && t.dispose());
        gatherTargets = [null, null];
        gatherBuffers = [null, null];
        slotBusy[0] = false;
        slotBusy[1] = false;
        latestSample = null;
        gatherNumPts = 0;
        lastPtsRef = null;
    }

    /**
     * Set up the pipeline for a new video resolution.
     *
     * @param {number} w - Video width
     * @param {number} h - Video height
     */
    function setupForResolution(w, h) {
        renderer.setSize(w, h);

        if (blurTarget) blurTarget.dispose();
        blurTarget = new WebGLRenderTarget(w, h, {
            minFilter: LinearFilter,
            magFilter: LinearFilter,
        });

        if (outputTarget) outputTarget.dispose();
        outputTarget = new WebGLRenderTarget(w, h, {
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

        // Position UVs depend on resolution — force a re-upload on next set.
        lastPtsRef = null;
        latestSample = null;
    }

    /**
     * Update shader uniforms from current slider values.
     *
     * @param {{ blurRadius: number, sigma: number, brightness: number, maxBrightness: number, gamma: number }} values
     */
    function updateUniforms(values) {
        const u = shaderMaterial.uniforms;
        u.blurRadius.value = values.blurRadius;
        u.sigma.value = values.sigma;
        u.brightness.value = values.brightness;
        u.maxBrightness.value = values.maxBrightness;
        u.gamma.value = values.gamma;
    }

    function renderBlurred(destTarget) {
        const u = shaderMaterial.uniforms;
        const savedBri = u.brightness.value;
        const savedMaxBri = u.maxBrightness.value;
        const savedGamma = u.gamma.value;

        u.tDiffuse.value = videoTexture;
        u.direction.value.set(1, 0);
        u.brightness.value = 1.0;
        u.maxBrightness.value = 1.0;
        u.gamma.value = 1.0;
        renderer.setRenderTarget(blurTarget);
        renderer.render(scene, camera);

        u.tDiffuse.value = blurTarget.texture;
        u.direction.value.set(0, 1);
        u.brightness.value = savedBri;
        u.maxBrightness.value = savedMaxBri;
        u.gamma.value = savedGamma;
        renderer.setRenderTarget(destTarget);
        renderer.render(scene, camera);

        u.tDiffuse.value = videoTexture;
    }

    /**
     * Render the two-pass blur into the offscreen output target, then blit
     * it to the visible canvas.
     */
    function renderFrame() {
        renderBlurred(outputTarget);

        copyMaterial.uniforms.tDiffuse.value = outputTarget.texture;
        quadMesh.material = copyMaterial;
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCamera);
    }

    /**
     * Upload LED sample positions into the gather position texture.
     * No-ops when the same points array (by reference) and resolution were
     * already uploaded, so callers can invoke this every frame cheaply.
     *
     * @param {Array<[number,number]>} pts - LED positions in video coords (Y down)
     * @param {number} w - Video width
     * @param {number} h - Video height
     */
    function setSamplePoints(pts, w, h) {
        if (pts === lastPtsRef && w === lastPtsW && h === lastPtsH) return;
        lastPtsRef = pts;
        lastPtsW = w;
        lastPtsH = h;

        const numPts = pts.length;
        if (numPts === 0) {
            disposeGatherResources();
            return;
        }

        if (numPts !== gatherNumPts) {
            disposeGatherResources();
            lastPtsRef = pts;
            gatherNumPts = numPts;
            gatherW = Math.ceil(Math.sqrt(numPts));
            gatherH = Math.ceil(numPts / gatherW);

            positionTexture = new DataTexture(
                new Float32Array(gatherW * gatherH * 4),
                gatherW, gatherH, RGBAFormat, FloatType,
            );
            positionTexture.minFilter = NearestFilter;
            positionTexture.magFilter = NearestFilter;

            for (let s = 0; s < 2; s++) {
                gatherTargets[s] = new WebGLRenderTarget(gatherW, gatherH, {
                    minFilter: NearestFilter,
                    magFilter: NearestFilter,
                    depthBuffer: false,
                });
                gatherBuffers[s] = new Uint8Array(gatherW * gatherH * 4);
            }
        }

        // Texel i (readPixels order: row 0 = bottom) maps to LED i.
        const data = positionTexture.image.data;
        for (let i = 0; i < numPts; i++) {
            const x = Math.round(pts[i][0]);
            const y = Math.round(pts[i][1]);
            const inBounds = x >= 0 && x < w && y >= 0 && y < h;
            const o = i * 4;
            data[o]     = (x + 0.5) / w;
            data[o + 1] = ((h - 1 - y) + 0.5) / h;
            data[o + 2] = 0;
            data[o + 3] = inBounds ? 1 : 0;
        }
        data.fill(0, numPts * 4);
        positionTexture.needsUpdate = true;
    }

    /**
     * Render the gather pass and kick off an async readback of the result.
     * Never blocks: skips the request when two reads are already in flight.
     * Resolved reads become visible via getLatestSample().
     */
    function requestSample() {
        if (!positionTexture || !outputTarget) return;
        const slot = nextSlot;
        if (slotBusy[slot]) return;
        nextSlot ^= 1;

        gatherMaterial.uniforms.tPositions.value = positionTexture;
        gatherMaterial.uniforms.tSource.value = outputTarget.texture;
        quadMesh.material = gatherMaterial;
        renderer.setRenderTarget(gatherTargets[slot]);
        renderer.render(quadScene, quadCamera);
        renderer.setRenderTarget(null);

        slotBusy[slot] = true;
        const buffer = gatherBuffers[slot];
        const numPts = gatherNumPts;
        renderer.readRenderTargetPixelsAsync(
            gatherTargets[slot], 0, 0, gatherW, gatherH, buffer,
        ).then(() => {
            // Resolution/screenmap may have changed while in flight
            if (gatherBuffers[slot] === buffer) {
                latestSample = { buffer, numPts };
            }
        }).catch(() => {
            // Context loss or disposal mid-read — drop the sample
        }).finally(() => {
            slotBusy[slot] = false;
        });
    }

    /**
     * @returns {{ buffer: Uint8Array, numPts: number }|null} Most recently
     * resolved gather readback (RGBA per LED, alpha 0 = out of bounds).
     */
    function getLatestSample() {
        return latestSample;
    }

    function dispose() {
        disposeGatherResources();
        if (blurTarget) blurTarget.dispose();
        if (outputTarget) outputTarget.dispose();
        if (videoTexture) videoTexture.dispose();
        shaderMaterial.dispose();
        copyMaterial.dispose();
        gatherMaterial.dispose();
        geometry.dispose();
        quadGeometry.dispose();
        renderer.dispose();
    }

    return {
        setupForResolution,
        updateUniforms,
        renderFrame,
        setSamplePoints,
        requestSample,
        getLatestSample,
        dispose,
    };
}
