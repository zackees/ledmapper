import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { snapFps, createFpsEstimator, createFrameSequencer } from '../../src/moviemaker/frame-pacing';
import { embedFps } from '../../src/moviemaker/recording';

// #256 / #255 Phase 1: the pacing logic that replaces the hardcoded-30fps
// wall-clock recording clock (measured: 60 fps sources captured at exactly
// 49% under the old pacing).

describe('snapFps', () => {
    it('snaps near-miss estimates onto common rates', () => {
        assert.equal(snapFps(59.3), 59.94); // within 2% of 59.94
        assert.equal(snapFps(60.4), 60);
        assert.equal(snapFps(29.7), 29.97);
        assert.equal(snapFps(30.2), 30);
        assert.equal(snapFps(24.1), 24);
        assert.equal(snapFps(23.9), 23.976);
    });

    it('keeps genuinely odd rates (rounded) instead of forcing a snap', () => {
        assert.equal(snapFps(42), 42);
        assert.equal(snapFps(15.337), 15.34);
    });

    it('defends against degenerate input', () => {
        assert.equal(snapFps(0), 30);
        assert.equal(snapFps(-5), 30);
        assert.equal(snapFps(Infinity), 30);
        assert.equal(snapFps(NaN), 30);
    });
});

describe('createFpsEstimator', () => {
    it('reports null until it has enough frames AND span', () => {
        const est = createFpsEstimator({ minFrames: 12, minSpanSec: 0.25 });
        for (let i = 0; i < 12; i++) est.sample(i, i / 60);
        // 11 frame deltas < 12 required
        assert.equal(est.estimate(), null);
        est.sample(15, 15 / 60);
        assert.equal(est.estimate(), 60);
    });

    it('is immune to rVFC callback throttling (uses counter ratio, not cadence)', () => {
        const est = createFpsEstimator();
        // Firefox-style: callbacks fire only every ~40ms but presentedFrames
        // still advances at the true 60 fps rate.
        for (let t = 0; t <= 1.0001; t += 0.04) {
            est.sample(Math.round(t * 60), t);
        }
        assert.equal(est.estimate(), 60);
    });

    it('resets on a mediaTime regression (seek / loop wrap)', () => {
        const est = createFpsEstimator({ minFrames: 4, minSpanSec: 0.05 });
        for (let i = 0; i < 30; i++) est.sample(i, i / 30);
        assert.equal(est.estimate(), 30);
        est.sample(31, 0.1); // loop wrapped — window re-seeds from this sample
        assert.equal(est.estimate(), null);
        for (let i = 1; i <= 10; i++) est.sample(31 + i, 0.1 + i / 30);
        assert.equal(est.estimate(), 30);
    });
});

describe('createFrameSequencer', () => {
    const US = 1e6;

    it('keyed path: records once per unique key and counts gaps as skips', () => {
        const seq = createFrameSequencer();
        assert.deepEqual(seq.next(10, 0, 0, 30), { record: true, skipped: 0, duplicate: false });
        // Same key again (RAF ticking faster than the source) — a duplicate.
        assert.deepEqual(seq.next(10, 0, 0, 30), { record: false, skipped: 0, duplicate: true });
        assert.deepEqual(seq.next(11, 0, 0, 30), { record: true, skipped: 0, duplicate: false });
        // Jump of 3 → 2 presented frames were never sampled.
        assert.deepEqual(seq.next(14, 0, 0, 30), { record: true, skipped: 2, duplicate: false });
        // Stale/duplicate key after the jump — ignored, flagged duplicate.
        assert.deepEqual(seq.next(13, 0, 0, 30), { record: false, skipped: 0, duplicate: true });
    });

    it('duplicate detection is key-based, never data-based (frozen source dedups; static-but-advancing does not)', () => {
        const seq = createFrameSequencer();
        // A paused source: the media-clock index floor(currentTime*fps) is
        // frozen at the same value → every repeat is a duplicate, withheld.
        assert.equal(seq.next(50, 0, 0, 30).record, true);
        for (let i = 0; i < 5; i++) {
            const d = seq.next(50, 0, 0, 30);
            assert.equal(d.record, false);
            assert.equal(d.duplicate, true);
        }
        // A playing-but-visually-static source advances its index every frame
        // even though the pixels never change — every frame records, none
        // dropped (the sequencer never sees pixels).
        for (let k = 51; k < 56; k++) {
            const d = seq.next(k, 0, 0, 30);
            assert.equal(d.record, true);
            assert.equal(d.duplicate, false);
        }
    });

    it('media-clock index keys behave identically (floor(currentTime*fps))', () => {
        const seq = createFrameSequencer();
        const idx = (tSec: number) => Math.floor(tSec * 30);
        // 30fps source sampled by a 60Hz loop: two ticks share each index.
        assert.equal(seq.next(idx(0.000), 0, 0, 30).record, true);    // idx 0
        assert.equal(seq.next(idx(0.016), 0, 0, 30).duplicate, true); // idx 0 again
        assert.equal(seq.next(idx(0.040), 0, 0, 30).record, true);    // idx 1
        assert.equal(seq.next(idx(0.055), 0, 0, 30).duplicate, true); // idx 1 again
    });

    it('wall-clock fallback (null key): one frame per 1/fps slot, no dup accounting', () => {
        const seq = createFrameSequencer();
        assert.equal(seq.next(null, 0, 0, 30).record, true);
        const dup = seq.next(null, 0.5 / 30 * US, 0, 30);
        assert.equal(dup.record, false);
        assert.equal(dup.duplicate, false); // fallback has no per-frame novelty
        assert.equal(seq.next(null, 1.02 / 30 * US, 0, 30).record, true);
        const jump = seq.next(null, 5 / 30 * US, 0, 30);
        assert.equal(jump.record, true);
        assert.equal(jump.skipped, 0); // fallback path cannot attribute gaps
    });

    it('reset() forgets the key history', () => {
        const seq = createFrameSequencer();
        seq.next(100, 0, 0, 30);
        seq.reset();
        assert.deepEqual(seq.next(5, 0, 0, 30), { record: true, skipped: 0, duplicate: false });
    });
});

describe('embedFps', () => {
    it('adds the spec-defined video.fps key to v1 and v2 screenmap JSON', () => {
        const v1 = JSON.stringify({ map: { s: { x: [0], y: [0] } } });
        const out1 = JSON.parse(embedFps(v1, 60)) as { map: unknown; video: { fps: number } };
        assert.equal(out1.video.fps, 60);
        assert.ok(out1.map);

        const v2 = JSON.stringify({ version: 2, segments: [{ id: 's', x: [0], y: [0] }] });
        const out2 = JSON.parse(embedFps(v2, 29.97)) as { version: number; video: { fps: number } };
        assert.equal(out2.video.fps, 29.97);
        assert.equal(out2.version, 2);
    });

    it('preserves other video.* keys and overwrites a stale fps', () => {
        const src = JSON.stringify({ map: {}, video: { fps: 30, other: 'x' } });
        const out = JSON.parse(embedFps(src, 60)) as { video: { fps: number; other: string } };
        assert.equal(out.video.fps, 60);
        assert.equal(out.video.other, 'x');
    });

    it('returns malformed input untouched rather than blocking a save', () => {
        assert.equal(embedFps('not json', 60), 'not json');
        assert.equal(embedFps('[1,2]', 60), '[1,2]');
    });
});
