/**
 * Pure LED-size/bloom/iris math shared by the demo page and the moviemaker
 * preview.
 *
 * Recipe copied from FastLED's graphics_manager_threejs.ts:
 * - UnrealBloomPass with threshold 0, strength up to 16, radius 1.
 * - An auto-bloom "iris": tracked brightness follows the frame's average LED
 *   brightness (global light output) through FastLED's attack-decay filter
 *   (attack_decay_filter_impl.h) — fast attack so the iris constricts
 *   immediately on blowouts, ~10x slower decay so it dilates gradually in
 *   dark scenes (mirrors human pupil dynamics, where dilation is several
 *   times slower than constriction) — and bloom strength scales inversely
 *   with it.
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

/** Video iris responds immediately; fast cuts need no perceptual delay. */
export const IRIS_LIGHT_LATENCY = 0;
/** Dimming/constriction attack: quick enough for cuts, slow enough not to jitter. */
export const IRIS_ATTACK_TAU = 0.20;
// Reopen the iris ~10x slower than it constricts — the idiomatic auto-exposure
// asymmetry, and close to human pupil dynamics (dilation much slower than
// constriction). Fast attack protects against blowout; slow decay dilates
// gradually in dark scenes.
/** Slower redilation preserves the iris-like dark adaptation. */
export const IRIS_DECAY_TAU = 1.20;
export const IRIS_MAX_DT = 0.25;

export const AUTO_BLOOM_SPACING_REF = 0.10;

// Tuned for the 400px preview pane (issue #49): the density envelope is an
// outer guard; bloomParamsForLedSize stays the binding ceiling on dense maps.
export const PREVIEW_AUTO_FLOOR       = 0.6;
export const PREVIEW_AUTO_MAX_DENSE   = 4;
export const PREVIEW_AUTO_MAX_SPARSE  = 6;

// Demo full-open iris ceiling — matches the manually-validated sweet spot
// (diameter 1, strength 36) so auto-bloom can reach the same look (issue #51).
export const DEMO_BLOOM_MAX_STRENGTH  = 36;
export const DEMO_AUTO_FLOOR          = 1.5;
// Density envelope is a non-binding outer guard at the demo ceiling; the iris
// and per-frame density factor still modulate strength within it.
export const DEMO_AUTO_MAX_DENSE      = DEMO_BLOOM_MAX_STRENGTH;
export const DEMO_AUTO_MAX_SPARSE     = DEMO_BLOOM_MAX_STRENGTH;

// Large-dot regime taming (issue #53): at large LED diameters the demo's dots
// already cover much of the panel, so the default radius-1.0 / wide-area kernel
// produces halos that wash out the whole display. These demo-only overrides
// halve the bloom radius and the area reference so the strength ceiling drops
// off faster as dots grow, while leaving the diameter-1 sweet spot untouched.
// Passed per-call to bloomParamsForLedSize so the preview pane keeps the shared
// defaults.
export const DEMO_BLOOM_RADIUS        = 0.5;
export const DEMO_BLOOM_AREA_REF      = 0.0125;

// Iris diameter modulation: on layouts whose rendered dots leave gaps between
// neighbours, the auto-bloom iris also grows the dot diameter as the frame
// brightens — like an aperture opening to admit more light (issue: sparse maps
// open up). The growth is a continuous function of geometry, so a dense layout
// (dots already filling the inter-LED spacing) self-rejects to ~no growth
// without any special-casing. 0.8 = sparse dots grow up to 1.8x at full bright.
export const IRIS_DIAMETER_GAIN = 0.8;
export const IRIS_DILATION_MAX = 0.20;
export const IRIS_CONSTRICTION_MAX = 0.40;
export const IRIS_DIAMETER_PIVOT = 0.45;

export const LIT_EPSILON = 0.01;
/** Pareto tail: the brightest 20% controls highlight protection. */
export const IRIS_PARETO_FRACTION = 0.20;
/** High-resolution histogram with nonlinear bucket density near white. */
export const IRIS_HISTOGRAM_BINS = 2048;
export const IRIS_HISTOGRAM_GAMMA = 4;
/** Power mean within the Pareto tail; >1 biases sustained near-white clusters. */
export const IRIS_PARETO_POWER = 4;
export const BLOOM_METER_TAIL_FRACTION = 0.10;
export const BLOOM_METER_KNEE = 0.04;
export const BLOOM_METER_FULL = 0.24;
export const BLOOM_COVERAGE_REF = 0.02;
export const BLOOM_AREA_REF = 0.025;
export const BLOOM_RADIUS_MIN = 0.15;
export const BLOOM_RESOLUTION_REF = 800;

