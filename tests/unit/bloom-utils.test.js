import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeFrameBrightness,
    stepIris,
    computeBloomStrength,
    BLOOM_MIN_STRENGTH,
    BLOOM_MAX_STRENGTH,
    IRIS_RESPONSE_SPEED,
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

describe('stepIris', () => {
    it('moves current brightness toward the average at the iris speed', () => {
        const next = stepIris(0, 1);
        assert.ok(Math.abs(next - IRIS_RESPONSE_SPEED) < 1e-9);
    });

    it('converges: repeated steps approach the target', () => {
        let cur = 0;
        for (let i = 0; i < 200; i++) cur = stepIris(cur, 0.8);
        assert.ok(Math.abs(cur - 0.8) < 1e-3);
    });

    it('is identity at the target', () => {
        assert.equal(stepIris(0.5, 0.5), 0.5);
    });

    it('clamps to [0, 1]', () => {
        assert.ok(stepIris(2, 5) <= 1);
        assert.ok(stepIris(-1, -2) >= 0);
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
