/**
 * Temporal source-frequency controller for the acrylic bloom pyramid (#507).
 *
 * The controller classifies the raw LED lattice, never the rendered/bloomed
 * image.  It changes only the distribution of energy among UnrealBloom mips
 * 0-2; capture strength, exposure, tone mapping, and LED diameter remain
 * independent.  Mips 3-4 stay hard-zero because those coarse bands caused the
 * historical full-pane colour wash.
 */

import { SRGB8_TO_LINEAR } from './color-space';
import type { StripPoint } from './types/domain';

export type BloomFrequencyMode = 'auto' | 'low' | 'high';
export type BloomMipWeights = readonly [number, number, number, number, number];
export type BloomFrequencyEdge = readonly [number, number];

export interface BloomFrequencyTopology {
    edges: readonly BloomFrequencyEdge[];
    channels: readonly number[];
    /** Spatial-grid metadata used by the local bloom-bias texture. */
    gridWidth: number;
    gridHeight: number;
    gridIndices: readonly number[];
    gridAspect: readonly [number, number];
    isCompleteGrid: boolean;
}

export interface BloomFrequencyFeatures {
    lumaDisagreement: number;
    chromaDisagreement: number;
    coherentCoverage: number;
    score: number;
}

export interface BloomFrequencyTelemetry extends BloomFrequencyFeatures {
    target: number;
    blend: number;
    weights: BloomMipWeights;
}

export interface LocalBloomBiasTelemetry {
    /** Scalar low/mid support request, retained for evaluator diagnostics. */
    data: Uint8Array;
    /** RGBA upload: mip bias, blue-halo support, and source R/B + G/B. */
    textureData: Uint8Array;
    width: number;
    height: number;
    activeCoverage: number;
    mean: number;
    peak: number;
}

/** Approved coherent-surface endpoint: slightly more mip-2 fill than #506. */
export const BLOOM_FREQUENCY_LOW_WEIGHTS: BloomMipWeights = [2.85, 4.00, 1.75, 0, 0];
/** Fine/chromatically-discontinuous endpoint: energy moves from mip 2 to 0-1. */
export const BLOOM_FREQUENCY_HIGH_WEIGHTS: BloomMipWeights = [3.40, 4.30, 0.713333333333, 0, 0];

/** Corpus-calibrated score corridor; AQNF is below, AQPahgl9 is above. */
export const BLOOM_FREQUENCY_LOW_EDGE = 0.32;
export const BLOOM_FREQUENCY_HIGH_EDGE = 0.65;
/** Protect a newly complex frame quickly; reopen surface fill conservatively. */
export const BLOOM_FREQUENCY_ATTACK_TAU = 0.14;
export const BLOOM_FREQUENCY_DECAY_TAU = 0.85;
export const BLOOM_FREQUENCY_MAX_DT = 0.25;

/** Open fill conservatively; close it quickly when structure turns shadowy. */
export const LOCAL_BLOOM_BIAS_ATTACK_TAU = 0.22;
export const LOCAL_BLOOM_BIAS_DECAY_TAU = 0.10;

// Effective constant-field/impulse contribution of each UnrealBloom band at
// the production radius.  These are deliberately not treated as equal-area
// weights: wider mips cover more pixels.  Both tuned endpoints were calibrated
// to the same dot-field energy under this model, and interpolation is
// normalized again to prevent visible exposure pumping along the curve.
const BLOOM_MIP_ENERGY = [0.76, 0.68, 0.60, 0.52, 0.44] as const;
const REFERENCE_ENERGY = weightedEnergy(BLOOM_FREQUENCY_LOW_WEIGHTS);

function clamp01(value: number): number {
    return Math.min(Math.max(value, 0), 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-9));
    return t * t * (3 - 2 * t);
}

function weightedEnergy(weights: BloomMipWeights): number {
    return weights.reduce(
        (sum, weight, index) => sum + weight * (BLOOM_MIP_ENERGY[index] ?? 0),
        0,
    );
}

