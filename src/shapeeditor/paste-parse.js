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

import { parseScreenmapMultiStrip } from '../common.js';

function _isFinitePair(p) {
    return Array.isArray(p) && p.length >= 2
        && Number.isFinite(+p[0]) && Number.isFinite(+p[1]);
}

function _coercePoints(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const out = [];
    for (const p of arr) {
        if (!_isFinitePair(p)) return null;
        out.push([+p[0], +p[1]]);
    }
    return out;
}

export function parsePastedScreenmap(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    let obj;
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

    // Case 1: full screenmap JSON with `map`
    if (obj.map && typeof obj.map === 'object') {
        try {
            const info = parseScreenmapMultiStrip(obj);
            if (!info || info.totalCount === 0 || info.strips.length === 0) return null;
            const strips = info.strips.map((s) => {
                const out = { name: String(s.name), points: s.points.map((p) => [+p[0], +p[1]]) };
                if (typeof s.diameter === 'number' && isFinite(s.diameter)) out.diameter = s.diameter;
                if (typeof s.video_offset === 'number' && isFinite(s.video_offset)) {
                    out.video_offset = s.video_offset;
                }
                return out;
            });
            // Reject if every strip is empty
            if (!strips.some((s) => s.points.length > 0)) return null;
            return { strips: strips.filter((s) => s.points.length > 0) };
        } catch {
            return null;
        }
    }

    // Case 2: single strip { name?, points: [...], diameter? }
    if (Array.isArray(obj.points)) {
        const pts = _coercePoints(obj.points);
        if (!pts) return null;
        const out = {
            name: (typeof obj.name === 'string' && obj.name.trim()) ? obj.name.trim() : 'pasted1',
            points: pts,
        };
        if (typeof obj.diameter === 'number' && isFinite(obj.diameter)) {
            out.diameter = obj.diameter;
        }
        return { strips: [out] };
    }

    return null;
}

/**
 * Merge a parsed paste-result against an existing list of strip names.
 * Returns a new array of strips with collision-renamed `name`s and
 * `video_offset` re-indexed to append after `currentTotalCount`.
 *
 * @param {{strips:Array<{name:string, points:Array<[number,number]>, diameter?:number, video_offset?:number}>}} parsed
 * @param {Set<string>|Array<string>} existingNames
 * @param {number} currentTotalCount
 * @returns {Array<{name:string, points:Array<[number,number]>, diameter?:number, video_offset:number}>}
 */
export function planPasteMerge(parsed, existingNames, currentTotalCount) {
    const used = new Set(existingNames instanceof Set ? existingNames : (existingNames || []));
    const base = currentTotalCount || 0;
    let runningOffset = 0;
    const out = [];
    for (const s of parsed.strips) {
        const name = _uniqueName(s.name || 'pasted', used);
        used.add(name);
        const entry = {
            name,
            points: s.points.map((p) => [+p[0], +p[1]]),
            video_offset: base + runningOffset,
        };
        if (typeof s.diameter === 'number') entry.diameter = s.diameter;
        runningOffset += entry.points.length;
        out.push(entry);
    }
    return out;
}

function _uniqueName(baseName, used) {
    if (!used.has(baseName)) return baseName;
    // " (2)", " (3)", ...
    let n = 2;
    while (used.has(`${baseName} (${n})`)) n++;
    return `${baseName} (${n})`;
}
