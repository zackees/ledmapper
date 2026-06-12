import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeFrameBrightness,
    stepIrisAttackDecay,
    computeBloomStrength,
    resolveLedDiameter,
    computeFitScale,
    bloomParamsForLedSize,
    BLOOM_MIN_STRENGTH,
    BLOOM_MAX_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_RADIUS_MIN,
    BLOOM_COVERAGE_REF,
    BLOOM_AREA_REF,
    IRIS_ATTACK_TAU,
    IRIS_DECAY_TAU,
    IRIS_MAX_DT,
} from '../../src/bloom-utils.js';

describe('computeFrameBrightness', () => {
    it('returns zeros for an empty frame', () => {
        const r = computeFrameBrightness(new Uint8Array(0));
        assert.deepEqual(r, { avgBrightness: 0, litCount: 0, totalCount: 0 });
    });

    it('full white frame → avg 1, all lit', () => {
        const r = computeFrameBrightness(new Uint8Array([255, 255, 255, 255, 255, 255]));
        assert.ok(Math.abs(r.avgBrightness - 1) < 1e-9);
        assert.equal(r.litCount, 2);
        assert.equal(r.totalCount, 2);
    });

    it('black frame → avg 0, none lit', () => {
        const r = computeFrameBrightness(new Uint8Array(9));
        assert.equal(r.avgBrightness, 0);
        assert.equal(r.litCount, 0);
        assert.equal(r.totalCount, 3);
    });

    it('counts only LEDs above the lit epsilon', () => {
        // LED0 black, LED1 dim but lit (avg 30/765 ≈ 0.039), LED2 barely off (avg 1/765 < 0.01)
        const r = computeFrameBrightness(new Uint8Array([0, 0, 0, 10, 10, 10, 1, 1, 1]));
        assert.equal(r.litCount, 1);
        assert.equal(r.totalCount, 3);
    });
});

describe('stepIrisAttackDecay', () => {
    it('matches the FastLED attack-decay formula on a rising input', () => {
        const dt = 0.033;
        const expected = 1 + (0 - 1) * Math.exp(-dt / IRIS_ATTACK_TAU);
        assert.ok(Math.abs(stepIrisAttackDecay(0, 1, dt) - expected) < 1e-12);
    });

    it('matches the FastLED attack-decay formula on a falling input', () => {
        const dt = 0.033;
        const expected = 0 + (1 - 0) * Math.exp(-dt / IRIS_DECAY_TAU);
        assert.ok(Math.abs(stepIrisAttackDecay(1, 0, dt) - expected) < 1e-12);
    });

    it('fast attack vs slow decay asymmetry: rises far faster than it falls', () => {
        const dt = 0.05;
        const rise = stepIrisAttackDecay(0, 1, dt);       // dark → blowout
        const fall = 1 - stepIrisAttackDecay(1, 0, dt);   // bright → dark
        assert.ok(rise > 0.4, `attack should track most of the step, got ${rise}`);
        assert.ok(fall < 0.1, `decay should move only slightly, got ${fall}`);
        assert.ok(rise > 4 * fall, 'attack must be much faster than decay');
    });

    it('is dt-independent: two 0.05s steps ≈ one 0.1s step', () => {
        const one = stepIrisAttackDecay(0, 1, 0.1);
        const two = stepIrisAttackDecay(stepIrisAttackDecay(0, 1, 0.05), 1, 0.05);
        assert.ok(Math.abs(one - two) < 1e-9);
    });

    it('clamps dt to IRIS_MAX_DT (tab-switch stall)', () => {
        const stalled = stepIrisAttackDecay(1, 0, 60); // a minute "elapsed"
        const clamped = stepIrisAttackDecay(1, 0, IRIS_MAX_DT);
        assert.ok(Math.abs(stalled - clamped) < 1e-12);
        // and the clamped decay still hasn't fully converged
        assert.ok(stalled > 0.5);
    });

    it('clamps negative dt to zero (no movement)', () => {
        assert.equal(stepIrisAttackDecay(0.5, 1, -1), 0.5);
    });

    it('is identity at the target and with dt=0', () => {
        assert.equal(stepIrisAttackDecay(0.5, 0.5, 0.1), 0.5);
        assert.ok(Math.abs(stepIrisAttackDecay(0.3, 1, 0) - 0.3) < 1e-12);
    });

    it('converges: repeated steps approach the target', () => {
        let cur = 1;
        for (let i = 0; i < 600; i++) cur = stepIrisAttackDecay(cur, 0.2, 1 / 60);
        assert.ok(Math.abs(cur - 0.2) < 1e-3);
    });

    it('snaps to the input when tau <= 0 (no smoothing)', () => {
        assert.equal(stepIrisAttackDecay(0, 1, 0.01, { attackTau: 0 }), 1);
    });

    it('clamps the result to [0, 1]', () => {
        assert.ok(stepIrisAttackDecay(0, 5, 10) <= 1);
        assert.ok(stepIrisAttackDecay(1, -5, 10) >= 0);
    });
});

