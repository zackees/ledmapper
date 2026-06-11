/**
 * Shared screenmap persistence via localStorage.
 * Gives screenmap data "object permanence" across tool navigations.
 */

const KEY = 'lm:screenmap';
const PRESET_KEY = 'lm:screenmap-preset';

/**
 * Save raw screenmap JSON text to localStorage.
 * Clears any stored preset selection — callers loading a built-in preset
 * should call savePresetSelection() afterwards.
 * @param {string} jsonText
 */
export function saveScreenmap(jsonText) {
    try {
        localStorage.setItem(KEY, jsonText);
        localStorage.removeItem(PRESET_KEY);
    } catch { /* quota / private mode */ }
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
    try { return localStorage.getItem(KEY); } catch { return null; }
}

/**
 * Persist the active built-in preset filename (e.g. "16x16_grid.json").
 * @param {string} file
 */
export function savePresetSelection(file) {
    try { localStorage.setItem(PRESET_KEY, file); } catch { /* quota / private mode */ }
}

/**
 * Retrieve the active built-in preset filename, or null.
 * @returns {string|null}
 */
export function getPresetSelection() {
    try { return localStorage.getItem(PRESET_KEY); } catch { return null; }
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
