/**
 * Screenmap v2 parser and dispatcher.
 *
 * v1 is the legacy FastLED `ScreenMap` shape: `{ "map": { "<name>": { "x": [], "y": [], "diameter": ? } } }`.
 * v2 is the editor-friendly shape from ledmapper issue #92:
 *
 *   {
 *     "version": 2,                                // optional, explicit
 *     "groups": { "<name>": { "color": "#hex", ... } },
 *     "segments": [
 *       { "id": "<unique>", "pin": <int|str>, "group": "<name>",
 *         "x": [...], "y": [...], "z": [...],     // z optional
 *         "parent": "<id>", "offset": <int|null>  // forks only
 *       }
 *     ]
 *   }
 *
 * The v1 parser (`parse_screenmap_data_json`, `parseScreenmapMultiStrip` in
 * `common.ts`) stays unchanged. This module:
 *
 *   - `parseScreenmapV2(raw)` — parse the v2 shape into a fully-typed `ScreenmapV2`.
 *   - `detectScreenmapVersion(obj)` — auto-detect v1 vs v2 by structure.
 *   - `v2ToMultiStripResult(v2)` — adapt v2 onto the existing `MultiStripParseResult`
 *     shape so downstream tools (shape editor, moviemaker) continue to work
 *     unchanged.
 */

import type {
    ScreenmapV2,
    ScreenmapV2Group,
    ScreenmapV2Segment,
    MultiStripParseResult,
    ParsedStrip,
    StripPoint,
} from './types/domain';

export type ScreenmapVersion = 1 | 2;

/**
 * Detect v1 vs v2 by structure (with explicit `version` taking priority).
 *
 * Order (top to bottom):
 *   1. Explicit `"version": 2` → 2
 *   2. Explicit `"version": 1` → 1
 *   3. Has `segments` (array) at root → 2 (auto)
 *   4. Has `map` (object) at root → 1
 *   5. Otherwise throws.
 */
export function detectScreenmapVersion(obj: unknown): ScreenmapVersion {
    if (!isObject(obj)) {
        throw new Error('Screenmap root is not a JSON object');
    }
    const v = obj.version;
    if (v === 2) return 2;
    if (v === 1) return 1;
    if (Array.isArray(obj.segments)) return 2;
    if (isObject(obj.map)) return 1;
    throw new Error('Unrecognized screenmap format (no version, no segments, no map)');
}

/**
 * Parse a v2 screenmap from raw text or a parsed object. Throws on invalid input.
 */
export function parseScreenmapV2(raw: string | object): ScreenmapV2 {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
    if (!isObject(parsed)) {
        throw new Error('Screenmap root is not a JSON object');
    }

    if (parsed.version !== undefined && parsed.version !== 2) {
        const versionStr = typeof parsed.version === 'string' || typeof parsed.version === 'number'
            ? String(parsed.version)
            : 'invalid';
        throw new Error(`Expected v2 screenmap, got version=${versionStr}`);
    }
    if (!Array.isArray(parsed.segments)) {
        throw new Error('v2 screenmap missing top-level `segments` array');
    }

    const groups = parseGroups(parsed.groups);
    const segments = (parsed.segments).map((s, i) => parseSegment(s, i, groups));

    // Cross-validate: every `parent` must resolve to another segment's id;
    // every `group` must resolve to a `groups` key.
    const idSet = new Set(segments.map((s) => s.id));
    for (const seg of segments) {
        if (!(seg.group in groups)) {
            throw new Error(
                `Segment '${seg.id}' references unknown group '${seg.group}'`,
            );
        }
        if (seg.parent !== undefined) {
            if (!idSet.has(seg.parent)) {
                throw new Error(
                    `Segment '${seg.id}' forks from unknown parent '${seg.parent}'`,
                );
            }
            if (seg.offset !== undefined && seg.offset !== null) {
                const parent = segments.find((p) => p.id === seg.parent);
                if (parent) {
                    const max = parent.x.length - 1;
                    if (seg.offset > max || seg.offset < -max) {
                        throw new Error(
                            `Segment '${seg.id}' offset ${String(seg.offset)} out of range for parent '${seg.parent}' (length ${String(parent.x.length)})`,
                        );
                    }
                }
            }
        }
    }

    const out: ScreenmapV2 = {
        groups,
        segments,
    };
    if (parsed.version === 2) {
        out.version = 2;
    }
    return out;
}

/**
 * Adapt a v2 document onto the existing v1-style `MultiStripParseResult` so
 * downstream tools that take `ParsedStrip[]` keep working without changes.
 *
 * Each v2 segment maps to one `ParsedStrip` keyed by `segment.id`. The flat
 * `offset` (LED index in the global concatenation) increments per segment in
 * array order — same convention v1 uses.
 */
