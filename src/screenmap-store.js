/**
 * Shared screenmap persistence via localStorage.
 * Gives screenmap data "object permanence" across tool navigations.
 */

const KEY = 'lm:screenmap';

/**
 * Save raw screenmap JSON text to localStorage.
 * @param {string} jsonText
 */
export function saveScreenmap(jsonText) {
    try { localStorage.setItem(KEY, jsonText); } catch { /* quota / private mode */ }
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
