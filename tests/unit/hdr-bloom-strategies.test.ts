import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER } from '../../src/moviemaker/hdr-bloom-gpu';
import {
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

    void test('the legacy export stays bound to the default strategy', () => {
        assert.equal(
            HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER,
            HDR_BLOOM_STRATEGIES[DEFAULT_HDR_BLOOM_STRATEGY].fragmentShader,
        );
    });

    void test('only the default strategy claims a CPU oracle', () => {
        // compositeHdrBloomRgba mirrors one algorithm. Any other strategy
        // claiming oracle support would make verify-full diff two different
        // algorithms and report a meaningless mismatch.
        for (const name of HDR_BLOOM_STRATEGY_NAMES) {
            assert.equal(
                resolveHdrBloomStrategy(name).supportsCpuOracle,
                name === DEFAULT_HDR_BLOOM_STRATEGY,
                `${name} has the wrong oracle claim`,
            );
        }
    });

    void test('strategies are distinct algorithms, not duplicates', () => {
        const shaders = new Set(
            HDR_BLOOM_STRATEGY_NAMES.map((name) => resolveHdrBloomStrategy(name).fragmentShader),
        );
        assert.equal(shaders.size, HDR_BLOOM_STRATEGY_NAMES.length);
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
        const current = resolveHdrBloomStrategy(DEFAULT_HDR_BLOOM_STRATEGY).brackets;
        assert.equal(current.highThresholdDark, 0.08);
        assert.equal(current.highThresholdBright, 0.16);
    });

    void test('only wide-surround-chroma separates the brackets spatially', () => {
        // Equal radii make the brackets near-scalar multiples of one another,
        // so no selection among them can recover hue none of them carries.
        // That is the whole point of this strategy, and the reason the others
        // cannot fix a blown white core by selection alone.
        assert.ok(resolveHdrBloomStrategy('wide-surround-chroma').brackets.radiusScales[2] > 1);
        for (const name of HDR_BLOOM_STRATEGY_NAMES) {
            if (name === 'wide-surround-chroma') continue;
            assert.deepEqual(
                [...resolveHdrBloomStrategy(name).brackets.radiusScales],
                [1, 1, 1],
                `${name} should keep the historical single-scale brackets`,
            );
        }
    });

    void test('name guard rejects unknown strategies', () => {
        assert.ok(isHdrBloomStrategyName('sliding-window'));
        assert.ok(!isHdrBloomStrategyName('does-not-exist'));
    });
});
