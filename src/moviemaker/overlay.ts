/**
 * Overlay drawing for the Video Maker's 2D canvas layer.
 */

import { getStripColors, stripStartEndLabels } from '../common';
import { gfxColors } from '../ui/theme';
import { createLabelRenderer } from '../label-render';
import { overlayLedRadius } from './transforms';
import { perfCount } from './perf';
import type { ParsedStrip, StripPoint } from '../types/domain';

// Stroking thousands of LED rings every frame is the single biggest
// main-thread/raster cost at 64x64 (4096 LEDs). The ring layer is rendered
// in translation-invariant space (rotate/zoom baked, both rare slider
// changes) into an offscreen canvas and blitted at the current translation
// offset, so dragging the shape never redraws the rings.
interface RingLayerEntry {
    pts: StripPoint[];
    rotate: number;
    zoom: number;
    strips: ParsedStrip[] | null;
    ledDiameter: number | null;
    showStripLabels: boolean;
    layer: HTMLCanvasElement;
    ox: number;
    oy: number;
}
const ringLayerCache = new WeakMap<CanvasRenderingContext2D, RingLayerEntry>();

function strokeRings(lctx: CanvasRenderingContext2D, transformedPts: StripPoint[], start: number, end: number, r: number, color: string) {
    lctx.strokeStyle = color;
    lctx.lineWidth = 1;
    lctx.beginPath();
    for (let i = start; i < end; i++) {
        const pt = transformedPts[i];
        if (!pt) continue;
        const [x, y] = pt;
        lctx.moveTo(x + r, y);
        lctx.arc(x, y, r, 0, Math.PI * 2);
    }
    lctx.stroke();
}

// Labels are laid out by the greedy engine (issue #28) so 16+ strip maps
// don't pile Start/End text at panel corners. Runs only on ring-layer
// rebuilds (rotate/zoom/strips changes), never per frame.
const labelRenderer = createLabelRenderer();

function drawStripLabels(lctx: CanvasRenderingContext2D, transformedPts: StripPoint[], strips: ParsedStrip[], r: number, colors: string[]) {
    const items: { id: string; text: string; anchorX: number; anchorY: number; color: string }[] = [];
    for (let si = 0; si < strips.length; si++) {
        const strip = strips[si];
        if (!strip) continue;
        const first = strip.offset;
        const last = strip.offset + strip.count - 1;
        if (first < 0 || last >= transformedPts.length || strip.count === 0) continue;
        const { start, end } = stripStartEndLabels(strip, si);
        const firstPt = transformedPts[first] ?? [0, 0];
        const lastPt = transformedPts[last] ?? [0, 0];
        items.push({ id: `start:${String(si)}`, text: start, anchorX: firstPt[0], anchorY: firstPt[1], color: colors[si] ?? 'white' });
        if (end !== null) {
            items.push({ id: `end:${String(si)}`, text: end, anchorX: lastPt[0], anchorY: lastPt[1], color: colors[si] ?? 'white' });
        }
    }
    labelRenderer.draw(lctx, items, {
        font: 'bold 12px monospace',
        obstacles: () => transformedPts.map(([x, y]) => ({ x: x - r, y: y - r, w: r * 2, h: r * 2 })),
    });
}

