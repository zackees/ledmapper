/**
 * Bundle the FastLED-style ("demo") bloom setup that the demo + movieplayer
 * tools were duplicating verbatim: `createAutoBloom` with the shared demo
 * profile + `wireBloomControls` with the standard auto/manual slider mapping.
 *
 * Issue #119 Phase 2 — both tools used the same DEMO_PROFILE, the same
 * paramOverrides (baseMax / baseRadius / refArea), the same minFloorMode
 * 'size' + useBlowoutRisk: true + IRIS_DIAMETER_GAIN, and the same
 * S_MIN / S_MAX strength-mapping math. The only per-tool inputs are the
 * canvas wrapper, the DOM elements, and the localStorage key for the
 * auto-bloom checkbox state.
 */

import type { WebGLRenderer, Scene, OrthographicCamera } from 'three';

import { createAutoBloom } from '../auto-bloom';

/** The handle returned by `createAutoBloom`. */
type AutoBloomController = ReturnType<typeof createAutoBloom>;
import {
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_DENSE,
    DEMO_AUTO_MAX_SPARSE,
    DEMO_BLOOM_MAX_STRENGTH,
    DEMO_BLOOM_RADIUS,
    DEMO_BLOOM_AREA_REF,
    IRIS_DIAMETER_GAIN,
    BLOOM_MIN_STRENGTH,
} from '../bloom-utils';
import { wireBloomControls } from './bloom-ui';

export interface DemoBloomSetupConfig {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: OrthographicCamera;
    /** Canvas dimensions in CSS px (square pane). */
    paneSize: number;
    /** Auto-bloom checkbox. */
    chk: HTMLInputElement;
    /** Manual strength slider. */
    slider: HTMLInputElement;
    /** Wrapper element that styles the slider's disabled-while-auto state. */
    sliderWrap: HTMLElement;
    /** Readout span for the slider's current strength value. */
    label: HTMLElement;
    /** localStorage key for the auto-bloom on/off state. */
    lsKey: string;
    /** Optional abort signal to detach listeners. */
    signal?: AbortSignal;
}

/**
 * Returns the `AutoBloomController` so the caller can drive
 * `setGeometry` / `frame` / `render` from its animation loop, and call
 * `dispose` on teardown.
 */
export function setupDemoStyleBloom(cfg: DemoBloomSetupConfig): AutoBloomController {
    const { renderer, scene, camera, paneSize, chk, slider, sliderWrap, label, lsKey, signal } = cfg;
    const profile = {
        floor:     DEMO_AUTO_FLOOR,
        maxDense:  DEMO_AUTO_MAX_DENSE,
        maxSparse: DEMO_AUTO_MAX_SPARSE,
    };
    const bloom = createAutoBloom({
        renderer, scene, camera,
        width: paneSize, height: paneSize,
        profile,
        paramOverrides: {
            baseMax:    DEMO_BLOOM_MAX_STRENGTH,
            baseRadius: DEMO_BLOOM_RADIUS,
            refArea:    DEMO_BLOOM_AREA_REF,
        },
        minFloorMode: 'size',
        useBlowoutRisk: true,
        diameterGain: IRIS_DIAMETER_GAIN,
    });

    const S_MIN = Math.max(BLOOM_MIN_STRENGTH, DEMO_AUTO_FLOOR * 0.5);
    const S_MAX = DEMO_BLOOM_MAX_STRENGTH;
    const sparseCeil = DEMO_AUTO_MAX_SPARSE * 1.5;

    wireBloomControls({
        chk, slider, sliderWrap, label, lsKey,
        adapter: {
            setAuto:            (e) => { bloom.setAuto(e); },
            getStrength:        () => bloom.getStrength(),
            setManualStrength:  (s) => { bloom.setManualStrength(s); },
        },
        strengthFromSlider: (rngVal) =>
            S_MIN + (S_MAX - S_MIN) * (rngVal / 100) ** 2,
        sliderFromStrength: (curr) => {
            const raw = (curr - S_MIN) / (sparseCeil - S_MIN);
            return Math.round(Math.sqrt(Math.max(raw, 0)) * 100);
        },
        disabledStyle: 'opacity',
        ...(signal !== undefined ? { signal } : {}),
    });

    return bloom;
}
