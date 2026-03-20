/**
 * Recording state machine for capturing LED color frames.
 */

import { getFrameIndex, flattenColorFrames } from './transforms.js';
import { download_binary_as_file } from '../common.js';

/**
 * Create a recording manager.
 *
 * @param {Object} opts
 * @param {function(): Promise<{fire: function}>} opts.getSwal - Async function returning SweetAlert2 instance.
 * @returns {Object} Recording API
 */
export function createRecording({ getSwal }) {
    let active = false;
    let capturing = false;
    let startTimeUs = 0;
    let lastFrameIdx = -1;
    let colorFrames = [];
    let downloadIndex = 0;

    function timeMicros() {
        return Math.floor(performance.now() * 1000);
    }

    /**
     * Toggle recording on/off. When stopping, triggers download.
     *
     * @returns {boolean} New active state.
     */
    async function toggle() {
        active = !active;
        if (!active) {
            await endRecording();
        }
        return active;
    }

    async function endRecording() {
        const flat = flattenColorFrames(colorFrames);
        if (flat === null) {
            const swal = await getSwal();
            swal.fire('No Frames', 'No frames were captured during recording.', 'warning');
        } else {
            download_binary_as_file(flat, `video${downloadIndex}.rgb`);
            downloadIndex++;
        }
        colorFrames = [];
        capturing = false;
        lastFrameIdx = -1;
    }

    /**
     * Process a frame during recording. Should be called every animation frame
     * when a valid sample is available.
     *
     * @param {{ rgbPts: Uint8Array }} sample - The sampled pixel data.
     * @param {number} frameRate - Current target FPS.
     */
    function processFrame(sample, frameRate) {
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

    /**
     * Reset recording state when no valid readback is happening.
     */
    function resetCapture() {
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
