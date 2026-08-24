import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER } from '../../src/moviemaker/hdr-bloom-gpu';
import {
    CPU_ORACLE_HDR_BLOOM_STRATEGY,
    DEFAULT_HDR_BLOOM_STRATEGY,
    HDR_BLOOM_STRATEGIES,
    HDR_BLOOM_STRATEGY_NAMES,
    isHdrBloomStrategyName,
    resolveHdrBloomStrategy,
} from '../../src/moviemaker/hdr-bloom-strategies';

void describe('HDR bloom strategies', () => {
    void test('every name resolves to a self-consistent strategy', () => {
        for (const name of HDR_BLOOM_STRATEGY_NAMES) {
            const strategy = resolveHdrBloomStrategy(name);
            assert.equal(strategy.name, name);
            assert.ok(strategy.label.length > 0, `${name} needs a label`);
            assert.ok(strategy.description.length > 0, `${name} needs a description`);
            assert.match(strategy.fragmentShader, /void main\(\)/, `${name} needs a main()`);
            assert.equal(strategy.brackets.factors.length, 3);
            assert.equal(strategy.brackets.radiusScales.length, 3);
        }
    });

    void test('the legacy export stays bound to the CPU-oracle strategy', () => {
        // Bound to the oracle, not the default: its consumers diff it against
        // compositeHdrBloomRgba, so promoting a new default must not repoint
        // it at an algorithm the CPU composite does not implement.
        assert.equal(
            HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER,
            HDR_BLOOM_STRATEGIES[CPU_ORACLE_HDR_BLOOM_STRATEGY].fragmentShader,
        );
    });

    void test('only the CPU-oracle strategy claims oracle support', () => {
        // compositeHdrBloomRgba mirrors one algorithm. Any other strategy
        // claiming oracle support would make verify-full diff two different
        // algorithms and report a meaningless mismatch.
        for (const name of HDR_BLOOM_STRATEGY_NAMES) {
            assert.equal(
                resolveHdrBloomStrategy(name).supportsCpuOracle,
                name === CPU_ORACLE_HDR_BLOOM_STRATEGY,
                `${name} has the wrong oracle claim`,
            );
        }
    });

    void test('strategies are distinct algorithms, not duplicates', () => {
        // Bracket capture is part of the algorithm, not just the shader. The
        // historical wide and localized acrylic panes intentionally share a
        // composite while using different spatial support.
        const identities = new Set(
            HDR_BLOOM_STRATEGY_NAMES.map((name) => {
                const strategy = resolveHdrBloomStrategy(name);
                return `${strategy.fragmentShader}\n${JSON.stringify(strategy.brackets)}`;
            }),
        );
        assert.equal(identities.size, HDR_BLOOM_STRATEGY_NAMES.length);
    });

    void test('resurrected strategies keep the bracket setup they shipped with', () => {
        // These co-evolved with their shaders; a shader alone does not
        // reproduce the render. linear-hdr scaled bloom strength globally and
        // neither historical strategy ramped the high-bracket threshold.
        assert.equal(resolveHdrBloomStrategy('linear-hdr').brackets.strengthScale, 0.30);
        assert.equal(resolveHdrBloomStrategy('chroma-capped').brackets.strengthScale, 1);
        for (const name of ['linear-hdr', 'chroma-capped'] as const) {
            const { highThresholdDark, highThresholdBright } = resolveHdrBloomStrategy(name).brackets;
            assert.equal(highThresholdDark, 0);
            assert.equal(highThresholdBright, 0);
        }
        const oracle = resolveHdrBloomStrategy(CPU_ORACLE_HDR_BLOOM_STRATEGY).brackets;
        assert.equal(oracle.highThresholdDark, 0.08);
        assert.equal(oracle.highThresholdBright, 0.16);
        // The promoted default reads its surround, so it must not share the
        // oracle's single-scale brackets.
        assert.ok(resolveHdrBloomStrategy(DEFAULT_HDR_BLOOM_STRATEGY).brackets.radiusScales[2] > 1);
    });

    void test('only surround-based strategies separate the brackets spatially', () => {
        // Equal radii make the brackets near-scalar multiples of one another,
        // so no selection among them can recover hue none of them carries.
        // Every strategy that reads hue from the region AROUND a pixel needs a
        // genuinely wider bracket; the selection-only strategies must keep the
        // historical single scale so their renders stay reproducible.
        const spatiallySeparated = new Set([
            'wide-surround-chroma', 'surround-white-safe', 'norm-tonescale',
            'surround-white-glow', 'norm-tonescale-guarded',
            'norm-tonescale-sharp', 'norm-surround-hue',
            'legacy-additive', 'acrylic-overflow', 'acrylic-pane-wide', 'acrylic-pane', 'acrylic-psf',
            'acrylic-native', 'hdr-reference',
        ]);
        for (const name of HDR_BLOOM_STRATEGY_NAMES) {
            const { radiusScales } = resolveHdrBloomStrategy(name).brackets;
            if (spatiallySeparated.has(name)) {
                assert.ok(
                    radiusScales[2] > 1,
                    `${name} needs a genuinely wider high bracket to read its surround`,
                );
            } else {
                assert.deepEqual(
                    [...radiusScales], [1, 1, 1],
                    `${name} should keep the historical single-scale brackets`,
                );
            }
        }
    });

    void test('the acrylic pane keeps a restrained mid band and disables coarse bands', () => {
        const { unrealMipWeights } = resolveHdrBloomStrategy('acrylic-pane').brackets;
        assert.deepEqual(unrealMipWeights, [2.85, 1.5, 0.25, 0, 0]);
        assert.ok(unrealMipWeights[0]);
        assert.ok(unrealMipWeights[1]);
        assert.ok(unrealMipWeights[2] > 0 && unrealMipWeights[2] < unrealMipWeights[1]);
        assert.ok(unrealMipWeights.slice(3).every((weight) => weight === 0));
    });

    void test('name guard rejects unknown strategies', () => {
        assert.ok(isHdrBloomStrategyName('sliding-window'));
        assert.ok(!isHdrBloomStrategyName('does-not-exist'));
    });
});
