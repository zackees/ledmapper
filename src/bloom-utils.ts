/**
 * Pure LED-size/bloom/iris math shared by the demo page and the moviemaker
 * preview.
 *
 * Recipe copied from FastLED's graphics_manager_threejs.ts:
 * - UnrealBloomPass with threshold 0, strength up to 16, radius 1.
 * - An auto-bloom "iris": tracked brightness follows the frame's average LED
 *   brightness through FastLED's attack-decay filter
 *   (attack_decay_filter_impl.h) — fast attack so bloom constricts
 *   immediately on blowouts, slow exponential decay so it dilates gradually
 *   in dark scenes — and bloom strength scales inversely with it.
 * - Bloom kernel proportioned to the rendered LED size: small sparse dots
 *   keep a tight visible halo, large/dense dots don't white out the pane.
 *
 * Kept free of DOM/Three.js imports so node:test can load it directly.
 */

export const BLOOM_MIN_STRENGTH = 0.5;
export const BLOOM_MAX_STRENGTH = 16;
export const BLOOM_RADIUS = 1;
export const BLOOM_THRESHOLD = 0.0;

// Attack-decay iris time constants (seconds). Attack is fast so bloom drops
// immediately when the scene blows out; decay is slow so bloom rises
// gradually as the scene darkens.
export const IRIS_ATTACK_TAU = 0.08;
export const IRIS_DECAY_TAU = 0.8;
// dt clamp so a backgrounded tab / long stall doesn't snap the filter.
export const IRIS_MAX_DT = 0.25;

// ---------------------------------------------------------------------------
// Auto-bloom density scaling
// ---------------------------------------------------------------------------

/**
 * Normalised spacing reference: spacingFraction >= this value → "sparse"
 * (D → 0, envelope opens to S_MAX_SPARSE).  Tuned to put a 32x32 panel
 * (spacingFraction ≈ 0.03-0.06) firmly in the "dense" region.
 */
export const AUTO_BLOOM_SPACING_REF = 0.10;

// Preview profile (200 px pane)
export const PREVIEW_AUTO_FLOOR       = 0.15;
export const PREVIEW_AUTO_MAX_DENSE   = 0.6;   // today's ceiling — no regression on dense
export const PREVIEW_AUTO_MAX_SPARSE  = 1.6;

// Demo profile (800 px canvas)
export const DEMO_AUTO_FLOOR          = 1.5;
export const DEMO_AUTO_MAX_DENSE      = 16;    // today's value — no regression on dense
export const DEMO_AUTO_MAX_SPARSE     = 24;

// An LED counts as "lit" for the density factor when its brightness
// (avg of r,g,b as 0-1) exceeds this epsilon.
export const LIT_EPSILON = 0.01;

// Reference linear dot coverage (LED pixel diameter / pane pixel size) at
// which the stock FastLED blur radius (1) is right — matches the demo page's
// known-good look (16px dots on an 800px canvas).
export const BLOOM_COVERAGE_REF = 0.02;
// Reference area coverage (ledCount * (ledPx/panePx)^2 — the fraction of the
// pane covered by lit dots) at which the full FastLED strength range
// (0.5-16) is right; denser/larger layouts scale the strength down
// inversely so the pane never whites out. Tuned against the demo page
// (1024 4px dots on an 800px canvas ≈ 0.026).
export const BLOOM_AREA_REF = 0.025;
// Bloom radius never collapses below this, so even sub-pixel dots keep a halo.
export const BLOOM_RADIUS_MIN = 0.15;
// Reference UnrealBloomPass resolution (the demo page's 800px canvas). The
// pass's blur mip chain is derived from its resolution, so on a smaller
// pane the same kernel covers a proportionally larger fraction of the
// image; strength is scaled down linearly with the resolution to
// compensate.
export const BLOOM_RESOLUTION_REF = 800;

