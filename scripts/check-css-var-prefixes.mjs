#!/usr/bin/env node
/**
 * Enforce CSS-variable naming prefixes across the codebase.
 *
 * Every CSS custom property declared in our shared / tool / package
 * stylesheets must use one of a small set of approved prefixes so
 * reviewers (and Find-in-Files) can instantly see which subsystem owns
 * a token. New ad-hoc prefixes are an error.
 *
 *   --fastled-*       → @fastled/gfx package palette (issue #170)
 *   --color-lm-*      → ledmapper-shell tokens
 *   --color-mm-*      → moviemaker-tool extras
 *   --radius-*        → border-radius scale
 *   --font-family-*   → font stacks
 *   --lm-*            → transition / motion tokens (durations, easings)
 *
 * Run via `npm run lint` — appended to the lint script.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_PREFIXES = [
    '--fastled-',     // @fastled/gfx package palette (#170)
    '--color-lm-',    // ledmapper-shell color tokens
    '--color-mm-',    // moviemaker-tool color extras
    '--lm-',          // ledmapper-shell non-color tokens (durations, sidebar width, etc.)
    '--mm-',          // moviemaker-tool non-color tokens (sidebar width, etc.)
    '--radius-',      // border-radius scale
    '--font-family-', // font stacks
];

const ROOT = path.resolve(process.cwd());
const SRC_DIR = path.join(ROOT, 'src');

function* walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(fullPath);
        } else if (entry.isFile()) {
            yield fullPath;
        }
    }
}

function shouldCheck(file) {
    if (file.endsWith('.css')) return true;
    if (file.endsWith(`${path.sep}template.html`)) return true;
    return false;
}

function* iterFiles() {
    for (const file of walk(SRC_DIR)) {
        if (shouldCheck(file)) yield file;
    }
}

/** Match `--ident:` (skip CSS rules that just use `--var(--name)` to
 *  read; we only flag DECLARATIONS). */
const DECL = /--[A-Za-z_][\w-]*\s*:/g;

const errors = [];

for (const file of iterFiles()) {
    let text;
    try { text = readFileSync(file, 'utf-8'); }
    catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const match of line.matchAll(DECL)) {
            const decl = match[0].replace(/:.*$/, '');
            if (!ALLOWED_PREFIXES.some((p) => decl.startsWith(p))) {
                errors.push({
                    file: path.relative(ROOT, file),
                    line: i + 1,
                    decl,
                    snippet: line.trim().slice(0, 100),
                });
            }
        }
    }
}

if (errors.length === 0) {
    process.exit(0);
}

console.error(`\n✖ CSS variable prefix violations (${errors.length}):\n`);
for (const e of errors) {
    console.error(`  ${e.file}:${e.line}  ${e.decl}\n      ${e.snippet}`);
}
console.error('\nAllowed prefixes:');
for (const p of ALLOWED_PREFIXES) console.error(`  ${p}`);
console.error('\nIf you need a new prefix, add it to scripts/check-css-var-prefixes.mjs');
console.error('and document the namespace in src/styles/global.css.');
process.exit(1);
