/**
 * Wire the standard demo-style bloom UI (auto checkbox + manual
 * strength slider with localStorage persistence) to a `Gfx` instance.
 *
 * Pulled out of `src/render/demo-bloom-setup.ts`: the helper previously
 * created its own `AutoBloomController` via `createAutoBloom`. The
 * controller is now private to the gfx package — this helper just
 * wires UI events to `gfx.setBloom` / `gfx.getBloomStrength`.
 */

import { wireBloomControls } from '../render/bloom-ui.js';
import {
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_SPARSE,
    DEMO_BLOOM_MAX_STRENGTH,
    BLOOM_MIN_STRENGTH,
} from '../bloom-utils.js';
import type { Gfx } from './types.js';

export interface WireBloomUiConfig {
    gfx: Gfx;
    /** Auto-bloom checkbox. */
    chk: HTMLInputElement;
    /** Manual strength slider (0..100). */
    slider: HTMLInputElement;
    /** Wrapper for the slider used for the auto-disabled visual state. */
    sliderWrap: HTMLElement;
    /** Readout span for the current strength value. */
    label: HTMLElement;
    /** localStorage key for the auto checkbox's persisted state. */
    lsKey: string;
    signal?: AbortSignal;
}

export function wireBloomUi(cfg: WireBloomUiConfig): void {
    const { gfx, chk, slider, sliderWrap, label, lsKey, signal } = cfg;
    const S_MIN = Math.max(BLOOM_MIN_STRENGTH, DEMO_AUTO_FLOOR * 0.5);
    const S_MAX = DEMO_BLOOM_MAX_STRENGTH;
    const sparseCeil = DEMO_AUTO_MAX_SPARSE * 1.5;

    wireBloomControls({
        chk, slider, sliderWrap, label, lsKey,
        adapter: {
            setAuto: (e) => {
                gfx.setBloom(e
                    ? { mode: 'auto' }
                    : { mode: 'manual', strength: gfx.getBloomStrength() });
            },
            getStrength:       () => gfx.getBloomStrength(),
            setManualStrength: (s) => { gfx.setBloom({ mode: 'manual', strength: s }); },
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
}
