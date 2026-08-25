/**
 * Opt-in Three.js bloom helpers (FastLED-style UnrealBloomPass).
 *
 * Kept separate from three-utils.js so consumers that don't use bloom
 * (movieplayer, shapeeditor) don't pull in the postprocessing addons.
 * The pure math lives in bloom-utils.js.
 */

import type { WebGLRenderer, Scene, Camera } from 'three';
import { Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
    BLOOM_MAX_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
    computeFrameBrightness,
    stepIrisAttackDecay,
    computeBloomStrength,
    IRIS_LIGHT_LATENCY,
} from './bloom-utils';
import type { IrisState, BloomStrengthRange, FrameBrightnessResult } from './types/domain';
import type { BloomMipWeights } from './bloom-frequency';

/**
 * Select which UnrealBloom spatial bands contribute to the final field.
 *
 * Tint colors are used instead of the pass's `bloomFactors`: Three's radius
 * control mirrors every factor toward `1.2 - factor`, so a zero factor starts
 * contributing again whenever radius is non-zero. A zero tint is the only
 * radius-independent way to remove a mip without forking UnrealBloomPass.
 */
export function setBloomMipWeights(
    bloomPass: UnrealBloomPass,
    weights: BloomMipWeights | undefined,
): void {
    const active = weights ?? [1, 1, 1, 1, 1];
    for (let index = 0; index < bloomPass.bloomTintColors.length; index++) {
        const weight = Math.max(active[index] ?? 0, 0);
        bloomPass.bloomTintColors[index]?.setScalar(weight);
    }
}

export function createBloomComposer({
    renderer,
    scene,
    camera,
    width,
    height,
    strength = BLOOM_MAX_STRENGTH,
    radius = BLOOM_RADIUS,
    threshold = BLOOM_THRESHOLD,
}: {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
    strength?: number;
    radius?: number;
    threshold?: number;
}) {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new Vector2(width, height), strength, radius, threshold);
    composer.addPass(bloomPass);

    return {
        composer,
        bloomPass,
        render() { composer.render(); },
        renderToTexture() {
            const previous = composer.renderToScreen;
            composer.renderToScreen = false;
            composer.render();
            composer.renderToScreen = previous;
            return composer.readBuffer.texture;
        },
        /**
         * Render the scene WITHOUT bloom through the same composer path.
         *
         * The HDR bracket capture subtracts the raw scene from bloomed
         * brackets. Capturing raw via a direct render disagrees with the
         * composer's multisampled scene render by up to half a pixel of
         * coverage at every sprite edge; the clamped subtraction then zeroes
         * glow in a ring around every dot (#493's black rings). Rendering
         * the raw frame through the composer makes the two pixel-identical.
         */
        renderBaseToTexture() {
            const previous = composer.renderToScreen;
            const bloomWasEnabled = bloomPass.enabled;
            composer.renderToScreen = false;
            bloomPass.enabled = false;
            composer.render();
            bloomPass.enabled = bloomWasEnabled;
            composer.renderToScreen = previous;
            return composer.readBuffer.texture;
        },
        setSize(w: number, h: number) { composer.setSize(w, h); },
        dispose() {
            bloomPass.dispose();
            composer.dispose();
        },
    };
}

export function updateBloomIris(
    bloomPass: UnrealBloomPass,
    irisState: IrisState,
    rgbBytes: Uint8Array | number[],
    range: BloomStrengthRange | null | undefined,
    manualStrength: number | null = null,
    nowMs = performance.now(),
): FrameBrightnessResult {
    const frameBrightness = computeFrameBrightness(rgbBytes);
    const { irisBrightness, litCount, totalCount } = frameBrightness;
    const dtSeconds = typeof irisState.lastTimeMs === 'number'
        ? (nowMs - irisState.lastTimeMs) / 1000
        : 0;
    irisState.lastTimeMs = nowMs;
    const history = irisState.brightnessHistory ??= [];
    history.push({ timeMs: nowMs, brightness: irisBrightness });
    const delayedTime = nowMs - IRIS_LIGHT_LATENCY * 1000;
    let delayedBrightness = irisState.delayedBrightness ?? irisState.currentBrightness;
    let latestEligible = -1;
    for (let index = 0; index < history.length; index++) {
        const sample = history[index];
        if (sample && sample.timeMs <= delayedTime) latestEligible = index;
        else break;
    }
    if (latestEligible >= 0) {
        delayedBrightness = history[latestEligible]?.brightness ?? delayedBrightness;
        history.splice(0, latestEligible + 1);
    }
    irisState.delayedBrightness = delayedBrightness;
    irisState.currentBrightness = stepIrisAttackDecay(irisState.currentBrightness, delayedBrightness, dtSeconds);
    if (manualStrength !== null) {
        bloomPass.strength = manualStrength;
    } else {
        bloomPass.strength = computeBloomStrength(irisState.currentBrightness, litCount, totalCount, range ?? undefined);
    }
    return frameBrightness;
}