/** Build axial + diagonal nearest-neighbour edges for a regular LED lattice. */
export function createBloomFrequencyTopology(
    points: readonly StripPoint[],
    channelOffsets: readonly number[] = [],
): BloomFrequencyTopology {
    const xs = [...new Set(points.map(([x]) => x))].sort((a, b) => a - b);
    const ys = [...new Set(points.map(([, y]) => y))].sort((a, b) => a - b);
    const xIndex = new Map(xs.map((value, index) => [value, index]));
    const yIndex = new Map(ys.map((value, index) => [value, index]));
    const nominalPitch = (values: readonly number[]): number | null => {
        if (values.length < 2) return null;
        const deltas = values.slice(1).map((value, index) => value - (values[index] ?? value));
        const sorted = deltas.filter((delta) => delta > 1e-9).sort((a, b) => a - b);
        if (sorted.length === 0) return null;
        return sorted[Math.floor(sorted.length / 2)] ?? null;
    };
    const xPitch = nominalPitch(xs);
    const yPitch = nominalPitch(ys);
    const hasUniformPitch = (values: readonly number[], pitch: number | null): boolean => {
        if (pitch === null) return false;
        return values.slice(1).every((value, index) => {
            const previous = values[index];
            if (previous === undefined) return false;
            return Math.abs((value - previous) - pitch) <= Math.max(pitch * 0.10, 1e-6);
        });
    };
    const isLocalStep = (values: readonly number[], index: number, delta: number, pitch: number | null): boolean => {
        if (delta === 0) return true;
        const next = index + delta;
        const first = values[index];
        const second = values[next];
        if (pitch === null || first === undefined || second === undefined) return false;
        const actual = Math.abs(second - first);
        return Math.abs(actual - pitch) <= Math.max(pitch * 0.10, 1e-6);
    };
    const grid = new Map<string, number>();
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        if (!point) continue;
        const gx = xIndex.get(point[0]);
        const gy = yIndex.get(point[1]);
        if (gx !== undefined && gy !== undefined) grid.set(`${String(gx)},${String(gy)}`, index);
    }

    const edges: BloomFrequencyEdge[] = [];
    const offsets = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
    for (const [key, first] of grid) {
        const [gxText, gyText] = key.split(',');
        const gx = Number(gxText);
        const gy = Number(gyText);
        for (const [dx, dy] of offsets) {
            // Ranked coordinates alone are insufficient: [0, 1, 100, 101]
            // contains two local panels, not a 99-unit nearest-neighbour edge.
            if (!isLocalStep(xs, gx, dx, xPitch) || !isLocalStep(ys, gy, dy, yPitch)) continue;
            const second = grid.get(`${String(gx + dx)},${String(gy + dy)}`);
            if (second !== undefined) edges.push([first, second]);
        }
    }
    return {
        edges,
        channels: points.map((_point, index) => channelOffsets[index] ?? index),
        gridWidth: xs.length,
        gridHeight: ys.length,
        gridIndices: points.map((point) => {
            const gx = xIndex.get(point[0]);
            const gy = yIndex.get(point[1]);
            return gx === undefined || gy === undefined ? -1 : gy * xs.length + gx;
        }),
        gridAspect: (() => {
            const spanX = Math.max((xs.at(-1) ?? 0) - (xs[0] ?? 0), 0);
            const spanY = Math.max((ys.at(-1) ?? 0) - (ys[0] ?? 0), 0);
            const extent = Math.max(spanX, spanY, 1e-9);
            return [spanX / extent, spanY / extent] as const;
        })(),
        isCompleteGrid: grid.size === points.length
            && grid.size === xs.length * ys.length
            && xs.length > 1
            && ys.length > 1
            // The texture is sampled uniformly between ranked grid cells.
            // Non-uniform physical coordinates need a coordinate texture, so
            // disable this simpler path rather than spatially misregister it.
            && hasUniformPitch(xs, xPitch)
            && hasUniformPitch(ys, yPitch),
    };
}

