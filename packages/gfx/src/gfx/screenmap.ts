/**
 * Screenmap normalization for @fastled/gfx.
 *
 * The constructors accept three input shapes (raw object, raw JSON
 * string, or an already-normalized `Screenmap`). This module turns any
 * of them into the package's internal `Screenmap`.
 */

import { parse_screenmap_data_json, parseScreenmapMultiStrip, centerAndFitPoints } from '../common.js';
import type { Screenmap } from './types.js';
import type { ScreenmapJson, StripPoint } from '../types/domain.js';

function isAlreadyNormalized(value: unknown): value is Screenmap {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as { points?: unknown };
    return Array.isArray(v.points);
}

/**
 * Normalize an input value into a `Screenmap`. Throws on unparseable input.
 *
 * - JSON string  → JSON.parse, then v1/v2 detection
 * - Object       → v1/v2 detection
 * - Screenmap    → passthrough
 *
 * `paneSize` controls the centering box used by `centerAndFitPoints` so
 * the returned `points` are in the renderer's canvas-pixel coordinate
 * system. Pass the same value used by the orthographic camera.
 */
export function normalizeScreenmap(input: unknown, paneSize: number): Screenmap {
    if (isAlreadyNormalized(input)) return input;

    const json: ScreenmapJson = typeof input === 'string'
        ? (JSON.parse(input) as ScreenmapJson)
        : (input as ScreenmapJson);

    const rawPoints = parse_screenmap_data_json(json);
    if (rawPoints.length === 0) {
        throw new Error('normalizeScreenmap: screenmap parsed to zero points');
    }

    const fitted = centerAndFitPoints(rawPoints, paneSize, paneSize);
    const multi = parseScreenmapMultiStrip(json);
    const strips = multi.strips.map((s) => ({
        name: s.name,
        offset: s.offset,
        count: s.count,
    }));

    const screenmap: Screenmap = {
        points: fitted.map(([x, y]: StripPoint) => [x, y] as const),
        strips,
        ...(typeof rawPoints.diameter === 'number' ? { diameter: rawPoints.diameter } : {}),
    };
    return screenmap;
}
