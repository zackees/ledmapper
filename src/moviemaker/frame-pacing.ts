/**
 * Frame pacing for recording (issue #256 / #255 Phase 1).
 *
 * Two pure, unit-testable pieces that fix the measured frame skipping:
 *
 * - `createFpsEstimator` — derives the SOURCE frame rate from
 *   requestVideoFrameCallback metadata instead of assuming 30 fps (a 60 fps
 *   video recorded at exactly 49% under the old wall-clock pacing). Uses the
 *   presentedFrames/mediaTime *ratio*, which stays correct even when rVFC
 *   callbacks themselves are throttled (Firefox clamps them to ~40 ms).
 *
 * - `createFrameSequencer` — decides, per gather sample, whether it starts a
 *   new recorded frame. Keyed on the video's `presentedFrames` counter when
 *   rVFC is available (one recorded frame per *presented source frame*,
 *   skips counted explicitly), falling back to the legacy wall-clock slot
 *   index otherwise (webcams without rVFC, old engines).
 */

import { getFrameIndex } from './transforms';

/** Common video rates; estimates within `tolerance` snap to these so a
 *  measured 29.93 records (and plays back) as clean 29.97. */
const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120];

/** Snap a raw fps estimate to the nearest common rate within `tolerance`
 *  (relative), else return the raw value rounded to 2 decimals. */
export function snapFps(raw: number, tolerance = 0.02): number {
    if (!isFinite(raw) || raw <= 0) return 30;
    // Nearest common rate, not first-within-tolerance: 60.0 must snap to 60,
    // not to its close neighbor 59.94 that happens to be listed first.
    let best = COMMON_RATES[0] ?? 30;
    let bestErr = Infinity;
    for (const rate of COMMON_RATES) {
        const err = Math.abs(raw - rate) / rate;
        if (err < bestErr) {
            bestErr = err;
            best = rate;
        }
    }
    if (bestErr <= tolerance) return best;
    return Math.round(raw * 100) / 100;
}

export interface FpsEstimator {
    /** Feed one rVFC metadata sample. */
    sample(presentedFrames: number, mediaTime: number): void;
    /** Snapped estimate, or null until enough frames have been observed. */
    estimate(): number | null;
    /** Drop all state (source change, seek discontinuity). */
    reset(): void;
}

/**
 * Estimate fps as (presentedFrames delta) / (mediaTime delta) across the
 * observation window. Requires `minFrames` presented frames AND `minSpanSec`
 * of media time before reporting, so one jittery inter-frame gap can't
 * produce a wild rate. Handles seeks/loops by resetting when mediaTime goes
 * backwards.
 */
export function createFpsEstimator({ minFrames = 12, minSpanSec = 0.25 }: { minFrames?: number; minSpanSec?: number } = {}): FpsEstimator {
    let first: { presented: number; mediaTime: number } | null = null;
    let last: { presented: number; mediaTime: number } | null = null;

    function reset(): void {
        first = null;
        last = null;
    }

    function sample(presentedFrames: number, mediaTime: number): void {
        if (last && (mediaTime < last.mediaTime || presentedFrames < last.presented)) {
            // Seek or loop wrap — the window no longer spans monotonic playback.
            reset();
        }
        const entry = { presented: presentedFrames, mediaTime };
        first ??= entry;
        last = entry;
    }

    function estimate(): number | null {
        if (!first || !last) return null;
        const frames = last.presented - first.presented;
        const span = last.mediaTime - first.mediaTime;
        if (frames < minFrames || span < minSpanSec) return null;
        return snapFps(frames / span);
    }

    return { sample, estimate, reset };
}

export interface SequencerDecision {
    /** True when this sample begins a new recorded frame. */
    record: boolean;
    /** Source frames that were presented but never sampled (gap since the
     *  previously recorded frame). Zero on the wall-clock fallback path. */
    skipped: number;
    /** True when this call repeats an already-recorded source frame — the
     *  same source-frame key seen again (a stalled/paused source, or RAF
     *  ticking faster than the source). Withheld to keep the recording
     *  duplicate-free (#266). NEVER decided by comparing sampled data:
     *  genuinely-identical source frames carry distinct keys and all record. */
    duplicate: boolean;
}

export interface FrameSequencer {
    /**
     * @param frameKey Monotonic per-source-frame key — rVFC `presentedFrames`
     *   when available, else the media-clock source-frame index
     *   `floor(currentTime * fps)` (both are SOURCE signals; #266). `null`
     *   only when no source signal exists at all, which falls back to
     *   wall-clock slot pacing.
     * @param nowUs / startUs / frameRate Wall-clock fallback inputs (same
     *   semantics as the legacy `getFrameIndex` pacing).
     */
    next(frameKey: number | null, nowUs: number, startUs: number, frameRate: number): SequencerDecision;
    reset(): void;
}

/** One recorded frame per unique source-frame key (or wall-clock slot), with
 *  explicit skip AND duplicate accounting on the keyed path. */
export function createFrameSequencer(): FrameSequencer {
    let lastKey = -1;
    let haveKey = false;

    function reset(): void {
        lastKey = -1;
        haveKey = false;
    }

    function next(frameKey: number | null, nowUs: number, startUs: number, frameRate: number): SequencerDecision {
        if (frameKey !== null) {
            if (!haveKey) {
                haveKey = true;
                lastKey = frameKey;
                return { record: true, skipped: 0, duplicate: false };
            }
            // Key hasn't advanced → same source frame → duplicate, withhold.
            if (frameKey <= lastKey) return { record: false, skipped: 0, duplicate: true };
            const skipped = frameKey - lastKey - 1;
            lastKey = frameKey;
            return { record: true, skipped, duplicate: false };
        }
        // Wall-clock fallback (no source signal at all): identical pacing to
        // the legacy path — no per-frame novelty, so no duplicate accounting.
        const idx = getFrameIndex(nowUs, startUs, frameRate);
        if (!haveKey) {
            haveKey = true;
            lastKey = idx;
            return { record: true, skipped: 0, duplicate: false };
        }
        if (idx <= lastKey) return { record: false, skipped: 0, duplicate: false };
        lastKey = idx;
        return { record: true, skipped: 0, duplicate: false };
    }

    return { next, reset };
}
