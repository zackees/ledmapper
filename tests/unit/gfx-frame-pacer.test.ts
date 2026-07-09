import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFramePacer } from '../../src/gfx/frame-pacer';

/**
 * #263: the demo pump lost ~1/3 of its frames to an RAF-vs-interval beat.
 * These tests replay the exact failing scenario against the pacer and assert
 * it now hits the target rate.
 */

/** Count emits over `seconds` of RAF ticks at `rafHz`, targeting `targetFps`,
 *  with optional per-tick jitter (ms) so the knife-edge case is exercised. */
function countEmits(targetFps: number, rafHz: number, seconds: number, jitter = 0): number {
    const pacer = createFramePacer();
    const interval = 1000 / targetFps;
    const rafStep = 1000 / rafHz;
    let emits = 0;
    const ticks = Math.round(rafHz * seconds);
    // Deterministic pseudo-jitter so the test is reproducible.
    let seed = 1;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < ticks; i++) {
        const t = i * rafStep + (jitter ? (rnd() - 0.5) * 2 * jitter : 0);
        if (pacer.due(t, interval)) emits++;
    }
    return emits;
}

test('60fps target on a 60Hz display reaches ~60 emits/s (was ~39 with the old gate)', () => {
    // ±0.15ms jitter straddles the 16.667ms period — the exact beat trigger.
    const rate = countEmits(60, 60, 5, 0.15) / 5;
    assert.ok(rate >= 58 && rate <= 61, `expected ~60, got ${rate.toFixed(1)}`);
});

test('30fps target on a 60Hz display reaches ~30 emits/s', () => {
    const rate = countEmits(30, 60, 5, 0.15) / 5;
    assert.ok(rate >= 29 && rate <= 31, `expected ~30, got ${rate.toFixed(1)}`);
});

test('never emits faster than the RAF cadence (can only downsample)', () => {
    // Target above display rate: capped at one emit per tick.
    const rate = countEmits(120, 60, 3) / 3;
    assert.ok(rate <= 61, `emit rate ${rate.toFixed(1)} must not exceed RAF rate`);
});

test('first tick always emits (establishes the schedule origin)', () => {
    const pacer = createFramePacer();
    assert.equal(pacer.due(1000, 16.667), true);
    assert.equal(pacer.due(1000.1, 16.667), false); // same slot
});

test('a long stall produces a single catch-up frame, not a burst', () => {
    const pacer = createFramePacer();
    const interval = 1000 / 60;
    assert.equal(pacer.due(0, interval), true);
    // Tab backgrounded for 5 seconds, then one tick.
    assert.equal(pacer.due(5000, interval), true); // catch-up frame
    // The very next tick must NOT also fire (no accumulated burst).
    assert.equal(pacer.due(5000 + 1, interval), false);
    // Normal cadence resumes one interval later.
    assert.equal(pacer.due(5000 + interval + 0.01, interval), true);
});

test('reset() forgets the schedule so the next tick emits immediately', () => {
    const pacer = createFramePacer();
    pacer.due(1000, 16.667);
    assert.equal(pacer.due(1005, 16.667), false);
    pacer.reset();
    assert.equal(pacer.due(1005, 16.667), true);
});

test('guards against a non-positive interval', () => {
    const pacer = createFramePacer();
    assert.equal(pacer.due(0, 0), true);
    assert.doesNotThrow(() => pacer.due(1, -5));
});
