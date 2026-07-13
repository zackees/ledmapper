/**
 * Pure logic functions for the Video Maker, extracted for testability.
 */

import { centerAndFitPoints } from '../common';
import type { StripPoint } from '../types/domain';

/**
 * Centers and scales points to fit within the given video dimensions.
 * Points are centered around origin (0,0) so that rotation works correctly.
 */
export function transformToCenter(pts: StripPoint[] | number[][], videoWidth: number, videoHeight: number): StripPoint[] {
    return centerAndFitPoints(pts as StripPoint[], videoWidth, videoHeight, {
        margin: 20,
        center: 'origin',
        pixelAlignScale: true,
    });
}

/**
 * Apply rotation, zoom, and translation to screenmap points.
 */
export function createTransformedScreenmap(screenmapPts: StripPoint[] | number[][], rotate: number, zoom: number, translate: [number, number]): StripPoint[] {
    if (screenmapPts.length === 0) return [];
    let pts: StripPoint[] = (screenmapPts as StripPoint[]).map(([x, y]) => [x, y]);
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
 */
export function getFrameIndex(nowUs: number, recordingStartUs: number, frameRate: number): number {
    const frameTimeUs = (1 / frameRate) * 1e6;
    // Add small epsilon to avoid floating-point floor errors at exact boundaries
    const raw = (nowUs - recordingStartUs) / frameTimeUs;
    return Math.floor(raw + 1e-9);
}

/**
 * Flatten accumulated color frames into a single Uint8Array.
 * Returns null if there are no frames.
 */
export function flattenColorFrames(colorFrames: Uint8Array[]): Uint8Array | null {
    if (colorFrames.length === 0) return null;
    let totalBytes = 0;
    colorFrames.forEach((f) => { totalBytes += f.length; });
    const flat = new Uint8Array(totalBytes);
    let offset = 0;
    colorFrames.forEach((f) => { flat.set(f, offset); offset += f.length; });
    return flat;
}

/**
 * Parse a resolution string like "640x480" into {width, height}.
 */
export function parseResolution(resStr: string): { width: number; height: number } {
    const parts = resStr.split('x');
    const w = parseInt(parts[0] ?? '0');
    const h = parseInt(parts[1] ?? '0');
    return { width: w, height: h };
}

/**
 * Compute the scaling factor for fitting points into a preview box.
 */
export function computePreviewFactor(pts: StripPoint[] | number[][], boxSize: number): number {
    if (pts.length === 0) return 1;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    (pts as StripPoint[]).forEach(([x, y]) => {
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
 */
export function samplePixels(readbackBuffer: Uint8Array, transformedPts: StripPoint[] | number[][], width: number, height: number): { rgbPts: Uint8Array; avgBri: number } {
    const numPts = transformedPts.length;
    const rgbPts = new Uint8Array(numPts * 3);
    let totalBri = 0;
    let inBoundsCount = 0;

    for (let i = 0; i < numPts; i++) {
        const pt = (transformedPts as StripPoint[])[i] ?? [0, 0];
        const x = Math.round(pt[0]);
        const y = Math.round(pt[1]);
        const flippedY = (height - 1) - y;

        if (x >= 0 && x < width && flippedY >= 0 && flippedY < height) {
            const idx = (flippedY * width + x) * 4;
            rgbPts[i * 3]     = readbackBuffer[idx] ?? 0;
            rgbPts[i * 3 + 1] = readbackBuffer[idx + 1] ?? 0;
            rgbPts[i * 3 + 2] = readbackBuffer[idx + 2] ?? 0;
            totalBri += (readbackBuffer[idx] ?? 0) + (readbackBuffer[idx + 1] ?? 0) + (readbackBuffer[idx + 2] ?? 0);
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
 */
export function extractGatherSample(gatherBuffer: Uint8Array, numPts: number, rgbPts: Uint8Array): { rgbPts: Uint8Array; avgBri: number; oobCount: number } {
    let totalBri = 0;
    let inBoundsCount = 0;

    for (let i = 0; i < numPts; i++) {
        const idx = i * 4;
        const o = i * 3;
        if ((gatherBuffer[idx + 3] ?? 0) >= 128) {
            const r = gatherBuffer[idx] ?? 0;
            const g = gatherBuffer[idx + 1] ?? 0;
            const b = gatherBuffer[idx + 2] ?? 0;
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
    // Surface the out-of-bounds count: at zoom > 1 whole edge columns fall
    // outside the video and silently go dark in the preview AND in
    // recordings; nothing else in the UI can tell the user why (#250).
    return { rgbPts, avgBri, oobCount: numPts - inBoundsCount };
}

/**
 * Build a flat-index -> video-channel map for multi-strip screenmaps that
 * declare an explicit `video_offset`. Returns null when every strip's
 * video_offset equals its flat offset (sequential case).
 */
export function buildVideoChannelMap(strips: { offset: number; count: number; video_offset?: number }[], totalCount: number): Int32Array | null {
    if (strips.length === 0) return null;
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
            map[s.offset + j] = (ch >= 0 && ch < totalCount) ? ch : (s.offset + j);
        }
    }
    return map;
}

/**
 * Compute FPS from frame timestamps.
 */
export function computeFps(nowMs: number, lastTimeMs: number): number {
    const delta = nowMs - lastTimeMs;
    if (delta <= 0) return 0;
    return Math.round(1000 / delta);
}

/**
 * Scale native dimensions so the larger side fits within maxDim.
 * Never upscales.
 */
export function scaleToMaxDimension(nativeW: number, nativeH: number, maxDim: number): { width: number; height: number } {
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
 */
export function estimateLedSize(pts: StripPoint[]): number {
    if (pts.length < 2) return 1.0;
    const a = pts[0] ?? [0, 0], b = pts[1] ?? [1, 0];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return Math.max(Math.sqrt(dx * dx + dy * dy), 1.0);
}

/**
 * Ring radius for the editor overlay: the screenmap's declared diameter
 * (already in localPts units) wins; the spacing heuristic is only a
 * fallback for maps that declare none — same precedence as the preview.
 */
export function overlayLedRadius(localPts: StripPoint[], zoom: number, ledDiameter: number | null): number {
    const dia = (typeof ledDiameter === 'number' && ledDiameter > 0)
        ? ledDiameter
        : estimateLedSize(localPts);
    return (dia * zoom) / 2;
}
