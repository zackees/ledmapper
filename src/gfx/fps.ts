/**
 * FPS counter for the gfx package.
 *
 * Three signals so a developer can tell apart "renderer is slow" from
 * "frame source is slow":
 *
 *   renderFps   – measured from the internal animation loop
 *   pushFps     – measured from gfx.pushFrame() call rate
 *   frameTimeMs – P50 of recent inter-frame deltas (catches stalls)
 *
 * The measurement primitive is `FpsMeter` — `tick(now)` per event, then
 * `get()` reads the current rate. No allocations on the hot path.
 *
 * The widget is a one-line absolutely-positioned overlay. Toggle state
 * persists to localStorage so the user's preference survives reloads.
 */

const LS_KEY = 'gfx.fps.visible';

/**
 * Exponentially-weighted FPS meter + ring buffer of recent inter-frame
 * deltas for the P50 frame-time readout.
 */
export class FpsMeter {
    private lastT = 0;
    private ewma = 0;
    private readonly alpha = 0.1;
    private readonly samples: number[];
    private sampleIdx = 0;
    private sampleCount = 0;
    constructor(private readonly windowSize = 30) {
        this.samples = new Array(windowSize).fill(0) as number[];
    }
    tick(now: number): void {
        if (this.lastT !== 0) {
            const dt = now - this.lastT;
            if (dt > 0) {
                this.ewma = this.ewma === 0 ? dt : this.ewma * (1 - this.alpha) + dt * this.alpha;
                this.samples[this.sampleIdx] = dt;
                this.sampleIdx = (this.sampleIdx + 1) % this.windowSize;
                if (this.sampleCount < this.windowSize) this.sampleCount++;
            }
        }
        this.lastT = now;
    }
    /** Estimated frames per second. 0 until two ticks have landed. */
    getFps(): number {
        if (this.ewma <= 0) return 0;
        return 1000 / this.ewma;
    }
    /** Median inter-frame delta in milliseconds over the recent window. */
    getMedianFrameMs(): number {
        if (this.sampleCount === 0) return 0;
        // Cheap copy + sort; window is tiny (default 30).
        const slice = this.samples.slice(0, this.sampleCount).sort((a, b) => a - b);
        return slice[Math.floor(slice.length / 2)] ?? 0;
    }
    reset(): void {
        this.lastT = 0;
        this.ewma = 0;
        this.sampleIdx = 0;
        this.sampleCount = 0;
    }
}

export interface FpsStats {
    renderFps: number;
    pushFps: number;
    frameTimeMs: number;
    framesRendered: number;
}

/**
 * Read the persisted visibility flag. Returns the explicit option when
 * provided, else the localStorage value, else `false`.
 */
export function resolveInitialVisibility(explicit: boolean | undefined): boolean {
    if (explicit !== undefined) return explicit;
    try {
        return localStorage.getItem(LS_KEY) === '1';
    } catch {
        // localStorage can throw in private mode / sandboxes — assume off.
        return false;
    }
}

export function persistVisibility(visible: boolean): void {
    try {
        localStorage.setItem(LS_KEY, visible ? '1' : '0');
    } catch {
        // Ignore — best-effort persistence.
    }
}

/**
 * Build the FPS counter widget into `wrapper`. The widget is an
 * absolutely-positioned, semi-transparent corner overlay that reads
 * the stats from `getStats()` four times a second. Click-to-hide,
 * delegated through the `onClickHide` callback so the parent can flip
 * the persisted state in one place.
 */
export function mountFpsWidget({
    wrapper, getStats, onClickHide,
}: {
    wrapper: HTMLElement;
    getStats: () => FpsStats;
    onClickHide: () => void;
}): { el: HTMLElement; dispose: () => void } {
    const el = document.createElement('div');
    el.setAttribute('data-gfx-fps', '');
    // Style lives in `src/styles/global.css` under `.gfx-fps-counter`.
    // See #170 — keeping style out of TS so the widget is themeable and
    // so the inline-cssText lint guard (#171) stops here.
    el.className = 'gfx-fps-counter';
    el.title = 'Click or press F to hide';
    wrapper.appendChild(el);

    function refresh() {
        const s = getStats();
        el.textContent = `render: ${String(Math.round(s.renderFps))} · push: ${String(Math.round(s.pushFps))} · ${s.frameTimeMs.toFixed(1)}ms`;
    }
    refresh();
    const interval = setInterval(refresh, 250);
    const onClick = () => { onClickHide(); };
    el.addEventListener('click', onClick);

    return {
        el,
        dispose() {
            clearInterval(interval);
            el.removeEventListener('click', onClick);
            el.remove();
        },
    };
}

/**
 * Standard "skip when typing" guard for global keyboard shortcuts.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
    // Guard for non-DOM environments (unit tests under Node).
    if (typeof HTMLElement === 'undefined') return false;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.isContentEditable;
}
