/**
 * setupToggleButton — primitive for two-state buttons.
 *
 * Hoists presentation strings (label, glyph, title) out of click
 * handlers (#192). The handler sets `el.dataset.state`; CSS owns the
 * glyph + visual via `[data-state="..."]` selectors; the label table
 * the consumer passes at mount time owns the accessible name.
 *
 * Three lines at the call site, no `innerHTML = '&#9654;'` ever.
 *
 * Example:
 *
 *     // CSS (in tool stylesheet):
 *     .play-pause-btn::before { content: '\25B6'; }                // ▶
 *     .play-pause-btn[data-state="on"]::before { content: '\23F8'; } // ⏸
 *
 *     // TS:
 *     const ctl = setupToggleButton(btn, {
 *         off: { state: 'off', label: 'Play' },
 *         on:  { state: 'on',  label: 'Pause' },
 *     }, 'off', (next) => {
 *         videoSource.playPause();
 *     });
 *
 *     // Anywhere later, when state changes externally:
 *     ctl.setState('on');
 */

export interface ToggleState {
    /** Value written to `el.dataset.state`. CSS keys off this. */
    state: string;
    /** Accessible label. Set on `aria-label` and `title`. */
    label: string;
}

export interface ToggleController {
    /** Flip without firing the click handler. Used to sync external state. */
    setState(which: 'off' | 'on'): void;
    /** Current logical position. */
    readonly current: 'off' | 'on';
}

export interface ToggleStates {
    off: ToggleState;
    on: ToggleState;
}

export interface SetupToggleButtonOptions {
    signal?: AbortSignal;
}

export function setupToggleButton(
    el: HTMLButtonElement,
    states: ToggleStates,
    initial: 'off' | 'on',
    onClick: (next: 'off' | 'on') => void,
    opts: SetupToggleButtonOptions = {},
): ToggleController {
    let current: 'off' | 'on' = initial;

    function apply(which: 'off' | 'on') {
        current = which;
        const s = states[which];
        el.dataset.state = s.state;
        el.setAttribute('aria-label', s.label);
        el.title = s.label;
    }

    apply(initial);

    const handleClick = () => {
        const next: 'off' | 'on' = current === 'off' ? 'on' : 'off';
        apply(next);
        onClick(next);
    };
    el.addEventListener('click', handleClick, opts.signal !== undefined ? { signal: opts.signal } : undefined);

    return {
        setState(which) { apply(which); },
        get current() { return current; },
    };
}
