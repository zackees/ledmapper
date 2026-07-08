/**
 * Unit tests for `src/watchdogs.ts` — the log-only rendering watchdogs from
 * issue #226 (context loss, video/RAF heartbeats, all-zero readback).
 *
 * Exercises the real `debug-log.ts` module (not a mock) so these tests also
 * prove every watchdog actually funnels through `createLogger('watchdog')`
 * — see tests/unit/debug-log.test.ts for the same "test against the real
 * logger" pattern. No DOM is touched: `attachContextLossWatchdog` is fed a
 * fake canvas-like object (just `addEventListener`/`removeEventListener`),
 * and every timer-driven watchdog is tested by calling its pure `check`/
 * `sample` function directly rather than via a real `setInterval`.
 */

import { test, describe, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import type { LmLogEntry } from '../../src/debug-log';
import {
    attachContextLossWatchdog,
    createVideoStallWatchdog,
    createRafHeartbeat,
    createZeroReadbackWatchdog,
} from '../../src/watchdogs';
import { getEventLog, _resetLogForTests } from '../../src/debug-log';

beforeEach(() => {
    _resetLogForTests();
});

function warnEntries(): LmLogEntry[] {
    return getEventLog().filter((e) => e.level === 'warn' && e.scope === 'watchdog');
}

/** `entries[0]` under `noUncheckedIndexedAccess` is `T | undefined`;
 *  `assert.ok` has a TS assertion signature, so this narrows the result to
 *  `T` for the rest of the test instead of repeating `?.` everywhere (same
 *  pattern as tests/unit/debug-log.test.ts). */
function first(entries: readonly LmLogEntry[]): LmLogEntry {
    const entry = entries[0];
    assert.ok(entry, 'expected at least one watchdog warn entry');
    return entry;
}

/** Fake canvas: just enough of the EventTarget surface for
 *  attachContextLossWatchdog, plus a way for tests to fire events. */
class FakeCanvas {
    private listeners = new Map<string, ((e: Event) => void)[]>();
    addEventListener(type: string, listener: (e: Event) => void): void {
        const arr = this.listeners.get(type) ?? [];
        arr.push(listener);
        this.listeners.set(type, arr);
    }
    removeEventListener(type: string, listener: (e: Event) => void): void {
        const arr = this.listeners.get(type);
        if (!arr) return;
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
    }
    dispatch(type: string, event: Event): void {
        for (const l of this.listeners.get(type) ?? []) l(event);
    }
    listenerCount(type: string): number {
        return this.listeners.get(type)?.length ?? 0;
    }
}

class FakeEvent {
    defaultPrevented = false;
    preventDefault(): void { this.defaultPrevented = true; }
}

describe('attachContextLossWatchdog', () => {
    test('preventDefault() is called on webglcontextlost and logs context-lost with the tool label', () => {
        const canvas = new FakeCanvas();
        attachContextLossWatchdog({ canvas, tool: 'moviemaker-render' });

        const event = new FakeEvent();
        canvas.dispatch('webglcontextlost', event as unknown as Event);

        assert.equal(event.defaultPrevented, true, 'preventDefault must be called or the browser never attempts restore');
        const entries = warnEntries();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).event, 'context-lost');
        assert.deepEqual(first(entries).data, { tool: 'moviemaker-render' });
    });

    test('webglcontextrestored logs context-restored', () => {
        const canvas = new FakeCanvas();
        attachContextLossWatchdog({ canvas, tool: 'gfx-core' });

        canvas.dispatch('webglcontextrestored', new FakeEvent() as unknown as Event);

        const entries = warnEntries();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).event, 'context-restored');
        assert.deepEqual(first(entries).data, { tool: 'gfx-core' });
    });

    test('detach() removes both listeners', () => {
        const canvas = new FakeCanvas();
        const detach = attachContextLossWatchdog({ canvas, tool: 'x' });
        assert.equal(canvas.listenerCount('webglcontextlost'), 1);
        assert.equal(canvas.listenerCount('webglcontextrestored'), 1);
        detach();
        assert.equal(canvas.listenerCount('webglcontextlost'), 0);
        assert.equal(canvas.listenerCount('webglcontextrestored'), 0);

        // No listeners left to fire, so no warning after detach.
        canvas.dispatch('webglcontextlost', new FakeEvent() as unknown as Event);
        assert.equal(warnEntries().length, 0);
    });
});

