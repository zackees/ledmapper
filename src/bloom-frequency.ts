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
    };
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
