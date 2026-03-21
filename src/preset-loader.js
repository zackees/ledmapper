import { parse_screenmap_data } from './common.js';

/**
 * Fetch and parse a screenmap preset file by name.
 * @param {string} file - Filename in /screenmaps/ (e.g. "16x16_grid.json")
 * @returns {Promise<Array<[number,number]>>}
 */
export async function loadPreset(file) {
    const resp = await fetch(`/screenmaps/${file}`);
    const text = await resp.text();
    return parse_screenmap_data(text);
}