export function v2ToMultiStripResult(v2: ScreenmapV2): MultiStripParseResult {
    const strips: ParsedStrip[] = [];
    const allPoints: StripPoint[] = [];
    let flatOffset = 0;
    for (const seg of v2.segments) {
        const points: StripPoint[] = [];
        const len = Math.min(seg.x.length, seg.y.length);
        for (let i = 0; i < len; ++i) {
            const pt: StripPoint = [seg.x[i] ?? 0, seg.y[i] ?? 0];
            points.push(pt);
            allPoints.push(pt);
        }
        const overrideOn = seg.video_offset_override === true && typeof seg.video_offset === 'number';
        strips.push({
            name: seg.id,
            points,
            diameter: seg.diameter,
            offset: flatOffset,
            count: points.length,
            video_offset: overrideOn ? (seg.video_offset ?? flatOffset) : flatOffset,
            pin: typeof seg.pin === 'string' ? seg.pin : String(seg.pin),
            videoOffsetOverride: overrideOn,
        });
        flatOffset += points.length;
    }
    return { strips, allPoints, totalCount: allPoints.length };
}

/**
 * Resolve a v2 fork's effective parent index from `offset` semantics.
 * Returns the parent index the fork branches from.
 */
export function resolveForkOffset(
    offset: number | null | undefined,
    parentLength: number,
): number {
    if (offset === undefined || offset === null) return parentLength - 1;
    if (offset >= 0) return offset;
    // Negative: -N = N positions before the tip
    return parentLength - 1 + offset;
}

// ── internals ───────────────────────────────────────────────────────────

function parseGroups(raw: unknown): Record<string, ScreenmapV2Group> {
    if (raw === undefined) return {};
    if (!isObject(raw)) {
        throw new Error('v2 `groups` is not an object');
    }
    const out: Record<string, ScreenmapV2Group> = {};
    for (const [name, value] of Object.entries(raw)) {
        if (!isObject(value)) {
            throw new Error(`Group '${name}' is not an object`);
        }
        if (typeof value.color !== 'string') {
            throw new Error(`Group '${name}' missing required string field 'color'`);
        }
        out[name] = value as ScreenmapV2Group;
    }
    return out;
}

function parseSegment(raw: unknown, idx: number, _groups: Record<string, ScreenmapV2Group>): ScreenmapV2Segment {
    if (!isObject(raw)) {
        throw new Error(`Segment at index ${String(idx)} is not an object`);
    }
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
        throw new Error(`Segment at index ${String(idx)} missing string 'id'`);
    }
    const id = raw.id;

    const pinValue = raw.pin;
    if (typeof pinValue !== 'string' && typeof pinValue !== 'number') {
        throw new Error(`Segment '${id}' missing string|number 'pin'`);
    }
    if (typeof raw.group !== 'string') {
        throw new Error(`Segment '${id}' missing string 'group'`);
    }
    const group = raw.group;

    if (!Array.isArray(raw.x) || !Array.isArray(raw.y)) {
        throw new Error(`Segment '${id}' missing 'x' or 'y' arrays`);
    }
    const x = raw.x.map(toFloat);
    const y = raw.y.map(toFloat);
    if (x.length !== y.length) {
        throw new Error(`Segment '${id}' has mismatched x/y lengths: ${String(x.length)} vs ${String(y.length)}`);
    }

    const out: ScreenmapV2Segment = { id, pin: pinValue, group, x, y };

    if (raw.z !== undefined) {
        if (!Array.isArray(raw.z)) {
            throw new Error(`Segment '${id}' 'z' is not an array`);
        }
        const z = raw.z.map(toFloat);
        if (z.length !== x.length) {
            throw new Error(`Segment '${id}' 'z' length ${String(z.length)} does not match x/y length ${String(x.length)}`);
        }
        out.z = z;
    }

    if (raw.parent !== undefined) {
        if (typeof raw.parent !== 'string') {
            throw new Error(`Segment '${id}' 'parent' is not a string`);
        }
        out.parent = raw.parent;
    }

    if (raw.diameter !== undefined) {
        if (typeof raw.diameter !== 'number' || !Number.isFinite(raw.diameter)) {
            throw new Error(`Segment '${id}' 'diameter' must be a finite number`);
        }
        out.diameter = raw.diameter;
    }

    if (raw.offset !== undefined) {
        if (raw.offset === null) {
            out.offset = null;
        } else if (typeof raw.offset === 'number' && Number.isInteger(raw.offset)) {
            out.offset = raw.offset;
        } else {
            throw new Error(`Segment '${id}' 'offset' must be integer or null`);
        }
    }

    // Ledmapper-specific extension (not part of canonical v2): per-segment
    // recorded-video offset override. Round-trips through the editor and the
    // moviemaker but isn't required by the schema; firmware ignores it.
    if (raw.video_offset !== undefined) {
        if (typeof raw.video_offset !== 'number' || !Number.isFinite(raw.video_offset)) {
            throw new Error(`Segment '${id}' 'video_offset' must be a finite number`);
        }
        out.video_offset = raw.video_offset;
    }
    if (raw.video_offset_override !== undefined) {
        if (typeof raw.video_offset_override !== 'boolean') {
            throw new Error(`Segment '${id}' 'video_offset_override' must be boolean`);
        }
        out.video_offset_override = raw.video_offset_override;
    }

    return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toFloat(v: unknown): number {
    const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
}