/**
 * Canonical bloom render resolution: the backing-buffer dimension (in device
 * pixels) the scene + bloom chain renders at, independent of
 * window.devicePixelRatio. Fixing this makes the UnrealBloomPass mip pyramid see
 * the same pixel count on Mac/Windows/Linux, so bloom output is identical across
 * platforms and displays. Chosen >= typical on-screen sizes so the canvas
 * downsamples (clean) rather than upsamples (soft).
 *
 * Power of two: UnrealBloomPass halves the render target at each mip level.
 * 2048 → 1024 → 512 → 256 → 128 → 64 → 32 → 16 — exact integer halves the
 * whole way down. The previous 2000 broke at level 4 (125 → 62, half-pixel
 * loss) which softened the high-mip bloom on every frame. 2048 also aligns
 * with the GPU's POT page size so the render target doesn't quietly cost
 * more VRAM than its dimension suggests.
 */
export const BLOOM_RENDER_PX = 2048;

export function computeFrameBrightness(rgbBytes: Uint8Array | number[]): FrameBrightnessResult {
    const totalCount = Math.floor(rgbBytes.length / 3);
    if (totalCount === 0) return { avgBrightness: 0, irisBrightness: 0, litCount: 0, totalCount: 0 };

    let totalBri = 0;
    let litCount = 0;
    // The existing LED readback feeds a nonlinear high-resolution histogram.
    // b^gamma allocates far more bucket precision near white, where bloom
    // clipping changes rapidly. We then take a Pareto (top-20%) power mean:
    // sustained highlight regions dominate, while a lone hot LED cannot close
    // the global iris by itself. No additional framebuffer/readback is needed.
    const binCounts = new Uint32Array(IRIS_HISTOGRAM_BINS);
    const binPowerSums = new Float64Array(IRIS_HISTOGRAM_BINS);
    for (let i = 0; i < totalCount; i++) {
        const i3 = i * 3;
        const bri = ((rgbBytes[i3] ?? 0) + (rgbBytes[i3 + 1] ?? 0) + (rgbBytes[i3 + 2] ?? 0)) / (3 * 255);
        totalBri += bri;
        const bin = Math.min(
            IRIS_HISTOGRAM_BINS - 1,
            Math.floor(Math.pow(bri, IRIS_HISTOGRAM_GAMMA) * (IRIS_HISTOGRAM_BINS - 1)),
        );
        binCounts[bin]++;
        binPowerSums[bin] = (binPowerSums[bin] ?? 0) + Math.pow(bri, IRIS_PARETO_POWER);
        if (bri > LIT_EPSILON) litCount++;
    }
    let remaining = Math.max(1, Math.ceil(totalCount * IRIS_PARETO_FRACTION));
    const tailCount = remaining;
    let tailPowerSum = 0;
    for (let bin = binCounts.length - 1; bin >= 0 && remaining > 0; bin--) {
        const count = binCounts[bin] ?? 0;
        const take = Math.min(count, remaining);
        if (take > 0 && count > 0) {
            tailPowerSum += (binPowerSums[bin] ?? 0) * (take / count);
            remaining -= take;
        }
    }
    return {
        avgBrightness: totalBri / totalCount,
        irisBrightness: Math.pow(tailPowerSum / tailCount, 1 / IRIS_PARETO_POWER),
        litCount,
        totalCount,
    };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = Math.min(Math.max((value - edge0) / Math.max(edge1 - edge0, 1e-9), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * Measure actual bloom-induced whitening by comparing aligned raw and bloomed
 * low-resolution RGBA framebuffers. Brightening and colored mixing are kept;
 * only loss of source chroma into near-white is treated as overexposure.
 */
export function computeBloomWhiteMergeRisk(
    rawRgba: Uint8Array | number[],
    bloomedRgba: Uint8Array | number[],
    pixelIndices?: Uint32Array | number[],
): number {
    const pixelCount = Math.min(Math.floor(rawRgba.length / 4), Math.floor(bloomedRgba.length / 4));
    if (pixelCount === 0) return 0;
    const histogram = new Uint32Array(256);
    let activeCount = 0;
    const sampleCount = pixelIndices?.length ?? pixelCount;
    for (let sample = 0; sample < sampleCount; sample++) {
        const i = pixelIndices?.[sample] ?? sample;
        if (i < 0 || i >= pixelCount) continue;
        const i4 = i * 4;
        const rr = (rawRgba[i4] ?? 0) / 255;
        const rg = (rawRgba[i4 + 1] ?? 0) / 255;
        const rb = (rawRgba[i4 + 2] ?? 0) / 255;
        const br = (bloomedRgba[i4] ?? 0) / 255;
        const bg = (bloomedRgba[i4 + 1] ?? 0) / 255;
        const bb = (bloomedRgba[i4 + 2] ?? 0) / 255;
        const rawMax = Math.max(rr, rg, rb);
        if (rawMax < 0.04) continue;
        activeCount++;
        const rawMin = Math.min(rr, rg, rb);
        const bloomMax = Math.max(br, bg, bb);
        const bloomMin = Math.min(br, bg, bb);
        const rawSaturation = rawMax > 0 ? (rawMax - rawMin) / rawMax : 0;
        const bloomSaturation = bloomMax > 0 ? (bloomMax - bloomMin) / bloomMax : 0;
        const chromaLoss = Math.max(rawSaturation - bloomSaturation, 0);
        const nearWhite = smoothstep(0.72, 0.98, bloomMin);
        const risk = nearWhite * chromaLoss;
        histogram[Math.min(255, Math.floor(risk * 255))]++;
    }
    if (activeCount === 0) return 0;
    let remaining = Math.max(1, Math.ceil(activeCount * BLOOM_METER_TAIL_FRACTION));
    const tailCount = remaining;
    let weighted = 0;
    for (let bin = 255; bin >= 0 && remaining > 0; bin--) {
        const take = Math.min(histogram[bin] ?? 0, remaining);
        weighted += take * (bin / 255);
        remaining -= take;
    }
    return weighted / tailCount;
}

/** Convert measured whitening risk into a bounded high-end correction. */
export function computeBloomMeterCorrection(risk: number): number {
    return smoothstep(BLOOM_METER_KNEE, BLOOM_METER_FULL, risk);
}

function pixelWhiteMergeRisk(
    rr: number, rg: number, rb: number,
    br: number, bg: number, bb: number,
): number {
    const rawMax = Math.max(rr, rg, rb);
    if (rawMax < 0.04) return 0;
    const rawMin = Math.min(rr, rg, rb);
    const bloomMax = Math.max(br, bg, bb);
    const bloomMin = Math.min(br, bg, bb);
    const rawSaturation = (rawMax - rawMin) / Math.max(rawMax, 1e-9);
    const bloomSaturation = (bloomMax - bloomMin) / Math.max(bloomMax, 1e-9);
    const colorWash = smoothstep(0.72, 0.98, bloomMin)
        * Math.max(rawSaturation - bloomSaturation, 0);
    const clippedDetail = smoothstep(0.82, 0.995, bloomMax)
        * smoothstep(0.03, 0.22, bloomMax - rawMax)
        * smoothstep(0.30, 0.85, rawMax);
    return Math.max(colorWash, clippedDetail * 0.65);
}

/**
 * Suppress only low-energy bloom in true shadows. A bright local halo still
 * reaches full strength, but the zero-threshold bloom pass can no longer turn
 * black into a persistent gray veil merely because HDR selects its high
 * bracket for pixels with no sharp LED core.
 */
function shadowBloomWeight(rawMax: number, bloomMax: number): number {
    if (rawMax >= 0.04) return 1;
    return smoothstep(0.025, 0.14, bloomMax);
}

/**
 * Spatial HDR-style bloom composite. All four inputs contain the same sharp
 * LED base. Dark/halo pixels select the high bracket; LED cores progressively
 * fall back to medium or restrained bloom only where added light destroys
 * chroma or highlight headroom.
 */
export function compositeHdrBloomRgba(
    rawRgba: Uint8ClampedArray,
    lowRgba: Uint8ClampedArray,
    midRgba: Uint8ClampedArray,
    highRgba: Uint8ClampedArray,
    output = new Uint8ClampedArray(rawRgba.length),
): Uint8ClampedArray {
    const length = Math.min(rawRgba.length, lowRgba.length, midRgba.length, highRgba.length, output.length);
    for (let i = 0; i + 3 < length; i += 4) {
        const rr = (rawRgba[i] ?? 0) / 255;
        const rg = (rawRgba[i + 1] ?? 0) / 255;
        const rb = (rawRgba[i + 2] ?? 0) / 255;
        const highRisk = pixelWhiteMergeRisk(
            rr, rg, rb,
            (highRgba[i] ?? 0) / 255,
            (highRgba[i + 1] ?? 0) / 255,
            (highRgba[i + 2] ?? 0) / 255,
        );
        const midRisk = pixelWhiteMergeRisk(
            rr, rg, rb,
            (midRgba[i] ?? 0) / 255,
            (midRgba[i + 1] ?? 0) / 255,
            (midRgba[i + 2] ?? 0) / 255,
        );
        const highWeight = 1 - smoothstep(0.035, 0.20, highRisk);
        const midWeight = 1 - smoothstep(0.05, 0.24, midRisk);
        const rawMax = Math.max(rr, rg, rb);
        const highMax = Math.max(
            (highRgba[i] ?? 0) / 255,
            (highRgba[i + 1] ?? 0) / 255,
            (highRgba[i + 2] ?? 0) / 255,
        );
        const shadowWeight = shadowBloomWeight(rawMax, highMax);
        for (let channel = 0; channel < 3; channel++) {
            const raw = rawRgba[i + channel] ?? 0;
            const low = lowRgba[i + channel] ?? 0;
            const mid = midRgba[i + channel] ?? 0;
            const high = highRgba[i + channel] ?? 0;
            const upper = mid + (high - mid) * highWeight;
            const bloomComposite = low + (upper - low) * midWeight;
            output[i + channel] = Math.round(raw + (bloomComposite - raw) * shadowWeight);
        }
        output[i + 3] = 255;
    }
    return output;
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
    { min = BLOOM_MIN_STRENGTH, max = BLOOM_MAX_STRENGTH, blowoutRisk = 1 }:
        { min?: number; max?: number; blowoutRisk?: number } = {},
): number {
    const bri = Math.min(Math.max(currentBrightness, 0), 1);
    const densityFactor = totalCount > 0
        ? Math.min(Math.max(litCount / totalCount, 0), 1)
        : 0;
    // Fully brightness/density-modulated strength (the original iris formula).
    const modulated = min + (max - min) * (1 - bri) * densityFactor;
    // The iris only needs to constrict in proportion to how likely the frame
    // is to wash out the panel. blowoutRisk is a geometry-derived scalar
    // (bloomParamsForLedSize): small/sparse dots (risk→0) hold full bloom
    // regardless of the frame; large/dense dots (risk→1) get full modulation.
    const risk = Math.min(Math.max(blowoutRisk, 0), 1);
    const strength = max - risk * (max - modulated);
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

/**
 * Geometric headroom for diameter growth, in [0, 1]. Compares the rendered dot
 * size to the inter-LED spacing: 0 = dots already meet/overlap their neighbours
 * (dense — no room to grow), 1 = dots are tiny relative to their spacing
 * (sparse — lots of empty space to fill). This is the "geometry functor" that a
 * dense map self-rejects through, so no sparse/dense branch is needed.
 */
export function computeDiameterHeadroom(
    ledPx: number,
    panePx: number,
    ledSpacing: number,
    sceneExtent: number,
): number {
    const extent = Math.max(sceneExtent, 1e-9);
    const dotFraction = panePx > 0 ? ledPx / panePx : 0;
    const spacingFraction = ledSpacing / extent;
    if (!(spacingFraction > 0)) return 0;
    const coverage = dotFraction / spacingFraction; // 1 = dots touch, >1 = overlap
    return Math.min(Math.max(1 - coverage, 0), 1);
}

/**
 * Combine total luminous-area risk with local neighbour overlap. Either a
 * panel filled by many dots or dots whose halos reach their neighbours can
 * wash out; the union keeps both signals in [0, 1].
 */
export function combineBloomBlowoutRisk(areaRisk: number, diameterHeadroom: number): number {
    const area = Math.min(Math.max(areaRisk, 0), 1);
    const overlap = 1 - Math.min(Math.max(diameterHeadroom, 0), 1);
    return 1 - (1 - area) * (1 - overlap);
}

/**
 * LED diameter multiplier for the current iris state. Dark-scene sensitivity
 * grows only where spacing permits. Highlight-driven attenuation contracts
 * globally; offline 2x framebuffer AA keeps that motion spatially stable.
 */
export function computeIrisDiameterScale(
    headroom: number,
    brightness: number,
    gain = IRIS_DIAMETER_GAIN,
): number {
    const h = Math.min(Math.max(headroom, 0), 1);
    const b = Math.min(Math.max(brightness, 0), 1);
    const g = Math.max(gain, 0);
    if (b <= IRIS_DIAMETER_PIVOT) {
        const sensitivity = 1 - b / IRIS_DIAMETER_PIVOT;
        return 1 + g * h * IRIS_DILATION_MAX * sensitivity;
    }
    const overload = (b - IRIS_DIAMETER_PIVOT) / (1 - IRIS_DIAMETER_PIVOT);
    return Math.max(0.2, 1 - g * IRIS_CONSTRICTION_MAX * Math.pow(overload, 0.75));
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
    // Coverage headroom drives how much the iris must modulate: when the lit
    // dots and their halos occupy little of the panel (areaScale*perDotScale→1)
    // there is no blow-out risk, so the iris can stay wide open; when they fill
    // it (→0) the iris must fully constrict on bright frames. Resolution is a
    // rendering detail, not a blow-out driver, so it is excluded here.
    const blowoutRisk = Math.min(Math.max(1 - areaScale * perDotScale, 0), 1);
    return {
        radius,
        minStrength: baseMin * strengthScale,
        maxStrength: baseMax * strengthScale,
        blowoutRisk,
    };
}
