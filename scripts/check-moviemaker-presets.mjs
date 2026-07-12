import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(repoRoot, 'public', 'screenmaps', 'manifest.json'), 'utf-8'));
const template = readFileSync(join(repoRoot, 'src', 'moviemaker', 'template.html'), 'utf-8');
const moviemaker = readFileSync(join(repoRoot, 'src', 'moviemaker', 'moviemaker.ts'), 'utf-8');
const viteConfig = readFileSync(join(repoRoot, 'vite.config.js'), 'utf-8');

// Schema-v2 invariants (issue #206): manifest carries a schemaVersion, a
// categories array, and every preset has a category that matches a
// declared category id.
assert.equal(manifest.schemaVersion, 2, 'manifest.json must declare "schemaVersion": 2');
assert.ok(Array.isArray(manifest.categories) && manifest.categories.length > 0,
    'manifest.json must declare a non-empty "categories" array');
const categoryIds = manifest.categories.map(c => c.id);
assert.equal(new Set(categoryIds).size, categoryIds.length, 'manifest.json category ids must be unique');
for (const cat of manifest.categories) {
    assert.equal(typeof cat.id, 'string', `category missing id: ${JSON.stringify(cat)}`);
    assert.equal(typeof cat.label, 'string', `category missing label: ${JSON.stringify(cat)}`);
}

const presets = manifest.presets || [];
assert.ok(presets.length > 0, 'manifest.json must declare at least one preset');
assert.equal(typeof manifest.defaultPreset, 'string', 'manifest.json must declare "defaultPreset"');
assert.ok(presets.some(p => p.file === manifest.defaultPreset),
    'manifest.json defaultPreset must name a listed preset');

const categoryIdSet = new Set(categoryIds);
for (const preset of presets) {
    assert.ok(preset.file && preset.name, `Preset entry missing file/name: ${JSON.stringify(preset)}`);
    assert.equal(typeof preset.category, 'string',
        `Preset entry missing category: ${JSON.stringify(preset)}`);
    assert.ok(categoryIdSet.has(preset.category),
        `Preset category "${preset.category}" not declared in manifest.categories: ${JSON.stringify(preset)}`);
    assert.ok(
        existsSync(join(repoRoot, 'public', 'screenmaps', preset.file)),
        `Preset file listed in manifest.json does not exist: ${preset.file}`
    );
}

const files = presets.map(p => p.file);
const names = presets.map(p => p.name);
assert.equal(new Set(files).size, files.length, 'manifest.json preset files must be unique');
assert.equal(new Set(names).size, names.length, 'manifest.json preset names must be unique');

// Buttons are rendered by the shared preset-picker module (issue #206) —
// the moviemaker template now provides a mount point and the wiring goes
// through `mountPresetPicker`.
assert.ok(
    /class="preset-picker-mount"/.test(template),
    'src/moviemaker/template.html must contain a <div class="preset-picker-mount"> for the shared accordion picker.'
);

assert.ok(
    /from\s+['"]virtual:screenmap-presets['"]/.test(moviemaker),
    'Moviemaker must import the baked manifest from virtual:screenmap-presets.'
);

assert.ok(
    /virtual:screenmap-presets/.test(viteConfig),
    'vite.config.js must provide the virtual:screenmap-presets module.'
);

assert.ok(
    /from\s+['"]\.\.\/ui\/preset-picker['"]/.test(moviemaker),
    'Moviemaker must import mountPresetPicker from "../ui/preset-picker".'
);

assert.ok(
    /mountPresetPicker\s*\(/.test(moviemaker),
    'Moviemaker must call mountPresetPicker to render the preset accordion.'
);
