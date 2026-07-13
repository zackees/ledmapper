import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'packages/gfx/api-report.json'), 'utf8'));
const sources = {
    '.': 'packages/gfx/src/gfx/index.ts',
    './core': 'packages/gfx/src/core.ts',
    './fled': 'packages/gfx/src/fled.ts',
    './worker': 'packages/gfx/src/worker.ts',
};
const failures = [];
for (const [entry, names] of Object.entries(report.entries)) {
    const source = fs.readFileSync(path.join(root, sources[entry]), 'utf8');
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`\\b${escaped}\\b`).test(source)) failures.push(`${entry}: missing ${name}`);
    }
}
if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`gfx API report v${String(report.version)}: ${Object.values(report.entries).flat().length} symbols verified`);
