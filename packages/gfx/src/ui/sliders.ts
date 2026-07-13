/**
 * Generic slider wiring for the "label + range + readout" pattern that the
 * tools (demo, movieplayer, moviemaker, screenmap) all use.
 *
 * Replaces N copies of:
 *
 *   slider.addEventListener('input', () => {
 *       readout.textContent = format(slider.value);
 *       … do something with the value …
 *   }, { signal });
 *
 * with one call to `wireSliderReadout({ slider, readout, format, onChange, signal })`.
 *
 * The helper also fires its update logic once at startup so the readout
 * matches the slider's initial value without the caller having to manually
 * dispatch a synthetic `input` event.
 */

export interface WireSliderReadoutOptions {
    /** The `<input type="range">` (or any element with a `.value` string). */
    slider: HTMLInputElement;
    /**
     * Optional element whose `textContent` is set to the formatted value.
     * Omit when the only thing the slider drives is the `onChange` callback.
     */
    readout?: HTMLElement | null;
    /**
     * How to convert the raw `slider.value` string into the readout text.
     * Defaults to the raw string. Useful for "%", "1.0", or "16.00" displays.
     */
    format?: (rawValue: string) => string;
    /**
     * Side-effect to run on every change (and once at startup). Receives the
     * raw slider.value string; parse it however you need.
     */
    onChange?: (rawValue: string) => void;
    /** AbortSignal to detach the listener when the tool tears down. */
    signal?: AbortSignal;
}

/**
 * Wire a slider's `input` event to update a readout label and/or run a
 * side-effect. Runs the update once immediately so the UI matches the
 * slider's initial value. Returns a getter for the current raw value.
 */
export function wireSliderReadout(opts: WireSliderReadoutOptions): () => string {
    const { slider, readout, format, onChange, signal } = opts;
    function update() {
        if (readout) {
            readout.textContent = format ? format(slider.value) : slider.value;
        }
        onChange?.(slider.value);
    }
    const listenerOpts: AddEventListenerOptions = signal !== undefined ? { signal } : {};
    slider.addEventListener('input', update, listenerOpts);
    update();
    return () => slider.value;
}
