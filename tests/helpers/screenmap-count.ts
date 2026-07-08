/**
 * Count total LEDs in a parsed screenmap JSON object, accepting both the
 * v2 schema (top-level `segments` array — what all ledmapper emitters have
 * produced since issue #144) and the legacy v1 `map` object (still valid
 * as third-party input). Specs that read fixtures or store round-trips at
 * module scope MUST use this: a v1-only read of a v2 fixture throws during
 * Playwright collection and kills the entire run (this is what broke the
 * first gpu-nightly dispatch).
 */
interface StripLike { x: unknown[] }
interface ScreenmapLike { segments?: StripLike[]; map?: Record<string, StripLike> }

export function countScreenmapLeds(json: ScreenmapLike): number {
    const strips = Array.isArray(json.segments)
        ? json.segments
        : Object.values(json.map ?? {});
    return strips.reduce((sum, strip) => sum + strip.x.length, 0);
}

/** Number of strips/segments, v2-or-v1. */
export function countScreenmapStrips(json: ScreenmapLike): number {
    return Array.isArray(json.segments)
        ? json.segments.length
        : Object.keys(json.map ?? {}).length;
}
