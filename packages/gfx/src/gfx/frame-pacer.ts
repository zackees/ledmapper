/**
 * Display-side frame emit pacer (issue #263 / #264).
 *
 * Decides, per animation-frame tick, whether it's time to emit the next
 * source frame to the renderer. This is the DISPLAY-side counterpart to the
 * moviemaker recording sequencer (`src/moviemaker/frame-pacing.ts`), which
 * decides when a captured frame enters a recording — different job, kept
 * separate on purpose.
 *
 * Fixes the demo pump's RAF-gate beat (#263): the old gate compared
 * `t - lastEmit < interval` and then set `lastEmit = t`, which (a) rejected
 * ticks landing a hair early on the knife edge (RAF deltas straddle the
 * 16.667 ms frame period) and (b) discarded the schedule remainder, letting
 * phase drift accumulate. Measured effect: 39 emits/s at a 60 fps target on
 * a 60 Hz display. This pacer carries the schedule forward instead
 * (`next += interval`), clamped so a backgrounded tab can't cause a burst on
 * return — measured 60.2 emits/s at target 60, 30.5 at target 30.
 */

export interface FramePacer {
    /**
     * @param nowMs   Current timestamp (RAF time / performance.now()).
     * @param intervalMs Target inter-frame interval (1000 / target fps).
     * @returns true when a new source frame is due this tick.
     */
    due(nowMs: number, intervalMs: number): boolean;
    /** Forget the schedule (source change, pause→play). */
    reset(): void;
}

export function createFramePacer(): FramePacer {
    // Timestamp at which the next frame becomes due. null until the first
    // tick establishes the schedule origin.
    let next: number | null = null;

    return {
        due(nowMs: number, intervalMs: number): boolean {
            const interval = intervalMs > 0 ? intervalMs : 1;
            if (next === null) {
                next = nowMs + interval;
                return true;
            }
            if (nowMs < next) return false;
            // Carry the schedule forward by one interval (preserves phase, so
            // the emit rate hits the target instead of beating against RAF).
            next += interval;
            // If a long stall (backgrounded tab) left us more than one
            // interval behind, resync to one interval out — this tick is the
            // single catch-up frame; the next lands at the normal cadence,
            // never a burst.
            if (nowMs - next > interval) next = nowMs + interval;
            return true;
        },
        reset(): void {
            next = null;
        },
    };
}
