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

/** Format the three playback clocks in user-facing terms. */
export function formatFpsStats(stats: FpsStats, monitorHz: number): string {
    const monitor = monitorHz > 0 ? `monitor: ${String(monitorHz)}hz · ` : '';
    return `${monitor}render: ${String(Math.round(stats.renderFps))} · source: ${String(Math.round(stats.pushFps))} · ${stats.frameTimeMs.toFixed(1)}ms`;
}

/** Common display refresh rates. A measured value within tolerance snaps to
 *  one of these so 59.6 reads as clean 60. */
const COMMON_REFRESH_HZ = [50, 60, 75, 90, 100, 120, 144, 165, 240, 360];

/** Snap a measured refresh rate to the nearest common value within
 *  `tolerance` (relative), else the raw value rounded to an integer. */
export function snapDisplayHz(rawHz: number, tolerance = 0.05): number {
    if (!isFinite(rawHz) || rawHz <= 0) return 0;
    let best = COMMON_REFRESH_HZ[0] ?? 60;
    let bestErr = Infinity;
    for (const hz of COMMON_REFRESH_HZ) {
        const err = Math.abs(rawHz - hz) / hz;
        if (err < bestErr) { bestErr = err; best = hz; }
    }
    return bestErr <= tolerance ? best : Math.round(rawHz);
}

/**
 * One-shot host display refresh-rate measurement (issue #267). Samples a
 * short burst of requestAnimationFrame deltas — which track the compositor's
 * vsync when the tab is visible — takes the median, and snaps to a common
 * refresh rate. Runs ONCE (no persistent loop, per the #264 main-thread
 * economy rule); callers cache the result.
 *
 * `raf` is injectable for tests. Resolves 0 if RAF is unavailable (e.g. a
 * worker context) — display Hz is a main-thread concept.
 */
export function measureDisplayHz({
    sampleCount = 20,
    raf,
}: {
    sampleCount?: number;
    raf?: (cb: (t: number) => void) => void;
} = {}): Promise<number> {
    const rafFn = raf ?? (typeof requestAnimationFrame === 'function'
        ? (cb: (t: number) => void) => { requestAnimationFrame(cb); }
        : null);
    if (!rafFn) return Promise.resolve(0);
    const schedule = rafFn;
    return new Promise<number>((resolve) => {
        const deltas: number[] = [];
        let prev: number | null = null;
        function step(t: number): void {
            if (prev !== null) {
                const dt = t - prev;
                if (dt > 0) deltas.push(dt);
            }
            prev = t;
            if (deltas.length < sampleCount) {
                schedule(step);
            } else {
                deltas.sort((a, b) => a - b);
                const medianMs = deltas[Math.floor(deltas.length / 2)] ?? 0;
                resolve(medianMs > 0 ? snapDisplayHz(1000 / medianMs) : 0);
            }
        }
        schedule(step);
    });
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

    // Monitor Hz is measured once at mount (no persistent loop, #267) and
    // shown separately from the achieved render and source-delivery rates.
    let displayHz = 0;
    void measureDisplayHz().then((hz) => { displayHz = hz; });

    function refresh() {
        el.textContent = formatFpsStats(getStats(), displayHz);
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
