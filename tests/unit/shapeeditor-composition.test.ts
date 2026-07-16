import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { installShapeEditorMethodBundle } from '../../src/shapeeditor/shapeeditor-install';

const shapeeditorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/shapeeditor');
const ownerFiles = readdirSync(shapeeditorDir).filter((name) => /^editor-.*\.ts$/.test(name));
const ownerSources = ownerFiles.map((name) => readFileSync(path.join(shapeeditorDir, name), 'utf8'));
const manifestEntries = ownerSources.flatMap((source, ownerIndex) => [...source.matchAll(/^\s{4}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)[^\n]*\(this: ShapeEditor/gm)].map((match) => ({ owner: ownerFiles[ownerIndex], name: match[1] })));

test('ShapeEditor method manifest has one owner for every baseline method plus group selection controls', () => {
    assert.equal(manifestEntries.length, 242);
    assert.equal(new Set(manifestEntries.map(({ name }) => name)).size, manifestEntries.length);
});

test('ShapeEditor composition lists all named bundles and no numbered chunks', () => {
    const composition = readFileSync(path.join(shapeeditorDir, 'shapeeditor-composition.ts'), 'utf8');
    assert.match(composition, /installShapeEditorModules/);
    assert.equal(ownerFiles.length, 16);
    assert.equal(readdirSync(shapeeditorDir).some((name) => /^shapeeditor-methods-\d{2}\.ts$/.test(name)), false);
});

test('method installer rejects duplicate claims and preserves prototype descriptors', () => {
    const prototype = {};
    const first = { onlyMethod() { return true; } };
    installShapeEditorMethodBundle(prototype, 'first', first);
    assert.throws(() => { installShapeEditorMethodBundle(prototype, 'second', { onlyMethod() { return false; } }); }, /claimed more than once/);
    assert.throws(() => { installShapeEditorMethodBundle(prototype, 'first', { replacement() { return true; } }); }, /already installed/);

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'onlyMethod');
    assert.deepEqual(
        { configurable: descriptor?.configurable, enumerable: descriptor?.enumerable, writable: descriptor?.writable },
        { configurable: true, enumerable: true, writable: true },
    );
});
