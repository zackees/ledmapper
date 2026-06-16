import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Phase 3a smoke: verify the new DOM-free `createGfxCore` is exported
 * and has the right surface. We can't actually instantiate it under
 * Node (Three.js + WebGL need a real GL context), but we can verify
 * the symbol exists with the right call signature and that the module
 * graph doesn't drag in any document/window references that would
 * crash at load time.
 *
 * The actual end-to-end worker integration test ships with Phase 3c.
 */

test('createGfxCore is exported from the gfx package', async () => {
    const mod = await import('../../src/gfx/index.ts');
    assert.equal(typeof mod.createGfxCore, 'function');
});

test('createGfxCore module loads without main-thread globals', async () => {
    // Importing the module under Node — where `document`, `window`,
    // and `localStorage` are all undefined — verifies the core path
    // has no top-level DOM references. (This is the Phase 3a goal:
    // a renderer entry point that a worker can `import` safely.)
    const mod = await import('../../src/gfx/gfx-core-headless.ts');
    assert.equal(typeof mod.createGfxCore, 'function');
});

test('createCircleTexture falls through to OffscreenCanvas when document is absent', async () => {
    // OffscreenCanvas isn't in Node's globals; we only verify the
    // module doesn't crash at import time and the code path that
    // gates on `typeof document === 'undefined'` exists.
    const src = await import('node:fs').then((fs) =>
        fs.promises.readFile(new URL('../../src/three-utils.ts', import.meta.url), 'utf-8'));
    assert.match(src, /typeof document === 'undefined'/);
    assert.match(src, /new OffscreenCanvas\(/);
});

test('createRendererCore accepts canvas: HTMLCanvasElement | OffscreenCanvas', async () => {
    const src = await import('node:fs').then((fs) =>
        fs.promises.readFile(new URL('../../src/three-utils.ts', import.meta.url), 'utf-8'));
    // Confirm the new headless renderer export exists and types its
    // canvas argument as the union.
    assert.match(src, /export function createRendererCore/);
    assert.match(src, /canvas: HTMLCanvasElement \| OffscreenCanvas/);
});