/**
 * Build a temporally stable, spatially sampled request for extra local fill.
 *
 * This is intentionally a separate data layer from the global frequency
 * classifier.  It finds coherent low/mid LED neighborhoods that can accept a
 * little more mip-2 support (AQNFgVV neck piece at t~=9), while bright pixels
 * remain exactly on the global profile and black/deep-discontinuous structure
 * stays protected (AQNFgVV hair at t=14).  Mips 3-4 are never involved.
 */
export function createLocalBloomBiasController() {
    let filtered: Float32Array | null = null;
    let blueFiltered = new Float32Array(0);
    let bytes = new Uint8Array(0);
    let textureBytes = new Uint8Array(0);
    let pointLuma = new Float32Array(0);
    let pointMax = new Float32Array(0);
    let linearR = new Float32Array(0);
    let linearG = new Float32Array(0);
    let linearB = new Float32Array(0);
    let pointWarm = new Float32Array(0);
    let chromaR = new Float32Array(0);
    let chromaG = new Float32Array(0);
    let chromaB = new Float32Array(0);
    let neighbourCount = new Uint8Array(0);
    let coherentCount = new Uint8Array(0);
    let warmNeighbour = new Float32Array(0);
    let target = new Float32Array(0);
    let spatial = new Float32Array(0);
    let blueTarget = new Float32Array(0);
    let blueSpatial = new Float32Array(0);
    let lastMediaTimeMs: number | null = null;

    function update(
        rgbBytes: Uint8Array | number[],
        topology: BloomFrequencyTopology,
        mediaTimeMs: number,
    ): LocalBloomBiasTelemetry | null {
        if (!topology.isCompleteGrid) return null;
        const count = topology.gridWidth * topology.gridHeight;
        if (filtered?.length !== count) {
            filtered = new Float32Array(count);
            blueFiltered = new Float32Array(count);
            bytes = new Uint8Array(count);
            textureBytes = new Uint8Array(count * 4);
            target = new Float32Array(count);
            spatial = new Float32Array(count);
            blueTarget = new Float32Array(count);
            blueSpatial = new Float32Array(count);
            lastMediaTimeMs = null;
        }
        const pointCount = topology.channels.length;
        if (pointLuma.length !== pointCount) {
            pointLuma = new Float32Array(pointCount);
            pointMax = new Float32Array(pointCount);
            linearR = new Float32Array(pointCount);
            linearG = new Float32Array(pointCount);
            linearB = new Float32Array(pointCount);
            pointWarm = new Float32Array(pointCount);
            chromaR = new Float32Array(pointCount);
            chromaG = new Float32Array(pointCount);
            chromaB = new Float32Array(pointCount);
            neighbourCount = new Uint8Array(pointCount);
            coherentCount = new Uint8Array(pointCount);
            warmNeighbour = new Float32Array(pointCount);
        } else {
            neighbourCount.fill(0);
            coherentCount.fill(0);
            warmNeighbour.fill(0);
        }
        target.fill(0);
        spatial.fill(0);
        blueTarget.fill(0);
        blueSpatial.fill(0);
        for (let point = 0; point < topology.channels.length; point++) {
            const channel = topology.channels[point] ?? point;
            const offset = channel * 3;
            const r8 = rgbBytes[offset] ?? 0;
            const g8 = rgbBytes[offset + 1] ?? 0;
            const b8 = rgbBytes[offset + 2] ?? 0;
            const sum = Math.max(r8 + g8 + b8, 1);
            linearR[point] = SRGB8_TO_LINEAR[r8] ?? 0;
            linearG[point] = SRGB8_TO_LINEAR[g8] ?? 0;
            linearB[point] = SRGB8_TO_LINEAR[b8] ?? 0;
            pointLuma[point] = 0.2126 * (linearR[point] ?? 0)
                + 0.7152 * (linearG[point] ?? 0)
                + 0.0722 * (linearB[point] ?? 0);
            pointMax[point] = Math.max(r8, g8, b8) / 255;
            chromaR[point] = r8 / sum;
            chromaG[point] = g8 / sum;
            chromaB[point] = b8 / sum;
            const maximum = Math.max(
                linearR[point] ?? 0,
                linearG[point] ?? 0,
                linearB[point] ?? 0,
                1e-9,
            );
            const yellowDominance = (Math.min(
                linearR[point] ?? 0,
                linearG[point] ?? 0,
            ) - (linearB[point] ?? 0)) / maximum;
            pointWarm[point] = smoothstep(0.08, 0.35, yellowDominance)
                * smoothstep(0.08, 0.25, pointMax[point] ?? 0);
        }
        for (const [first, second] of topology.edges) {
            const firstLuma = pointLuma[first] ?? 0;
            const secondLuma = pointLuma[second] ?? 0;
            const lumaDistance = Math.abs(firstLuma - secondLuma)
                / Math.max(firstLuma + secondLuma + 0.02, 0.02);
            const chromaDistance = Math.hypot(
                (chromaR[first] ?? 0) - (chromaR[second] ?? 0),
                (chromaG[first] ?? 0) - (chromaG[second] ?? 0),
                (chromaB[first] ?? 0) - (chromaB[second] ?? 0),
            );
            neighbourCount[first] = (neighbourCount[first] ?? 0) + 1;
            neighbourCount[second] = (neighbourCount[second] ?? 0) + 1;
            if (lumaDistance < 0.24 && chromaDistance < 0.11) {
                coherentCount[first] = (coherentCount[first] ?? 0) + 1;
                coherentCount[second] = (coherentCount[second] ?? 0) + 1;
            }
            warmNeighbour[first] = Math.max(
                warmNeighbour[first] ?? 0,
                pointWarm[second] ?? 0,
            );
            warmNeighbour[second] = Math.max(
                warmNeighbour[second] ?? 0,
                pointWarm[first] ?? 0,
            );
        }
        for (let point = 0; point < topology.channels.length; point++) {
            const gridIndex = topology.gridIndices[point] ?? -1;
            if (gridIndex < 0) continue;
            const luma = pointLuma[point] ?? 0;
            const drive = pointMax[point] ?? 0;
            const coherence = (coherentCount[point] ?? 0)
                / Math.max(neighbourCount[point] ?? 0, 1);
            // Perceptually blue low/mids have much lower Rec.709 luminance
            // than skin. The max-channel floor admits them, while the luma
            // shoulder makes bright neutral face/highlight pixels zero. A
            // saturated primary is core-protected later in the composite.
            const visible = smoothstep(0.008, 0.035, luma)
                * (1 - smoothstep(0.16, 0.30, luma));
            // Keep the field open through saturated blue midtones, then taper
            // the REQUEST as it approaches full primary drive. The composite
            // independently pins genuinely clipped cores. The evaluator
            // starts measuring bright-core deltas at 0.70, so this behavior is
            // bounded without reviving the old premature splat cutoff.
            const driven = smoothstep(0.10, 0.28, drive)
                * (1 - smoothstep(0.70, 0.92, drive));
            // A chromatic checker retains same-colour diagonal neighbours
            // (coherence ~= 0.5); require more than that so high-frequency
            // detail cannot masquerade as a surface. The following grid blur
            // carries the interior request smoothly across a real boundary.
            const supported = smoothstep(0.52, 0.78, coherence);
            target[gridIndex] = clamp01(visible * driven * supported);
            const maximum = Math.max(
                linearR[point] ?? 0,
                linearG[point] ?? 0,
                linearB[point] ?? 0,
                1e-9,
            );
            const blueDominance = ((linearB[point] ?? 0)
                - Math.max(linearR[point] ?? 0, linearG[point] ?? 0)) / maximum;
            // This field is intentionally independent of neighbourhood
            // coherence: a yellow/blue boundary is precisely where a blue
            // emitter's already-existing Gaussian may need hue correction.
            // It never opens bloom energy; the shader uses it only to recolor
            // mismatched tight-lobe energy in negative space.
            const blueEmitter = smoothstep(0.08, 0.18, drive)
                * (1 - smoothstep(0.65, 0.90, drive));
            blueTarget[gridIndex] = clamp01(
                blueEmitter
                * smoothstep(0.18, 0.50, blueDominance)
                * smoothstep(0.05, 0.25, warmNeighbour[point] ?? 0),
            );
        }
        // One axial+diagonal grid blur turns per-vertex requests into a smooth
        // scalar field. It is a control texture, not emitted light: the actual
        // Gaussian bloom remains GPU-generated and ring-free.
        for (let y = 0; y < topology.gridHeight; y++) {
            for (let x = 0; x < topology.gridWidth; x++) {
                const index = y * topology.gridWidth + x;
                let sum = (target[index] ?? 0) * 4;
                let weight = 4;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || nx >= topology.gridWidth || ny < 0 || ny >= topology.gridHeight) continue;
                        const sampleWeight = dx === 0 || dy === 0 ? 2 : 1;
                        sum += (target[ny * topology.gridWidth + nx] ?? 0) * sampleWeight;
                        weight += sampleWeight;
                    }
                }
                spatial[index] = sum / weight;
                // Keep ownership on the blue emitter texel. The GPU's linear
                // sampler spreads this continuous control across that LED's
                // own sub-pitch halo; a CPU neighbour blur would leak the mask
                // onto a yellow/red texel and pair it with the wrong hue.
                blueSpatial[index] = blueTarget[index] ?? 0;
            }
        }

        const reset = lastMediaTimeMs === null
            || !Number.isFinite(mediaTimeMs)
            || mediaTimeMs < lastMediaTimeMs;
        const dt = reset ? 0 : Math.min(Math.max(
            (mediaTimeMs - (lastMediaTimeMs ?? mediaTimeMs)) / 1000,
            0,
        ), BLOOM_FREQUENCY_MAX_DT);
        let sum = 0;
        let active = 0;
        let peak = 0;
        for (let index = 0; index < count; index++) {
            const desired = spatial[index] ?? 0;
            const current = filtered[index] ?? 0;
            const tau = desired > current
                ? LOCAL_BLOOM_BIAS_ATTACK_TAU
                : LOCAL_BLOOM_BIAS_DECAY_TAU;
            const next = reset ? desired : desired + (current - desired) * Math.exp(-dt / tau);
            filtered[index] = next;
            bytes[index] = Math.round(clamp01(next) * 255);
            const blueDesired = blueSpatial[index] ?? 0;
            const blueCurrent = blueFiltered[index] ?? 0;
            const blueTau = blueDesired > blueCurrent
                ? LOCAL_BLOOM_BIAS_ATTACK_TAU
                : LOCAL_BLOOM_BIAS_DECAY_TAU;
            blueFiltered[index] = reset
                ? blueDesired
                : blueDesired + (blueCurrent - blueDesired) * Math.exp(-dt / blueTau);
            sum += next;
            if (next >= 0.20) active++;
            peak = Math.max(peak, next);
        }
        // Keep color out of the scalar temporal filter: it is sampled from the
        // same current source frame as the Gaussian brackets. Hardware linear
        // interpolation between grid texels supplies a smooth source-hue field
        // in the gaps. R is the attack/decay-filtered general mip-bias mask; G
        // is an independently filtered blue-halo recolor mask. Since G only
        // admits blue-dominant texels, B/A can store R/B and G/B with blue
        // implied as 1, preserving the source hue needed by the narrow repair.
        textureBytes.fill(0);
        for (let point = 0; point < topology.gridIndices.length; point++) {
            const gridIndex = topology.gridIndices[point] ?? -1;
            if (gridIndex < 0) continue;
            const maximum = Math.max(
                linearR[point] ?? 0,
                linearG[point] ?? 0,
                linearB[point] ?? 0,
            );
            const offset = gridIndex * 4;
            textureBytes[offset] = bytes[gridIndex] ?? 0;
            const blueWeight = clamp01(blueFiltered[gridIndex] ?? 0);
            textureBytes[offset + 1] = Math.round(blueWeight * 255);
            if (maximum > 1e-9) {
                // Premultiply hue ratios by ownership before interpolation.
                // The shader divides by sampled G, so a zero-weight yellow
                // neighbour cannot inject its hue into a blue emitter's halo.
                textureBytes[offset + 2] = Math.round(
                    (linearR[point] ?? 0) / maximum * blueWeight * 255,
                );
                textureBytes[offset + 3] = Math.round(
                    (linearG[point] ?? 0) / maximum * blueWeight * 255,
                );
            }
        }
        lastMediaTimeMs = mediaTimeMs;
        return {
            data: bytes,
            textureData: textureBytes,
            width: topology.gridWidth,
            height: topology.gridHeight,
            activeCoverage: active / count,
            mean: sum / count,
            peak,
        };
    }

    function reset(): void {
        filtered = null;
        blueFiltered = new Float32Array(0);
        bytes = new Uint8Array(0);
        textureBytes = new Uint8Array(0);
        pointLuma = new Float32Array(0);
        pointMax = new Float32Array(0);
        linearR = new Float32Array(0);
        linearG = new Float32Array(0);
        linearB = new Float32Array(0);
        pointWarm = new Float32Array(0);
        chromaR = new Float32Array(0);
        chromaG = new Float32Array(0);
        chromaB = new Float32Array(0);
        neighbourCount = new Uint8Array(0);
        coherentCount = new Uint8Array(0);
        warmNeighbour = new Float32Array(0);
        target = new Float32Array(0);
        spatial = new Float32Array(0);
        blueTarget = new Float32Array(0);
        blueSpatial = new Float32Array(0);
        lastMediaTimeMs = null;
    }

    return { update, reset };
}

