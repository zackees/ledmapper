/**
 * Recording state machine for capturing LED color frames.
 */

import { getFrameIndex, flattenColorFrames } from './transforms';
import { download_binary_as_file } from '../common';
import { saveVideo } from '../video-store';
import { prependFledHeader, PixelFormat } from '../render/rgb-video';
import { createLogger } from '../debug-log';
import { createZeroReadbackWatchdog } from '../watchdogs';
import type Swal from 'sweetalert2';

const log = createLogger('recording');

type SwalInstance = typeof Swal;

export function createRecording({ getSwal, getScreenmapJson }: {
    getSwal?: () => Promise<SwalInstance>;
    /** Returns the current screenmap JSON string, or null if none loaded. */
    getScreenmapJson: () => string | null;
}) {
    let active = false;
    let capturing = false;
    let startTimeUs = 0;
    let lastFrameIdx = -1;
    const colorFrames: Uint8Array[] = [];
    let downloadIndex = 0;
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
            const fledFile = prependFledHeader(flat, screenmapJson, PixelFormat.rgb8);
            log.info('save-fled', { frames: colorFrames.length, bytes: fledFile.byteLength });
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
        lastFrameIdx = -1;
    }

    /**
     * @param videoHealthy Ground-truth video-heartbeat health (see
     *   `createVideoStallWatchdog` in `../watchdogs`), used to suppress the
     *   all-zero readback watchdog while the video itself is already known
     *   to be stalled — that's a different bug with its own warning.
     *   Defaults to `true` (assume healthy) for callers that don't track it.
     */
    function processFrame(sample: { rgbPts: Uint8Array }, frameRate: number, videoHealthy = true): void {
        if (!active) {
            if (capturing) {
                capturing = false;
                lastFrameIdx = -1;
            }
            return;
        }

        const nowUs = timeMicros();
        if (!capturing) {
            capturing = true;
            startTimeUs = nowUs;
            lastFrameIdx = -1;
            zeroReadbackWatchdog.resetForNewRecording();
        }
        const frameIdx = getFrameIndex(nowUs, startTimeUs, frameRate);
        if (frameIdx > lastFrameIdx) {
            lastFrameIdx = frameIdx;
            colorFrames.push(new Uint8Array(sample.rgbPts));
            zeroReadbackWatchdog.sample(sample.rgbPts, videoHealthy);
        }
    }

    function resetCapture(): void {
        if (capturing) {
            capturing = false;
            lastFrameIdx = -1;
        }
    }

    return {
        toggle,
        processFrame,
        resetCapture,
        get isActive() { return active; },
    };
}
