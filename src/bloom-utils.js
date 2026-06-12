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
