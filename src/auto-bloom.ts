/**
 * Shared auto-bloom controller.
 *
 * Centralizes the FastLED-style bloom orchestration that the demo page, the
 * moviemaker preview and the movie player all need: an UnrealBloomPass driven
 * by an auto-bloom "iris" whose strength range is the conservative combination
 * of a size-proportional kernel (bloomParamsForLedSize) and a density envelope
 * (computeAutoBloomRange). The pure math stays in bloom-utils; the Three.js
 * passes stay in three-bloom; this module is the stateful glue.
 *
 * Per-tool differences are expressed as options rather than copy-pasted logic:
 *  - `profile`        density envelope constants (floor / maxDense / maxSparse)
 *  - `paramOverrides` bloomParamsForLedSize overrides (baseMax, radius, …)
 *  - `minFloorMode`   'density' raises the floor to the density envelope min so
 *                     dense maps don't collapse to an imperceptible strength
 *                     (preview, issue #49); 'size' uses the size-kernel min only
 *                     (demo / player).
 *  - `useBlowoutRisk` pass the geometry-derived iris modulation depth so
 *                     small/sparse dots hold full bloom (demo / player, #56);
 *                     omit to always fully modulate (preview).
 */

import type { WebGLRenderer, Scene, Camera } from 'three';
import { createBloomComposer, updateBloomIris } from './three-bloom';
import {
    computeAutoBloomRange,
    bloomParamsForLedSize,
    computeDiameterHeadroom,
    combineBloomBlowoutRisk,
    computeGlobalBloomBias,
    stepBloomExposure,
    BLOOM_MIN_STRENGTH,
} from './bloom-utils';
import type { BloomProfile, BloomRange } from './types/domain';

/** bloomParamsForLedSize overrides, fixed per tool. */
export interface AutoBloomParamOverrides {
    baseMax?: number;
    baseRadius?: number;
    refArea?: number;
    bloomResolution?: number;
}

export interface AutoBloomOptions {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: Camera;
    width: number;
    height: number;
    profile: BloomProfile;
    paramOverrides?: AutoBloomParamOverrides;
    /** How the effective strength floor is derived. Default 'size'. */
    minFloorMode?: 'size' | 'density';
    /** Pass the geometry-derived iris modulation depth. Default false. */
    useBlowoutRisk?: boolean;
    /**
     * Max fractional LED-diameter growth at full brightness on a fully sparse
     * layout (the iris "opening up" its aperture). 0 disables diameter
     * modulation. The effect is gated by layout geometry, so dense maps barely
     * grow even when this is set. Default 0.
     */
    diameterGain?: number;
}

/** Geometry inputs needed to (re)proportion the bloom kernel and envelope. */
export interface AutoBloomGeometry {
    /** Rendered dot size in CSS pixels (PointsMaterial.size). */
    ledPx: number;
    /** Pane size in CSS pixels (the world→pixel reference). */
    panePx: number;
    /** Number of rendered LEDs. */
    ledCount: number;
    /** LED spacing in the same units as sceneExtent. */
    ledSpacing: number;
    /** Bounding-box max dimension of the rendered points. */
    sceneExtent: number;
}

