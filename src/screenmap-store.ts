/**
 * Shared screenmap persistence via localStorage.
 * Gives screenmap data "object permanence" across tool navigations.
 *
 * Sidecar keys layered on top of the raw `lm:screenmap` JSON:
 *   lm:screenmap-meta        – { savedAt, source, ledCount, stripCount }
 *   lm:screenmap-backup      – previous last-known-good raw JSON
 *   lm:screenmap-backup-meta – same shape as meta + { presetFile }
 *
 * Multi-tab races are out of scope; meta.savedAt makes last-writer detectable.
 */

const KEY = 'lm:screenmap';
const PRESET_KEY = 'lm:screenmap-preset';
const META_KEY = 'lm:screenmap-meta';
const BACKUP_KEY = 'lm:screenmap-backup';
const BACKUP_META_KEY = 'lm:screenmap-backup-meta';

/** Smallest LED count we consider a "real" screenmap. Anything below this
 *  is treated as a degenerate placeholder and refused for autosave. */
export const MIN_AUTOSAVE_LEDS = 4;

/** Window after a user-initiated pin mutation during which a pin-count drop
 *  is allowed to write through (issue #24 §1.8). */
export const PIN_MUTATION_GRACE_MS = 2000;

// Timestamp of the last user-initiated pin mutation (strip-repin, pin-delete,
// explicit file load, ...). The editor calls notePinMutation() right before
// persisting such a change so the pin-count regression guard lets it through.
let _lastPinMutationAt = 0;
let _pinGuardWarned = false;

/**
 * Record that a user-initiated action legitimately changed pin assignments
 * (repin, strip/pin delete, explicit load of a different map, undo/redo of
 * those). Must be called before the corresponding save for the pin-count
 * regression guard in saveScreenmapWithMeta() to allow the write.
 */
export function notePinMutation() {
    _lastPinMutationAt = Date.now();
}

/** Test-only: reset the pin-mutation guard state. */
export function _resetPinMutationGuardForTests() {
    _lastPinMutationAt = 0;
    _pinGuardWarned = false;
}

import { safeStorage } from './services/storage';
import { gfxColors } from './ui/theme';
import { createLogger } from './debug-log';

const log = createLogger('screenmap-store');

/**
 * Count LEDs and strips in a raw screenmap JSON string.
 * Returns `null` if the JSON is unusable.
 * @param {string} jsonText
 */
interface MapCounts { stripCount: number; ledCount: number; pinCount: number; }

function _countMap(jsonText: string): MapCounts | null {
    if (typeof jsonText !== 'string' || jsonText.length === 0) return null;
    let obj: unknown;
    try { obj = JSON.parse(jsonText) as unknown; } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;

    // v2: top-level "segments" array OR explicit "version": 2.
    const top = obj as Record<string, unknown>;
    const isV2 = top.version === 2 || Array.isArray(top.segments);
    if (isV2) {
        const segments = Array.isArray(top.segments) ? top.segments : [];
        let ledCount = 0;
        const pinSet = new Set<string>();
        for (const seg of segments) {
            if (!seg || typeof seg !== 'object') continue;
            const s = seg as { x?: unknown[]; pin?: unknown };
            if (Array.isArray(s.x)) ledCount += s.x.length;
            const pinKey = (typeof s.pin === 'string' || typeof s.pin === 'number')
                ? String(s.pin)
                : 'pin1';
            pinSet.add(pinKey);
        }
        return { stripCount: segments.length, ledCount, pinCount: pinSet.size };
    }

    // v1: legacy `map` object keyed by strip name.
    const map = top.map as Record<string, { x?: unknown[]; points?: unknown[]; pin?: string }> | undefined;
    if (!map || typeof map !== 'object') return null;
    const stripNames = Object.keys(map);
    let ledCount = 0;
    const pinSet = new Set<string>();
    for (const name of stripNames) {
        const s = map[name];
        if (!s) continue;
        if (Array.isArray(s.x)) ledCount += s.x.length;
        else if (Array.isArray(s.points)) ledCount += s.points.length;
        pinSet.add((typeof s.pin === 'string' && s.pin.trim() !== '') ? s.pin : 'pin1');
    }
    return { stripCount: stripNames.length, ledCount, pinCount: pinSet.size };
}

