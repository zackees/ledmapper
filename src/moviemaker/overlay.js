/**
 * Overlay drawing for the Video Maker's 2D canvas layer.
 */

import { getStripColors, stripStartEndLabels } from '../common.js';
import { computePreviewFactor, estimateLedSize } from './transforms.js';

// Stroking thousands of LED rings every frame is the single biggest
// main-thread/raster cost at 64x64 (4096 LEDs). The ring layer only depends
// on the (memoized) points array, strip metadata, and canvas size, so render
// it once into an offscreen canvas and blit it per frame; rebuild only when
// inputs change.
const ringLayerCache = new WeakMap();

function strokeRings(lctx, transformedPts, start, end, r, color) {
    lctx.strokeStyle = color;
    lctx.lineWidth = 1;
    lctx.beginPath();
    for (let i = start; i < end; i++) {
        const [x, y] = transformedPts[i];
        lctx.moveTo(x + r, y);
        lctx.arc(x, y, r, 0, Math.PI * 2);
    }
    lctx.stroke();
}

function drawStripLabel(lctx, text, pt, r, color) {
    const x = pt[0] + r + 3;
    const y = pt[1] - r - 3;
    lctx.font = 'bold 12px monospace';
    lctx.textAlign = 'left';
    lctx.textBaseline = 'bottom';
    lctx.lineWidth = 3;
    lctx.strokeStyle = 'black';
    lctx.strokeText(text, x, y);
    lctx.fillStyle = color;
    lctx.fillText(text, x, y);
}

function drawStripLabels(lctx, transformedPts, strips, r, colors) {
    for (let si = 0; si < strips.length; si++) {
        const strip = strips[si];
        const first = strip.offset;
        const last = strip.offset + strip.count - 1;
        if (first < 0 || last >= transformedPts.length || strip.count === 0) continue;
        const { start, end } = stripStartEndLabels(strip, si);
        drawStripLabel(lctx, start, transformedPts[first], r, colors[si]);
        if (end !== null) {
            drawStripLabel(lctx, end, transformedPts[last], r, colors[si]);
        }
    }
}

function getRingLayer(ctx, transformedPts, videoWidth, videoHeight, strips) {
    const cached = ringLayerCache.get(ctx);
    if (cached && cached.pts === transformedPts && cached.strips === strips &&
        cached.w === videoWidth && cached.h === videoHeight) {
        return cached.layer;
    }

    const layer = cached ? cached.layer : document.createElement('canvas');
    layer.width = videoWidth;   // resizing also clears the layer
    layer.height = videoHeight;

    const lctx = layer.getContext('2d');
    const r = estimateLedSize(transformedPts) / 2;
    const multiStrip = Array.isArray(strips) && strips.length > 1;

    if (multiStrip) {
        // Tint rings per strip so the physical wiring order is visible.
        const colors = getStripColors(strips.length);
        for (let si = 0; si < strips.length; si++) {
            const strip = strips[si];
            const end = Math.min(strip.offset + strip.count, transformedPts.length);
            strokeRings(lctx, transformedPts, strip.offset, end, r, colors[si]);
        }
        drawStripLabels(lctx, transformedPts, strips, r, colors);
    } else {
        strokeRings(lctx, transformedPts, 0, transformedPts.length, r, 'white');
        if (Array.isArray(strips) && strips.length === 1) {
            drawStripLabels(lctx, transformedPts, strips, r, ['white']);
        }
    }

    ringLayerCache.set(ctx, { pts: transformedPts, strips, w: videoWidth, h: videoHeight, layer });
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
 * @param {boolean} [showLeds=true] - Whether to draw the LED ring layer.
 * @param {Array<{name:string, offset:number, count:number}>} [strips] - Strip metadata for tinting/labels.
 */
export function drawMoviemakerOverlay(ctx, transformedPts, lastSample, videoWidth, videoHeight, fps, showLeds = true, strips = null) {
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    if (transformedPts.length === 0) return;

    if (showLeds) {
        ctx.drawImage(getRingLayer(ctx, transformedPts, videoWidth, videoHeight, strips), 0, 0);
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
