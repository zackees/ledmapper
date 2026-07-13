/**
 * Rendering watchdogs — log-only detectors for the "silent black canvas"
 * class of bug (issue #226 / #221 item 1). A logger can only record events
 * that happen; these watchdogs record the *absence* of expected activity:
 * a lost WebGL context, a video that stopped advancing, a render loop that
 * stopped ticking, or a recording readback that has gone all-zero.
 *
 * Design rules (see issue #226):
 *  - Every warning goes through `createLogger('watchdog').warn(event, data)`
 *    — never a bespoke scope, never console.* directly.
 *  - Log-only. No auto-remediation of any kind (no restarting loops,
 *    re-initializing pipelines, or reloading sources).
 *  - Each detector is armed only while the tab is visible AND the activity
 *    it watches is actually expected (playing, recording, etc.) — callers
 *    pass that as an `armed` boolean computed from their own state, and
 *    should reset detectors on `visibilitychange`/pause transitions so a
 *    background tab never accrues false "stalled" time.
 *  - False-positive discipline: every detector requires the condition to
 *    hold across multiple consecutive samples before it warns, and warns
 *    at most once per stall episode (until the condition clears and recurs)
 *    so a single dropped frame or GC pause never spams the log.
 *
 * Pure logic only (no DOM globals besides the `canvas` object handed to
 * `attachContextLossWatchdog`, which only needs `addEventListener` /
 * `removeEventListener` — satisfied by both HTMLCanvasElement and
 * OffscreenCanvas), so this module and its detectors are unit-testable
 * under plain Node. See tests/unit/watchdogs.test.ts.
 */

import { createLogger } from './debug-log.js';

const log = createLogger('watchdog');

/** Minimal surface `attachContextLossWatchdog` needs — satisfied by
 *  HTMLCanvasElement and OffscreenCanvas alike, and easy to fake in tests. */
