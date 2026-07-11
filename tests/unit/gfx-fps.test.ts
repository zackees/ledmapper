import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FpsMeter, resolveInitialVisibility, persistVisibility, isTypingTarget, snapDisplayHz, measureDisplayHz, formatFpsStats } from '../../src/gfx/fps';

test('FpsMeter: starts at zero before any ticks', () => {
    const m = new FpsMeter();
    assert.equal(m.getFps(), 0);
    assert.equal(m.getMedianFrameMs(), 0);
});

test('FpsMeter: getFps stays zero on a single tick', () => {
    const m = new FpsMeter();
    m.tick(0);
    assert.equal(m.getFps(), 0);
});

test('FpsMeter: 60 FPS in → ~60 FPS out', () => {
    const m = new FpsMeter();
    // Inject 60 ticks at 16.667ms spacing.
    for (let i = 0; i <= 60; i++) m.tick(i * (1000 / 60));
    const fps = m.getFps();
    assert.ok(Math.abs(fps - 60) < 0.5, `expected ~60, got ${String(fps)}`);
});

test('FpsMeter: 30 FPS in → ~30 FPS out', () => {
    const m = new FpsMeter();
    for (let i = 0; i <= 60; i++) m.tick(i * (1000 / 30));
    const fps = m.getFps();
    assert.ok(Math.abs(fps - 30) < 0.5, `expected ~30, got ${String(fps)}`);
});

test('FpsMeter: median frame time tracks input cadence', () => {
    const m = new FpsMeter();
    for (let i = 0; i <= 60; i++) m.tick(i * 20); // 50 FPS, 20ms frames
    const median = m.getMedianFrameMs();
    assert.ok(Math.abs(median - 20) < 0.1, `expected ~20ms, got ${String(median)}`);
});

test('FpsMeter: reset clears state', () => {
    const m = new FpsMeter();
    for (let i = 0; i <= 30; i++) m.tick(i * 16.667);
    m.reset();
    assert.equal(m.getFps(), 0);
    m.tick(0);
    assert.equal(m.getFps(), 0); // single tick after reset
});

test('FpsMeter: ignores non-positive deltas (clock skew protection)', () => {
    const m = new FpsMeter();
    m.tick(100);
    m.tick(100); // dt = 0, should be ignored
    m.tick(100); // still zero
    assert.equal(m.getFps(), 0);
});

// --- localStorage persistence ---

interface LSStub {
    store: Map<string, string>;
    setItem: (k: string, v: string) => void;
    getItem: (k: string) => string | null;
    removeItem: (k: string) => void;
    clear: () => void;
}

function installLSStub(): LSStub {
    const stub: LSStub = {
        store: new Map(),
        setItem(k, v) { this.store.set(k, v); },
        getItem(k) { return this.store.get(k) ?? null; },
        removeItem(k) { this.store.delete(k); },
        clear() { this.store.clear(); },
    };
    // @ts-expect-error overriding global for the duration of the test
    globalThis.localStorage = stub;
    return stub;
}

test('resolveInitialVisibility: explicit option wins', () => {
    installLSStub().setItem('gfx.fps.visible', '1');
    assert.equal(resolveInitialVisibility(false), false);
    assert.equal(resolveInitialVisibility(true), true);
});

test('resolveInitialVisibility: falls back to localStorage when no explicit option', () => {
    const ls = installLSStub();
    ls.setItem('gfx.fps.visible', '1');
    assert.equal(resolveInitialVisibility(undefined), true);
    ls.setItem('gfx.fps.visible', '0');
    assert.equal(resolveInitialVisibility(undefined), false);
});

test('resolveInitialVisibility: defaults to false when nothing is set', () => {
    installLSStub();
    assert.equal(resolveInitialVisibility(undefined), false);
});

test('persistVisibility: round-trips through localStorage', () => {
    const ls = installLSStub();
    persistVisibility(true);
    assert.equal(ls.getItem('gfx.fps.visible'), '1');
    persistVisibility(false);
    assert.equal(ls.getItem('gfx.fps.visible'), '0');
});

test('persistVisibility: swallows localStorage errors', () => {
    // @ts-expect-error replacing with a throwing stub
    globalThis.localStorage = {
        setItem() { throw new Error('private mode'); },
        getItem() { return null; },
    };
    // Should not throw.
    persistVisibility(true);
});

// --- isTypingTarget ---

test('isTypingTarget: null returns false', () => {
    assert.equal(isTypingTarget(null), false);
});

// --- display Hz (issue #267) ---

test('snapDisplayHz: snaps near-miss measurements onto common refresh rates', () => {
    assert.equal(snapDisplayHz(59.6), 60);
    assert.equal(snapDisplayHz(60.4), 60);
    assert.equal(snapDisplayHz(119), 120);
    assert.equal(snapDisplayHz(143.5), 144);
    assert.equal(snapDisplayHz(74), 75);
});

test('snapDisplayHz: keeps unusual rates (rounded) rather than forcing a snap', () => {
    assert.equal(snapDisplayHz(85), 85); // 5% from both 75 and 90 → no snap
    assert.equal(snapDisplayHz(0), 0);
    assert.equal(snapDisplayHz(-10), 0);
    assert.equal(snapDisplayHz(Infinity), 0);
});

test('measureDisplayHz: derives 60Hz from injected 16.667ms RAF cadence', async () => {
    let t = 0;
    const raf = (cb: (t: number) => void) => { t += 1000 / 60; const nt = t; queueMicrotask(() => { cb(nt); }); };
    const hz = await measureDisplayHz({ sampleCount: 20, raf });
    assert.equal(hz, 60);
});

test('measureDisplayHz: derives 120Hz from 8.333ms cadence', async () => {
    let t = 0;
    const raf = (cb: (t: number) => void) => { t += 1000 / 120; const nt = t; queueMicrotask(() => { cb(nt); }); };
    const hz = await measureDisplayHz({ sampleCount: 20, raf });
    assert.equal(hz, 120);
});

test('measureDisplayHz: resolves 0 when RAF is unavailable', async () => {
    // No injected raf and no global requestAnimationFrame in Node.
    const hz = await measureDisplayHz({ sampleCount: 5 });
    assert.equal(hz, 0);
});

test('formatFpsStats uses stable three-line monitor/render/source rows', () => {
    const integerRates = formatFpsStats({
        renderFps: 60,
        pushFps: 30,
        frameTimeMs: 16.67,
        framesRendered: 100,
    }, 60);
    const fractionalRates = formatFpsStats({
        renderFps: 60,
        pushFps: 29.97,
        frameTimeMs: 16.67,
        framesRendered: 100,
    }, 60);

    assert.equal(integerRates, 'Monitor: 60\nRender:  60\nSource:  30');
    assert.equal(fractionalRates, 'Monitor: 60\nRender:  60\nSource:  29.97');
    assert.equal(integerRates.split('\n')[2]?.indexOf('30'), fractionalRates.split('\n')[2]?.indexOf('29.97'));
});

test('FPS counter CSS fixes its width and left-aligns tabular values', async () => {
    const css = await import('node:fs').then((fs) =>
        fs.promises.readFile(new URL('../../src/styles/global.css', import.meta.url), 'utf-8'));
    assert.match(css, /\.gfx-fps-counter\s*\{[^}]*inline-size:\s*15ch;/s);
    assert.match(css, /\.gfx-fps-counter\s*\{[^}]*text-align:\s*left;/s);
    assert.match(css, /\.gfx-fps-counter\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
    assert.match(css, /\.gfx-fps-counter\s*\{[^}]*white-space:\s*pre;/s);
});