/**
 * Cheap "is this JSON a degenerate / placeholder map?" check.
 * Returns true for invalid JSON, missing `map`, or fewer than MIN_AUTOSAVE_LEDS
 * total LEDs. Never throws.
 * @param {string} jsonText
 * @returns {boolean}
 */
export function isDegenerate(jsonText: string | null | undefined): boolean {
    if (jsonText === null || jsonText === undefined) return true;
    const counts = _countMap(jsonText);
    if (counts === null) return true;
    if (counts.stripCount === 0) return true;
    if (counts.ledCount < MIN_AUTOSAVE_LEDS) return true;
    return false;
}

/**
 * Save raw screenmap JSON text to localStorage.
 * Clears any stored preset selection — callers loading a built-in preset
 * should call savePresetSelection() afterwards.
 * Refuses degenerate writes (no map / <MIN_AUTOSAVE_LEDS LEDs).
 * @param {string} jsonText
 */
export function saveScreenmap(jsonText: string): void {
    const ok = saveScreenmapWithMeta(jsonText, { source: 'save' });
    if (ok) safeStorage.remove(PRESET_KEY);
}

/**
 * Convenience: save from parsed point array back to JSON format.
 * @param {Array<[number,number]>} pts
 * @param {number} [diameter]
 */
export function saveScreenmapPoints(pts: [number, number][] | number[][], diameter: number | undefined): void {
    // Round-trip through buildScreenmapMultiStripJson so this path emits v2
    // with the same shape (groups + segments) as multi-strip saves.
    saveScreenmap(buildScreenmapMultiStripJson([{
        name: 'strip1',
        points: pts,
        diameter,
        offset: 0,
        count: pts.length,
    }]));
}

/**
 * Retrieve stored screenmap JSON text, or null.
 * @returns {string|null}
 */
export function getScreenmap() {
    return safeStorage.get(KEY);
}

/**
 * Persist the active built-in preset filename (e.g. "16x16_grid.json").
 * @param {string} file
 */
export function savePresetSelection(file: string): void {
    safeStorage.set(PRESET_KEY, file);
}

/**
 * Retrieve the active built-in preset filename, or null.
 * @returns {string|null}
 */
export function getPresetSelection() {
    return safeStorage.get(PRESET_KEY);
}

/**
 * Build a screenmap JSON string from a multi-strip structured result.
 * Emits the v2 schema (issue #92) — `{ version: 2, groups, segments: [...] }`.
 * The v1 `{ map: { stripName: {...} } }` format is no longer produced.
 *
 * Bilingual readers (`parse_screenmap_data_json`, FastLED's `ScreenMap::ParseJson`,
 * `_countMap` above) still accept v1 input, so older recordings and third-party
 * files keep working.
 *
 * - Every strip gets its own group keyed by name. Group color cycles through a
 *   small palette so the editor visually distinguishes strips without needing
 *   to assign one manually.
 * - `pin` is required by v2. It defaults to `'pin1'` when the caller didn't set
 *   one, matching v1's implicit default.
 * - `video_offset` (plus `video_offset_override: true`) is preserved per-strip
 *   only when the caller's `videoOffsetOverride` flag is true. Same gate as v1.
 *
 * @param {Array<{name:string, points:Array<[number,number]>, diameter:number|undefined, offset:number, count:number, video_offset:number, pin?:string, videoOffsetOverride?:boolean}>} strips
 * @returns {string} JSON string in v2 shape
 */
// The 8-color group palette lives under `@theme` as `--fastled-group-0..7`
// (#170). gfxColors.group(i) wraps mod-8 automatically.

