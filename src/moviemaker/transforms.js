/**
 * Pure logic functions for the Video Maker, extracted for testability.
 */

import { centerAndFitPoints } from '../common.js';

/**
 * Centers and scales points to fit within the given video dimensions.
 * Points are centered around origin (0,0) so that rotation works correctly.
 *
 * @param {Array<[number,number]>} pts - raw screenmap points
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @returns {Array<[number,number]>} transformed points centered around (0,0)
 */
export function transformToCenter(pts, videoWidth, videoHeight) {
    return centerAndFitPoints(pts, videoWidth, videoHeight, { margin: 20, center: 'origin' });
}

/**
 * Apply rotation, zoom, and translation to screenmap points.
 *
 * @param {Array<[number,number]>} screenmapPts - points centered around (0,0)
 * @param {number} rotate - rotation in degrees
 * @param {number} zoom - zoom factor
 * @param {[number,number]} translate - [x, y] translation (canvas center)
 * @returns {Array<[number,number]>}
 */
export function createTransformedScreenmap(screenmapPts, rotate, zoom, translate) {
    if (screenmapPts.length === 0) return [];
    let pts = screenmapPts.map(([x, y]) => [x, y]);
    if (rotate !== 0) {
        const r = rotate * Math.PI / 180;
        const cos_r = Math.cos(r), sin_r = Math.sin(r);
        pts = pts.map(([x, y]) => [x * cos_r - y * sin_r, x * sin_r + y * cos_r]);
    }
    pts = pts.map(([x, y]) => [
        x * zoom + translate[0],
        y * zoom + translate[1]
    ]);
    return pts;
}

/**
 * Calculate frame index from timing.
 *
 * @param {number} nowUs - current time in microseconds
 * @param {number} recordingStartUs - recording start time in microseconds
 * @param {number} frameRate - target FPS
 * @returns {number} frame index (0-based)
 */
export function getFrameIndex(nowUs, recordingStartUs, frameRate) {
    const frameTimeUs = (1 / frameRate) * 1e6;
    // Add small epsilon to avoid floating-point floor errors at exact boundaries
    // e.g. Math.floor(4.999999999999999) should be 5, not 4
    const raw = (nowUs - recordingStartUs) / frameTimeUs;
    return Math.floor(raw + 1e-9);
}

/**
 * Flatten accumulated color frames into a single Uint8Array.
 * Returns null if there are no frames (caller should handle this case).
 *
 * @param {Uint8Array[]} colorFrames
 * @returns {Uint8Array|null}
 */
export function flattenColorFrames(colorFrames) {
    if (colorFrames.length === 0) return null;
    let totalBytes = 0;
    colorFrames.forEach(f => { totalBytes += f.length; });
    const flat = new Uint8Array(totalBytes);
    let offset = 0;
    colorFrames.forEach(f => { flat.set(f, offset); offset += f.length; });
    return flat;
}

/**
 * Parse a resolution string like "640x480" into {width, height}.
 *
 * @param {string} resStr
 * @returns {{width: number, height: number}}
 */
export function parseResolution(resStr) {
    const [w, h] = resStr.split('x').map(n => parseInt(n));
    return { width: w, height: h };
}

/**
 * Compute the scaling factor for fitting points into a preview box.
 *
 * @param {Array<[number,number]>} pts - transformed LED positions
 * @param {number} boxSize - side length of the square preview box
 * @returns {number} scaling factor (includes 0.8 margin)
 */
export function computePreviewFactor(pts, boxSize) {
    if (pts.length === 0) return 1;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    pts.forEach(([x, y]) => {
        xmin = Math.min(x, xmin); xmax = Math.max(x, xmax);
        ymin = Math.min(y, ymin); ymax = Math.max(y, ymax);
    });
    const xspan = xmax - xmin;
    const yspan = ymax - ymin;
    const maxSpan = Math.max(xspan, yspan);
    const factor = maxSpan > 0 ? boxSize / maxSpan : 1;
    return factor * 0.8;
}

/**
 * Sample pixel values from a readback buffer at transformed LED positions.
 *
 * @param {Uint8Array} readbackBuffer - RGBA pixel data (WebGL: Y=0 is bottom)
 * @param {Array<[number,number]>} transformedPts - LED positions in video coords
 * @param {number} width - buffer width
 * @param {number} height - buffer height
 * @returns {{rgbPts: Uint8Array, avgBri: number}}
 */
export function samplePixels(readbackBuffer, transformedPts, width, height) {
    const numPts = transformedPts.length;
    const rgbPts = new Uint8Array(numPts * 3);
    let totalBri = 0;
    let inBoundsCount = 0;

    for (let i = 0; i < numPts; i++) {
        const x = Math.round(transformedPts[i][0]);
        const y = Math.round(transformedPts[i][1]);
        const flippedY = (height - 1) - y;

        if (x >= 0 && x < width && flippedY >= 0 && flippedY < height) {
            const idx = (flippedY * width + x) * 4;
            rgbPts[i * 3]     = readbackBuffer[idx];
            rgbPts[i * 3 + 1] = readbackBuffer[idx + 1];
            rgbPts[i * 3 + 2] = readbackBuffer[idx + 2];
            totalBri += readbackBuffer[idx] + readbackBuffer[idx + 1] + readbackBuffer[idx + 2];
            inBoundsCount++;
        }
    }
    const avgBri = inBoundsCount > 0 ? totalBri / (inBoundsCount * 3 * 255) : 0;
    return { rgbPts, avgBri };
}