describe('computeBloomStrength', () => {
    it('dark scene with all LEDs lit → max strength', () => {
        const s = computeBloomStrength(0, 100, 100);
        assert.ok(Math.abs(s - BLOOM_MAX_STRENGTH) < 1e-9);
    });

    it('fully bright scene → min strength', () => {
        const s = computeBloomStrength(1, 100, 100);
        assert.ok(Math.abs(s - BLOOM_MIN_STRENGTH) < 1e-9);
    });

    it('no lit LEDs → min strength (densityFactor 0)', () => {
        const s = computeBloomStrength(0, 0, 100);
        assert.ok(Math.abs(s - BLOOM_MIN_STRENGTH) < 1e-9);
    });

    it('matches the FastLED formula: min + (max-min)*(1-bri)*density', () => {
        const bri = 0.25, lit = 50, total = 200;
        const expected = BLOOM_MIN_STRENGTH
            + (BLOOM_MAX_STRENGTH - BLOOM_MIN_STRENGTH) * (1 - bri) * (lit / total);
        assert.ok(Math.abs(computeBloomStrength(bri, lit, total) - expected) < 1e-9);
    });

    it('clamps out-of-range inputs to [min, max]', () => {
        assert.ok(computeBloomStrength(-5, 200, 100) <= BLOOM_MAX_STRENGTH);
        assert.ok(computeBloomStrength(5, 100, 100) >= BLOOM_MIN_STRENGTH);
        assert.ok(computeBloomStrength(0.5, 10, 0) >= BLOOM_MIN_STRENGTH);
    });
});

describe('resolveLedDiameter', () => {
    it('screenmap-declared diameter wins over the heuristic fallback', () => {
        assert.equal(resolveLedDiameter([{ diameter: 0.25 }], 7), 0.25);
    });

    it('uses the max diameter across strips', () => {
        const strips = [{ diameter: 0.2 }, { diameter: 0.75 }, { diameter: 0.3 }];
        assert.equal(resolveLedDiameter(strips, 7), 0.75);
    });

    it('falls back to the heuristic when no strip declares a diameter', () => {
        assert.equal(resolveLedDiameter([{}, { name: 's' }], 7), 7);
    });

    it('ignores non-numeric / non-positive declared diameters', () => {
        assert.equal(resolveLedDiameter([{ diameter: '3' }, { diameter: 0 }, { diameter: NaN }], 7), 7);
    });

    it('returns null when neither source provides a diameter', () => {
        assert.equal(resolveLedDiameter([], null), null);
        assert.equal(resolveLedDiameter(null), null);
        assert.equal(resolveLedDiameter([{}], 0), null);
    });
});

describe('computeFitScale', () => {
    it('returns the bbox extent ratio of a uniform fit', () => {
        const raw = [[0, 0], [10, 5]];
        const fitted = [[0, 0], [100, 50]];
        assert.ok(Math.abs(computeFitScale(raw, fitted) - 10) < 1e-9);
    });

    it('uses the max extent (matches min-scale fitting of the larger axis)', () => {
        const raw = [[0, 0], [10, 2]];
        const fitted = raw.map(([x, y]) => [x * 3, y * 3]);
        assert.ok(Math.abs(computeFitScale(raw, fitted) - 3) < 1e-9);
    });

    it('returns 1 for degenerate inputs', () => {
        assert.equal(computeFitScale([], []), 1);
        assert.equal(computeFitScale([[1, 1]], [[5, 5]]), 1);
        assert.equal(computeFitScale([[0, 0], [0, 0]], [[0, 0], [1, 1]]), 1);
    });
});

