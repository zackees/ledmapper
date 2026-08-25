import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BLOOM_FREQUENCY_ATTACK_TAU,
    BLOOM_FREQUENCY_DECAY_TAU,
    BLOOM_FREQUENCY_HIGH_WEIGHTS,
    BLOOM_FREQUENCY_LOW_WEIGHTS,
    bloomFrequencyTarget,
    computeBloomFrequencyFeatures,
    createBloomFrequencyController,
    createBloomFrequencyTopology,
    interpolateBloomMipWeights,
    stepBloomFrequencyBlend,
} from '../../src/bloom-frequency';
import type { StripPoint } from '../../src/types/domain';

function grid(size = 8): StripPoint[] {
    return Array.from({ length: size * size }, (_unused, index) => [
        index % size,
        Math.floor(index / size),
    ]);
}

function pixels(size: number, color: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
    const out = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) out.set(color(x, y), (y * size + x) * 3);
    }
    return out;
}

function advanceBlend(start: number, target: number, duration: number, fps: number): number {
    let blend = start;
    const frames = Math.round(duration * fps);
    for (let frame = 0; frame < frames; frame++) {
        blend = stepBloomFrequencyBlend(blend, target, 1 / fps);
    }
    return blend;
}

describe('bloom source-frequency classifier', () => {
    it('builds axial and diagonal topology independent of channel order', () => {
        const points = grid();
        const channels = points.map((_point, index) => points.length - index - 1);
        const topology = createBloomFrequencyTopology(points, channels);
        assert.equal(topology.edges.length, 210);
        assert.equal(topology.channels[0], 63);
    });

    it('does not bridge large coordinate gaps between separate local panels', () => {
        const points: StripPoint[] = [];
        for (const x of [0, 1, 100, 101]) {
            for (const y of [0, 1]) points.push([x, y]);
        }
        const topology = createBloomFrequencyTopology(points);
        assert.equal(topology.edges.length, 12);
        for (const [first, second] of topology.edges) {
            const a = points[first]!;
            const b = points[second]!;
            assert.ok(Math.abs(a[0] - b[0]) <= 1);
            assert.ok(Math.abs(a[1] - b[1]) <= 1);
        }
    });

    it('separates flat/coherent fields from luma and chroma high-frequency fields', () => {
        const topology = createBloomFrequencyTopology(grid());
        const flat = computeBloomFrequencyFeatures(pixels(8, () => [128, 128, 128]), topology);
        const checker = computeBloomFrequencyFeatures(
            pixels(8, (x, y) => (x + y) % 2 ? [255, 255, 255] : [0, 0, 0]),
            topology,
        );
        const chroma = computeBloomFrequencyFeatures(
            pixels(8, (x, y) => (x + y) % 2 ? [255, 0, 0] : [0, 0, 255]),
            topology,
        );
        assert.equal(flat.score, 0);
        assert.ok(checker.score > 0.5, `checker score ${String(checker.score)}`);
        assert.ok(chroma.score > 0.5, `chroma score ${String(chroma.score)}`);
        assert.equal(bloomFrequencyTarget(flat.score), 0);
        assert.ok(bloomFrequencyTarget(chroma.score) > 0.5);
    });
});