describe('createVideoStallWatchdog', () => {
    test('unarmed checks never warn, even with an unchanged currentTime', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        for (let i = 0; i < 10; i++) {
            t += 2000;
            wd.check(false, 5, 4, 2);
        }
        assert.equal(warnEntries().length, 0);
        assert.equal(wd.isHealthy(), true);
    });

    test('armed + currentTime advancing every check never warns', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        for (let i = 0; i < 10; i++) {
            t += 2000;
            wd.check(true, i, 4, 2);
        }
        assert.equal(warnEntries().length, 0);
        assert.equal(wd.isHealthy(), true);
    });

    test('armed + currentTime frozen for >= threshold with no frame observed warns once', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        wd.check(true, 10, 4, 2); // establishes baseline at t=0
        t = 2000;
        wd.check(true, 10, 4, 2); // 2s frozen — under threshold
        assert.equal(warnEntries().length, 0);
        assert.equal(wd.isHealthy(), true);

        t = 4500;
        wd.check(true, 10, 4, 2); // 4.5s frozen — over threshold
        assert.equal(wd.isHealthy(), false);
        const entries = warnEntries();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).event, 'video-stalled');
        const data = first(entries).data as { currentTime: number; readyState: number; networkState: number; stalledForMs: number };
        assert.equal(data.currentTime, 10);
        assert.equal(data.readyState, 4);
        assert.equal(data.networkState, 2);
        assert.ok(data.stalledForMs >= 4000);

        // Doesn't spam: another stale check does not warn again.
        t = 6000;
        wd.check(true, 10, 4, 2);
        assert.equal(warnEntries().length, 1);
    });

    test('a frame observed (rVFC) during the stalled window suppresses the warning', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        wd.check(true, 10, 4, 2);
        t = 5000;
        wd.noteFrame(); // rVFC fired despite currentTime not (yet) reflecting it
        wd.check(true, 10, 4, 2);
        assert.equal(warnEntries().length, 0);
        assert.equal(wd.isHealthy(), true);
    });

    test('recovering (currentTime changes) resets stall tracking so a later stall can warn again', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        wd.check(true, 10, 4, 2);
        t = 5000;
        wd.check(true, 10, 4, 2); // warns
        assert.equal(warnEntries().length, 1);

        t = 5100;
        wd.check(true, 11, 4, 2); // currentTime moved — recovered
        assert.equal(wd.isHealthy(), true);

        t = 9200; // 4.1s frozen again at the new value
        wd.check(true, 11, 4, 2);
        assert.equal(warnEntries().length, 2);
    });

    test('reset() clears state (e.g. on pause / tab hidden)', () => {
        let t = 0;
        const wd = createVideoStallWatchdog({ stallThresholdMs: 4000, now: () => t });
        wd.check(true, 10, 4, 2);
        t = 5000;
        wd.check(true, 10, 4, 2);
        assert.equal(warnEntries().length, 1);

        wd.reset();
        assert.equal(wd.isHealthy(), true);
        // Immediately re-arming with the same frozen value must not warn
        // instantly — the stall clock restarted.
        wd.check(true, 10, 4, 2);
        assert.equal(warnEntries().length, 1);
    });
});

