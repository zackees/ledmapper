/**
 * Shared bloom UI wiring: the "auto checkbox + manual strength slider +
 * localStorage" orchestration that every video tool repeated by hand.
 *
 * The pure strength<->slider math and the bloom target are injected, so each
 * tool keeps its exact mapping/constants while this module owns the glue
 * (persistence, disabled-state styling, the seed-on-toggle dance, readout).
 *
 * Returns a small controller behind a stable signature so the rendering
 * internals can later be swapped (e.g. reactive signals, see #72) without
 * touching callers.
 */

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
     * 'opacity' = add `opacity-50 pointer-events-none` (demo/movieplayer),
     * 'class'   = toggle a `disabled` class (moviemaker).
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
        signal,
    } = cfg;

    function applyAutoState(enabled: boolean) {
        slider.disabled = enabled;
        if (disabledStyle === 'opacity') {
            if (enabled) {
                sliderWrap.classList.add('opacity-50', 'pointer-events-none');
                sliderWrap.classList.remove('opacity-100');
            } else {
                sliderWrap.classList.remove('opacity-50', 'pointer-events-none');
                sliderWrap.classList.add('opacity-100');
            }
        } else {
            sliderWrap.classList.toggle('disabled', enabled);
        }
        adapter.setAuto(enabled);
    }

    function applyManualFromSlider() {
        const strength = strengthFromSlider(parseInt(slider.value));
        label.innerText = formatLabel(strength);
        adapter.setManualStrength(strength);
    }

    // Restore persisted auto-bloom state (default: on).
    const stored = localStorage.getItem(lsKey);
    const init = stored === null ? true : stored === 'true';
    chk.checked = init;
    applyAutoState(init);

    chk.addEventListener('change', () => {
        const enabled = chk.checked;
        localStorage.setItem(lsKey, String(enabled));
        if (!enabled) {
            // Seed the slider from the current strength so there's no jump.
            const seed = sliderFromStrength(adapter.getStrength());
            slider.value = String(Math.min(Math.max(seed, 0), 100));
            applyManualFromSlider();
        }
        applyAutoState(enabled);
    }, { signal });

    slider.addEventListener('input', applyManualFromSlider, { signal });

    function setAuto(enabled: boolean) {
        chk.checked = enabled;
        localStorage.setItem(lsKey, String(enabled));
        applyAutoState(enabled);
    }

    return { setAuto };
}
