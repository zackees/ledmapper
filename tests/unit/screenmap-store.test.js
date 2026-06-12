import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Tiny in-memory localStorage shim. The screenmap-store imports localStorage
// at module evaluation time (via try/catch), so we install before importing.
class MemStorage {
    constructor() { this.data = new Map(); }
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
    setItem(k, v) { this.data.set(String(k), String(v)); }
    removeItem(k) { this.data.delete(k); }
    clear() { this.data.clear(); }
    get length() { return this.data.size; }
    key(i) { return Array.from(this.data.keys())[i] ?? null; }
}
globalThis.localStorage = new MemStorage();

const {
    MIN_AUTOSAVE_LEDS,
    isDegenerate,
    saveScreenmap,
    saveScreenmapPoints,
    saveScreenmapWithMeta,
    getScreenmap,
    getScreenmapMeta,
    getBackup,
    promoteToBackup,
    restoreBackup,
    backfillMeta,
    savePresetSelection,
    getPresetSelection,
    notePinMutation,
    _resetPinMutationGuardForTests,
} = await import('../../src/screenmap-store.js');

function clearAll() {
    localStorage.clear();
}

function makeMap(stripLeds) {
    const map = {};
    for (const [name, count] of Object.entries(stripLeds)) {
        const x = [], y = [];
        for (let i = 0; i < count; i++) { x.push(i); y.push(0); }
        map[name] = { x, y, diameter: 0.5 };
    }
    return JSON.stringify({ map });
}

describe('screenmap-store: isDegenerate', () => {
    beforeEach(clearAll);

    it('returns true for invalid JSON', () => {
        assert.equal(isDegenerate(''), true);
        assert.equal(isDegenerate('not json'), true);
        assert.equal(isDegenerate('{'), true);
        assert.equal(isDegenerate(null), true);
        assert.equal(isDegenerate(undefined), true);
    });

    it('returns true for missing map', () => {
        assert.equal(isDegenerate('{}'), true);
        assert.equal(isDegenerate(JSON.stringify({ foo: 1 })), true);
    });

    it('returns true for 1-3 LEDs (below MIN_AUTOSAVE_LEDS=4)', () => {
        assert.equal(MIN_AUTOSAVE_LEDS, 4);
        for (let n = 1; n <= 3; n++) {
            assert.equal(isDegenerate(makeMap({ strip1: n })), true, `should be degenerate at ${n}`);
        }
    });

    it('returns false for >= 4 LEDs', () => {
        assert.equal(isDegenerate(makeMap({ strip1: 4 })), false);
        assert.equal(isDegenerate(makeMap({ strip1: 16, strip2: 16 })), false);
    });

    it('returns true for empty map object', () => {
        assert.equal(isDegenerate(JSON.stringify({ map: {} })), true);
    });
});

describe('screenmap-store: saveScreenmapWithMeta', () => {
    beforeEach(clearAll);

    it('refuses degenerate writes and does not mutate', () => {
        const ok = saveScreenmapWithMeta(makeMap({ strip1: 1 }), { source: 'test' });
        assert.equal(ok, false);
        assert.equal(getScreenmap(), null);
        assert.equal(getScreenmapMeta(), null);
        assert.equal(getBackup(), null);
    });

    it('writes meta on accepted writes', () => {
        const json = makeMap({ strip1: 8 });
        const ok = saveScreenmapWithMeta(json, { source: 'save' });
        assert.equal(ok, true);
        assert.equal(getScreenmap(), json);
        const meta = getScreenmapMeta();
        assert.equal(meta.source, 'save');
        assert.equal(meta.ledCount, 8);
        assert.equal(meta.stripCount, 1);
        assert.ok(typeof meta.savedAt === 'number' && meta.savedAt > 0);
    });

    it('promotes prior non-degenerate to backup when writing a different non-degenerate', () => {
        const a = makeMap({ strip1: 8 });
        const b = makeMap({ strip1: 16 });
        assert.equal(saveScreenmapWithMeta(a, { source: 'save' }), true);
        savePresetSelection('preset-a.json');
        assert.equal(saveScreenmapWithMeta(b, { source: 'save' }), true);
        const backup = getBackup();
        assert.ok(backup, 'expected a backup');
        assert.equal(backup.json, a);
        assert.equal(backup.meta.presetFile, 'preset-a.json');
        assert.equal(backup.meta.ledCount, 8);
    });

    it('does not promote when incoming text is identical', () => {
        const a = makeMap({ strip1: 8 });
        assert.equal(saveScreenmapWithMeta(a, { source: 'save' }), true);
        assert.equal(saveScreenmapWithMeta(a, { source: 'save' }), true);
        assert.equal(getBackup(), null);
    });

    it('does not promote when outgoing write is degenerate (refused entirely)', () => {
        const good = makeMap({ strip1: 8 });
        assert.equal(saveScreenmapWithMeta(good, { source: 'save' }), true);
        const bad = makeMap({ strip1: 1 });
        assert.equal(saveScreenmapWithMeta(bad, { source: 'save' }), false);
        // No backup because we refused the write
        assert.equal(getBackup(), null);
        // Working copy unchanged
        assert.equal(getScreenmap(), good);
    });
});

