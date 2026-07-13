import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendPayload, extractGatherToRgb } from '../../src/moviemaker/offline-capture-frame';

describe('offline capture frame packing (#373)', () => {
    it('maps RGBA gather data into flat RGB and blackens OOB LEDs', () => {
        const gather = new Uint8Array([10, 20, 30, 255, 99, 99, 99, 0]);
        const result = extractGatherToRgb({ buffer: gather, numPts: 2 });
        assert.deepEqual([...result.rgbPts], [10, 20, 30, 0, 0, 0]);
        assert.equal(result.oobCount, 1);
    });

    it('writes mapped channels and rejects overflow or wrong frame sizes', () => {
        const result = extractGatherToRgb({ buffer: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), numPts: 2 }, new Int32Array([1, 0]));
        assert.deepEqual([...result.rgbPts], [4, 5, 6, 1, 2, 3]);
        const payload = new Uint8Array(6);
        appendPayload(payload, result.rgbPts, 0, 6);
        assert.deepEqual([...payload], [4, 5, 6, 1, 2, 3]);
        assert.throws(() => { appendPayload(payload, new Uint8Array(3), 0, 6); }, /frame-byte-count-mismatch/);
        assert.throws(() => { appendPayload(payload, result.rgbPts, 1, 6); }, /frame-count-overflow/);
    });
});
