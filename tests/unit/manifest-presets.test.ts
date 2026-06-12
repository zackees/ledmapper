import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScreenmapPresetManifestEntry } from '../../src/types/domain';

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenmapsDir = join(__dirname, '..', '..', 'public', 'screenmaps');

describe('screenmaps manifest', () => {
    it('manifest.json exists and is valid JSON', () => {
        const raw = readFileSync(join(screenmapsDir, 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(raw);
        assert.ok(Array.isArray(manifest.presets), 'manifest should have a presets array');
        assert.ok(manifest.presets.length > 0, 'manifest should have at least one preset');
    });

    it('every preset in manifest has required fields', () => {
        const manifest = JSON.parse(readFileSync(join(screenmapsDir, 'manifest.json'), 'utf-8'));
        for (const preset of manifest.presets) {
            assert.ok(typeof preset.file === 'string' && preset.file.length > 0,
                `preset missing "file": ${JSON.stringify(preset)}`);
            assert.ok(typeof preset.name === 'string' && preset.name.length > 0,
                `preset missing "name": ${JSON.stringify(preset)}`);
        }
    });

    it('every preset file in manifest exists on disk', () => {
        const manifest = JSON.parse(readFileSync(join(screenmapsDir, 'manifest.json'), 'utf-8'));
        for (const preset of manifest.presets) {
            const filePath = join(screenmapsDir, preset.file);
            const raw = readFileSync(filePath, 'utf-8');
            // Verify it's valid JSON
            assert.doesNotThrow(() => JSON.parse(raw),
                `preset file ${preset.file} is not valid JSON`);
        }
    });

    it('every .json file in screenmaps/ is listed in manifest', () => {
        const manifest = JSON.parse(readFileSync(join(screenmapsDir, 'manifest.json'), 'utf-8'));
        const manifestFiles = new Set((manifest.presets as ScreenmapPresetManifestEntry[]).map((p) => p.file));

        const allFiles = readdirSync(screenmapsDir)
            .filter(f => f.endsWith('.json') && f !== 'manifest.json');

        const missing = allFiles.filter(f => !manifestFiles.has(f));
        assert.deepStrictEqual(missing, [],
            `These .json files in public/screenmaps/ are not in manifest.json: ${missing.join(', ')}`);
    });

    it('manifest has no duplicate file entries', () => {
        const manifest = JSON.parse(readFileSync(join(screenmapsDir, 'manifest.json'), 'utf-8'));
        const files = (manifest.presets as ScreenmapPresetManifestEntry[]).map((p) => p.file);
        const unique = new Set(files);
        assert.strictEqual(files.length, unique.size,
            `manifest has duplicate entries: ${files.filter((f: string, i: number) => files.indexOf(f) !== i).join(', ')}`);
    });
});
