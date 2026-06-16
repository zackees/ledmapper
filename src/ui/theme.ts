/**
 * Single source of truth for gfx-package colors at runtime.
 *
 * Issue #170. Hex literals in TS are forbidden by the inline-color
 * lint guard (#171). Reads happen via these accessors, which look up
 * the value from the CSS custom properties defined under `@theme` in
 * `src/styles/global.css`.
 *
 * Workers don't have `document` / `getComputedStyle`, so the worker
 * variant of @fastled/gfx must NOT call these accessors directly. The
 * main thread snapshots the palette via `snapshotGfxColors()` and
 * forwards it across postMessage; the worker-side code uses the
 * snapshot instead of asking the DOM.
 */

const FALLBACK: Record<string, string> = {
    '--fastled-accent-blue':         '#3b82f6',
    '--fastled-accent-blue-hover':   '#60a5fa',
    '--fastled-accent-cyan':         '#22d3ee',
    '--fastled-accent-amber':        '#f59e0b',
    '--fastled-accent-amber-hover':  '#fbbf24',
    '--fastled-accent-purple':       '#a855f7',
    '--fastled-accent-purple-hover': '#c084fc',
    '--fastled-accent-red':          '#ef4444',
    '--fastled-accent-green':        '#22c55e',
    '--fastled-accent-emerald':      '#10b981',
    '--fastled-led-start':           '#22c55e',
    '--fastled-led-end':             '#ef4444',
    '--fastled-bg-popover':          '#1e1e1e',
    '--fastled-bg-popover-strong':   '#0a0a0a',
    '--fastled-border-popover':      '#444444',
    '--fastled-text-strong':         '#e4e4e7',
    '--fastled-text-muted':          '#a1a1aa',
    '--fastled-text-dim':            '#63636e',
    '--fastled-text-link':           '#93c5fd',
    '--fastled-group-0':             '#3b82f6',
    '--fastled-group-1':             '#10b981',
    '--fastled-group-2':             '#f59e0b',
    '--fastled-group-3':             '#ef4444',
    '--fastled-group-4':             '#a855f7',
    '--fastled-group-5':             '#06b6d4',
    '--fastled-group-6':             '#ec4899',
    '--fastled-group-7':             '#84cc16',
};

const _cache = new Map<string, string>();

/** Read a CSS custom property at runtime; falls back to the hardcoded
 *  palette when the DOM is unavailable (worker scope) or the property
 *  is unset. Result is cached per-name; call `invalidateThemeCache()`
 *  on theme change to bust it. */
export function cssVar(name: `--${string}`): string {
    const cached = _cache.get(name);
    if (cached !== undefined) return cached;
    let v = '';
    if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
        v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    if (v === '') v = FALLBACK[name] ?? '#ffffff';
    _cache.set(name, v);
    return v;
}

export function invalidateThemeCache(): void {
    _cache.clear();
}

/** Named accessors. Call rather than capture in module-init so cache
 *  invalidation after a theme change works without code churn. */
export const gfxColors = {
    accentBlue:        (): string => cssVar('--fastled-accent-blue'),
    accentBlueHover:   (): string => cssVar('--fastled-accent-blue-hover'),
    accentCyan:        (): string => cssVar('--fastled-accent-cyan'),
    accentAmber:       (): string => cssVar('--fastled-accent-amber'),
    accentAmberHover:  (): string => cssVar('--fastled-accent-amber-hover'),
    accentPurple:      (): string => cssVar('--fastled-accent-purple'),
    accentPurpleHover: (): string => cssVar('--fastled-accent-purple-hover'),
    accentRed:         (): string => cssVar('--fastled-accent-red'),
    accentGreen:       (): string => cssVar('--fastled-accent-green'),
    accentEmerald:     (): string => cssVar('--fastled-accent-emerald'),
    ledStart:          (): string => cssVar('--fastled-led-start'),
    ledEnd:            (): string => cssVar('--fastled-led-end'),
    bgPopover:         (): string => cssVar('--fastled-bg-popover'),
    bgPopoverStrong:   (): string => cssVar('--fastled-bg-popover-strong'),
    borderPopover:     (): string => cssVar('--fastled-border-popover'),
    textStrong:        (): string => cssVar('--fastled-text-strong'),
    textMuted:         (): string => cssVar('--fastled-text-muted'),
    textDim:           (): string => cssVar('--fastled-text-dim'),
    textLink:          (): string => cssVar('--fastled-text-link'),
    /** 8-color group palette. Wraps `i mod 8`. */
    group:             (i: number): string => {
        const k = ((i % 8) + 8) % 8;
        return cssVar(`--fastled-group-${String(k)}`);
    },
};

/** Snapshot the full palette into a plain `Record<string, string>` so
 *  the worker variant can carry it across postMessage. Workers then
 *  serve their drawing code from this map without touching the DOM. */
export function snapshotGfxColors(): Record<string, string> {
    return { ...FALLBACK, ...Object.fromEntries(_cache) };
}
