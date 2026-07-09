/**
 * Recording state machine for capturing LED color frames.
 *
 * Pacing (issue #256 / #255 Phase 1): one recorded frame per PRESENTED
 * source frame, keyed on requestVideoFrameCallback's `presentedFrames`
 * counter when the caller provides it — with explicit skip accounting —
 * falling back to the legacy wall-clock slot pacing otherwise. The
 * detected source fps is embedded in the FLED metadata so playback runs
 * at source speed.
 */

import { flattenColorFrames } from './transforms';
import { createFrameSequencer } from './frame-pacing';
import { download_binary_as_file } from '../common';
import { saveVideo } from '../video-store';
import { prependFledHeader, PixelFormat } from '../render/rgb-video';
import { createLogger } from '../debug-log';
import { createZeroReadbackWatchdog } from '../watchdogs';
import type Swal from 'sweetalert2';

const log = createLogger('recording');

type SwalInstance = typeof Swal;

export interface CaptureStats {
    /** Frames appended to the recording so far. */
    captured: number;
    /** Source frames presented but never sampled (rVFC-keyed path only). */
    skipped: number;
}

/**
 * Embed the recording frame rate into the FLED metadata JSON as the
 * spec-defined optional `video.fps` key (docs/fled-format.md "JSON
 * payload"). The metadata is a superset of the screenmap object; screenmap
 * parsers (v1/v2, FastLED's ScreenMap::ParseJson) ignore unknown keys.
 * Falls back to the raw screenmap text if it doesn't parse (never blocks
 * a save).
 */
export function embedFps(screenmapJson: string, fps: number): string {
    try {
        const obj = JSON.parse(screenmapJson) as unknown;
        if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
            const rec = obj as Record<string, unknown>;
            const video = (rec.video !== null && typeof rec.video === 'object' && !Array.isArray(rec.video))
                ? rec.video as Record<string, unknown>
                : {};
            video.fps = fps;
            rec.video = video;
            return JSON.stringify(rec);
        }
    } catch { /* malformed screenmap text — save it untouched */ }
    return screenmapJson;
}

export function createRecording({ getSwal, getScreenmapJson }: {
    getSwal?: () => Promise<SwalInstance>;
    /** Returns the current screenmap JSON string, or null if none loaded. */
    getScreenmapJson: () => string | null;
}) {
    let active = false;
    let capturing = false;
    let startTimeUs = 0;
    const colorFrames: Uint8Array[] = [];
    let downloadIndex = 0;
    const sequencer = createFrameSequencer();
    let skippedFrames = 0;
    // The fps to stamp into the file: the last frameRate seen while
    // capturing (the caller feeds the detected source rate per frame, so a
    // detection that stabilizes mid-recording still lands correctly).
    let recordedFps = 30;
    // Log-only watchdog (issue #226): flags a recording whose readback has
    // gone all-zero for many consecutive frames — the class of bug that let
    // #221's black moviemaker preview go unnoticed. Never auto-remediates.
    const zeroReadbackWatchdog = createZeroReadbackWatchdog();

    function timeMicros(): number {
        return Math.floor(performance.now() * 1000);
    }

    async function toggle(): Promise<boolean> {
        active = !active;
        if (!active) {
            await endRecording();
        }
        return active;
    }

    async function endRecording(): Promise<void> {
        if (skippedFrames > 0) {
            log.warn('frames-skipped', { skipped: skippedFrames, captured: colorFrames.length });
        }
        const flat = flattenColorFrames(colorFrames);
        if (flat === null) {
            log.info('save-failed', { reason: 'no-frames' });
            if (getSwal) {
                const swal = await getSwal();
                void swal.fire('No Frames', 'No frames were captured during recording.', 'warning');
            }
        } else {
            // Wrap the raw RGB payload in a FLED container so the screenmap
            // travels with the video. See docs/fled-format.md.
            const screenmapJson = getScreenmapJson();
            if (screenmapJson === null) {
                // The record button is gated on screenmapValid in moviemaker.ts,
                // so this is unreachable in normal use — guard so the cast
                // can't silently produce a headerless file.
                log.info('save-failed', { reason: 'no-screenmap-json', frames: colorFrames.length });
                if (getSwal) {
                    const swal = await getSwal();
                    void swal.fire('Recording could not be saved', 'The LED layout state was lost during recording — this is a bug. Re-select your layout (or re-upload your screenmap) and record again.', 'error');
                }
                return;
            }
            const fledFile = prependFledHeader(flat, embedFps(screenmapJson, recordedFps), PixelFormat.rgb8);
            log.info('save-fled', { frames: colorFrames.length, skipped: skippedFrames, fps: recordedFps, bytes: fledFile.byteLength });
            download_binary_as_file(fledFile, `video${String(downloadIndex)}.fled`);
            downloadIndex++;
            // Hand the freshly recorded video to the Movie Player via IndexedDB
            // so navigating there auto-loads it. Movie Player only accepts
            // FLED-formatted bytes — legacy headerless blobs are dropped on
            // startup.
            // IndexedDB persistence is best-effort: the user already has
            // the downloaded file; storage failure (quota, permission)
            // just means Movie Player won't auto-restore. Log so the
            // failure isn't completely silent. Issue #179.
            saveVideo(fledFile).catch((error: unknown) => {
                log.error('save-to-indexeddb-failed', { error: String(error) });
            });
        }
        colorFrames.length = 0;
        capturing = false;
        skippedFrames = 0;
        sequencer.reset();
    }

    /**
     * @param frameKey Monotonic per-presented-source-frame key (rVFC
     *   `presentedFrames`), or null to pace by wall clock at `frameRate`.
     * @param videoHealthy Ground-truth video-heartbeat health (see
     *   `createVideoStallWatchdog` in `../watchdogs`), used to suppress the
     *   all-zero readback watchdog while the video itself is already known
     *   to be stalled — that's a different bug with its own warning.
     *   Defaults to `true` (assume healthy) for callers that don't track it.
     */
    function processFrame(sample: { rgbPts: Uint8Array }, frameRate: number, videoHealthy = true, frameKey: number | null = null): void {
        if (!active) {
            if (capturing) {
                capturing = false;
                sequencer.reset();
            }
            return;
        }

        const nowUs = timeMicros();
        if (!capturing) {
            capturing = true;
            startTimeUs = nowUs;
            skippedFrames = 0;
            sequencer.reset();
            zeroReadbackWatchdog.resetForNewRecording();
        }
        recordedFps = frameRate;
        const { record, skipped } = sequencer.next(frameKey, nowUs, startTimeUs, frameRate);
        skippedFrames += skipped;
        if (record) {
            colorFrames.push(new Uint8Array(sample.rgbPts));
            zeroReadbackWatchdog.sample(sample.rgbPts, videoHealthy);
        }
    }

    function resetCapture(): void {
        if (capturing) {
            capturing = false;
            sequencer.reset();
        }
    }

    function getStats(): CaptureStats {
        return { captured: colorFrames.length, skipped: skippedFrames };
    }

    return {
        toggle,
        processFrame,
        resetCapture,
        getStats,
        get isActive() { return active; },
    };
}
