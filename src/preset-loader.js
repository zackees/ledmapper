import { parse_screenmap_data } from './common.js';

/**
 * Fetch the raw JSON text of a screenmap preset file by name.
 * @param {string} file - Filename in /screenmaps/ (e.g. "16x16_grid.json")
 * @returns {Promise<string>}
 */
export async function loadPresetText(file) {
    const resp = await fetch(`/screenmaps/${file}`);
    return resp.text();
}

/**
 * Fetch and parse a screenmap preset file by name.
 * @param {string} file - Filename in /screenmaps/ (e.g. "16x16_grid.json")
 * @returns {Promise<Array<[number,number]>>}
 */
export async function loadPreset(file) {
    return parse_screenmap_data(await loadPresetText(file));
}

/**
 * Fetch the preset manifest listing all built-in screenmaps.
 * @returns {Promise<Array<{file: string, name: string}>>}
 */
export async function loadPresetManifest() {
    const resp = await fetch('/screenmaps/manifest.json');
    const manifest = await resp.json();
    return manifest.presets;
}