describe('screenmap-store: saveScreenmap clears preset only on accepted writes', () => {
    beforeEach(clearAll);

    it('clears preset on accepted write', () => {
        savePresetSelection('preset.json');
        saveScreenmap(makeMap({ strip1: 8 }));
        assert.equal(getPresetSelection(), null);
    });

    it('does NOT clear preset when write is degenerate', () => {
        savePresetSelection('preset.json');
        saveScreenmap(makeMap({ strip1: 1 }));
        assert.equal(getPresetSelection(), 'preset.json');
    });
});

describe('screenmap-store: restoreBackup', () => {
    beforeEach(clearAll);

    it('restores prior backup including preset filename', () => {
        const a = makeMap({ strip1: 8 });
        const b = makeMap({ strip1: 16 });
        saveScreenmap(a);
        savePresetSelection('preset-a.json');
        // Overwrite — promotes a to backup with preset-a.json captured
        saveScreenmap(b);
        const restored = restoreBackup();
        assert.equal(restored, a);
        assert.equal(getScreenmap(), a);
        assert.equal(getPresetSelection(), 'preset-a.json');
        const meta = getScreenmapMeta();
        assert.equal(meta.source, 'restore');
        assert.equal(meta.ledCount, 8);
    });

    it('removes preset key when backup meta has null presetFile', () => {
        const a = makeMap({ strip1: 8 });
        const b = makeMap({ strip1: 16 });
        // First write — no preset captured.
        saveScreenmap(a);
        saveScreenmap(b);
        // Now a preset is set in the working state.
        savePresetSelection('preset-current.json');
        restoreBackup();
        // Backup meta captured preset=null when promoted, so preset should be cleared.
        assert.equal(getPresetSelection(), null);
    });

    it('returns null when no backup exists', () => {
        assert.equal(restoreBackup(), null);
    });
});

describe('screenmap-store: promoteToBackup', () => {
    beforeEach(clearAll);

    it('promotes the current working copy', () => {
        const a = makeMap({ strip1: 8 });
        saveScreenmap(a);
        savePresetSelection('p.json');
        assert.equal(promoteToBackup(), true);
        const backup = getBackup();
        assert.equal(backup.json, a);
        assert.equal(backup.meta.presetFile, 'p.json');
    });

    it('refuses when working copy is degenerate or missing', () => {
        assert.equal(promoteToBackup(), false);
        // Manually write a degenerate value via the raw API
        localStorage.setItem('lm:screenmap', makeMap({ strip1: 1 }));
        assert.equal(promoteToBackup(), false);
    });
});