/**
 * Compute the average brightness and lit-LED count of an RGB frame.
 *
 * @param {Uint8Array|number[]} rgbBytes - 3 bytes (0-255) per LED.
 * @returns {{avgBrightness: number, litCount: number, totalCount: number}}
 *          avgBrightness is 0-1.
 */
export function computeFrameBrightness(rgbBytes: any) {
    const totalCount = Math.floor(rgbBytes.length / 3);
    if (totalCount === 0) return { avgBrightness: 0, litCount: 0, totalCount: 0 };

    let totalBri = 0;
    let litCount = 0;
    for (let i = 0; i < totalCount; i++) {
        const i3 = i * 3;
        const bri = (rgbBytes[i3] + rgbBytes[i3 + 1] + rgbBytes[i3 + 2]) / (3 * 255);
        totalBri += bri;
        if (bri > LIT_EPSILON) litCount++;
    }
    return { avgBrightness: totalBri / totalCount, litCount, totalCount };
}

/**
 * Advance the iris brightness tracker one step with FastLED's attack-decay
 * filter (fl::detail::AttackDecayFilterImpl):
 *
 *   tau = (|input| > |y|) ? attackTau : decayTau
 *   y   = input + (y - input) * exp(-dt / tau)
 *
 * Rising brightness is tracked with the (small) attack tau so bloom strength
 * — inversely proportional to brightness — drops immediately on blowouts;
 * falling brightness is tracked with the (large) decay tau so bloom rises
 * gradually in dark scenes. dt-based, so frame-rate independent.
 *
 * @param {number} currentBrightness - tracked brightness (0-1)
 * @param {number} avgBrightness - this frame's average LED brightness (0-1)
 * @param {number} dtSeconds - real elapsed time since the previous step
 * @param {Object} [opts]
 * @param {number} [opts.attackTau=IRIS_ATTACK_TAU]
 * @param {number} [opts.decayTau=IRIS_DECAY_TAU]
 * @param {number} [opts.maxDt=IRIS_MAX_DT] - dt clamp (tab-switch stalls)
 * @returns {number} new tracked brightness (0-1)
 */
export function stepIrisAttackDecay(currentBrightness: any, avgBrightness: any, dtSeconds: any, {
    attackTau = IRIS_ATTACK_TAU,
    decayTau = IRIS_DECAY_TAU,
    maxDt = IRIS_MAX_DT,
} = {}) {
    const dt = Math.min(Math.max(dtSeconds, 0), maxDt);
    const tau = Math.abs(avgBrightness) > Math.abs(currentBrightness) ? attackTau : decayTau;
    let next;
    if (tau <= 0) {
        next = avgBrightness; // no smoothing when tau <= 0
    } else {
        next = avgBrightness + (currentBrightness - avgBrightness) * Math.exp(-dt / tau);
    }
    return Math.min(Math.max(next, 0), 1);
}

/**
 * Compute the auto-bloom strength for the current iris state:
 * strength = min + (max - min) * (1 - currentBrightness) * densityFactor
 * where densityFactor = litCount / totalCount.
 *
 * @param {number} currentBrightness - tracked brightness (0-1)
 * @param {number} litCount - LEDs brighter than LIT_EPSILON
 * @param {number} totalCount - total LED count
 * @param {Object} [opts]
 * @param {number} [opts.min=BLOOM_MIN_STRENGTH]
 * @param {number} [opts.max=BLOOM_MAX_STRENGTH]
 * @returns {number} bloom strength, clamped to [min, max]
 */
export function computeBloomStrength(currentBrightness: any, litCount: any, totalCount: any, { min = BLOOM_MIN_STRENGTH, max = BLOOM_MAX_STRENGTH }: { min?: number; max?: number } = {}) {
    const bri = Math.min(Math.max(currentBrightness, 0), 1);
    const densityFactor = totalCount > 0
        ? Math.min(Math.max(litCount / totalCount, 0), 1)
        : 0;
    const strength = min + (max - min) * (1 - bri) * densityFactor;
    return Math.min(Math.max(strength, min), max);
}