export interface ContextLossCanvas {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * Wire `webglcontextlost` / `webglcontextrestored` on a canvas that hosts a
 * WebGL context. `preventDefault()` on the loss event is mandatory — without
 * it the browser never attempts to restore the context at all.
 *
 * Three.js re-uploads its own GPU resources (geometries, textures, programs)
 * automatically on restore. Custom pipelines built directly against the
 * WebGL context (e.g. moviemaker's blur/gather render targets) do NOT get
 * re-initialized here — that full recovery is out of scope for this issue;
 * this only makes the failure visible instead of silent.
 *
 * `tool` identifies which canvas this is in the log payload (e.g.
 * 'moviemaker-render', 'moviemaker-preview', 'gfx-core').
 */
export function attachContextLossWatchdog({ canvas, tool }: { canvas: ContextLossCanvas; tool: string }): () => void {
    function onLost(event: Event): void {
        event.preventDefault();
        log.warn('context-lost', { tool });
    }
    function onRestored(): void {
        log.warn('context-restored', { tool });
    }
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return function detach(): void {
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
    };
}

// ── Video-frame heartbeat ───────────────────────────────────────────────────

export interface VideoStallWatchdog {
    /** Call from a `requestVideoFrameCallback` callback (or `timeupdate`
     *  fallback) to mark that a real frame was observed since the last check. */
    noteFrame(): void;
    /** Call on a ~2s interval with the current sample. `armed` should be
     *  `false` whenever the tab is hidden, the source isn't playing, or the
     *  user is scrubbing — the watchdog treats that as "nothing to watch"
     *  and resets its stall clock rather than accruing false stall time. */
    check(armed: boolean, currentTime: number, readyState: number, networkState: number): void;
    /** Clear all state — call on pause / visibilitychange-to-hidden so a
     *  background tab doesn't warn the instant it's foregrounded again. */
    reset(): void;
    /** True unless a stall is currently being reported. */
    isHealthy(): boolean;
}

/**
 * Detects a video/webcam source whose `currentTime` has stopped advancing
 * while it's supposed to be playing. `video-source.ts` flips its `isPlaying`
 * flag optimistically on `play()`, so this heartbeat — not that flag — is
 * the ground truth for "is the video actually moving".
 *
 * Requires BOTH no observed frame (rVFC/timeupdate) AND an unchanged
 * `currentTime` across `stallThresholdMs` before warning, to keep a single
 * skipped rVFC tick from producing a false positive.
 */
export function createVideoStallWatchdog({
    stallThresholdMs = 4000,
    now = () => performance.now(),
}: { stallThresholdMs?: number; now?: () => number } = {}): VideoStallWatchdog {
    let lastCurrentTime: number | null = null;
    let stalledSinceMs: number | null = null;
    let frameObservedSinceStallStart = false;
    let warned = false;
    let stalledNow = false;

    function reset(): void {
        lastCurrentTime = null;
        stalledSinceMs = null;
        frameObservedSinceStallStart = false;
        warned = false;
        stalledNow = false;
    }

    function noteFrame(): void {
        frameObservedSinceStallStart = true;
    }

    function check(armed: boolean, currentTime: number, readyState: number, networkState: number): void {
        if (!armed) {
            reset();
            return;
        }
        const t = now();
        if (lastCurrentTime === null || currentTime !== lastCurrentTime) {
            lastCurrentTime = currentTime;
            stalledSinceMs = t;
            frameObservedSinceStallStart = false;
            warned = false;
            stalledNow = false;
            return;
        }
        stalledSinceMs ??= t;
        const stalledForMs = t - stalledSinceMs;
        stalledNow = !frameObservedSinceStallStart && stalledForMs >= stallThresholdMs;
        if (stalledNow && !warned) {
            warned = true;
            log.warn('video-stalled', { currentTime, readyState, networkState, stalledForMs: Math.round(stalledForMs) });
        }
    }

    function isHealthy(): boolean {
        return !stalledNow;
    }

    return { noteFrame, check, reset, isHealthy };
}

// ── RAF-loop heartbeat ──────────────────────────────────────────────────────

export interface RafHeartbeat {
    /** Call on a ~3s `setInterval` tick (never from `requestAnimationFrame`
     *  itself — a throttled/dead RAF loop wouldn't tick its own watchdog).
     *  `armed` gates on tab visibility + the loop's source being active. */
    check(armed: boolean, frameCount: number): void;
}

/**
 * Detects a render loop whose frame counter has stopped advancing while it
 * should be running. Watched from `setInterval` (per the Sentry-ANR
 * principle: watch from a different scheduler than the thing you're
 * watching) rather than `requestAnimationFrame`, since a throttled or dead
 * RAF loop would never tick a RAF-based watchdog either.
 *
 * Requires `staleTicksThreshold` consecutive unchanged ticks (default 2,
 * i.e. ~2x the interval) before warning, and warns once per stall episode.
 */
export function createRafHeartbeat({
    loop,
    staleTicksThreshold = 2,
}: { loop: string; staleTicksThreshold?: number }): RafHeartbeat {
    let lastCount: number | null = null;
    let staleTicks = 0;
    let warned = false;

    function check(armed: boolean, frameCount: number): void {
        if (!armed) {
            // Reset to "no baseline yet" (not `frameCount`) so the next armed
            // check always starts a fresh streak — otherwise a counter that
            // legitimately didn't move while unarmed (e.g. rendering paused
            // in a hidden tab) would look identical to a stall the instant
            // the tab is foregrounded again.
            lastCount = null;
            staleTicks = 0;
            warned = false;
            return;
        }
        if (lastCount === null || frameCount !== lastCount) {
            lastCount = frameCount;
            staleTicks = 0;
            warned = false;
            return;
        }
        staleTicks++;
        if (staleTicks >= staleTicksThreshold && !warned) {
            warned = true;
            log.warn('render-loop-stalled', { loop, frameCount });
        }
    }

    return { check };
}

// ── All-zero readback detection ─────────────────────────────────────────────

export interface ZeroReadbackWatchdog {
    /** Feed one recording frame's sample buffer. `videoHealthy` should come
     *  from the video-stall watchdog's `isHealthy()` — a genuinely stalled
     *  video repeating its last (possibly black) frame is that watchdog's
     *  story to tell, not this one's. */
    sample(buffer: Uint8Array, videoHealthy: boolean): void;
    /** Call when a new recording starts so the "once per recording" warning
     *  can fire again for the new session. */
    resetForNewRecording(): void;
}

/**
 * Detects a recording readback that has gone all-zero for many consecutive
 * frames — the WebRTC black-frame-detection pattern, and the one that would
 * have caught issue #221's silently-black moviemaker preview.
 *
 * Samples cheaply (every `strideBytes`th byte, default 16) rather than
 * scanning the whole buffer every frame.
 */
export function createZeroReadbackWatchdog({
    strideBytes = 16,
    consecutiveThreshold = 30,
}: { strideBytes?: number; consecutiveThreshold?: number } = {}): ZeroReadbackWatchdog {
    let consecutiveZero = 0;
    let warnedThisRecording = false;

    function isAllZeroStrided(buffer: Uint8Array): boolean {
        if (buffer.length === 0) return false;
        for (let i = 0; i < buffer.length; i += strideBytes) {
            if (buffer[i] !== 0) return false;
        }
        return true;
    }

    function sample(buffer: Uint8Array, videoHealthy: boolean): void {
        if (!videoHealthy) {
            // A stalled video repeating its last frame isn't this watchdog's
            // signal to raise — don't let that time count toward the streak.
            consecutiveZero = 0;
            return;
        }
        consecutiveZero = isAllZeroStrided(buffer) ? consecutiveZero + 1 : 0;
        if (consecutiveZero >= consecutiveThreshold && !warnedThisRecording) {
            warnedThisRecording = true;
            log.warn('readback-black', { consecutiveFrames: consecutiveZero });
        }
    }

    function resetForNewRecording(): void {
        consecutiveZero = 0;
        warnedThisRecording = false;
    }

    return { sample, resetForNewRecording };
}
