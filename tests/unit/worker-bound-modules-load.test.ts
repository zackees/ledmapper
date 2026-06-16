import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Issue #172. Node has no `document` / `window` / `localStorage`.
 * Importing each worker-bound module here proves they load — i.e. they
 * have no top-level reference that would crash inside a Web Worker.
 *
 * This catches escapes the lint rule misses, like a function whose body
 * references `document.title` but isn't called from a worker-bound
 * code path the ESLint selector visits. If a module added here fails to
 * load under Node, the worker variant of @fastled/gfx will fail at
 * runtime for the user.
 *
 * Keep this list in sync with the `files:` block of the worker-bound
 * override in `eslint.config.js`.
 */

const WORKER_BOUND_MODULES = [
    '../../src/gfx/gfx-core-headless.ts',
    '../../src/gfx/screenmap.ts',
    '../../src/gfx/worker/worker-host.ts',
    '../../src/gfx/worker/protocol.ts',
    '../../src/auto-bloom.ts',
    '../../src/bloom-utils.ts',
    '../../src/render/bloom-geometry.ts',
];

for (const p of WORKER_BOUND_MODULES) {
    test(`worker-bound: ${p} loads under Node`, async () => {
        await assert.doesNotReject(async () => { await import(p); });
    });
}
