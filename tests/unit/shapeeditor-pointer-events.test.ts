import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const source = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/shapeeditor/shapeeditor-methods-03.ts'), 'utf8');

test('shapeeditor overlay uses pointer events with a legacy touch fallback', () => {
    assert.match(source, /addEventListener\('pointerdown'/);
    assert.match(source, /addEventListener\('pointermove'/);
    assert.match(source, /addEventListener\('pointercancel'/);
    assert.match(source, /_wireTouchHandlers\(this\.signal\)/);
});
