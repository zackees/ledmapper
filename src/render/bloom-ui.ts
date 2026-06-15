/**
 * Shared bloom UI wiring: the "auto checkbox + manual strength slider +
 * localStorage" orchestration that every video tool repeated by hand.
 *
 * The pure strength<->slider math and the bloom target are injected, so each
 * tool keeps its exact mapping/constants while this module owns the glue
 * (persistence, disabled-state styling, the seed-on-toggle dance, readout).
 *
 * State lives in two signals (auto on/off, slider position); effects own the
 * state->DOM and state->controller sync so there are no hand-written "when X
 * changes also update Y and Z" sites (see #72). The public signature is
 * unchanged, so callers don't know the internals went reactive.
 */
import { effect, signal } from '../ui/signal';

/** The bloom controller surface this wiring drives (auto-bloom or preview). */
export interface BloomControlsAdapter {
    setAuto: (enabled: boolean) => void;
    getStrength: () => number;
    setManualStrength: (strength: number) => void;
}

export interface BloomControlsConfig {
    /** Auto-bloom checkbox (#chk_auto_bloom). */
    chk: HTMLInputElement;
    /** Manual strength range input (#rng_bloom_strength). */
    slider: HTMLInputElement;
    /** Wrapper element whose disabled styling is toggled with auto state. */
    sliderWrap: HTMLElement;
    /** Readout label for the current strength (#txt_curr_bloom_strength). */
    label: HTMLElement;
    /** localStorage key persisting the auto on/off state. */
    lsKey: string;
    /** Bloom target driven by this UI. */
    adapter: BloomControlsAdapter;
    /** Forward map: slider value (0-100) -> bloom strength. */
    strengthFromSlider: (rngVal: number) => number;
    /** Inverse map: bloom strength -> slider value, to seed on auto->manual. */
    sliderFromStrength: (strength: number) => number;
    /**
     * How to visually disable the manual slider while auto is on.
     * 'opacity' = toggle the shared `.is-disabled` class from global.css
     *            (demo/movieplayer, which use the `.control-row` shell),
     * 'class'   = toggle a `disabled` class on the wrapper (moviemaker,
     *            which has its own `.slider-container.disabled` rule).
     */
    disabledStyle?: 'opacity' | 'class';
    /** Format strength for the readout. Defaults to 2 decimal places. */
    formatLabel?: (strength: number) => string;
    signal?: AbortSignal;
}

export interface BloomControls {
    /** Programmatically set the auto on/off state (also updates the checkbox). */
    setAuto: (enabled: boolean) => void;
}

export function wireBloomControls(cfg: BloomControlsConfig): BloomControls {
    const {
        chk, slider, sliderWrap, label, lsKey, adapter,
        strengthFromSlider, sliderFromStrength,
        disabledStyle = 'opacity',
        formatLabel = (s: number) => s.toFixed(2),
        signal: abortSignal,
    } = cfg;

    const clampSlider = (v: number) => Math.min(Math.max(v, 0), 100);

    // Restore persisted auto-bloom state (default: on).
    const stored = localStorage.getItem(lsKey);
    const auto = signal(stored === null ? true : stored === 'true');
    const sliderVal = signal(clampSlider(parseInt(slider.value) || 0));

    // auto state -> checkbox, disabled styling, controller.
    effect(() => {
        const enabled = auto.get();
        chk.checked = enabled;
        slider.disabled = enabled;
        if (disabledStyle === 'opacity') {
            sliderWrap.classList.toggle('is-disabled', enabled);
        } else {
            sliderWrap.classList.toggle('disabled', enabled);
        }
        adapter.setAuto(enabled);
    });

    // slider position -> readout, and -> manual strength while in manual mode.
    effect(() => {
        const strength = strengthFromSlider(sliderVal.get());
        label.innerText = formatLabel(strength);
        if (!auto.get()) adapter.setManualStrength(strength);
    });

    const listenerOpts: AddEventListenerOptions = abortSignal ? { signal: abortSignal } : {};

    chk.addEventListener('change', () => {
        const enabled = chk.checked;
        localStorage.setItem(lsKey, String(enabled));
        if (!enabled) {
            // Seed the slider from the current strength so there's no jump.
            const seed = clampSlider(sliderFromStrength(adapter.getStrength()));
            slider.value = String(seed);
            sliderVal.set(seed);
        }
        auto.set(enabled);
    }, listenerOpts);

    slider.addEventListener('input', () => {
        sliderVal.set(clampSlider(parseInt(slider.value) || 0));
    }, listenerOpts);

    function setAuto(enabled: boolean) {
        localStorage.setItem(lsKey, String(enabled));
        auto.set(enabled);
    }

    return { setAuto };
}
