/**
 * Recording state machine for capturing LED color frames.
 */

import { getFrameIndex, flattenColorFrames } from './transforms';
import { download_binary_as_file } from '../common';
import { saveVideo } from '../video-store';
import { prependFledHeader, PixelFormat } from '../render/rgb-video';
import type Swal from 'sweetalert2';

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
                if (getSwal) {
                    const swal = await getSwal();
                    void swal.fire('No Screenmap', 'A screenmap must be loaded before saving — open the Screenmap Editor first.', 'error');
                }
                return;
            }
            const fledFile = prependFledHeader(flat, screenmapJson, PixelFormat.rgb8);
            download_binary_as_file(fledFile, `video${String(downloadIndex)}.fled`);
            downloadIndex++;
            // Hand the freshly recorded video to the Movie Player via IndexedDB
            // so navigating there auto-loads it. Movie Player only accepts
            // FLED-formatted bytes — legacy headerless blobs are dropped on
            // startup.
            void saveVideo(fledFile);
        }
        colorFrames.length = 0;
        capturing = false;
        lastFrameIdx = -1;
    }

    function processFrame(sample: { rgbPts: Uint8Array }, frameRate: number): void {
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
        }
        const frameIdx = getFrameIndex(nowUs, startTimeUs, frameRate);
        if (frameIdx > lastFrameIdx) {
            lastFrameIdx = frameIdx;
            colorFrames.push(new Uint8Array(sample.rgbPts));
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