export function buildScreenmapMultiStripJson(strips: { name: string; points: [number, number][] | number[][]; diameter?: number | undefined; offset: number; count: number; video_offset?: number | undefined; pin?: string | undefined; videoOffsetOverride?: boolean | undefined }[]): string {
    if (!Array.isArray(strips) || strips.length === 0) {
        throw new Error('strips must be a non-empty array');
    }
    interface V2Segment { id: string; pin: string; group: string; x: number[]; y: number[]; diameter?: number; video_offset?: number; video_offset_override?: boolean }
    const pinOf = (s: { pin?: string | undefined }) => (typeof s.pin === 'string' && s.pin.trim() !== '') ? s.pin : 'pin1';
    const groups: Record<string, { color: string }> = {};
    const segments: V2Segment[] = [];
    for (let i = 0; i < strips.length; i++) {
        const s = strips[i];
        if (!s) continue;
        if (!Array.isArray(s.points)) {
            throw new Error(`Strip "${s.name}" has no points array`);
        }
        if (s.points.length === 0) {
            throw new Error(`Strip "${s.name}" has 0 points`);
        }
        groups[s.name] = { color: gfxColors.group(i) };
        const seg: V2Segment = {
            id: s.name,
            pin: pinOf(s),
            group: s.name,
            x: s.points.map((p) => p[0]),
            y: s.points.map((p) => p[1]),
        };
        if (typeof s.diameter === 'number') {
            seg.diameter = s.diameter;
        }
        if (s.videoOffsetOverride === true && typeof s.video_offset === 'number') {
            seg.video_offset = s.video_offset;
            seg.video_offset_override = true;
        }
        segments.push(seg);
    }
    return JSON.stringify({ version: 2, groups, segments }, null, 2);
}

/**
 * Save multi-strip data to localStorage.
 * @param {Array<{name:string, points:Array<[number,number]>, diameter?:number, offset:number, count:number, video_offset?:number}>} strips
 */
export function saveScreenmapMultiStrip(strips: Parameters<typeof buildScreenmapMultiStripJson>[0]): void {
    saveScreenmap(buildScreenmapMultiStripJson(strips));
}

/**
 * Get the parsed meta sidecar, or null when missing/corrupt.
 * @returns {{savedAt:number, source:string, ledCount:number, stripCount:number}|null}
 */
interface ScreenmapMeta { savedAt: number; source: string; ledCount: number; stripCount: number; pinCount: number; }

export function getScreenmapMeta(): ScreenmapMeta | null {
    const raw = safeStorage.get(META_KEY);
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw) as unknown;
        if (!obj || typeof obj !== 'object') return null;
        return obj as ScreenmapMeta;
    } catch { return null; }
}

/**
 * Get the backup (last-known-good) payload + meta, or null when missing.
 * Corrupt backup meta is treated as no meta (json is still returned).
 * @returns {{json:string, meta:object|null}|null}
 */
export interface BackupMeta extends ScreenmapMeta { presetFile?: string | null; }

export function getBackup(): { json: string; meta: BackupMeta | null } | null {
    const json = safeStorage.get(BACKUP_KEY);
    if (!json) return null;
    let meta: BackupMeta | null = null;
    const rawMeta = safeStorage.get(BACKUP_META_KEY);
    if (rawMeta) {
        try {
            const parsed = JSON.parse(rawMeta) as unknown;
            if (parsed && typeof parsed === 'object') meta = parsed as BackupMeta;
        } catch { /* ignore */ }
    }
    return { json, meta };
}

/**
 * Promote the current working copy to backup if it is non-degenerate.
 * Returns true when a promote actually occurred.
 * @returns {boolean}
 */
export function promoteToBackup() {
    const current = safeStorage.get(KEY);
    if (!current || isDegenerate(current)) return false;
    const counts: MapCounts = _countMap(current) ?? { ledCount: 0, stripCount: 0, pinCount: 0 };
    const existingMeta = getScreenmapMeta();
    const backupMeta = {
        savedAt: (existingMeta && typeof existingMeta.savedAt === 'number')
            ? existingMeta.savedAt
            : Date.now(),
        source: (existingMeta && typeof existingMeta.source === 'string')
            ? existingMeta.source
            : 'promote',
        ledCount: (existingMeta && typeof existingMeta.ledCount === 'number')
            ? existingMeta.ledCount
            : counts.ledCount,
        stripCount: (existingMeta && typeof existingMeta.stripCount === 'number')
            ? existingMeta.stripCount
            : counts.stripCount,
        pinCount: (existingMeta && typeof existingMeta.pinCount === 'number')
            ? existingMeta.pinCount
            : counts.pinCount,
        presetFile: safeStorage.get(PRESET_KEY),
    };
    safeStorage.set(BACKUP_KEY, current);
    safeStorage.set(BACKUP_META_KEY, JSON.stringify(backupMeta));
    return true;
}

