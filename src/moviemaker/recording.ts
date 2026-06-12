/**
 * Recording state machine for capturing LED color frames.
 */

import { getFrameIndex, flattenColorFrames } from './transforms';
import { download_binary_as_file } from '../common';
import type Swal from 'sweetalert2';

type SwalInstance = typeof Swal;

export function createRecording({ getSwal }: { getSwal?: () => Promise<SwalInstance> }) {
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
            download_binary_as_file(flat, `video${String(downloadIndex)}.rgb`);
            downloadIndex++;
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
