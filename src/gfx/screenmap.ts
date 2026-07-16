/**
 * Screenmap normalization for @fastled/gfx.
 *
 * The constructors accept three input shapes (raw object, raw JSON
 * string, or an already-normalized `Screenmap`). This module turns any
 * of them into the package's internal `Screenmap`.
 */

import { parse_screenmap_data_json, parseScreenmapMultiStrip, centerAndFitPoints, computeCenterFitScale } from '../common';
import type { Screenmap, ScreenmapShape } from './types';
import type { ScreenmapJson, StripPoint } from '../types/domain';

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

    const multi = parseScreenmapMultiStrip(json);
    const sourceGeometry = multi.strips.flatMap((s) => s.type === 'led_strip' ? s.points : (s.vertices ?? []));
    if (sourceGeometry.length === 0 && (multi.channelCount ?? multi.totalCount) === 0) {
        throw new Error('normalizeScreenmap: screenmap parsed to zero points');
    }

    const fitted = centerAndFitPoints(sourceGeometry, paneSize, paneSize);
    const fittedPoints = centerAndFitPoints(multi.allPoints, paneSize, paneSize);
    const fitScale = computeCenterFitScale(sourceGeometry, paneSize, paneSize);
    let cursor = 0;
    const strips = multi.strips.map((s) => ({
        name: s.name,
        offset: s.offset,
        count: s.count,
    }));
    const shapes: ScreenmapShape[] = [];
    for (const s of multi.strips) {
        if (s.type === 'el_wire' || s.type === 'el_panel') {
            const vertices = (s.vertices ?? []).map(() => {
                const p = fitted[cursor++] ?? [0, 0];
                return [p[0], p[1]] as const;
            });
            shapes.push({ name: s.name, type: s.type, offset: s.offset, vertices, ...(s.thickness !== undefined ? { thickness: s.thickness * fitScale } : {}) });
        } else {
            cursor += s.points.length;
        }
    }
    const rawPoints = parse_screenmap_data_json(json);

    const screenmap: Screenmap = {
        points: fittedPoints.map(([x, y]: StripPoint) => [x, y] as const),
        strips,
        ...(typeof rawPoints.diameter === 'number' ? { diameter: rawPoints.diameter } : {}),
        ...(shapes.length > 0 ? { shapes } : {}),
        channelCount: multi.channelCount ?? multi.totalCount,
    };
    return screenmap;
}
