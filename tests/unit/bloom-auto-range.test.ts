/**
 * Unit tests for computeAutoBloomRange and the bloom-never-disabled invariant.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeAutoBloomRange,
    computeBloomStrength,
    bloomParamsForLedSize,
    AUTO_BLOOM_SPACING_REF,
    PREVIEW_AUTO_FLOOR,
    PREVIEW_AUTO_MAX_DENSE,
    PREVIEW_AUTO_MAX_SPARSE,
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_DENSE,
    DEMO_AUTO_MAX_SPARSE,
    DEMO_BLOOM_MAX_STRENGTH,
    DEMO_BLOOM_RADIUS,
    DEMO_BLOOM_AREA_REF,
    BLOOM_RADIUS_MIN,
    BLOOM_MIN_STRENGTH,
} from '../../src/bloom-utils';

const PREVIEW_PROFILE = { floor: PREVIEW_AUTO_FLOOR, maxDense: PREVIEW_AUTO_MAX_DENSE, maxSparse: PREVIEW_AUTO_MAX_SPARSE };
const DEMO_PROFILE    = { floor: DEMO_AUTO_FLOOR,    maxDense: DEMO_AUTO_MAX_DENSE,    maxSparse: DEMO_AUTO_MAX_SPARSE };

describe('computeAutoBloomRange', () => {
    // 1. Sparse geometry → range.max ≈ PREVIEW_AUTO_MAX_SPARSE
    it('sparse layout (spacingFraction >= SPACING_REF) → max approaches MAX_SPARSE', () => {
        // spacingFraction = ledSpacing / sceneExtent = 0.10 exactly → D = 0
        const range = computeAutoBloomRange({
            ledSpacing: AUTO_BLOOM_SPACING_REF,
            sceneExtent: 1,
            profile: PREVIEW_PROFILE,
        });
        assert.ok(
            Math.abs(range.max - PREVIEW_AUTO_MAX_SPARSE) < 1e-6,
            `expected max ≈ ${PREVIEW_AUTO_MAX_SPARSE}, got ${range.max}`,
        );
    });

    // 1b. Dense geometry → range.max ≈ PREVIEW_AUTO_MAX_DENSE
    it('dense layout (spacingFraction → 0) → max approaches MAX_DENSE', () => {
        // spacingFraction → 0 means D → 1
        const range = computeAutoBloomRange({
            ledSpacing: 1e-10,
            sceneExtent: 1,
            profile: PREVIEW_PROFILE,
        });
        assert.ok(
            Math.abs(range.max - PREVIEW_AUTO_MAX_DENSE) < 1e-6,
            `expected max ≈ ${PREVIEW_AUTO_MAX_DENSE}, got ${range.max}`,
        );
    });

    // 2. Floor enforced: absurd density still yields range.max >= FLOOR and range.min > 0
    it('floor enforced: extremely dense geometry still yields positive min and max >= floor', () => {
        const range = computeAutoBloomRange({
            ledSpacing: 0,
            sceneExtent: 1,
            profile: PREVIEW_PROFILE,
        });
        assert.ok(range.max >= PREVIEW_AUTO_FLOOR, `range.max ${range.max} < floor ${PREVIEW_AUTO_FLOOR}`);
        assert.ok(range.min > 0, `range.min ${range.min} must be > 0`);
    });

    // 3. Continuity: two closely adjacent spacings differ by < 0.01 in range.max
    it('continuity: small spacing change → small range.max change', () => {
        const r1 = computeAutoBloomRange({ ledSpacing: 0.05,   sceneExtent: 1, profile: PREVIEW_PROFILE });
        const r2 = computeAutoBloomRange({ ledSpacing: 0.0501, sceneExtent: 1, profile: PREVIEW_PROFILE });
        assert.ok(
            Math.abs(r1.max - r2.max) < 0.01,
            `max diff ${Math.abs(r1.max - r2.max)} exceeds 0.01`,
        );
    });

    // 4. Demo profile strictly larger than preview for same geometry
    it('demo profile yields strictly larger max than preview profile for the same geometry', () => {
        const ledSpacing = 0.03, sceneExtent = 1;
        const preview = computeAutoBloomRange({ ledSpacing, sceneExtent, profile: PREVIEW_PROFILE });
        const demo    = computeAutoBloomRange({ ledSpacing, sceneExtent, profile: DEMO_PROFILE });
        assert.ok(
            demo.max > preview.max,
            `demo.max (${demo.max}) should be > preview.max (${preview.max})`,
        );
    });

    // 5. Integration: computeBloomStrength with auto range stays within [floor, sparseMax]
    it('integration: computeBloomStrength inside auto range stays within [floor, sparseMax]', () => {
        const range = computeAutoBloomRange({ ledSpacing: 0.05, sceneExtent: 1, profile: PREVIEW_PROFILE });
        // Test several brightness/density combos
        for (const bri of [0, 0.25, 0.5, 0.75, 1]) {
            for (const [lit, total] of [[0, 100], [50, 100], [100, 100]] as [number, number][]) {
                const s = computeBloomStrength(bri, lit, total, range);
                assert.ok(s >= PREVIEW_AUTO_FLOOR * 0.5 - 1e-9, `strength ${s} below floor*0.5`);
                assert.ok(s <= PREVIEW_AUTO_MAX_SPARSE + 1e-9, `strength ${s} above sparseMax`);
            }
        }
    });

    // 6. Bypass-invariant: for every spacing in a wide range, range.max > 0 strictly
    it('bypass-invariant: range.max > 0 for all spacings (bloom never disabled)', () => {
        const sceneExtent = 1;
        // Sample spacing from near-zero to 10x sceneExtent
        const spacings = [
            0.0001, 0.001, 0.005, 0.01, 0.02, 0.05, 0.10, 0.20, 0.50,
            1.0, 2.0, 5.0, 10.0,
        ];
        for (const ledSpacing of spacings) {
            for (const profile of [PREVIEW_PROFILE, DEMO_PROFILE]) {
                const range = computeAutoBloomRange({ ledSpacing, sceneExtent, profile });
                assert.ok(
                    range.max > 0,
                    `range.max ${range.max} is not > 0 at spacing=${ledSpacing}`,
                );
                assert.ok(
                    range.min > 0,
                    `range.min ${range.min} is not > 0 at spacing=${ledSpacing}`,
                );
            }
        }
    });

    // Verify the range envelope respects BLOOM_MIN_STRENGTH for the min floor
    it('range.min is at least BLOOM_MIN_STRENGTH * 0.5 (no sub-floor)', () => {
        const range = computeAutoBloomRange({ ledSpacing: 0.05, sceneExtent: 1, profile: PREVIEW_PROFILE });
        assert.ok(range.min >= BLOOM_MIN_STRENGTH * 0.5 - 1e-9);
    });
});

// Mirrors the effective-range combination in moviemaker/preview.ts render().
describe('preview effective bloom range — dense map regression (issue #49)', () => {
    // 32x32 quad serpentine: 64x64 grid, 4096 LEDs, spacing 0.7071,
    // declared diameter 0.25, rotated 45°, rendered in the 400px pane.
    const spacing = 0.7071, dia = 0.25, count = 4096, side = 400;
    const extent = 63 * spacing * Math.SQRT2;
    const half = (extent / 2 + dia / 2) * 1.05;
    const ledPx = Math.max((dia / (half * 2)) * side, 0.75);
    const params = bloomParamsForLedSize(ledPx, side, count, { bloomResolution: side });
    const env = computeAutoBloomRange({ ledSpacing: spacing, sceneExtent: extent, profile: PREVIEW_PROFILE });
    const effMax = Math.min(params.maxStrength, env.max);
    const effMin = Math.min(Math.max(params.minStrength, env.min), effMax);

    it('effective ceiling is high enough for a visible halo (was ~0.71)', () => {
        assert.ok(effMax >= 1.5, `effMax ${effMax} < 1.5 — bloom imperceptible on dense maps`);
    });

    it('effective floor keeps the bloom-never-disabled minimum (was ~0.11)', () => {
        assert.ok(effMin >= BLOOM_MIN_STRENGTH - 1e-9, `effMin ${effMin} below BLOOM_MIN_STRENGTH ${BLOOM_MIN_STRENGTH}`);
    });

    it('frame strength at the screenshot brightness (19%, ~60% lit) is clearly visible', () => {
        const s = computeBloomStrength(0.19, 60, 100, { min: effMin, max: effMax });
        assert.ok(s >= 1.5, `strength ${s} < 1.5 at typical brightness`);
    });

    it('floor never exceeds the ceiling', () => {
        assert.ok(effMin <= effMax + 1e-12);
    });
});

// Mirrors the effective-range combination in demo/demo.ts onFrame(): the demo
// auto ceiling must reach the manually-validated sweet spot (issue #51).
describe('demo effective bloom range — small dot sweet spot (issue #51)', () => {
    // 800px demo canvas, dense 4096-LED map, diameter slider at its lowest (1px).
    const ledPx = 1, count = 4096, side = 800;
    const params = bloomParamsForLedSize(ledPx, side, count, { baseMax: DEMO_BLOOM_MAX_STRENGTH });
    // Density envelope is a non-binding outer guard at the demo ceiling.
    const env = computeAutoBloomRange({ ledSpacing: 1, sceneExtent: 800, profile: DEMO_PROFILE });
    const effMax = Math.min(params.maxStrength, env.max);
    const effMin = Math.min(params.minStrength, effMax);

    it('auto ceiling reaches the manual sweet spot (~36) for small dense dots', () => {
        assert.ok(effMax >= DEMO_BLOOM_MAX_STRENGTH - 1e-9, `effMax ${effMax} below sweet spot ${DEMO_BLOOM_MAX_STRENGTH}`);
    });

    it('iris fully open (dark, all lit) reaches the sweet spot', () => {
        const s = computeBloomStrength(0, count, count, { min: effMin, max: effMax });
        assert.ok(Math.abs(s - DEMO_BLOOM_MAX_STRENGTH) < 1e-6, `dark-frame strength ${s} != ${DEMO_BLOOM_MAX_STRENGTH}`);
    });

    it('iris closes on bright frames (strength drops well below the ceiling)', () => {
        const s = computeBloomStrength(0.9, count, count, { min: effMin, max: effMax });
        assert.ok(s < DEMO_BLOOM_MAX_STRENGTH * 0.3, `bright-frame strength ${s} should be well below ceiling`);
    });
});

// At large LED diameters the demo dots already cover the panel; the default
// radius-1 / wide-area kernel washed it out (issue #53). The demo-only radius
// and area overrides must tame the large-dot regime while leaving the
// diameter-1 sweet spot from issue #51 intact.
describe('demo large-dot regime is tamed (issue #53)', () => {
    const count = 4096, side = 800;
    const demoOpts = {
        baseMax: DEMO_BLOOM_MAX_STRENGTH,
        baseRadius: DEMO_BLOOM_RADIUS,
        refArea: DEMO_BLOOM_AREA_REF,
    };

    it('large dots (diameter 16) get a halved radius and a low ceiling', () => {
        const params = bloomParamsForLedSize(16, side, count, demoOpts);
        assert.ok(Math.abs(params.radius - DEMO_BLOOM_RADIUS) < 1e-9, `radius ${params.radius} != ${DEMO_BLOOM_RADIUS}`);
        assert.ok(params.maxStrength <= DEMO_BLOOM_RADIUS, `large-dot ceiling ${params.maxStrength} should be tame`);
    });

    it('small dots (diameter 1) keep the issue #51 sweet spot', () => {
        const params = bloomParamsForLedSize(1, side, count, demoOpts);
        assert.ok(Math.abs(params.radius - BLOOM_RADIUS_MIN) < 1e-9, `radius ${params.radius} != ${BLOOM_RADIUS_MIN}`);
        assert.ok(Math.abs(params.maxStrength - DEMO_BLOOM_MAX_STRENGTH) < 1e-6, `ceiling ${params.maxStrength} != ${DEMO_BLOOM_MAX_STRENGTH}`);
    });

    it('the ceiling falls monotonically as dots grow', () => {
        const small = bloomParamsForLedSize(1, side, count, demoOpts).maxStrength;
        const mid = bloomParamsForLedSize(4, side, count, demoOpts).maxStrength;
        const large = bloomParamsForLedSize(16, side, count, demoOpts).maxStrength;
        assert.ok(small >= mid && mid >= large, `expected ${small} >= ${mid} >= ${large}`);
    });
});
