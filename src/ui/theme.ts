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

/** Wrap a hex color (e.g. `gfxColors.ledStart()` → `'#22c55e'`) into an
 *  `rgba()` string with the given alpha. The hex source stays under
 *  CSS-variable control; only the alpha is callsite-specific.
 *
 *  Accepts: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. The input alpha is
 *  multiplied with the explicit `alpha` argument so you can soften a
 *  token that already carries some transparency.
 *
 *  Returns the input unchanged if it doesn't match a recognized hex
 *  format (e.g. a CSS-named color like `'black'`). */
export function withAlpha(hex: string, alpha: number): string {
    const m = /^#([0-9a-fA-F]{3,8})$/.exec(hex);
    if (!m) return hex;
    let s = m[1];
    // Expand 3- / 4-digit shorthand.
    if (s.length === 3 || s.length === 4) {
        s = s.split('').map((c) => c + c).join('');
    }
    if (s.length !== 6 && s.length !== 8) return hex;
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    const baseA = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    const a = Math.max(0, Math.min(1, baseA * alpha));
    return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${a.toFixed(3)})`;
}
