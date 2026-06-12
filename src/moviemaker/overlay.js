/**
 * Overlay drawing for the Video Maker's 2D canvas layer.
 */

import { getStripColors, stripStartEndLabels } from '../common.js';
import { createLabelRenderer } from '../label-render.js';
import { estimateLedSize } from './transforms.js';
import { perfCount } from './perf.js';

// Stroking thousands of LED rings every frame is the single biggest
// main-thread/raster cost at 64x64 (4096 LEDs). The ring layer is rendered
// in translation-invariant space (rotate/zoom baked, both rare slider
// changes) into an offscreen canvas and blitted at the current translation
// offset, so dragging the shape never redraws the rings.
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

// Labels are laid out by the greedy engine (issue #28) so 16+ strip maps
// don't pile Start/End text at panel corners. Runs only on ring-layer
// rebuilds (rotate/zoom/strips changes), never per frame.
const labelRenderer = createLabelRenderer();

function drawStripLabels(lctx, transformedPts, strips, r, colors) {
    const items = [];
    for (let si = 0; si < strips.length; si++) {
        const strip = strips[si];
        const first = strip.offset;
        const last = strip.offset + strip.count - 1;
        if (first < 0 || last >= transformedPts.length || strip.count === 0) continue;
        const { start, end } = stripStartEndLabels(strip, si);
        items.push({ id: 'start:' + si, text: start, anchorX: transformedPts[first][0], anchorY: transformedPts[first][1], color: colors[si] });
        if (end !== null) {
            items.push({ id: 'end:' + si, text: end, anchorX: transformedPts[last][0], anchorY: transformedPts[last][1], color: colors[si] });
        }
    }
    labelRenderer.draw(lctx, items, {
        font: 'bold 12px monospace',
        obstacles: () => transformedPts.map(([x, y]) => ({ x: x - r, y: y - r, w: r * 2, h: r * 2 })),
    });
}

function getRingLayer(ctx, localPts, rotate, zoom, strips) {
    const cached = ringLayerCache.get(ctx);
    if (cached && cached.pts === localPts && cached.rotate === rotate &&
        cached.zoom === zoom && cached.strips === strips) {
        return cached;
    }
    perfCount('ringLayerRebuilds');

    const rad = rotate * Math.PI / 180;
    const cos_r = Math.cos(rad), sin_r = Math.sin(rad);
    const pts = localPts.map(([x, y]) => [
        (x * cos_r - y * sin_r) * zoom,
        (x * sin_r + y * cos_r) * zoom,
    ]);

    // Rotation preserves distances, so the ring radius only scales with zoom.
    const r = (estimateLedSize(localPts) * zoom) / 2;

    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const [x, y] of pts) {
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
    }
    // Pad for the ring stroke plus strip-label text overhang.
    const pad = Math.ceil(r) + 80;
    const ox = Math.floor(xmin) - pad;
    const oy = Math.floor(ymin) - pad;

    const layer = cached ? cached.layer : document.createElement('canvas');
    layer.width = Math.ceil(xmax) - Math.floor(xmin) + pad * 2;  // resizing also clears the layer
    layer.height = Math.ceil(ymax) - Math.floor(ymin) + pad * 2;

    const lctx = layer.getContext('2d');
    lctx.translate(-ox, -oy);
    const multiStrip = Array.isArray(strips) && strips.length > 1;

    if (multiStrip) {
        // Tint rings per strip so the physical wiring order is visible.
        const colors = getStripColors(strips.length);
        for (let si = 0; si < strips.length; si++) {
            const strip = strips[si];
            const end = Math.min(strip.offset + strip.count, pts.length);
            strokeRings(lctx, pts, strip.offset, end, r, colors[si]);
        }
        drawStripLabels(lctx, pts, strips, r, colors);
    } else {
        strokeRings(lctx, pts, 0, pts.length, r, 'white');
        if (Array.isArray(strips) && strips.length === 1) {
            drawStripLabels(lctx, pts, strips, r, ['white']);
        }
    }

    const entry = { pts: localPts, rotate, zoom, strips, layer, ox, oy };
    ringLayerCache.set(ctx, entry);
    return entry;
}

/**
 * Draw the moviemaker overlay: LED position circles, mini preview, and status text.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[number,number]>} localPts - LED positions in screenmap-local coords.
 * @param {number} rotate - rotation in degrees
 * @param {number} zoom - zoom factor
 * @param {number} translateX - translation x in video coords
 * @param {number} translateY - translation y in video coords
 * @param {{ rgbPts: Uint8Array, avgBri: number }|null} lastSample - Most recent sampled data, or null.
 * @param {number} videoWidth
 * @param {number} videoHeight
 * @param {number} fps - Current frames per second.
 * @param {boolean} [showLeds=true] - Whether to draw the LED ring layer.
 * @param {Array<{name:string, offset:number, count:number}>} [strips] - Strip metadata for tinting/labels.
 */
export function drawMoviemakerOverlay(ctx, localPts, rotate, zoom, translateX, translateY, lastSample, videoWidth, videoHeight, fps, showLeds = true, strips = null) {
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    if (localPts.length === 0) return;

    if (showLeds) {
        const { layer, ox, oy } = getRingLayer(ctx, localPts, rotate, zoom, strips);
        ctx.drawImage(layer, translateX + ox, translateY + oy);
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
 * Draw the LED preview on a separate canvas. The preview self-centers and
 * self-scales, so translation and zoom cancel out — only rotation affects
 * the rendered layout. Rotation is applied inline (no per-frame array
 * allocation).
 */
export function drawPreview(ctx, localPts, rotate, lastSample, side) {
    ctx.clearRect(0, 0, side, side);
    if (!lastSample || localPts.length === 0) return;

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, side, side);

    const rad = rotate * Math.PI / 180;
    const cos_r = Math.cos(rad), sin_r = Math.sin(rad);
    let xavg = 0, yavg = 0;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x0, y0] of localPts) {
        const x = x0 * cos_r - y0 * sin_r;
        const y = x0 * sin_r + y0 * cos_r;
        xavg += x; yavg += y;
        if (x < xmin) xmin = x;
        if (x > xmax) xmax = x;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
    }
    xavg /= localPts.length;
    yavg /= localPts.length;
    const maxSpan = Math.max(xmax - xmin, ymax - ymin);
    const factor = (maxSpan > 0 ? side / maxSpan : 1) * 0.8;

    const previewLedSize = estimateLedSize(localPts) * factor;
    for (let i = 0; i < localPts.length; i++) {
        const [x0, y0] = localPts[i];
        const px = (x0 * cos_r - y0 * sin_r - xavg) * factor + side / 2;
        const py = (x0 * sin_r + y0 * cos_r - yavg) * factor + side / 2;
        const idx = i * 3;
        const r = lastSample.rgbPts[idx];
        const g = lastSample.rgbPts[idx + 1];
        const b = lastSample.rgbPts[idx + 2];
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px - previewLedSize / 2, py - previewLedSize / 2, previewLedSize, previewLedSize);
    }
}