describe('bloomParamsForLedSize', () => {
    // Pane / count where the reference coverages line up exactly:
    // linear ref → ledPx = 0.02 * panePx; area ref → count = refArea / linear².
    const PANE = 800;
    const REF_LED_PX = BLOOM_COVERAGE_REF * PANE; // 16
    const REF_COUNT = BLOOM_AREA_REF / (BLOOM_COVERAGE_REF * BLOOM_COVERAGE_REF); // 62.5

    it('reproduces the stock FastLED numbers at the reference coverages', () => {
        const p = bloomParamsForLedSize(REF_LED_PX, PANE, REF_COUNT);
        assert.ok(Math.abs(p.radius - BLOOM_RADIUS) < 1e-9);
        assert.ok(Math.abs(p.minStrength - BLOOM_MIN_STRENGTH) < 1e-9);
        assert.ok(Math.abs(p.maxStrength - BLOOM_MAX_STRENGTH) < 1e-9);
    });

    it('radius is proportional to the rendered dot size', () => {
        const p = bloomParamsForLedSize(REF_LED_PX / 4, PANE, 4);
        assert.ok(Math.abs(p.radius - BLOOM_RADIUS / 4) < 1e-9);
    });

    it('sparse small dots keep the full strength range', () => {
        // area = 4 * (4/800)^2 = 1e-4 << refArea
        const p = bloomParamsForLedSize(4, PANE, 4);
        assert.ok(Math.abs(p.maxStrength - BLOOM_MAX_STRENGTH) < 1e-9);
        assert.ok(Math.abs(p.minStrength - BLOOM_MIN_STRENGTH) < 1e-9);
    });

    it('dense/large layouts scale strength down inversely with lit area, radius capped at base', () => {
        const p = bloomParamsForLedSize(REF_LED_PX * 2, PANE, REF_COUNT);
        assert.ok(Math.abs(p.radius - BLOOM_RADIUS) < 1e-9); // capped
        // total lit area quadrupled (×1/4) and per-dot area quadrupled (×1/4)
        assert.ok(Math.abs(p.maxStrength - BLOOM_MAX_STRENGTH / 16) < 1e-9);
        assert.ok(Math.abs(p.minStrength - BLOOM_MIN_STRENGTH / 16) < 1e-9);
    });

    it('a small pane (low bloom resolution) scales strength down linearly', () => {
        const full = bloomParamsForLedSize(4, PANE, 4);
        const quarter = bloomParamsForLedSize(4, PANE, 4, { bloomResolution: 200 });
        assert.ok(Math.abs(quarter.maxStrength - full.maxStrength / 4) < 1e-9);
        assert.ok(Math.abs(quarter.radius - full.radius) < 1e-9); // radius unaffected
    });

    it('more LEDs at the same dot size → lower strength', () => {
        const sparse = bloomParamsForLedSize(8, PANE, 100);
        const dense = bloomParamsForLedSize(8, PANE, 4000);
        assert.ok(dense.maxStrength < sparse.maxStrength);
        assert.ok(Math.abs(dense.radius - sparse.radius) < 1e-9); // radius from dot size only
    });

    it('radius never collapses below the floor for sub-pixel dots', () => {
        const p = bloomParamsForLedSize(0.05, PANE, 10);
        assert.ok(p.radius >= BLOOM_RADIUS_MIN);
    });

    it('is monotonic: bigger dots never increase strength', () => {
        let prev = Infinity;
        for (const ledPx of [1, 4, 16, 40, 160, 800]) {
            const p = bloomParamsForLedSize(ledPx, PANE, 1000);
            assert.ok(p.maxStrength <= prev + 1e-12);
            prev = p.maxStrength;
        }
    });

    it('clamps degenerate inputs instead of blowing up', () => {
        const lo = bloomParamsForLedSize(0, 0, 0);
        const hi = bloomParamsForLedSize(5000, PANE, 1e9);
        assert.ok(Number.isFinite(lo.radius) && Number.isFinite(lo.maxStrength));
        assert.ok(Number.isFinite(hi.radius) && hi.maxStrength > 0);
    });
});
