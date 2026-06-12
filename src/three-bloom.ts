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
} from './bloom-utils';
import type { IrisState, BloomRange } from './types/domain';

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
    range: BloomRange | null | undefined,
    manualStrength: number | null = null,
    nowMs = performance.now(),
): void {
    const { avgBrightness, litCount, totalCount } = computeFrameBrightness(rgbBytes);
    const dtSeconds = typeof irisState.lastTimeMs === 'number'
        ? (nowMs - irisState.lastTimeMs) / 1000
        : 0;
    irisState.lastTimeMs = nowMs;
    irisState.currentBrightness = stepIrisAttackDecay(irisState.currentBrightness, avgBrightness, dtSeconds);
    if (manualStrength !== null) {
        bloomPass.strength = manualStrength;
    } else {
        bloomPass.strength = computeBloomStrength(irisState.currentBrightness, litCount, totalCount, range ?? undefined);
    }
}
