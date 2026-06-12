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

function _safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function _safeSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch { return false; }
}

function _safeRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Count LEDs and strips in a raw screenmap JSON string.
 * Returns `null` if the JSON is unusable.
 * @param {string} jsonText
 */
function _countMap(jsonText) {
    if (typeof jsonText !== 'string' || jsonText.length === 0) return null;
    let obj;
    try { obj = JSON.parse(jsonText); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const map = obj.map;
    if (!map || typeof map !== 'object') return null;
    const stripNames = Object.keys(map);
    let ledCount = 0;
    for (const name of stripNames) {
        const s = map[name];
        if (!s) continue;
        if (Array.isArray(s.x)) ledCount += s.x.length;
        else if (Array.isArray(s.points)) ledCount += s.points.length;
    }
    return { stripCount: stripNames.length, ledCount };
}

/**
 * Cheap "is this JSON a degenerate / placeholder map?" check.
 * Returns true for invalid JSON, missing `map`, or fewer than MIN_AUTOSAVE_LEDS
 * total LEDs. Never throws.
 * @param {string} jsonText
 * @returns {boolean}
 */
export function isDegenerate(jsonText) {
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
export function saveScreenmap(jsonText) {
    const ok = saveScreenmapWithMeta(jsonText, { source: 'save' });
    if (ok) _safeRemove(PRESET_KEY);
}

/**
 * Convenience: save from parsed point array back to JSON format.
 * @param {Array<[number,number]>} pts
 * @param {number} [diameter]
 */
export function saveScreenmapPoints(pts, diameter) {
    const obj = { map: { strip1: { x: pts.map(p => p[0]), y: pts.map(p => p[1]) } } };
    if (typeof diameter === 'number') obj.map.strip1.diameter = diameter;
    saveScreenmap(JSON.stringify(obj));
}

/**
 * Retrieve stored screenmap JSON text, or null.
 * @returns {string|null}
 */
export function getScreenmap() {
    return _safeGet(KEY);
}

/**
 * Persist the active built-in preset filename (e.g. "16x16_grid.json").
 * @param {string} file
 */
export function savePresetSelection(file) {
    _safeSet(PRESET_KEY, file);
}

/**
 * Retrieve the active built-in preset filename, or null.
 * @returns {string|null}
 */
export function getPresetSelection() {
    return _safeGet(PRESET_KEY);
}

/**
 * Build a screenmap JSON string from a multi-strip structured result.
 * Produces the canonical {map: {stripName: {x:[], y:[], diameter, video_offset?}}} format.
 * Omits video_offset when it matches the sequential (default) offset for cleaner output.
 *
 * @param {Array<{name:string, points:Array<[number,number]>, diameter:number|undefined, offset:number, count:number, video_offset:number}>} strips
 * @returns {string} JSON string
 */
export function buildScreenmapMultiStripJson(strips) {
    if (!Array.isArray(strips) || strips.length === 0) {
        throw new Error('strips must be a non-empty array');
    }
    const map = {};
    let seqOffset = 0;
    for (const s of strips) {
        if (!Array.isArray(s.points)) {
            throw new Error(`Strip "${s.name}" has no points array`);
        }
        if (s.points.length === 0) {
            throw new Error(`Strip "${s.name}" has 0 points`);
        }
        const entry = {
            x: s.points.map(p => p[0]),
            y: s.points.map(p => p[1]),
        };
        if (typeof s.diameter === 'number') {
            entry.diameter = s.diameter;
        }
        // Only include video_offset when it differs from the default sequential position
        if (typeof s.video_offset === 'number' && s.video_offset !== seqOffset) {
            entry.video_offset = s.video_offset;
        }
        map[s.name] = entry;
        seqOffset += s.points.length;
    }
    return JSON.stringify({ map }, null, 2);
}

/**
 * Save multi-strip data to localStorage.
 * @param {Array<{name:string, points:Array<[number,number]>, diameter?:number, offset:number, count:number, video_offset?:number}>} strips
 */
export function saveScreenmapMultiStrip(strips) {
    saveScreenmap(buildScreenmapMultiStripJson(strips));
}

/**
 * Get the parsed meta sidecar, or null when missing/corrupt.
 * @returns {{savedAt:number, source:string, ledCount:number, stripCount:number}|null}
 */
export function getScreenmapMeta() {
    const raw = _safeGet(META_KEY);
    if (!raw) return null;
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object') return null;
        return obj;
    } catch { return null; }
}

/**
 * Get the backup (last-known-good) payload + meta, or null when missing.
 * Corrupt backup meta is treated as no meta (json is still returned).
 * @returns {{json:string, meta:object|null}|null}
 */
export function getBackup() {
    const json = _safeGet(BACKUP_KEY);
    if (!json) return null;
    let meta = null;
    const rawMeta = _safeGet(BACKUP_META_KEY);
    if (rawMeta) {
        try {
            const parsed = JSON.parse(rawMeta);
            if (parsed && typeof parsed === 'object') meta = parsed;
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
    const current = _safeGet(KEY);
    if (!current || isDegenerate(current)) return false;
    const counts = _countMap(current) || { ledCount: 0, stripCount: 0 };
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
        presetFile: _safeGet(PRESET_KEY),
    };
    _safeSet(BACKUP_KEY, current);
    _safeSet(BACKUP_META_KEY, JSON.stringify(backupMeta));
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
    const counts = _countMap(json) || { ledCount: 0, stripCount: 0 };
    const newMeta = {
        savedAt: (meta && typeof meta.savedAt === 'number') ? meta.savedAt : Date.now(),
        source: 'restore',
        ledCount: (meta && typeof meta.ledCount === 'number') ? meta.ledCount : counts.ledCount,
        stripCount: (meta && typeof meta.stripCount === 'number') ? meta.stripCount : counts.stripCount,
    };
    _safeSet(KEY, json);
    _safeSet(META_KEY, JSON.stringify(newMeta));
    if (meta && typeof meta.presetFile === 'string' && meta.presetFile.length > 0) {
        _safeSet(PRESET_KEY, meta.presetFile);
    } else {
        _safeRemove(PRESET_KEY);
    }
    return json;
}

/**
 * One-shot migration helper: if a working-copy screenmap is present but no
 * meta sidecar exists, write a synthetic meta dated "now" with computed
 * counts and source 'backfill'.
 */
export function backfillMeta() {
    const json = _safeGet(KEY);
    if (!json) return;
    if (getScreenmapMeta()) return;
    const counts = _countMap(json);
    if (!counts) return;
    const meta = {
        savedAt: Date.now(),
        source: 'backfill',
        ledCount: counts.ledCount,
        stripCount: counts.stripCount,
    };
    _safeSet(META_KEY, JSON.stringify(meta));
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
export function saveScreenmapWithMeta(jsonText, opts = {}) {
    if (isDegenerate(jsonText)) return false;
    const source = (opts && typeof opts.source === 'string') ? opts.source : 'save';
    const counts = _countMap(jsonText) || { ledCount: 0, stripCount: 0 };
    const prev = _safeGet(KEY);
    if (prev && prev !== jsonText && !isDegenerate(prev)) {
        promoteToBackup();
    }
    const ok = _safeSet(KEY, jsonText);
    if (!ok) return false;
    const meta = {
        savedAt: Date.now(),
        source,
        ledCount: counts.ledCount,
        stripCount: counts.stripCount,
    };
    _safeSet(META_KEY, JSON.stringify(meta));
    return true;
}