/**
 * Restore the backup into the working copy. Restores meta savedAt from
 * backup meta and writes a fresh meta with source 'restore'. Also restores
 * the preset filename from backup meta (or removes it when null).
 * Returns the restored JSON text, or null when nothing to restore.
 * @returns {string|null}
 */
export function restoreBackup() {
    const backup = getBackup();
    if (!backup) return null;
    const { json, meta } = backup;
    const counts: MapCounts = _countMap(json) ?? { ledCount: 0, stripCount: 0, pinCount: 0 };
    const newMeta = {
        savedAt: (meta && typeof meta.savedAt === 'number') ? meta.savedAt : Date.now(),
        source: 'restore',
        ledCount: (meta && typeof meta.ledCount === 'number') ? meta.ledCount : counts.ledCount,
        stripCount: (meta && typeof meta.stripCount === 'number') ? meta.stripCount : counts.stripCount,
        pinCount: (meta && typeof meta.pinCount === 'number') ? meta.pinCount : counts.pinCount,
    };
    safeStorage.set(KEY, json);
    safeStorage.set(META_KEY, JSON.stringify(newMeta));
    if (meta && typeof meta.presetFile === 'string' && meta.presetFile.length > 0) {
        safeStorage.set(PRESET_KEY, meta.presetFile);
    } else {
        safeStorage.remove(PRESET_KEY);
    }
    return json;
}

/**
 * One-shot migration helper: if a working-copy screenmap is present but no
 * meta sidecar exists, write a synthetic meta dated "now" with computed
 * counts and source 'backfill'.
 */
export function backfillMeta() {
    const json = safeStorage.get(KEY);
    if (!json) return;
    if (getScreenmapMeta()) return;
    const counts = _countMap(json);
    if (!counts) return;
    const meta = {
        savedAt: Date.now(),
        source: 'backfill',
        ledCount: counts.ledCount,
        stripCount: counts.stripCount,
        pinCount: counts.pinCount,
    };
    safeStorage.set(META_KEY, JSON.stringify(meta));
}

/**
 * Core writer used by saveScreenmap / saveScreenmapPoints / saveScreenmapMultiStrip.
 * - Refuses degenerate writes (returns false, no mutation).
 * - When the prior working copy is non-degenerate AND differs from the
 *   incoming text, promotes it to the backup slot first.
 * - Writes a fresh meta sidecar.
 * Quota errors are swallowed (treated like the legacy code).
 *
 * @param {string} jsonText
 * @param {{source?:string}} [opts]
 * @returns {boolean} true if the write went through.
 */
export function saveScreenmapWithMeta(jsonText: string, opts: { source?: string } = {}): boolean {
    if (isDegenerate(jsonText)) return false;
    const source = typeof opts.source === 'string' ? opts.source : 'save';
    const counts = _countMap(jsonText) ?? { ledCount: 0, stripCount: 0, pinCount: 0 };
    const prev = safeStorage.get(KEY);
    // Pin-count regression guard (issue #24 §1.8): refuse a write whose
    // distinct pin count dropped vs. the stored working copy unless a
    // user-initiated pin mutation was recorded recently. Protects against
    // code paths that forget to plumb `pin` and against foreign-tool
    // flattening on import.
    if (prev && prev !== jsonText && !isDegenerate(prev)) {
        const prevCounts = _countMap(prev);
        if (prevCounts && typeof prevCounts.pinCount === 'number'
            && counts.pinCount < prevCounts.pinCount
            && (Date.now() - _lastPinMutationAt) > PIN_MUTATION_GRACE_MS) {
            if (!_pinGuardWarned) {
                log.warn('pin-guard-refused', { from: prevCounts.pinCount, to: counts.pinCount });
                _pinGuardWarned = true;
            }
            return false;
        }
    }
    if (prev && prev !== jsonText && !isDegenerate(prev)) {
        promoteToBackup();
    }
    const ok = safeStorage.set(KEY, jsonText);
    if (!ok) return false;
    const meta = {
        savedAt: Date.now(),
        source,
        ledCount: counts.ledCount,
        stripCount: counts.stripCount,
        pinCount: counts.pinCount,
    };
    safeStorage.set(META_KEY, JSON.stringify(meta));
    return true;
}
