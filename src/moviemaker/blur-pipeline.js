/**
 * Three.js two-pass Gaussian blur rendering pipeline for video processing.
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
    VideoTexture,
} from 'three';
import { BLUR_VERT, BLUR_FRAG } from './shaders.js';

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
    const renderer = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    const geometry = new PlaneGeometry(2, 2);

    const shaderMaterial = new ShaderMaterial({
        uniforms: {
            tDiffuse:   { value: null },
            resolution: { value: new Vector2(640, 480) },
            blurRadius: { value: initialUniforms.blurRadius },
            sigma:      { value: initialUniforms.sigma },
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

    /**
     * Set up the pipeline for a new video resolution.
     *
     * @param {number} w - Video width
     * @param {number} h - Video height
     */
    function setupForResolution(w, h) {
        renderer.setSize(w, h);
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
    }

    /**
     * Update shader uniforms from current slider values.
     *
     * @param {{ blurRadius: number, sigma: number, brightness: number, gamma: number }} values
     */
    function updateUniforms(values) {
        const u = shaderMaterial.uniforms;
        u.blurRadius.value = values.blurRadius;
        u.sigma.value = values.sigma;
        u.brightness.value = values.brightness;
        u.gamma.value = values.gamma;
    }

    /**
     * Perform the two-pass Gaussian blur render.
     * If destTarget is null, renders to the screen.
     *
     * @param {THREE.WebGLRenderTarget|null} destTarget
     */
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

    /**
     * Render blurred to screen and read back pixel data.
     *
     * @param {number} w - Video width
     * @param {number} h - Video height
     * @returns {Uint8Array} RGBA pixel buffer
     */
    function readbackPixels(w, h) {
        renderBlurred(null);
        const gl = renderer.getContext();
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, readbackBuffer);
        return readbackBuffer;
    }

    function dispose() {
        if (blurTarget) blurTarget.dispose();
        if (videoTexture) videoTexture.dispose();
        shaderMaterial.dispose();
        geometry.dispose();
        renderer.dispose();
    }

    return {
        setupForResolution,
        updateUniforms,
        renderBlurred,
        readbackPixels,
        dispose,
    };
}
