import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(repoRoot, 'public', 'screenmaps', 'manifest.json'), 'utf-8'));
const template = readFileSync(join(repoRoot, 'src', 'moviemaker', 'template.html'), 'utf-8');
const moviemaker = readFileSync(join(repoRoot, 'src', 'moviemaker', 'moviemaker.js'), 'utf-8');

const manifestFiles = (manifest.presets || []).map(preset => preset.file).sort();

const templateMatches = [...template.matchAll(/data-preset-file\s*=\s*(["'])(.+?)\1/g)];
const templateFiles = [...new Set(templateMatches.map(match => match[2]))].sort();

const missingFromTemplate = manifestFiles.filter(file => !templateFiles.includes(file));
const extraInTemplate = templateFiles.filter(file => !manifestFiles.includes(file));

assert.deepStrictEqual(
    missingFromTemplate,
    [],
    `Preset files in public/screenmaps/manifest.json must be represented in src/moviemaker/template.html:
${missingFromTemplate.join('\n')}`
);

assert.deepStrictEqual(
    extraInTemplate,
    [],
    `Preset files in src/moviemaker/template.html must exist in public/screenmaps/manifest.json:
${extraInTemplate.join('\n')}`
);

assert.ok(
    /querySelectorAll\(\s*['"]button\[data-preset-file\]['"]\s*\)/.test(moviemaker),
    'Moviemaker must bind preset buttons from [data-preset-file] attributes.'
);

assert.ok(
    /btn\.dataset\.presetFile/.test(moviemaker),
    'Moviemaker preset binding should use dataset.presetFile when loading presets.'
);