/**
 * Compute the auto-bloom strength envelope based on LED spatial density.
 *
 * Uses the LED spacing relative to the scene bounding-box extent to derive a
 * normalised density value D ∈ [0, 1] (0 = sparse, 1 = dense), then linearly
 * interpolates the max-strength ceiling between S_MAX_SPARSE (open, sparse
 * layouts) and S_MAX_DENSE (conservative, dense grids like 32×32 panels).
 *
 * The returned range is always strictly positive — bloom is never disabled.
 *
 * @param {Object} opts
 * @param {number} opts.ledSpacing   - inter-LED spacing in scene units
 *                                     (e.g. from `estimateLedSize`)
 * @param {number} opts.sceneExtent  - max bounding-box dimension of the scene
 *                                     (must be > 0)
 * @param {Object} [opts.profile]    - profile constants (defaults to preview profile)
 * @param {number} [opts.profile.floor=PREVIEW_AUTO_FLOOR]
 * @param {number} [opts.profile.maxDense=PREVIEW_AUTO_MAX_DENSE]
 * @param {number} [opts.profile.maxSparse=PREVIEW_AUTO_MAX_SPARSE]
 * @returns {{ min: number, max: number }}
 */
export function computeAutoBloomRange({
    ledSpacing,
    sceneExtent,
    profile: {
        floor    = PREVIEW_AUTO_FLOOR,
        maxDense  = PREVIEW_AUTO_MAX_DENSE,
        maxSparse = PREVIEW_AUTO_MAX_SPARSE,
    } = {},
}: { ledSpacing: any; sceneExtent: any; profile?: { floor?: number; maxDense?: number; maxSparse?: number } }) {
    const extent = Math.max(sceneExtent, 1e-9);
    const spacingFraction = ledSpacing / extent;

    // D=1 → very dense (small spacingFraction), D=0 → sparse (large spacingFraction)
    const D = 1 - Math.min(Math.max(spacingFraction / AUTO_BLOOM_SPACING_REF, 0), 1);

    // Interpolate max ceiling
    const rawMax = maxSparse + (maxDense - maxSparse) * D;   // lerp(maxSparse, maxDense, D)
    const autoMax = Math.max(rawMax, floor);

    return {
        min: Math.max(BLOOM_MIN_STRENGTH, floor * 0.5),
        max: autoMax,
    };
}

/**
 * Resolve the LED world diameter for rendering: the screenmap's declared
 * strip diameter always wins (max across strips when several declare one);
 * the spacing heuristic is only a fallback for maps that declare none.
 *
 * @param {Array<{diameter?: number}>|null} strips - parsed screenmap strips
 *        (parseScreenmapMultiStrip output), diameters in screenmap world units.
 * @param {number|null} [fallback=null] - heuristic estimate (same units)
 *        used when no strip declares a positive diameter.
 * @returns {number|null} diameter in world units, or null if neither source
 *          provides one.
 */
export function resolveLedDiameter(strips: any, fallback: number | null = null) {
    let max = 0;
    if (strips) {
        for (const s of strips) {
            if (s && typeof s.diameter === 'number' && Number.isFinite(s.diameter) && s.diameter > max) {
                max = s.diameter;
            }
        }
    }
    if (max > 0) return max;
    return (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) ? fallback : null;
}

/**
 * Compute the uniform scale factor a fit transform applied to a point set:
 * the ratio of the fitted bbox's max extent to the raw bbox's max extent.
 * Used to carry the screenmap's world-unit diameter into fitted/canvas
 * coordinate spaces.
 *
 * @param {Array<[number,number]>} rawPts
 * @param {Array<[number,number]>} fittedPts
 * @returns {number} scale factor (1 when either set is degenerate)
 */
export function computeFitScale(rawPts: any, fittedPts: any) {
    const extent = (pts: any[]) => {
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of pts) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        return Math.max(xmax - xmin, ymax - ymin);
    };
    if (!rawPts || !fittedPts || rawPts.length < 2 || fittedPts.length < 2) return 1;
    const rawExtent = extent(rawPts);
    const fittedExtent = extent(fittedPts);
    if (!(rawExtent > 0) || !(fittedExtent > 0)) return 1;
    return fittedExtent / rawExtent;
}

