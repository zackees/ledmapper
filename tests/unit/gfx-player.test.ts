import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlayer } from '../../src/gfx/player';

/**
 * Player is the state machine that drives `gfx.pushFrame` from a .fled
 * payload. Tests inject a synthetic clock + raf so they can step time
 * deterministically without a real animation loop.
 */

interface Harness {
    pushed: Uint8Array[];
    now: { ms: number };
    advance: (ms: number) => void;
    pendingRaf: ((t: number) => void)[];
}

function makeHarness(): Harness {
    const pushed: Uint8Array[] = [];
    const now = { ms: 0 };
    const pendingRaf: ((t: number) => void)[] = [];
    return {
        pushed, now, pendingRaf,
        advance(ms: number) {
            now.ms += ms;
            // Fire all pending RAFs once at the new time. The player
            // re-schedules itself inside `tick`, so the next advance()
            // picks them up.
            const callbacks = pendingRaf.splice(0, pendingRaf.length);
            for (const cb of callbacks) cb(now.ms);
        },
    };
}

function makeFrames(count: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
        out.push(new Uint8Array([i, i, i]));
    }
    return out;
}

test('player: starts paused when autoplay=false', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: false,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    assert.equal(p.playing, false);
    assert.equal(p.duration, 1.0);
    assert.equal(p.currentTime, 0);
    // First frame is pre-pushed so the renderer isn't blank.
    assert.equal(h.pushed.length, 1);
});

test('player: autoplay=true pushes frames over time', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    assert.equal(p.playing, true);
    // No frames pushed yet besides the initial preroll suppressed by autoplay.
    const before = h.pushed.length;
    h.advance(500); // 0.5 sec at 1× → playhead = 0.5 → frame 5
    const idx5 = h.pushed[before + 0];
    assert.ok(idx5);
    assert.equal(idx5[0], 5);
});

test('player: pause stops advancing', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    h.advance(200); // playhead = 0.2
    const beforePause = p.currentTime;
    p.pause();
    h.advance(500);
    assert.equal(p.playing, false);
    assert.equal(p.currentTime, beforePause);
});

test('player: seek snaps to the right frame', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: false,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    p.seek(0.7); // 70% → frame 7
    assert.equal(p.currentTime, 0.7);
    const pushed = h.pushed[h.pushed.length - 1];
    assert.ok(pushed);
    assert.equal(pushed[0], 7);
});

test('player: seek clamps to [0, duration]', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: false,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    p.seek(-5);
    assert.equal(p.currentTime, 0);
    p.seek(99);
    assert.equal(p.currentTime, 1.0); // duration
});

test('player: loop=true wraps around at end', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    p.loop = true;
    h.advance(1200); // 1.2 sec, duration is 1.0 → wraps to 0.2
    assert.ok(p.currentTime < 0.3 && p.currentTime > 0.15);
    assert.equal(p.playing, true);
});

test('player: loop=false fires onEnded and stops', () => {
    const h = makeHarness();
    let ended = 0;
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    p.loop = false;
    p.onEnded(() => { ended++; });
    h.advance(1200);
    assert.equal(p.currentTime, p.duration);
    assert.equal(p.playing, false);
    assert.equal(ended, 1);
});

test('player: speed multiplies playback rate', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    p.speed = 2;
    h.advance(250); // 250ms * 2x = 500ms playhead
    assert.ok(Math.abs(p.currentTime - 0.5) < 0.01);
});

test('player: onTimeUpdate fires on every advancing tick + on seek', () => {
    const h = makeHarness();
    const updates: number[] = [];
    const p = createPlayer({
        frames: makeFrames(10), fps: 10, autoplay: false,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    const off = p.onTimeUpdate((t) => updates.push(t));
    p.seek(0.3);
    assert.deepEqual(updates, [0.3]);
    off();
    p.seek(0.4);
    assert.deepEqual(updates, [0.3]); // listener detached
});

test('player: empty frame list → duration=0, play() is a no-op', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: [], fps: 30, autoplay: true,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    assert.equal(p.duration, 0);
    assert.equal(p.frameCount, 0);
    assert.equal(p.playing, false);
    p.play();
    assert.equal(p.playing, false);
});

test('player: fps fallback when 0 or negative passed', () => {
    const h = makeHarness();
    const p = createPlayer({
        frames: makeFrames(30), fps: -5, autoplay: false,
        pushFrame: (rgb) => h.pushed.push(rgb),
        now: () => h.now.ms,
        raf: (cb) => { h.pendingRaf.push(cb); return h.pendingRaf.length; },
        cancelRaf: () => { /* noop */ },
    });
    assert.equal(p.fps, 30); // default
    assert.equal(p.duration, 1.0);
});