function getRingLayer(ctx: CanvasRenderingContext2D, localPts: StripPoint[], rotate: number, zoom: number, strips: ParsedStrip[] | null, ledDiameter: number | null, showStripLabels: boolean): RingLayerEntry {
    const cached = ringLayerCache.get(ctx);
    if (cached?.pts === localPts && cached.rotate === rotate &&
        cached.zoom === zoom && cached.strips === strips &&
        cached.ledDiameter === ledDiameter &&
        cached.showStripLabels === showStripLabels) {
        return cached;
    }
    perfCount('ringLayerRebuilds');

    const rad = rotate * Math.PI / 180;
    const cos_r = Math.cos(rad), sin_r = Math.sin(rad);
    const pts: StripPoint[] = localPts.map(([x, y]) => [
        (x * cos_r - y * sin_r) * zoom,
        (x * sin_r + y * cos_r) * zoom,
    ]);

    // Rotation preserves distances, so the ring radius only scales with zoom.
    const r = overlayLedRadius(localPts, zoom, ledDiameter);

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
    layer.width = Math.ceil(xmax) - Math.floor(xmin) + pad * 2;
    layer.height = Math.ceil(ymax) - Math.floor(ymin) + pad * 2;

    const lctx = layer.getContext('2d');
    if (!lctx) throw new Error('Failed to get 2D context for ring layer');
    lctx.translate(-ox, -oy);
    if (Array.isArray(strips) && strips.length > 1) {
        // Tint rings per strip so the physical wiring order is visible.
        const colors = getStripColors(strips.length);
        for (let si = 0; si < strips.length; si++) {
            const strip = strips[si];
            if (!strip) continue;
            const end = Math.min(strip.offset + strip.count, pts.length);
            strokeRings(lctx, pts, strip.offset, end, r, colors[si] ?? 'white');
        }
        if (showStripLabels) drawStripLabels(lctx, pts, strips, r, colors);
    } else {
        strokeRings(lctx, pts, 0, pts.length, r, 'white');
        if (showStripLabels && Array.isArray(strips) && strips.length === 1 && strips[0] !== undefined) {
            drawStripLabels(lctx, pts, strips, r, ['white']);
        }
    }

    const entry: RingLayerEntry = { pts: localPts, rotate, zoom, strips, ledDiameter, showStripLabels, layer, ox, oy };
    ringLayerCache.set(ctx, entry);
    return entry;
}

export function drawMoviemakerOverlay(
    ctx: CanvasRenderingContext2D,
    localPts: StripPoint[],
    rotate: number,
    zoom: number,
    translateX: number,
    translateY: number,
    lastSample: { rgbPts: Uint8Array; avgBri: number; oobCount?: number } | null,
    videoWidth: number,
    videoHeight: number,
    fps: number,
    showLeds = true,
    strips: ParsedStrip[] | null = null,
    ledDiameter: number | null = null,
    captureStats: { captured: number; skipped: number } | null = null,
    sourceFps: number | null = null,
    // Per-strip Start/End labels clutter the record preview on dense
    // multi-strip maps (issue #280), so the moviemaker overlay defaults them
    // off; the editor tools draw their own labels and are unaffected. Toggled
    // via the toolbar "Labels" checkbox.
    showStripLabels = false,
): void {
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    if (localPts.length === 0) return;

    if (showLeds) {
        const { layer, ox, oy } = getRingLayer(ctx, localPts, rotate, zoom, strips, ledDiameter, showStripLabels);
        ctx.drawImage(layer, translateX + ox, translateY + oy);
    }

    ctx.fillStyle = 'white';
    ctx.font = '12px monospace';
    // Two distinct clocks (#264/#265): `render` is this preview loop's rate;
    // `source` is the detected native frame rate of the video/webcam that
    // drives capture. They differ on purpose — a 29.97 source rendered on a
    // 60 fps loop is healthy, not a discrepancy.
    const srcText = sourceFps !== null ? ` · source: ${String(sourceFps)}` : '';
    ctx.fillText(`render: ${String(fps)}${srcText}`, 10, 14);
    if (lastSample) {
        const pct = Math.round(lastSample.avgBri * 100);
        ctx.fillText(`Avg Brightness: ${String(pct)}%`, 10, 28);
        // Out-of-bounds LEDs sample nothing and record black (#250). Their
        // overlay dots sit off-canvas (clipped invisible), so this line is
        // the user's only signal that zoom/pan pushed LEDs off the video.
        const oob = lastSample.oobCount ?? 0;
        if (oob > 0) {
            ctx.fillStyle = gfxColors.accentAmber();
            ctx.fillText(`⚠ ${String(oob)} LEDs outside video (adjust zoom/position)`, 10, 42);
        }
        // Live capture pacing during a recording (#256): frames appended and
        // source frames that were presented but never sampled. Amber the
        // moment anything is skipped — silent frame loss is the bug class
        // this line exists to prevent.
        if (captureStats) {
            const { captured, skipped } = captureStats;
            ctx.fillStyle = skipped > 0 ? gfxColors.accentAmber() : gfxColors.textStrong();
            const skipText = skipped > 0 ? ` (${String(skipped)} skipped!)` : '';
            ctx.fillText(`REC ${String(captured)} frames${skipText}`, 10, oob > 0 ? 56 : 42);
        }
    }
}
