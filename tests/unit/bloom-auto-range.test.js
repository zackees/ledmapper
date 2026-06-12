/**
 * Unit tests for computeAutoBloomRange and the bloom-never-disabled invariant.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeAutoBloomRange,
    computeBloomStrength,
    AUTO_BLOOM_SPACING_REF,
    PREVIEW_AUTO_FLOOR,
    PREVIEW_AUTO_MAX_DENSE,
    PREVIEW_AUTO_MAX_SPARSE,
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_DENSE,
    DEMO_AUTO_MAX_SPARSE,
    BLOOM_MIN_STRENGTH,
} from '../../src/bloom-utils.js';

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
            for (const [lit, total] of [[0, 100], [50, 100], [100, 100]]) {
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