/**
 * Proportion the bloom kernel to the rendered LED size.
 *
 * Two coverage factors drive it (ledPx and panePx in the same pixel space,
 * e.g. material.size and the drawing-buffer size):
 * - linear coverage ledPx/panePx sets the blur radius, so the halo stays
 *   proportional to the rendered dot diameter (smaller dots → tighter halo);
 * - area coverage ledCount*(ledPx/panePx)^2 — the fraction of the pane the
 *   dots occupy, i.e. the total bloom energy — scales the strength range
 *   down inversely past the reference, so dense or large-dot renders never
 *   white out the pane while sparse small dots keep the full FastLED range.
 *
 * @param {number} ledPx - rendered LED diameter in buffer pixels.
 * @param {number} panePx - render surface size in buffer pixels.
 * @param {number} ledCount - number of LEDs in the layout.
 * @param {Object} [opts]
 * @param {number} [opts.bloomResolution=BLOOM_RESOLUTION_REF] - the
 *        resolution the UnrealBloomPass was constructed with (its blur mips
 *        derive from it); smaller panes get a proportionally weaker range.
 * @param {number} [opts.refCoverage=BLOOM_COVERAGE_REF]
 * @param {number} [opts.refArea=BLOOM_AREA_REF]
 * @param {number} [opts.refResolution=BLOOM_RESOLUTION_REF]
 * @param {number} [opts.baseRadius=BLOOM_RADIUS]
 * @param {number} [opts.minRadius=BLOOM_RADIUS_MIN]
 * @param {number} [opts.baseMin=BLOOM_MIN_STRENGTH]
 * @param {number} [opts.baseMax=BLOOM_MAX_STRENGTH]
 * @returns {{radius: number, minStrength: number, maxStrength: number}}
 */
export function bloomParamsForLedSize(ledPx: any, panePx: any, ledCount: any, {
    bloomResolution = BLOOM_RESOLUTION_REF,
    refCoverage = BLOOM_COVERAGE_REF,
    refArea = BLOOM_AREA_REF,
    refResolution = BLOOM_RESOLUTION_REF,
    baseRadius = BLOOM_RADIUS,
    minRadius = BLOOM_RADIUS_MIN,
    baseMin = BLOOM_MIN_STRENGTH,
    baseMax = BLOOM_MAX_STRENGTH,
} = {}) {
    const linear = Math.min(Math.max(panePx > 0 ? ledPx / panePx : 0, 1e-4), 1);
    const count = Math.max(Number.isFinite(ledCount) ? ledCount : 1, 1);
    const area = Math.min(Math.max(count * linear * linear, 1e-6), 1);
    // Radius shrinks proportionally with the dot below the reference so the
    // halo stays relative to LED size; it never grows past the base radius.
    const radius = Math.min(Math.max(baseRadius * (linear / refCoverage), minRadius), baseRadius);
    // Strength scales down inversely with three energy factors (never up
    // past the base range):
    // - total lit area past the reference (more lit area = more total bloom
    //   energy raising the whole pane);
    // - per-dot area past the reference coverage (a large dot concentrates
    //   its bloom energy into one oversized local halo);
    // - pane resolution below the reference (the bloom mips cover a
    //   proportionally larger fraction of a small pane, so the same
    //   strength deposits far more glow).
    const areaScale = Math.min(refArea / area, 1);
    const perDotScale = Math.min((refCoverage * refCoverage) / (linear * linear), 1);
    const resScale = refResolution > 0
        ? Math.min(Math.max(bloomResolution, 1) / refResolution, 1)
        : 1;
    const strengthScale = areaScale * perDotScale * resScale;
    return {
        radius,
        minStrength: baseMin * strengthScale,
        maxStrength: baseMax * strengthScale,
    };
}