describe('screenmap-store: backfillMeta', () => {
    beforeEach(clearAll);

    it('synthesizes meta when missing', () => {
        const a = makeMap({ strip1: 12 });
        localStorage.setItem('lm:screenmap', a);
        assert.equal(getScreenmapMeta(), null);
        backfillMeta();
        const meta = getScreenmapMeta();
        assert.equal(meta.source, 'backfill');
        assert.equal(meta.ledCount, 12);
        assert.equal(meta.stripCount, 1);
        assert.ok(typeof meta.savedAt === 'number');
    });

    it('is a no-op when meta already exists', () => {
        const a = makeMap({ strip1: 8 });
        saveScreenmap(a);
        const before = getScreenmapMeta();
        backfillMeta();
        const after = getScreenmapMeta();
        assert.equal(after.savedAt, before.savedAt);
        assert.equal(after.source, before.source);
    });

    it('is a no-op when no working copy exists', () => {
        backfillMeta();
        assert.equal(getScreenmapMeta(), null);
    });
});

describe('screenmap-store: saveScreenmapPoints delegates to gated writer', () => {
    beforeEach(clearAll);

    it('refuses single placeholder point (degenerate)', () => {
        saveScreenmapPoints([[0, 0]], 0.5);
        assert.equal(getScreenmap(), null);
    });

    it('accepts >= MIN_AUTOSAVE_LEDS points', () => {
        const pts = [];
        for (let i = 0; i < MIN_AUTOSAVE_LEDS; i++) pts.push([i, 0]);
        saveScreenmapPoints(pts, 0.5);
        assert.ok(getScreenmap());
    });
});

// ── Pins (issue #24): meta + pin-count regression guard ──────────────

function makePinMap(stripSpecs) {
    // stripSpecs: { name: { count, pin } }
    const map = {};
    for (const [name, spec] of Object.entries(stripSpecs)) {
        const x = [], y = [];
        for (let i = 0; i < spec.count; i++) { x.push(i); y.push(0); }
        map[name] = { x, y, diameter: 0.5 };
        if (spec.pin) map[name].pin = spec.pin;
    }
    return JSON.stringify({ map });
}

describe('screenmap-store: pinCount meta + regression guard', () => {
    beforeEach(() => {
        clearAll();
        _resetPinMutationGuardForTests();
    });

    it('meta includes pinCount', () => {
        const json = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin2' },
        });
        assert.equal(saveScreenmapWithMeta(json, { source: 'save' }), true);
        assert.equal(getScreenmapMeta().pinCount, 2);
    });

    it('pinCount defaults to 1 when strips have no pin field', () => {
        assert.equal(saveScreenmapWithMeta(makeMap({ strip1: 8 }), { source: 'save' }), true);
        assert.equal(getScreenmapMeta().pinCount, 1);
    });

    it('refuses a write that silently drops pin count (no recent mutation)', () => {
        const twoPins = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin2' },
        });
        notePinMutation();
        assert.equal(saveScreenmapWithMeta(twoPins, { source: 'save' }), true);
        _resetPinMutationGuardForTests();
        const onePin = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin1' },
        });
        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            assert.equal(saveScreenmapWithMeta(onePin, { source: 'save' }), false);
        } finally {
            console.warn = origWarn;
        }
        // Working copy untouched
        assert.equal(getScreenmap(), twoPins);
        assert.ok(warnings.some((w) => /pin/i.test(w)), 'expected a console.warn mentioning pins');
    });

    it('allows pin-count drop within grace window after notePinMutation()', () => {
        const twoPins = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin2' },
        });
        notePinMutation();
        assert.equal(saveScreenmapWithMeta(twoPins, { source: 'save' }), true);
        const onePin = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin1' },
        });
        notePinMutation();
        assert.equal(saveScreenmapWithMeta(onePin, { source: 'save' }), true);
        assert.equal(getScreenmap(), onePin);
        assert.equal(getScreenmapMeta().pinCount, 1);
    });

    it('allows pin-count increases without mutation note', () => {
        const onePin = makeMap({ strip1: 8 });
        assert.equal(saveScreenmapWithMeta(onePin, { source: 'save' }), true);
        _resetPinMutationGuardForTests();
        const twoPins = makePinMap({
            a: { count: 4, pin: 'pin1' },
            b: { count: 4, pin: 'pin2' },
        });
        assert.equal(saveScreenmapWithMeta(twoPins, { source: 'save' }), true);
        assert.equal(getScreenmapMeta().pinCount, 2);
    });
});