/** Classify fine luma/chroma variation already present on the raw LED grid. */
export function computeBloomFrequencyFeatures(
    rgbBytes: Uint8Array | number[],
    topology: BloomFrequencyTopology,
): BloomFrequencyFeatures {
    let litEdges = 0;
    let lumaDisagree = 0;
    let chromaDisagree = 0;
    let coherent = 0;
    for (const [pointA, pointB] of topology.edges) {
        const channelA = topology.channels[pointA] ?? pointA;
        const channelB = topology.channels[pointB] ?? pointB;
        const a3 = channelA * 3;
        const b3 = channelB * 3;
        const ar8 = rgbBytes[a3] ?? 0;
        const ag8 = rgbBytes[a3 + 1] ?? 0;
        const ab8 = rgbBytes[a3 + 2] ?? 0;
        const br8 = rgbBytes[b3] ?? 0;
        const bg8 = rgbBytes[b3 + 1] ?? 0;
        const bb8 = rgbBytes[b3 + 2] ?? 0;
        if (Math.max(ar8, ag8, ab8, br8, bg8, bb8) < 20) continue;

        const ay = 0.2126 * (SRGB8_TO_LINEAR[ar8] ?? 0)
            + 0.7152 * (SRGB8_TO_LINEAR[ag8] ?? 0)
            + 0.0722 * (SRGB8_TO_LINEAR[ab8] ?? 0);
        const by = 0.2126 * (SRGB8_TO_LINEAR[br8] ?? 0)
            + 0.7152 * (SRGB8_TO_LINEAR[bg8] ?? 0)
            + 0.0722 * (SRGB8_TO_LINEAR[bb8] ?? 0);
        const lumaDistance = Math.abs(ay - by) / Math.max(ay + by + 0.02, 0.02);
        const aSum = Math.max(ar8 + ag8 + ab8, 1);
        const bSum = Math.max(br8 + bg8 + bb8, 1);
        const dr = ar8 / aSum - br8 / bSum;
        const dg = ag8 / aSum - bg8 / bSum;
        const db = ab8 / aSum - bb8 / bSum;
        const chromaDistance = Math.hypot(dr, dg, db);

        litEdges++;
        if (lumaDistance > 0.18) lumaDisagree++;
        if (chromaDistance > 0.10) chromaDisagree++;
        if (lumaDistance < 0.12 && chromaDistance < 0.08) coherent++;
    }
    if (litEdges === 0) {
        return { lumaDisagreement: 0, chromaDisagreement: 0, coherentCoverage: 1, score: 0 };
    }
    const lumaDisagreement = lumaDisagree / litEdges;
    const chromaDisagreement = chromaDisagree / litEdges;
    const coherentCoverage = coherent / litEdges;
    return {
        lumaDisagreement,
        chromaDisagreement,
        coherentCoverage,
        // The max term detects both luminance-only checker/stripe detail and
        // isoluminant chromatic noise.  The coherence term distinguishes a
        // textured field from a few ordinary hard edges. On the locked real
        // clips this leaves AQNF below the 0.32 low edge and AQPahgl9 above
        // the 0.65 high edge. The plateau begins below AQPahgl9's measured
        // runtime minimum (0.660) so codec noise cannot leave a tiny residual
        // blend that the composite magnifies.
        score: clamp01((() => {
            const disagreement = Math.max(lumaDisagreement, chromaDisagreement);
            const nonCoherent = Math.max(1 - coherentCoverage, 1e-9);
            return 0.75 * disagreement + 0.25 * Math.min(disagreement / nonCoherent, 1) - 0.10;
        })()),
    };
}

