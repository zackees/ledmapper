/**
 * Canvas 2D consumer for the label-layout engine: measures label boxes,
 * runs the layout, then draws anchor dot + optional leader line + outlined
 * text per the issue #28 rendering spec.
 */

import { createLabelLayoutEngine } from './label-layout';
import type { LabelLayoutOptions, LabelPlacement } from './types/domain';
import { gfxColors, withAlpha } from './ui/theme';

interface LabelRenderItem {
    id: string;
    text: string;
    anchorX: number;
    anchorY: number;
    color: string;
    dotColor?: string;
    dotRadius?: number;
    priority?: number;
    opacity?: number;
}

interface LabelRenderOptions {
    font?: string;
    bounds?: LabelLayoutOptions['canvasBounds'];
    obstacles?: LabelLayoutOptions['obstacles'];
    textColor?: string;
}

interface MeasureResult { w: number; h: number; }

export function createLabelRenderer(engineOptions: LabelLayoutOptions = {}) {
    const engine = createLabelLayoutEngine(engineOptions);
    const measureCache = new Map<string, MeasureResult>();

    function measure(ctx: CanvasRenderingContext2D, text: string, font: string): MeasureResult {
        const key = font + ' ' + text;
        let m = measureCache.get(key);
        if (m === undefined) {
            ctx.font = font;
            const tm = ctx.measureText(text);
            const h = (tm.actualBoundingBoxAscent || 9) + (tm.actualBoundingBoxDescent || 3);
            m = { w: tm.width, h };
            measureCache.set(key, m);
        }
        return m;
    }

    function draw(ctx: CanvasRenderingContext2D, items: LabelRenderItem[], opts: LabelRenderOptions = {}): LabelPlacement[] {
        const font = opts.font ?? 'bold 13px "Outfit", system-ui, sans-serif';
        const labels = items.map((it) => {
            const m = measure(ctx, it.text, font);
            return { id: it.id, anchorX: it.anchorX, anchorY: it.anchorY, w: m.w, h: m.h, priority: it.priority ?? 0 };
        });
        const placements = engine.layout(labels, { canvasBounds: opts.bounds ?? null, obstacles: opts.obstacles ?? null });

        const prevAlpha = ctx.globalAlpha;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const p = placements[i];
            if (!it || !p) continue;
            const opacity = it.opacity ?? 1;

            // 1. Anchor dot — always, even when the label is hidden.
            ctx.globalAlpha = opacity;
            ctx.fillStyle = it.dotColor ?? it.color;
            ctx.beginPath();
            ctx.arc(p.anchorX, p.anchorY, it.dotRadius ?? 3, 0, Math.PI * 2);
            ctx.fill();

            if (p.hidden) continue;
            ctx.globalAlpha = (p.demoted ? 0.5 : 1) * opacity;

            // 2. Leader line from dot to the facing label-box edge midpoint.
            if (p.needsLeader) {
                ctx.strokeStyle = it.color;
                ctx.lineWidth = 1;
                const prevLineAlpha = ctx.globalAlpha;
                ctx.globalAlpha = prevLineAlpha * 0.7;
                ctx.beginPath();
                ctx.moveTo(p.leaderX0, p.leaderY0);
                ctx.lineTo(p.leaderX1, p.leaderY1);
                ctx.stroke();
                ctx.fillStyle = it.color;
                ctx.beginPath();
                ctx.arc(p.leaderX1, p.leaderY1, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = prevLineAlpha;
            }

            // 3. Outlined label text at the placed box.
            ctx.font = font;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = withAlpha(gfxColors.bgPopoverStrong(), 0.9);
            ctx.strokeText(it.text, p.labelX, p.labelY + p.h / 2);
            ctx.fillStyle = opts.textColor ?? it.color;
            ctx.fillText(it.text, p.labelX, p.labelY + p.h / 2);
        }
        ctx.globalAlpha = prevAlpha;
        return placements;
    }

    return { draw, engine, debugDump: () => engine.debugDump(), invalidate: () => { engine.invalidate(); } };
}
