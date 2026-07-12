import { parseScreenmapMultiStrip } from './common';
import type { ParsedStrip, StripPoint } from './types/domain';

export const CANONICAL_64X64_PRESET = '64x64_quad_serpentine.json';

export interface CanonicalExtraPoint {
    strip: string;
    index: number;
    point: StripPoint;
}

export interface Canonical64x64Divergence {
    actualLedCount: number;
    expectedLedCount: number;
    shiftedStrips: string[];
    extraPoints: CanonicalExtraPoint[];
}

interface StripMatch {
    dx: number;
    dy: number;
    extra: CanonicalExtraPoint | null;
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
    return a === b;
}

export function isCanonical64x64Geometry(candidateText: string, canonicalText: string): boolean {
    try {
        const candidate = parseScreenmapMultiStrip(candidateText);
        const canonical = parseScreenmapMultiStrip(canonicalText);
        if (canonical.totalCount !== 4096 || candidate.strips.length !== canonical.strips.length) return false;
        return canonical.strips.every((expected, index) => {
            const actual = candidate.strips[index];
            return actual?.name === expected.name
                && actual.pin === expected.pin
                && actual.video_offset === expected.video_offset
                && actual.videoOffsetOverride === expected.videoOffsetOverride
                && sameNumber(actual.diameter, expected.diameter)
                && actual.points.length === expected.points.length
                && actual.points.every((point, pointIndex) => (
                    point[0] === expected.points[pointIndex][0]
                    && point[1] === expected.points[pointIndex][1]
                ));
        });
    } catch {
        return false;
    }
}

const TRANSLATION_LIMIT = 0.75;
const EPSILON = 1e-3;

function matchTranslatedStrip(actual: ParsedStrip, expected: ParsedStrip): StripMatch | null {
    const extraCount = actual.points.length - expected.points.length;
    if (extraCount < 0 || extraCount > 1) return null;
    const skipCandidates = extraCount === 0 ? [-1] : actual.points.map((_, index) => index);

    for (const skip of skipCandidates) {
        let dx: number | null = null;
        let dy: number | null = null;
        let expectedIndex = 0;
        let matches = true;
        for (let actualIndex = 0; actualIndex < actual.points.length; actualIndex++) {
            if (actualIndex === skip) continue;
            const actualPoint = actual.points[actualIndex];
            const expectedPoint = expected.points[expectedIndex++];
            if (!actualPoint || !expectedPoint) { matches = false; break; }
            const pointDx = actualPoint[0] - expectedPoint[0];
            const pointDy = actualPoint[1] - expectedPoint[1];
            dx ??= pointDx;
            dy ??= pointDy;
            if (Math.abs(pointDx - dx) > EPSILON || Math.abs(pointDy - dy) > EPSILON) {
                matches = false;
                break;
            }
        }
        if (!matches || expectedIndex !== expected.points.length || dx === null || dy === null) continue;
        if (Math.abs(dx) > TRANSLATION_LIMIT || Math.abs(dy) > TRANSLATION_LIMIT) continue;
        const extraPoint = skip >= 0 ? actual.points[skip] : null;
        return {
            dx,
            dy,
            extra: extraPoint
                ? { strip: actual.name, index: skip, point: [extraPoint[0], extraPoint[1]] }
                : null,
        };
    }
    return null;
}

/** Recognize only a narrowly bounded, damaged copy of the canonical map. */
export function analyzeCanonical64x64Divergence(
    candidateText: string,
    canonicalText: string,
): Canonical64x64Divergence | null {
    let candidate;
    let canonical;
    try {
        candidate = parseScreenmapMultiStrip(candidateText);
        canonical = parseScreenmapMultiStrip(canonicalText);
    } catch {
        return null;
    }
    if (candidate.strips.length !== canonical.strips.length || canonical.totalCount !== 4096) return null;

    const shiftedStrips: string[] = [];
    const extraPoints: CanonicalExtraPoint[] = [];
    for (let index = 0; index < canonical.strips.length; index++) {
        const actualStrip = candidate.strips[index];
        const expectedStrip = canonical.strips[index];
        if (!expectedStrip || actualStrip?.name !== expectedStrip.name) return null;
        const match = matchTranslatedStrip(actualStrip, expectedStrip);
        if (!match) return null;
        if (Math.abs(match.dx) > EPSILON || Math.abs(match.dy) > EPSILON) shiftedStrips.push(actualStrip.name);
        if (match.extra) extraPoints.push(match.extra);
    }

    if (shiftedStrips.length === 0 && extraPoints.length === 0) return null;
    return {
        actualLedCount: candidate.totalCount,
        expectedLedCount: canonical.totalCount,
        shiftedStrips,
        extraPoints,
    };
}

export function getDefaultPresetFile(manifest: unknown): string | null {
    if (!manifest || typeof manifest !== 'object') return null;
    const value = manifest as { defaultPreset?: unknown; presets?: unknown };
    if (typeof value.defaultPreset !== 'string' || !Array.isArray(value.presets)) return null;
    return value.presets.some((preset) => (
        preset && typeof preset === 'object'
        && (preset as { file?: unknown }).file === value.defaultPreset
    )) ? value.defaultPreset : null;
}