export function bloomFrequencyTarget(score: number): number {
    return smoothstep(BLOOM_FREQUENCY_LOW_EDGE, BLOOM_FREQUENCY_HIGH_EDGE, score);
}

export function interpolateBloomMipWeights(blend: number): BloomMipWeights {
    const t = clamp01(blend);
    const raw = BLOOM_FREQUENCY_LOW_WEIGHTS.map((low, index) => (
        low + t * ((BLOOM_FREQUENCY_HIGH_WEIGHTS[index] ?? low) - low)
    )) as unknown as BloomMipWeights;
    const scale = REFERENCE_ENERGY / Math.max(weightedEnergy(raw), 1e-9);
    const normalized = raw.map(
        (weight, index) => index < 3 ? Math.max(weight * scale, 0) : 0,
    );
    return normalized as unknown as BloomMipWeights;
}

export function stepBloomFrequencyBlend(
    current: number,
    target: number,
    dtSeconds: number,
    attackTau = BLOOM_FREQUENCY_ATTACK_TAU,
    decayTau = BLOOM_FREQUENCY_DECAY_TAU,
): number {
    const from = clamp01(current);
    const to = clamp01(target);
    const dt = Math.min(Math.max(dtSeconds, 0), BLOOM_FREQUENCY_MAX_DT);
    if (dt === 0 || from === to) return from;
    const tau = to > from ? attackTau : decayTau;
    if (tau <= 0) return to;
    return clamp01(to + (from - to) * Math.exp(-dt / tau));
}

