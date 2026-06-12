/**
 * Clipboard-text parser for the ScreenMap editor "paste screenmap" flow.
 *
 * Accepted formats:
 *   1. Full screenmap JSON: { map: { stripName: { x:[...], y:[...], diameter?, video_offset? } } }
 *   2. Single strip object: { name, points: [[x,y],...], diameter? }
 *   3. Bare points array:   [[x,y], [x,y], ...]
 *
 * Returns a normalized shape:
 *   { strips: [{ name, points:[[x,y],...], diameter?:number, video_offset?:number }, ...] }
 *
 * Returns `null` for invalid/empty/degenerate input.
 */

import { parseScreenmapMultiStrip } from '../common';
import type { ParsedStrip } from '../types/domain';

export interface PasteStrip {
    name: string;
    points: [number, number][];
    diameter?: number;
    video_offset?: number;
}

export interface PasteResult {
    strips: PasteStrip[];
}

function _isFinitePair(p: unknown): p is [number, number] {
    return Array.isArray(p) && p.length >= 2
        && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
}

function _coercePoints(arr: unknown): [number, number][] | null {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out: [number, number][] = [];
    for (const p of arr) {
        if (!_isFinitePair(p)) return null;
        out.push([p[0], p[1]]);
    }
    return out;
}

export function parsePastedScreenmap(text: unknown): PasteResult | null {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    let obj: unknown;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        return null;
    }
    if (obj === null || obj === undefined) return null;

    // Case 3: bare array of points
    if (Array.isArray(obj)) {
        const pts = _coercePoints(obj);
        if (!pts) return null;
        return { strips: [{ name: 'pasted1', points: pts }] };
    }

    if (typeof obj !== 'object') return null;
    const objRecord = obj as Record<string, unknown>;

    // Case 1: full screenmap JSON with `map`
    if (objRecord.map && typeof objRecord.map === 'object') {
        try {
            const info = parseScreenmapMultiStrip(obj);
            if (info.totalCount === 0 || info.strips.length === 0) return null;
            const strips: PasteStrip[] = info.strips.map((s: ParsedStrip) => {
                const out: PasteStrip = {
                    name: s.name,
                    points: s.points.map(p => [p[0], p[1]] as [number, number]),
                };
                if (typeof s.diameter === 'number' && isFinite(s.diameter)) out.diameter = s.diameter;
                if (typeof s.video_offset === 'number' && isFinite(s.video_offset)) {
                    out.video_offset = s.video_offset;
                }
                return out;
            });
            // Reject if every strip is empty
            if (!strips.some(s => s.points.length > 0)) return null;
            return { strips: strips.filter(s => s.points.length > 0) };
        } catch {
            return null;
        }
    }

    // Case 2: single strip { name?, points: [...], diameter? }
    if (Array.isArray(objRecord.points)) {
        const pts = _coercePoints(objRecord.points);
        if (!pts) return null;
        const name = objRecord.name;
        const diameter = objRecord.diameter;
        const out: PasteStrip = {
            name: (typeof name === 'string' && name.trim()) ? name.trim() : 'pasted1',
            points: pts,
        };
        if (typeof diameter === 'number' && isFinite(diameter)) {
            out.diameter = diameter;
        }
        return { strips: [out] };
    }

    return null;
}

/**
 * Merge a parsed paste-result against an existing list of strip names.
 * Returns a new array of strips with collision-renamed `name`s and
 * `video_offset` re-indexed to append after `currentTotalCount`.
 */
export function planPasteMerge(
    parsed: PasteResult,
    existingNames: Set<string> | string[],
    currentTotalCount: number,
): (PasteStrip & { video_offset: number })[] {
    const used = new Set(existingNames instanceof Set ? existingNames : existingNames);
    const base = currentTotalCount;
    let runningOffset = 0;
    const out: (PasteStrip & { video_offset: number })[] = [];
    for (const s of parsed.strips) {
        const name = _uniqueName(s.name, used);
        used.add(name);
        const points: [number, number][] = s.points.map(p => [p[0], p[1]] as [number, number]);
        const entry: PasteStrip & { video_offset: number } = {
            name,
            points,
            video_offset: base + runningOffset,
        };
        if (typeof s.diameter === 'number') entry.diameter = s.diameter;
        runningOffset += entry.points.length;
        out.push(entry);
    }
    return out;
}

function _uniqueName(baseName: string, used: Set<string>): string {
    if (!used.has(baseName)) return baseName;
    // " (2)", " (3)", ...
    let n = 2;
    while (used.has(`${baseName} (${String(n)})`)) n++;
    return `${baseName} (${String(n)})`;
}