/**
 * Extract LED colors from a GPU gather-pass readback buffer.
 * Texel i corresponds to LED i; alpha 0 marks an out-of-bounds LED
 * (rendered black, excluded from the brightness average).
 *
 * @param {Uint8Array} gatherBuffer - RGBA readback from the gather target
 * @param {number} numPts - LED count (≤ buffer texel count)
 * @param {Uint8Array} rgbPts - output buffer of length numPts * 3 (reused)
 * @returns {{rgbPts: Uint8Array, avgBri: number}}
 */
export function extractGatherSample(gatherBuffer, numPts, rgbPts) {
    let totalBri = 0;
    let inBoundsCount = 0;

    for (let i = 0; i < numPts; i++) {
        const idx = i * 4;
        const o = i * 3;
        if (gatherBuffer[idx + 3] >= 128) {
            const r = gatherBuffer[idx];
            const g = gatherBuffer[idx + 1];
            const b = gatherBuffer[idx + 2];
            rgbPts[o]     = r;
            rgbPts[o + 1] = g;
            rgbPts[o + 2] = b;
            totalBri += r + g + b;
            inBoundsCount++;
        } else {
            rgbPts[o] = 0;
            rgbPts[o + 1] = 0;
            rgbPts[o + 2] = 0;
        }
    }
    const avgBri = inBoundsCount > 0 ? totalBri / (inBoundsCount * 3 * 255) : 0;
    return { rgbPts, avgBri };
}

/**
 * Build a flat-index -> video-channel map for multi-strip screenmaps that
 * declare an explicit `video_offset`. Strip s's LED j occupies frame channel
 * `video_offset + j` in the .rgb stream. Returns null when every strip's
 * video_offset equals its flat offset (the common sequential case), so
 * callers can skip remapping entirely.
 *
 * Shared by the moviemaker recording path and the movieplayer playback path
 * so both sides of the .rgb format always agree.
 *
 * @param {Array<{offset:number, count:number, video_offset:number}>} strips
 * @param {number} totalCount - total LED count across all strips
 * @returns {Int32Array|null} map[flatIndex] = channelIndex, or null if identity
 */
export function buildVideoChannelMap(strips, totalCount) {
    if (!strips || strips.length === 0) return null;
    let sequential = true;
    for (const s of strips) {
        const vo = typeof s.video_offset === 'number' ? s.video_offset : s.offset;
        if (vo !== s.offset) { sequential = false; break; }
    }
    if (sequential) return null;
    const map = new Int32Array(totalCount);
    for (const s of strips) {
        const vo = typeof s.video_offset === 'number' ? s.video_offset : s.offset;
        for (let j = 0; j < s.count; j++) {
            const ch = vo + j;
            // Out-of-range channel declarations fall back to the flat index
            // rather than corrupting neighbouring strips.
            map[s.offset + j] = (ch >= 0 && ch < totalCount) ? ch : (s.offset + j);
        }
    }
    return map;
}

/**
 * Compute FPS from frame timestamps.
 *
 * @param {number} nowMs - current time in ms
 * @param {number} lastTimeMs - previous frame time in ms
 * @returns {number} frames per second (integer)
 */
export function computeFps(nowMs, lastTimeMs) {
    const delta = nowMs - lastTimeMs;
    if (delta <= 0) return 0;
    return Math.round(1000 / delta);
}

/**
 * Scale native dimensions so the larger side fits within maxDim.
 * Never upscales — if both sides are already within maxDim, returns native.
 * A maxDim of 0 means "native" (no scaling).
 *
 * @param {number} nativeW
 * @param {number} nativeH
 * @param {number} maxDim - maximum pixels for the larger dimension (0 = native)
 * @returns {{width: number, height: number}}
 */
export function scaleToMaxDimension(nativeW, nativeH, maxDim) {
    if (maxDim <= 0) return { width: nativeW, height: nativeH };
    const maxNative = Math.max(nativeW, nativeH);
    if (maxNative <= maxDim) return { width: nativeW, height: nativeH };
    const scale = maxDim / maxNative;
    return {
        width: Math.max(1, Math.round(nativeW * scale)),
        height: Math.max(1, Math.round(nativeH * scale)),
    };
}

/**
 * Estimate LED diameter from the first two points.
 * Returns the distance between them, with a minimum of 1.0.
 *
 * @param {Array<[number,number]>} pts
 * @returns {number}
 */
export function estimateLedSize(pts) {
    if (pts.length < 2) return 1.0;
    const a = pts[0], b = pts[1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.max(Math.sqrt(dx * dx + dy * dy), 1.0);
}
