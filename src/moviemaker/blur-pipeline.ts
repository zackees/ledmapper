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
    VideoFrameTexture,
    DataTexture,
    RGBAFormat,
    FloatType,
} from 'three';
import type { Texture } from 'three';
import { BLUR_VERT, BLUR_FRAG, COPY_FRAG, GATHER_FRAG } from './shaders';
import { perfCount } from './perf';
import { attachContextLossWatchdog } from '../watchdogs';

/**
 * Create a blur pipeline bound to the given canvas and video element.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas - The WebGL render canvas.
 * @param {HTMLVideoElement} opts.videoPlayer - The video source element.
 * @param {{ blurRadius: number, sigma: number }} opts.initialUniforms
 * @returns {Object} Pipeline API
 */
export function createBlurPipeline({ canvas, videoPlayer, initialUniforms }: { canvas?: HTMLCanvasElement | OffscreenCanvas; videoPlayer?: HTMLVideoElement; initialUniforms?: { blurRadius: number; sigma: number } }) {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new WebGLRenderer({ canvas, antialias: false });
    const geometry = new PlaneGeometry(2, 2);

    // Log-only watchdog (issue #226) — the repo had zero context-loss
    // handling before this. Three.js re-uploads its own resources on
    // restore, but this pipeline's own render targets / textures (blurTarget,
    // outputTarget, gather targets) are NOT re-initialized here — that's
    // out of scope for this issue. This only makes the failure visible.
    attachContextLossWatchdog({ canvas: renderer.domElement, tool: 'moviemaker-render' });

    // Typed uniform interface for the blur shader
    interface BlurShaderUniforms {
        tDiffuse: { value: Texture | null };
        resolution: { value: Vector2 };
        blurRadius: { value: number };
        sigma: { value: number };
        brightness: { value: number };
        maxBrightness: { value: number };
        gamma: { value: number };
        direction: { value: Vector2 };
    }
    const blurUniforms: BlurShaderUniforms = {
        tDiffuse:   { value: null },
        resolution: { value: new Vector2(640, 480) },
        blurRadius: { value: initialUniforms?.blurRadius ?? 2 },
        sigma:      { value: initialUniforms?.sigma ?? 1 },
        brightness: { value: 1.0 },
        maxBrightness: { value: 1.0 },
        gamma:      { value: 1.0 },
        direction:  { value: new Vector2(1, 0) },
    };
    const shaderMaterial = new ShaderMaterial({
        uniforms: blurUniforms as unknown as Record<string, { value: unknown }>,
        vertexShader: BLUR_VERT,
        fragmentShader: BLUR_FRAG,
    });

    const mesh = new Mesh(geometry, shaderMaterial);
    scene.add(mesh);

    // Fullscreen quad scene shared by the copy (blit) and gather passes.
    const quadScene = new Scene();
    const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new PlaneGeometry(2, 2);
    interface CopyShaderUniforms { tDiffuse: { value: Texture | null } }
    const copyUniforms: CopyShaderUniforms = { tDiffuse: { value: null } };
    const copyMaterial = new ShaderMaterial({
        uniforms: copyUniforms as unknown as Record<string, { value: unknown }>,
        vertexShader: BLUR_VERT,
        fragmentShader: COPY_FRAG,
    });
    interface GatherShaderUniforms {
        tPositions: { value: Texture | null };
        tSource: { value: Texture | null };
        uResolution: { value: Vector2 };
        uTranslate: { value: Vector2 };
        uZoom: { value: number };
        uRotate: { value: number };
    }
    const gatherUniforms: GatherShaderUniforms = {
        tPositions:  { value: null },
        tSource:     { value: null },
        uResolution: { value: new Vector2(640, 480) },
        uTranslate:  { value: new Vector2(0, 0) },
        uZoom:       { value: 1 },
        uRotate:     { value: 0 },
    };
    const gatherMaterial = new ShaderMaterial({
        uniforms: gatherUniforms as unknown as Record<string, { value: unknown }>,
        vertexShader: BLUR_VERT,
        fragmentShader: GATHER_FRAG,
    });
    const quadMesh = new Mesh(quadGeometry, copyMaterial);
    quadScene.add(quadMesh);

    let blurTarget: WebGLRenderTarget | null = null;
    let outputTarget: WebGLRenderTarget | null = null;
    let videoTexture: VideoTexture | null = null;

    // ── LED gather state ──────────────────────────────────────────────────
    let positionTexture: DataTexture | null = null;
    let gatherTargets: (WebGLRenderTarget | null)[] = [null, null];
    let gatherBuffers: (Uint8Array | null)[] = [null, null];
    const slotBusy = [false, false];
    let nextSlot = 0;
    let gatherW = 0, gatherH = 0;
    let gatherNumPts = 0;
    let lastPtsRef: number[][] | null = null;
    let lastPtsW = 0, lastPtsH = 0;
    let latestSample: { buffer: Uint8Array; numPts: number } | null = null;

    function disposeGatherResources() {
        if (positionTexture) { positionTexture.dispose(); positionTexture = null; }
        gatherTargets.forEach(t => t?.dispose());
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
    function setupForResolution(w: number, h: number) {
        renderer.setSize(w, h, 'style' in renderer.domElement);

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
        if (videoPlayer) {
            videoTexture = new VideoTexture(videoPlayer);
            const vt = videoTexture;
            vt.minFilter = LinearFilter;
            vt.magFilter = LinearFilter;
            blurUniforms.tDiffuse.value = vt;
        }
        blurUniforms.resolution.value.set(w, h);

        const aspect = w / h;
        camera.left = -1;
        camera.right = 1;
        camera.top = 1 / aspect;
        camera.bottom = -1 / aspect;
        camera.updateProjectionMatrix();
        mesh.scale.set(1, 1 / aspect, 1);

        // The gather uResolution uniform depends on resolution — force the
        // next setSamplePoints to run (its guard also keys on w/h).
        lastPtsRef = null;
        latestSample = null;
    }

    /**
     * Update shader uniforms from current slider values.
     *
     * @param {{ blurRadius: number, sigma: number, brightness: number, maxBrightness: number, gamma: number }} values
     */
    function updateUniforms(values: { blurRadius: number; sigma: number; brightness: number; maxBrightness: number; gamma: number }) {
        const u = blurUniforms;
        u.blurRadius.value = values.blurRadius;
        u.sigma.value = values.sigma;
        u.brightness.value = values.brightness;
        u.maxBrightness.value = values.maxBrightness;
        u.gamma.value = values.gamma;
    }

    function renderBlurred(destTarget: WebGLRenderTarget, source: Texture | null = videoTexture) {
        const u = blurUniforms;
        const savedBri = u.brightness.value;
        const savedMaxBri = u.maxBrightness.value;
        const savedGamma = u.gamma.value;

        u.tDiffuse.value = source;
        u.direction.value.set(1, 0);
        u.brightness.value = 1.0;
        u.maxBrightness.value = 1.0;
        u.gamma.value = 1.0;
        renderer.setRenderTarget(blurTarget);
        renderer.render(scene, camera);

        if (blurTarget) u.tDiffuse.value = blurTarget.texture;
        u.direction.value.set(0, 1);
        u.brightness.value = savedBri;
        u.maxBrightness.value = savedMaxBri;
        u.gamma.value = savedGamma;
        renderer.setRenderTarget(destTarget);
        renderer.render(scene, camera);

        // Always restore the live-video binding so the realtime path is
        // unaffected by an offline frame having been rendered in between.
        u.tDiffuse.value = videoTexture;
    }

    /**
     * Render the two-pass blur into the offscreen output target, then blit
     * it to the visible canvas.
     */
    function renderFrame() {
        if (!outputTarget) return;
        renderBlurred(outputTarget);

        copyUniforms.tDiffuse.value = outputTarget.texture;
        quadMesh.material = copyMaterial;
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCamera);
    }

    /**
     * Upload LED positions in screenmap-local coordinates into the gather
     * position texture. Rotate/zoom/translate are NOT baked in — they are
     * applied per LED in the gather shader (see setSampleTransform), so this
     * upload only happens on screenmap or resolution change.
     * No-ops when the same points array (by reference) and resolution were
     * already uploaded, so callers can invoke this every frame cheaply.
     *
     * @param {Array<[number,number]>} pts - LED positions in screenmap-local coords (Y down)
     * @param {number} w - Video width
     * @param {number} h - Video height
     */
    function setSamplePoints(pts: number[][], w: number, h: number) {
        if (pts === lastPtsRef && w === lastPtsW && h === lastPtsH) return;
        lastPtsRef = pts;
        lastPtsW = w;
        lastPtsH = h;

        const numPts = pts.length;
        if (numPts === 0) {
            disposeGatherResources();
            return;
        }
        perfCount('positionUploads');

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

        gatherUniforms.uResolution.value.set(w, h);

        // Texel i (readPixels order: row 0 = bottom) maps to LED i.
        if (!positionTexture) return;
        const pt = positionTexture;
        const data = pt.image.data as Float32Array;
        for (let i = 0; i < numPts; i++) {
            const o = i * 4;
            const p = pts[i] ?? [0, 0];
            data[o]     = p[0] ?? 0;
            data[o + 1] = p[1] ?? 0;
            data[o + 2] = 0;
            data[o + 3] = 1;
        }
        data.fill(0, numPts * 4);
        pt.needsUpdate = true;
    }

    /**
     * Update the gather pass transform uniforms. Cheap — call every frame.
     *
     * @param {number} rotateDeg - rotation in degrees (about the screenmap origin)
     * @param {number} zoom - zoom factor
     * @param {number} translateX - translation x in video coords
     * @param {number} translateY - translation y in video coords
     */
    function setSampleTransform(rotateDeg: number, zoom: number, translateX: number, translateY: number) {
        const u = gatherUniforms;
        u.uRotate.value = rotateDeg * Math.PI / 180;
        u.uZoom.value = zoom;
        u.uTranslate.value.set(translateX, translateY);
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

        gatherUniforms.tPositions.value = positionTexture;
        gatherUniforms.tSource.value = outputTarget.texture;
        quadMesh.material = gatherMaterial;
        const slotTarget = gatherTargets[slot];
        if (!slotTarget) return;
        renderer.setRenderTarget(slotTarget);
        renderer.render(quadScene, quadCamera);
        renderer.setRenderTarget(null);

        slotBusy[slot] = true;
        const buffer = gatherBuffers[slot];
        if (!buffer) { slotBusy[slot] = false; return; }
        const numPts = gatherNumPts;
        renderer.readRenderTargetPixelsAsync(
            slotTarget, 0, 0, gatherW, gatherH, buffer,
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

    /**
     * True when both async-readback slots are in flight, i.e. the gather
     * pipeline is saturated and `requestSample()` would no-op. Realtime
     * recording of a pausable source uses this to apply backpressure —
     * slow the source instead of racing past it and losing frames (#266).
     */
    function isSampleBusy(): boolean {
        return slotBusy[0] === true && slotBusy[1] === true;
    }

    // Offline every-frame capture (issue #257 / #255 Phase 2) ---------------

    // Texture wrapper for WebCodecs frames; created lazily on the first
    // offline capture and reused for every subsequent frame.
    let frameTexture: VideoFrameTexture | null = null;

    /**
     * Render one decoded WebCodecs VideoFrame through the same blur+gather
     * pipeline as the realtime path and AWAIT its readback — deterministic
     * one-in/one-out, no slots racing the compositor. Also blits the blurred
     * frame to the visible canvas so the user sees render progress.
     *
     * Caller contract: the realtime `requestSample()` loop must be paused
     * while offline capture runs (both paths share the gather slot-0
     * target/buffer). Returns null when the pipeline isn't ready or slot 0
     * is unexpectedly still in flight.
     */
    async function captureFrameSample(frame: VideoFrame): Promise<{ buffer: Uint8Array; numPts: number } | null> {
        if (!positionTexture || !outputTarget) return null;
        const slot = 0;
        if (slotBusy[slot]) return null;
        const slotTarget = gatherTargets[slot];
        const buffer = gatherBuffers[slot];
        if (!slotTarget || !buffer) return null;

        frameTexture ??= (() => {
            const t = new VideoFrameTexture();
            t.minFilter = LinearFilter;
            t.magFilter = LinearFilter;
            return t;
        })();
        frameTexture.setFrame(frame);

        renderBlurred(outputTarget, frameTexture);
        copyUniforms.tDiffuse.value = outputTarget.texture;
        quadMesh.material = copyMaterial;
        renderer.setRenderTarget(null);
        renderer.render(quadScene, quadCamera);

        gatherUniforms.tPositions.value = positionTexture;
        gatherUniforms.tSource.value = outputTarget.texture;
        quadMesh.material = gatherMaterial;
        renderer.setRenderTarget(slotTarget);
        renderer.render(quadScene, quadCamera);
        renderer.setRenderTarget(null);

        slotBusy[slot] = true;
        try {
            await renderer.readRenderTargetPixelsAsync(slotTarget, 0, 0, gatherW, gatherH, buffer);
            return { buffer, numPts: gatherNumPts };
        } catch {
            return null; // context loss / disposal mid-read
        } finally {
            slotBusy[slot] = false;
        }
    }

    function dispose() {
        disposeGatherResources();
        if (frameTexture) { frameTexture.dispose(); frameTexture = null; }
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
        setSampleTransform,
        requestSample,
        getLatestSample,
        isSampleBusy,
        captureFrameSample,
        dispose,
    };
}
