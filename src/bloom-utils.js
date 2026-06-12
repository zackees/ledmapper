/**
 * Pure bloom/iris math shared by the demo page and the moviemaker preview.
 *
 * Recipe copied from FastLED's graphics_manager_threejs.ts:
 * - UnrealBloomPass with threshold 0, strength up to 16, radius 1.
 * - An auto-bloom "iris": tracked brightness LERPs toward the frame's
 *   average LED brightness, and bloom strength scales inversely with it
 *   (dark scenes bloom hard like dilated pupils, bright scenes constrict).
 *
 * Kept free of DOM/Three.js imports so node:test can load it directly.
 */

export const BLOOM_MIN_STRENGTH = 0.5;
export const BLOOM_MAX_STRENGTH = 16;
export const BLOOM_RADIUS = 1;
export const BLOOM_THRESHOLD = 0.0;
export const IRIS_RESPONSE_SPEED = 0.1;

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

/**
 * Compute the average brightness and lit-LED count of an RGB frame.
 *
 * @param {Uint8Array|number[]} rgbBytes - 3 bytes (0-255) per LED.
 * @returns {{avgBrightness: number, litCount: number, totalCount: number}}
 *          avgBrightness is 0-1.
 */
export function computeFrameBrightness(rgbBytes) {
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
 * Advance the iris state one frame: LERP current brightness toward the
 * frame's average brightness at the iris response speed.
 *
 * @param {number} currentBrightness - tracked brightness (0-1)
 * @param {number} avgBrightness - this frame's average LED brightness (0-1)
 * @param {number} [speed=IRIS_RESPONSE_SPEED]
 * @returns {number} new tracked brightness (0-1)
 */
export function stepIris(currentBrightness, avgBrightness, speed = IRIS_RESPONSE_SPEED) {
    const next = currentBrightness + (avgBrightness - currentBrightness) * speed;
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
export function computeBloomStrength(currentBrightness, litCount, totalCount, { min = BLOOM_MIN_STRENGTH, max = BLOOM_MAX_STRENGTH } = {}) {
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
}) {
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
