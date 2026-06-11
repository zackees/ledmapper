import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(repoRoot, 'public', 'screenmaps', 'manifest.json'), 'utf-8'));
const template = readFileSync(join(repoRoot, 'src', 'moviemaker', 'template.html'), 'utf-8');
const moviemaker = readFileSync(join(repoRoot, 'src', 'moviemaker', 'moviemaker.js'), 'utf-8');
const viteConfig = readFileSync(join(repoRoot, 'vite.config.js'), 'utf-8');

const presets = manifest.presets || [];
assert.ok(presets.length > 0, 'manifest.json must declare at least one preset');

// Every manifest entry has a name and points at an existing screenmap file.
for (const preset of presets) {
    assert.ok(preset.file && preset.name, `Preset entry missing file/name: ${JSON.stringify(preset)}`);
    assert.ok(
        existsSync(join(repoRoot, 'public', 'screenmaps', preset.file)),
        `Preset file listed in manifest.json does not exist: ${preset.file}`
    );
}

const files = presets.map(p => p.file);
const names = presets.map(p => p.name);
assert.equal(new Set(files).size, files.length, 'manifest.json preset files must be unique');
assert.equal(new Set(names).size, names.length, 'manifest.json preset names must be unique');

// Buttons are generated from the manifest at build time — the template must
// not hand-maintain a preset list.
assert.ok(
    !/data-preset-file/.test(template),
    'src/moviemaker/template.html must not hardcode preset buttons; they are generated from manifest.json via virtual:screenmap-presets.'
);

assert.ok(
    /from\s+['"]virtual:screenmap-presets['"]/.test(moviemaker),
    'Moviemaker must import presets from virtual:screenmap-presets.'
);

assert.ok(
    /virtual:screenmap-presets/.test(viteConfig),
    'vite.config.js must provide the virtual:screenmap-presets module.'
);

assert.ok(
    /querySelectorAll\(\s*['"]button\[data-preset-file\]['"]\s*\)/.test(moviemaker),
    'Moviemaker must bind preset buttons from [data-preset-file] attributes.'
);

assert.ok(
    /btn\.dataset\.presetFile/.test(moviemaker),
    'Moviemaker preset binding should use dataset.presetFile when loading presets.'
);
