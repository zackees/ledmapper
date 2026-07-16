/**
 * Unit tests for `src/stale-chunk-reload.ts` — the vite:preloadError
 * auto-reload guard from issue #447 (first fire reloads, second fire within
 * the window is suppressed, storage failures fall back to the in-memory cap).
 *
 * Exercises the pure factory with injected clock/storage/reload — no DOM
 * globals needed (Node's built-in `Event` covers the event surface). The
 * injected logger is the real `debug-log.ts` module (the watchdogs.test.ts
 * pattern) so these tests also prove the events land in the ring buffer that
 * `window.__lmLog.dump()` reads.
 */

import { test, describe, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    createStaleChunkReloadHandler,
    STALE_RELOAD_WINDOW_MS,
} from '../../src/stale-chunk-reload';
import { createLogger, getEventLog, _resetLogForTests } from '../../src/debug-log';

beforeEach(() => {
    _resetLogForTests();
});

function bootEvents(): string[] {
    return getEventLog().filter((e) => e.scope === 'boot').map((e) => e.event);
}

interface HarnessOptions {
    nowMs?: number;
    stamp?: string | null;
    readThrows?: boolean;
    writeThrows?: boolean;
}

function makeHarness(opts: HarnessOptions = {}) {
    const state = {
        nowMs: opts.nowMs ?? 100_000,
        stamp: opts.stamp ?? null,
        reloads: 0,
        writes: [] as string[],
    };
    const handler = createStaleChunkReloadHandler({
        now: () => state.nowMs,
        readStamp: () => {
            if (opts.readThrows) throw new Error('sessionStorage unavailable');
            return state.stamp;
        },
        writeStamp: (value) => {
            if (opts.writeThrows) throw new Error('sessionStorage unavailable');
            state.writes.push(value);
            state.stamp = value;
        },
        reload: () => { state.reloads++; },
        log: createLogger('boot'),
    });
    return { handler, state };
}

/** Fire a synthetic vite:preloadError (cancelable, Error payload — the shape
 *  Vite dispatches) through the handler and return it for inspection. */
function fire(handler: (event: Event) => void): Event {
    const event = new Event('vite:preloadError', { cancelable: true });
    (event as unknown as { payload: Error }).payload = new Error('chunk 404');
    handler(event);
    return event;
}

describe('first fire (no stamp)', () => {
    test('reloads, writes the stamp, preventDefaults, logs stale-deploy-reload', () => {
        const { handler, state } = makeHarness({ nowMs: 100_000 });
        const event = fire(handler);
        assert.equal(state.reloads, 1);
        assert.deepEqual(state.writes, ['100000']);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload']);
    });

    test('a garbage (non-numeric) stamp is treated as absent — still reloads', () => {
        const { handler, state } = makeHarness({ stamp: 'not-a-number' });
        const event = fire(handler);
        assert.equal(state.reloads, 1);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload']);
    });
});

describe('second fire within the window', () => {
    test('a fresh handler (post-reload page) with a recent stamp suppresses: no reload, no preventDefault', () => {
        const { handler, state } = makeHarness({ nowMs: 100_000, stamp: String(100_000 - 5_000) });
        const event = fire(handler);
        assert.equal(state.reloads, 0);
        assert.equal(state.writes.length, 0);
        assert.equal(event.defaultPrevented, false);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload-suppressed']);
    });

    test('same handler firing twice reloads only once (stamp written by the first fire)', () => {
        const { handler, state } = makeHarness({ nowMs: 100_000 });
        const first = fire(handler);
        const second = fire(handler);
        assert.equal(state.reloads, 1);
        assert.equal(first.defaultPrevented, true);
        assert.equal(second.defaultPrevented, false);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload', 'stale-deploy-reload-suppressed']);
    });
});

describe('window expiry', () => {
    test('a stamp older than the window reloads again', () => {
        const nowMs = 500_000;
        const { handler, state } = makeHarness({
            nowMs,
            stamp: String(nowMs - STALE_RELOAD_WINDOW_MS - 1_000),
        });
        const event = fire(handler);
        assert.equal(state.reloads, 1);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload']);
    });
});

describe('storage unavailable (read/write throw)', () => {
    test('still reloads once; a subsequent fire is suppressed by the in-memory cap', () => {
        const { handler, state } = makeHarness({ readThrows: true, writeThrows: true });
        const first = fire(handler);
        assert.equal(state.reloads, 1);
        assert.equal(first.defaultPrevented, true);

        const second = fire(handler);
        assert.equal(state.reloads, 1, 'in-memory flag must cap at one auto-reload per page lifetime');
        assert.equal(second.defaultPrevented, false);
        assert.deepEqual(bootEvents(), ['stale-deploy-reload', 'stale-deploy-reload-suppressed']);
    });
});