describe('createRafHeartbeat', () => {
    test('advancing frame count while armed never warns', () => {
        const hb = createRafHeartbeat({ loop: 'moviemaker' });
        for (let i = 0; i < 5; i++) hb.check(true, i);
        assert.equal(warnEntries().length, 0);
    });

    test('unarmed checks never warn regardless of frame count', () => {
        const hb = createRafHeartbeat({ loop: 'moviemaker' });
        for (let i = 0; i < 5; i++) hb.check(false, 42);
        assert.equal(warnEntries().length, 0);
    });

    test('warns after staleTicksThreshold consecutive unchanged armed checks, once per episode', () => {
        const hb = createRafHeartbeat({ loop: 'gfx-core', staleTicksThreshold: 2 });
        hb.check(true, 7); // baseline
        hb.check(true, 7); // 1 stale tick — under threshold
        assert.equal(warnEntries().length, 0);
        hb.check(true, 7); // 2 stale ticks — warns
        const entries = warnEntries();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).event, 'render-loop-stalled');
        assert.deepEqual(first(entries).data, { loop: 'gfx-core', frameCount: 7 });

        hb.check(true, 7); // still stale — must not spam
        assert.equal(warnEntries().length, 1);

        hb.check(true, 8); // recovered
        hb.check(true, 8);
        hb.check(true, 8); // stale again for 2 ticks
        assert.equal(warnEntries().length, 2);
    });

    test('going unarmed clears the stale streak', () => {
        const hb = createRafHeartbeat({ loop: 'moviemaker', staleTicksThreshold: 2 });
        hb.check(true, 3);
        hb.check(true, 3); // 1 stale tick
        hb.check(false, 3); // tab hidden — resets
        hb.check(true, 3); // baseline re-established, no warning yet
        hb.check(true, 3); // 1 stale tick
        assert.equal(warnEntries().length, 0);
    });
});

describe('createZeroReadbackWatchdog', () => {
    function zeroBuffer(len: number): Uint8Array {
        return new Uint8Array(len);
    }
    function nonZeroBuffer(len: number): Uint8Array {
        const buf = new Uint8Array(len);
        buf[0] = 1;
        return buf;
    }

    test('warns once after consecutiveThreshold all-zero frames while video is healthy', () => {
        const wd = createZeroReadbackWatchdog({ strideBytes: 4, consecutiveThreshold: 5 });
        for (let i = 0; i < 4; i++) wd.sample(zeroBuffer(64), true);
        assert.equal(warnEntries().length, 0);
        wd.sample(zeroBuffer(64), true); // 5th consecutive zero frame
        const entries = warnEntries();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).event, 'readback-black');
        assert.deepEqual(first(entries).data, { consecutiveFrames: 5 });

        // Does not spam on further all-zero frames in the same recording.
        for (let i = 0; i < 10; i++) wd.sample(zeroBuffer(64), true);
        assert.equal(warnEntries().length, 1);
    });

    test('a single non-zero frame resets the consecutive-zero counter', () => {
        const wd = createZeroReadbackWatchdog({ strideBytes: 4, consecutiveThreshold: 5 });
        for (let i = 0; i < 4; i++) wd.sample(zeroBuffer(64), true);
        wd.sample(nonZeroBuffer(64), true); // resets
        for (let i = 0; i < 4; i++) wd.sample(zeroBuffer(64), true); // only 4 again
        assert.equal(warnEntries().length, 0);
    });

    test('videoHealthy=false suppresses counting entirely', () => {
        const wd = createZeroReadbackWatchdog({ strideBytes: 4, consecutiveThreshold: 5 });
        for (let i = 0; i < 20; i++) wd.sample(zeroBuffer(64), false);
        assert.equal(warnEntries().length, 0);
    });

    test('resetForNewRecording() allows a fresh recording to warn again', () => {
        const wd = createZeroReadbackWatchdog({ strideBytes: 4, consecutiveThreshold: 3 });
        for (let i = 0; i < 3; i++) wd.sample(zeroBuffer(32), true);
        assert.equal(warnEntries().length, 1);

        wd.resetForNewRecording();
        for (let i = 0; i < 2; i++) wd.sample(zeroBuffer(32), true);
        assert.equal(warnEntries().length, 1, 'not yet at threshold in the new recording');
        wd.sample(zeroBuffer(32), true);
        assert.equal(warnEntries().length, 2, 'new recording warns independently');
    });

    test('an empty buffer is treated as non-informative, not as an all-zero frame', () => {
        const wd = createZeroReadbackWatchdog({ strideBytes: 4, consecutiveThreshold: 2 });
        wd.sample(zeroBuffer(0), true);
        wd.sample(zeroBuffer(0), true);
        wd.sample(zeroBuffer(0), true);
        assert.equal(warnEntries().length, 0);
    });
});
