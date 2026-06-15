import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectScreenmapVersion, parseScreenmapV2 } from '../../src/screenmap-v2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lock-in test for issue #143: every shipped screenmap *.json file MUST be v2.
// If anything emits v1 again (`{"map":{...}}`), this test fails loud at CI
// time. Scans `public/screenmaps/` (built-in presets) and `tests/fixtures/`
// (test data shipped in the repo). Add directories here as new shipped-JSON
// locations show up.

const repoRoot = path.resolve(__dirname, '..', '..');
const directoriesToCheck = [
    path.join(repoRoot, 'public', 'screenmaps'),
    path.join(repoRoot, 'tests', 'fixtures'),
];

function collectJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile())
        // Skip non-screenmap JSON fixtures by convention. Add patterns as
        // new non-screenmap JSON ships next to the screenmap files.
        .filter((f) => !f.startsWith('package') && f !== 'manifest.json')
        .map((f) => path.join(dir, f));
}

test('every shipped screenmap *.json is v2', () => {
    const files: string[] = [];
    for (const d of directoriesToCheck) files.push(...collectJsonFiles(d));
    assert.ok(files.length > 0, 'expected to find shipped screenmap files');

    const failures: string[] = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        let obj: unknown;
        try { obj = JSON.parse(text) as unknown; }
        catch (err) {
            failures.push(`${file}: not valid JSON (${(err as Error).message})`);
            continue;
        }
        let version: 1 | 2;
        try { version = detectScreenmapVersion(obj); }
        catch (err) {
            // Files that aren't screenmaps at all (e.g. screenmap-presets.json
            // manifest) should be excluded by the directory scan, but if the
            // detector can't classify, fail loud — better than silent passthrough.
            failures.push(`${file}: detectScreenmapVersion rejected (${(err as Error).message})`);
            continue;
        }
        if (version === 1) {
            failures.push(`${file}: still v1 ({"map":...}) — must be migrated to v2`);
            continue;
        }
        // Belt-and-braces: also confirm the v2 parser accepts it.
        try { parseScreenmapV2(obj); }
        catch (err) {
            failures.push(`${file}: detectScreenmapVersion said v2 but parser rejected: ${(err as Error).message}`);
        }
    }

    if (failures.length > 0) {
        assert.fail(`Shipped JSON files failed v2 check:\n  ${failures.join('\n  ')}`);
    }
});
