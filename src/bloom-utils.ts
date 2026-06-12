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

import type { BloomAutoRangeInput, BloomRange, BloomParams, FrameBrightnessResult } from './types/domain';

export const BLOOM_MIN_STRENGTH = 0.5;
export const BLOOM_MAX_STRENGTH = 16;
export const BLOOM_RADIUS = 1;
export const BLOOM_THRESHOLD = 0.0;

export const IRIS_ATTACK_TAU = 0.08;
export const IRIS_DECAY_TAU = 0.8;
export const IRIS_MAX_DT = 0.25;

export const AUTO_BLOOM_SPACING_REF = 0.10;

export const PREVIEW_AUTO_FLOOR       = 0.15;
export const PREVIEW_AUTO_MAX_DENSE   = 0.6;
export const PREVIEW_AUTO_MAX_SPARSE  = 1.6;

export const DEMO_AUTO_FLOOR          = 1.5;
export const DEMO_AUTO_MAX_DENSE      = 16;
export const DEMO_AUTO_MAX_SPARSE     = 24;

export const LIT_EPSILON = 0.01;
export const BLOOM_COVERAGE_REF = 0.02;
export const BLOOM_AREA_REF = 0.025;
export const BLOOM_RADIUS_MIN = 0.15;
export const BLOOM_RESOLUTION_REF = 800;

export function computeFrameBrightness(rgbBytes: Uint8Array | number[]): FrameBrightnessResult {
    const totalCount = Math.floor(rgbBytes.length / 3);
    if (totalCount === 0) return { avgBrightness: 0, litCount: 0, totalCount: 0 };

    let totalBri = 0;
    let litCount = 0;
    for (let i = 0; i < totalCount; i++) {
        const i3 = i * 3;
        const bri = ((rgbBytes[i3] ?? 0) + (rgbBytes[i3 + 1] ?? 0) + (rgbBytes[i3 + 2] ?? 0)) / (3 * 255);
        totalBri += bri;
        if (bri > LIT_EPSILON) litCount++;
    }
    return { avgBrightness: totalBri / totalCount, litCount, totalCount };
}

export function stepIrisAttackDecay(
    currentBrightness: number,
    avgBrightness: number,
    dtSeconds: number,
    {
        attackTau = IRIS_ATTACK_TAU,
        decayTau = IRIS_DECAY_TAU,
        maxDt = IRIS_MAX_DT,
    }: { attackTau?: number; decayTau?: number; maxDt?: number } = {},
): number {
    const dt = Math.min(Math.max(dtSeconds, 0), maxDt);
    const tau = Math.abs(avgBrightness) > Math.abs(currentBrightness) ? attackTau : decayTau;
    let next;
    if (tau <= 0) {
        next = avgBrightness;
    } else {
        next = avgBrightness + (currentBrightness - avgBrightness) * Math.exp(-dt / tau);
    }
    return Math.min(Math.max(next, 0), 1);
}

export function computeBloomStrength(
    currentBrightness: number,
    litCount: number,
    totalCount: number,
    { min = BLOOM_MIN_STRENGTH, max = BLOOM_MAX_STRENGTH }: { min?: number; max?: number } = {},
): number {
    const bri = Math.min(Math.max(currentBrightness, 0), 1);
    const densityFactor = totalCount > 0
        ? Math.min(Math.max(litCount / totalCount, 0), 1)
        : 0;
    const strength = min + (max - min) * (1 - bri) * densityFactor;
    return Math.min(Math.max(strength, min), max);
}

export function computeAutoBloomRange({
    ledSpacing,
    sceneExtent,
    profile: {
        floor    = PREVIEW_AUTO_FLOOR,
        maxDense  = PREVIEW_AUTO_MAX_DENSE,
        maxSparse = PREVIEW_AUTO_MAX_SPARSE,
    } = {},
}: BloomAutoRangeInput): BloomRange {
    const extent = Math.max(sceneExtent, 1e-9);
    const spacingFraction = ledSpacing / extent;
    const D = 1 - Math.min(Math.max(spacingFraction / AUTO_BLOOM_SPACING_REF, 0), 1);
    const rawMax = maxSparse + (maxDense - maxSparse) * D;
    const autoMax = Math.max(rawMax, floor);
    return {
        min: Math.max(BLOOM_MIN_STRENGTH, floor * 0.5),
        max: autoMax,
    };
}

export function resolveLedDiameter(
    strips: Record<string, unknown>[] | null | undefined,
    fallback: number | null = null,
): number | null {
    let max = 0;
    if (strips) {
        for (const s of strips) {
            if (typeof s.diameter === 'number' && Number.isFinite(s.diameter) && s.diameter > max) {
                max = s.diameter;
            }
        }
    }
    if (max > 0) return max;
    return (typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0) ? fallback : null;
}

export function computeFitScale(rawPts: number[][], fittedPts: number[][]): number {
    const extent = (pts: number[][]) => {
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const pt of pts) {
            const x = pt[0] ?? 0;
            const y = pt[1] ?? 0;
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        return Math.max(xmax - xmin, ymax - ymin);
    };
    if (rawPts.length < 2 || fittedPts.length < 2) return 1;
    const rawExtent = extent(rawPts);
    const fittedExtent = extent(fittedPts);
    if (!(rawExtent > 0) || !(fittedExtent > 0)) return 1;
    return fittedExtent / rawExtent;
}

export function bloomParamsForLedSize(
    ledPx: number,
    panePx: number,
    ledCount: number,
    {
        bloomResolution = BLOOM_RESOLUTION_REF,
        refCoverage = BLOOM_COVERAGE_REF,
        refArea = BLOOM_AREA_REF,
        refResolution = BLOOM_RESOLUTION_REF,
        baseRadius = BLOOM_RADIUS,
        minRadius = BLOOM_RADIUS_MIN,
        baseMin = BLOOM_MIN_STRENGTH,
        baseMax = BLOOM_MAX_STRENGTH,
    }: {
        bloomResolution?: number;
        refCoverage?: number;
        refArea?: number;
        refResolution?: number;
        baseRadius?: number;
        minRadius?: number;
        baseMin?: number;
        baseMax?: number;
    } = {},
): BloomParams {
    const linear = Math.min(Math.max(panePx > 0 ? ledPx / panePx : 0, 1e-4), 1);
    const count = Math.max(Number.isFinite(ledCount) ? ledCount : 1, 1);
    const area = Math.min(Math.max(count * linear * linear, 1e-6), 1);
    const radius = Math.min(Math.max(baseRadius * (linear / refCoverage), minRadius), baseRadius);
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
