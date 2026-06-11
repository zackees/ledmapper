/**
 * Overlay drawing for the Video Maker's 2D canvas layer.
 */

import { computePreviewFactor, estimateLedSize } from './transforms.js';

// Stroking thousands of LED rings every frame is the single biggest
// main-thread/raster cost at 64x64 (4096 LEDs). The ring layer only depends
// on the (memoized) points array and canvas size, so render it once into an
// offscreen canvas and blit it per frame; rebuild only when inputs change.
const ringLayerCache = new WeakMap();

function getRingLayer(ctx, transformedPts, videoWidth, videoHeight) {
    const cached = ringLayerCache.get(ctx);
    if (cached && cached.pts === transformedPts &&
        cached.w === videoWidth && cached.h === videoHeight) {
        return cached.layer;
    }

    const layer = cached ? cached.layer : document.createElement('canvas');
    layer.width = videoWidth;   // resizing also clears the layer
    layer.height = videoHeight;

    const lctx = layer.getContext('2d');
    const r = estimateLedSize(transformedPts) / 2;
    lctx.strokeStyle = 'white';
    lctx.lineWidth = 1;
    lctx.beginPath();
    for (let i = 0; i < transformedPts.length; i++) {
        const [x, y] = transformedPts[i];
        lctx.moveTo(x + r, y);
        lctx.arc(x, y, r, 0, Math.PI * 2);
    }
    lctx.stroke();

    ringLayerCache.set(ctx, { pts: transformedPts, w: videoWidth, h: videoHeight, layer });
    return layer;
}

/**
 * Draw the moviemaker overlay: LED position circles, mini preview, and status text.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number,number]>} transformedPts - Current LED positions in video coords.
 * @param {{ rgbPts: Uint8Array, avgBri: number }|null} lastSample - Most recent sampled data, or null.
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {number} fps - Current frames per second.
 */
export function drawMoviemakerOverlay(ctx, transformedPts, lastSample, videoWidth, videoHeight, fps, showLeds = true) {
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    if (transformedPts.length === 0) return;

    if (showLeds) {
        ctx.drawImage(getRingLayer(ctx, transformedPts, videoWidth, videoHeight), 0, 0);
    }

    ctx.fillStyle = 'white';
    ctx.font = '12px monospace';
    ctx.fillText(`FPS: ${fps}`, 10, 14);
    if (lastSample) {
        const pct = Math.round(lastSample.avgBri * 100);
        ctx.fillText(`Avg Brightness: ${pct}%`, 10, 28);
    }
}

/**
 * Draw the LED preview on a separate canvas.
 */
export function drawPreview(ctx, transformedPts, lastSample, side) {
    ctx.clearRect(0, 0, side, side);
    if (!lastSample || transformedPts.length === 0) return;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, side, side);

    let xavg = 0, yavg = 0;
    transformedPts.forEach(([x, y]) => {
        xavg += x; yavg += y;
    });
    xavg /= transformedPts.length;
    yavg /= transformedPts.length;
    const factor = computePreviewFactor(transformedPts, side);

    const previewLedSize = estimateLedSize(transformedPts) * factor;
    for (let i = 0; i < transformedPts.length; i++) {
        const px = (transformedPts[i][0] - xavg) * factor + side / 2;
        const py = (transformedPts[i][1] - yavg) * factor + side / 2;
        const idx = i * 3;
        const r = lastSample.rgbPts[idx];
        const g = lastSample.rgbPts[idx + 1];
        const b = lastSample.rgbPts[idx + 2];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px - previewLedSize / 2, py - previewLedSize / 2, previewLedSize, previewLedSize);
    }
}
