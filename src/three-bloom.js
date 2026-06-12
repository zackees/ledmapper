/**
 * Opt-in Three.js bloom helpers (FastLED-style UnrealBloomPass).
 *
 * Kept separate from three-utils.js so consumers that don't use bloom
 * (movieplayer, shapeeditor) don't pull in the postprocessing addons.
 * The pure math lives in bloom-utils.js.
 */

import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    BLOOM_MAX_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
    computeFrameBrightness,
    stepIris,
    computeBloomStrength,
} from './bloom-utils.js';

/**
 * Wire an EffectComposer with a RenderPass + UnrealBloomPass.
 * Call `render()` instead of `renderer.render(scene, camera)` when bloom
 * is active.
 *
 * @param {Object} opts
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {number} opts.width - CSS pixel width of the render surface.
 * @param {number} opts.height - CSS pixel height of the render surface.
 * @param {number} [opts.strength=BLOOM_MAX_STRENGTH]
 * @param {number} [opts.radius=BLOOM_RADIUS]
 * @param {number} [opts.threshold=BLOOM_THRESHOLD]
 * @returns {{ composer: EffectComposer, bloomPass: UnrealBloomPass, render: function(): void, setSize: function(number, number): void, dispose: function(): void }}
 */
export function createBloomComposer({ renderer, scene, camera, width, height, strength = BLOOM_MAX_STRENGTH, radius = BLOOM_RADIUS, threshold = BLOOM_THRESHOLD }) {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new Vector2(width, height), strength, radius, threshold);
    composer.addPass(bloomPass);

    return {
        composer,
        bloomPass,
        render() { composer.render(); },
        setSize(w, h) { composer.setSize(w, h); },
        dispose() {
            bloomPass.dispose();
            composer.dispose();
        },
    };
}

/**
 * Per-frame auto-bloom "iris" update: track average LED brightness and
 * scale the bloom pass strength inversely (FastLED's _updateAutoBrightness).
 * Call before composer.render().
 *
 * @param {UnrealBloomPass} bloomPass
 * @param {{currentBrightness: number}} irisState - mutated in place.
 * @param {Uint8Array|number[]} rgbBytes - this frame's LED colors, 3 bytes per LED.
 * @param {{min?: number, max?: number}} [range] - strength range override
 *        (small render surfaces need a lower max — bloom mips cover a
 *        proportionally larger area, so full FastLED strength whites out).
 * @param {number|null} [manualStrength=null] - when provided, override the
 *        computed strength directly; the iris LERP still advances so
 *        re-enabling auto is smooth (no strength jump).
 */
export function updateBloomIris(bloomPass, irisState, rgbBytes, range, manualStrength = null) {
    const { avgBrightness, litCount, totalCount } = computeFrameBrightness(rgbBytes);
    irisState.currentBrightness = stepIris(irisState.currentBrightness, avgBrightness);
    if (manualStrength !== null) {
        bloomPass.strength = manualStrength;
    } else {
        bloomPass.strength = computeBloomStrength(irisState.currentBrightness, litCount, totalCount, range);
    }
}