describe('continuous temporal mip-bias controller', () => {
    it('preserves endpoints, non-negative weights, coarse zeros, and calibrated energy', () => {
        assert.deepEqual(interpolateBloomMipWeights(0), BLOOM_FREQUENCY_LOW_WEIGHTS);
        const high = interpolateBloomMipWeights(1);
        high.forEach((value, index) => {
            assert.ok(Math.abs(value - (BLOOM_FREQUENCY_HIGH_WEIGHTS[index] ?? 0)) < 1e-9);
        });
        const energy = (weights: readonly number[]) => (
            weights.reduce((sum, weight, index) => sum + weight * [0.76, 0.68, 0.60, 0.52, 0.44][index]!, 0)
        );
        const reference = energy(interpolateBloomMipWeights(0));
        for (let step = 0; step <= 20; step++) {
            const weights = interpolateBloomMipWeights(step / 20);
            assert.ok(weights.every((weight) => weight >= 0));
            assert.deepEqual(weights.slice(3), [0, 0]);
            assert.ok(Math.abs(energy(weights) - reference) < 1e-9);
        }
    });

    it('is timestep invariant for a fixed target and attacks faster than it decays', () => {
        const one = stepBloomFrequencyBlend(0, 1, 0.1);
        const two = stepBloomFrequencyBlend(stepBloomFrequencyBlend(0, 1, 0.05), 1, 0.05);
        assert.ok(Math.abs(one - two) < 1e-12);
        const attack = stepBloomFrequencyBlend(0, 1, 0.1);
        const decay = 1 - stepBloomFrequencyBlend(1, 0, 0.1);
        assert.ok(attack > decay);
    });

    it('locks the documented 50%/90% attack and decay response times', () => {
        // tau * ln(2) and tau * ln(10), respectively. These values make
        // detail protection engage in about 0.10/0.32 s while coherent fill
        // returns conservatively in about 0.59/1.96 s.
        const attack50 = BLOOM_FREQUENCY_ATTACK_TAU * Math.log(2);
        const attack90 = BLOOM_FREQUENCY_ATTACK_TAU * Math.log(10);
        const decay50 = BLOOM_FREQUENCY_DECAY_TAU * Math.log(2);
        const decay90 = BLOOM_FREQUENCY_DECAY_TAU * Math.log(10);
        assert.ok(Math.abs(advanceBlend(0, 1, attack50, 1000) - 0.5) < 0.002);
        assert.ok(Math.abs(advanceBlend(0, 1, attack90, 1000) - 0.9) < 0.002);
        assert.ok(Math.abs(advanceBlend(1, 0, decay50, 1000) - 0.5) < 0.002);
        assert.ok(Math.abs(advanceBlend(1, 0, decay90, 1000) - 0.1) < 0.002);
    });

    it('agrees at matching media times for 24/30/60 fps and resists a one-frame quiet impulse', () => {
        for (const target of [0, 1]) {
            const start = 1 - target;
            const states = [24, 30, 60].map((fps) => advanceBlend(start, target, 1, fps));
            assert.ok(Math.max(...states) - Math.min(...states) < 1e-12);
        }

        const afterImpulse = stepBloomFrequencyBlend(1, 0, 1 / 30);
        assert.ok(afterImpulse > 0.96, `one-frame low impulse fell to ${String(afterImpulse)}`);
        const recovered = stepBloomFrequencyBlend(afterImpulse, 1, 1 / 30);
        assert.ok(recovered > afterImpulse && recovered <= 1);
    });

    it('uses media time, holds repeated timestamps, and primes after backward seeks', () => {
        const topology = createBloomFrequencyTopology(grid());
        const low = pixels(8, () => [128, 128, 128]);
        const high = pixels(8, (x, y) => (x + y) % 2 ? [255, 0, 0] : [0, 0, 255]);
        const controller = createBloomFrequencyController();
        assert.equal(controller.update(low, topology, 0).blend, 0);
        const attacked = controller.update(high, topology, 100).blend;
        assert.ok(attacked > 0 && attacked < 1);
        assert.equal(controller.update(high, topology, 100).blend, attacked);
        const decayed = controller.update(low, topology, 200).blend;
        assert.ok(decayed < attacked && decayed > 0);
        assert.equal(controller.update(low, topology, 50).blend, 0);
        controller.update(high, topology, 100);
        controller.reset();
        assert.equal(controller.update(low, topology, 1000).blend, 0);
    });

    it('pins low/high and scalar evaluator overrides exactly', () => {
        const topology = createBloomFrequencyTopology(grid());
        const flat = pixels(8, () => [128, 128, 128]);
        assert.equal(createBloomFrequencyController({ mode: 'high' }).update(flat, topology, 0).blend, 1);
        assert.equal(createBloomFrequencyController({ mode: 'low' }).update(flat, topology, 0).blend, 0);
        assert.equal(createBloomFrequencyController({ mode: 'high', blendOverride: 0.375 })
            .update(flat, topology, 0).blend, 0.375);
    });
});