export function createAutoBloom({
    renderer,
    scene,
    camera,
    width,
    height,
    profile,
    paramOverrides = {},
    minFloorMode = 'size',
    useBlowoutRisk = false,
}: AutoBloomOptions) {
    const bloom = createBloomComposer({ renderer, scene, camera, width, height });
    const irisState = { currentBrightness: 0 };
    const bloomExposureState: { current: number | null; lastTimeMs?: number } = { current: null };

    // Size-proportional kernel range + geometry-derived modulation depth.
    const sizeRange: BloomRange = { min: 0, max: 0 };
    let blowoutRisk = 1;
    // Density envelope; seeded so the first frame (before setGeometry) is sane.
    let densityRange: BloomRange = {
        min: Math.max(BLOOM_MIN_STRENGTH, profile.floor * 0.5),
        max: profile.maxDense,
    };

    let autoEnabled = true;
    let manualStrength: number | null = null;
    let bloomEnabled = true; // false = render the scene without the bloom pass
    // Geometric room for the iris to grow the dot diameter (0 dense → 1 sparse).
    let diameterHeadroom = 0;

    /** Reproportion the kernel and density envelope to the current geometry. */
    function setGeometry({ ledPx, panePx, ledCount, ledSpacing, sceneExtent }: AutoBloomGeometry) {
        const params = bloomParamsForLedSize(ledPx, panePx, ledCount, paramOverrides);
        bloom.bloomPass.radius = params.radius;
        sizeRange.min = params.minStrength;
        sizeRange.max = params.maxStrength;
        densityRange = computeAutoBloomRange({ ledSpacing, sceneExtent, profile });
        diameterHeadroom = computeDiameterHeadroom(ledPx, panePx, ledSpacing, sceneExtent);
        blowoutRisk = combineBloomBlowoutRisk(params.blowoutRisk, diameterHeadroom);
    }

    /**
     * Iris eliminated (#496 Phase 0, user direction): the diameter no longer
     * breathes with brightness. Exposure control is the tone curve's job.
     */
    function getDiameterScale() {
        return 1;
    }

    /** Update the iris/strength from one frame's RGB bytes. */
    /**
     * Update bloom from a frame. Offline production may pass the media clock
     * so the iris follows video time rather than a tight encode-loop clock.
     */
    function frame(rgbBytes: Uint8Array | number[], nowMs = performance.now()) {
        // Conservative combination: neither ceiling is exceeded, and the floor
        // stays strictly positive without rising above the ceiling.
        const effMax = Math.min(sizeRange.max, densityRange.max);
        const effMin = minFloorMode === 'density'
            ? Math.min(Math.max(sizeRange.min, densityRange.min), effMax)
            : Math.min(sizeRange.min, effMax);
        const range = useBlowoutRisk
            ? { min: effMin, max: effMax, blowoutRisk }
            : { min: effMin, max: effMax };
        // Iris eliminated (#496 Phase 0): auto mode uses the geometry
        // envelope's ceiling as a FIXED treatment instead of brightness-
        // modulated strength. Measured basis: at fixed strength the composite
        // merges driven regions at 0.83-0.97; the brightness modulation was
        // starving exactly the frames that should white out, and the tone
        // curve's toe/shoulder now owns wash control. Brightness is still
        // tracked below for the exposure-bias bracket selector.
        const override = autoEnabled ? effMax : manualStrength;
        const frameBrightness = updateBloomIris(bloom.bloomPass, irisState, rgbBytes, range, override, nowMs);
        // Manual bloom must be a fixed treatment. A changing global selector
        // would otherwise keep altering the bracket mix despite fixed strength.
        if (!autoEnabled) return 0;
        const targetExposure = computeGlobalBloomBias(frameBrightness);
        if (bloomExposureState.current === null || bloomExposureState.lastTimeMs === undefined) {
            // Unlike the pupil-like iris, bloom selection has no useful
            // adaptation from black on the first frame. Seed it at exposure.
            bloomExposureState.current = targetExposure;
        } else {
            const dt = Math.max((nowMs - bloomExposureState.lastTimeMs) / 1000, 0);
            bloomExposureState.current = stepBloomExposure(bloomExposureState.current, targetExposure, dt);
        }
        bloomExposureState.lastTimeMs = nowMs;
        return bloomExposureState.current;
    }

    /** Render one frame: bloom composer, or the raw scene when bloom is off. */
    function render() {
        if (!bloomEnabled) {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            return;
        }
        bloom.render();
    }

    /** Render bloom into the composer's RGBA16F linear-light target. */
    function renderToTexture() {
        if (!bloomEnabled) return null;
        return bloom.renderToTexture();
    }

    /** Raw scene through the composer path (see three-bloom.ts). */
    function renderBaseToTexture() {
        return bloom.renderBaseToTexture();
    }

    function setAuto(enabled: boolean) {
        autoEnabled = enabled;
        if (enabled) manualStrength = null;
        // Re-seed from the next media frame when modes change; carrying an
        // automatic exposure history through manual mode causes a visible jump.
        bloomExposureState.current = null;
        delete bloomExposureState.lastTimeMs;
    }

    function setManualStrength(strength: number) {
        manualStrength = strength;
    }

    function setEnabled(enabled: boolean) {
        bloomEnabled = enabled;
    }

    function getStrength() {
        return bloom.bloomPass.strength;
    }

    function setSize(w: number, h: number) {
        bloom.setSize(w, h);
    }

    function dispose() {
        bloom.dispose();
    }

    return {
        bloomPass: bloom.bloomPass,
        setGeometry,
        getDiameterScale,
        frame,
        render,
        renderToTexture,
        renderBaseToTexture,
        setAuto,
        setManualStrength,
        setEnabled,
        getStrength,
        setSize,
        dispose,
    };
}