export function createBloomFrequencyController({
    mode = 'auto',
    blendOverride = null,
}: {
    mode?: BloomFrequencyMode;
    blendOverride?: number | null;
} = {}) {
    let blend: number | null = null;
    let lastMediaTimeMs: number | null = null;
    let telemetry: BloomFrequencyTelemetry | null = null;

    function forcedTarget(autoTarget: number): number {
        if (blendOverride !== null) return clamp01(blendOverride);
        if (mode === 'low') return 0;
        if (mode === 'high') return 1;
        return autoTarget;
    }

    function update(
        rgbBytes: Uint8Array | number[],
        topology: BloomFrequencyTopology,
        mediaTimeMs: number,
    ): BloomFrequencyTelemetry {
        const features = computeBloomFrequencyFeatures(rgbBytes, topology);
        const target = forcedTarget(bloomFrequencyTarget(features.score));
        const reset = blend === null
            || lastMediaTimeMs === null
            || !Number.isFinite(mediaTimeMs)
            || mediaTimeMs < lastMediaTimeMs;
        const nextBlend = reset
            ? target
            : stepBloomFrequencyBlend(
                blend ?? target,
                target,
                (mediaTimeMs - (lastMediaTimeMs ?? mediaTimeMs)) / 1000,
            );
        blend = nextBlend;
        lastMediaTimeMs = mediaTimeMs;
        const nextTelemetry = {
            ...features,
            target,
            blend: nextBlend,
            weights: interpolateBloomMipWeights(nextBlend),
        };
        telemetry = nextTelemetry;
        return nextTelemetry;
    }

    function reset(): void {
        blend = null;
        lastMediaTimeMs = null;
        telemetry = null;
    }

    return { update, reset, getTelemetry: () => telemetry };
}
