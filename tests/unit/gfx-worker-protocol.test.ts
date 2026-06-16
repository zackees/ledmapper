import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pushFramePayload } from '../../src/gfx/worker/protocol';

/**
 * Issue #163 Phase 3c — protocol-level smoke tests. The runtime
 * (worker-host + createGfxInWorker) needs a real browser to exercise,
 * but the message shapes + helpers are pure JS and unit-testable.
 */

test('pushFramePayload: round-trips a tight Uint8Array (offset=0, exact buffer)', () => {
    const buf = new ArrayBuffer(12);
    const view = new Uint8Array(buf);
    for (let i = 0; i < 12; i++) view[i] = i + 1;
    const { msg, transfer } = pushFramePayload(view);
    assert.equal(msg.type, 'pushFrame');
    assert.equal(msg.length, 12);
    // Tight buffer → transferable IS the input's underlying ArrayBuffer.
    assert.equal(msg.buffer, buf);
    assert.equal(transfer.length, 1);
    assert.equal(transfer[0], buf);
});

test('pushFramePayload: copies when the view is a slice of a larger buffer', () => {
    const big = new ArrayBuffer(100);
    const view = new Uint8Array(big, 8, 12); // offset 8, length 12
    for (let i = 0; i < 12; i++) view[i] = i + 1;
    const { msg, transfer } = pushFramePayload(view);
    assert.equal(msg.length, 12);
    // Sliced view → fresh buffer, not the original.
    assert.notEqual(msg.buffer, big);
    assert.equal(msg.buffer.byteLength, 12);
    // Contents survive the copy.
    const out = new Uint8Array(msg.buffer);
    for (let i = 0; i < 12; i++) assert.equal(out[i], i + 1);
    // Transferable is the new buffer.
    assert.equal(transfer[0], msg.buffer);
});

test('pushFramePayload: handles an empty Uint8Array', () => {
    const view = new Uint8Array(0);
    const { msg, transfer } = pushFramePayload(view);
    assert.equal(msg.type, 'pushFrame');
    assert.equal(msg.length, 0);
    assert.equal(transfer.length, 1);
});

test('protocol module imports without DOM globals', async () => {
    // The protocol file is intended to be importable from a Worker
    // bundle (no window/document). Importing it under Node verifies
    // there are no top-level browser references.
    const mod = await import('../../src/gfx/worker/protocol.ts');
    assert.equal(typeof mod.pushFramePayload, 'function');
});

test('package index exports the worker surface', async () => {
    const mod = await import('../../src/gfx/index.ts');
    assert.equal(typeof mod.createGfxInWorker, 'function');
    assert.equal(typeof mod.pushFramePayload, 'function');
});

test('worker entry exports runGfxWorker', async () => {
    const src = await import('node:fs').then((fs) =>
        fs.promises.readFile(new URL('../../src/gfx/worker/index.ts', import.meta.url), 'utf-8'));
    // We can't import the worker host module under Node — it references
    // DedicatedWorkerGlobalScope at runtime only when constructed, but
    // the type imports + Three.js dependency make a Node import flaky.
    // Verify the entry re-exports the right symbol via source-grep.
    assert.match(src, /export \{ runGfxWorker \}/);
});
