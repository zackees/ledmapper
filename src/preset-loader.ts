import { parse_screenmap_data } from './common';
import type { StripPoint } from './types/domain';

/**
 * Fetch the raw JSON text of a screenmap preset file by name.
 * @param file - Filename in /screenmaps/ (e.g. "16x16_grid.json")
 */
export async function loadPresetText(file: string, signal?: AbortSignal): Promise<string> {
    const resp = await fetch(`/screenmaps/${file}`, { signal });
    return resp.text();
}

/**
 * Fetch and parse a screenmap preset file by name.
 * @param file - Filename in /screenmaps/ (e.g. "16x16_grid.json")
 */
export async function loadPreset(file: string): Promise<StripPoint[]> {
    return parse_screenmap_data(await loadPresetText(file));
}

/**
 * Fetch the preset manifest listing all built-in screenmaps.
 */
export async function loadPresetManifest(): Promise<{ file: string; name: string }[]> {
    const resp = await fetch('/screenmaps/manifest.json');
    const manifest = await resp.json() as { presets: { file: string; name: string }[] };
    return manifest.presets;
}
