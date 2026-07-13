// Named ShapeEditor method bundle: rulers.
import type { ShapeEditor } from './shapeeditor-class';
import { gfxColors, withAlpha } from "../ui/theme";
import type { RulerDragHandle } from "./shapeeditor-types";

export interface EditorRulersMethods {
    positionRulerAboveBBox: () => void;
    hitTestRuler: (cx: number, cy: number) => RulerDragHandle | null;
    drawRuler: () => void;
    _findRulerAtCanvasPoint: (cx: number, cy: number) => number;
    _insertRulerAt: (worldX: number, worldY: number) => void;
    _duplicateRuler: (idx: number) => void;
    _deleteRuler: (idx: number) => void;
}

export const editorRulersMethods: EditorRulersMethods & ThisType<ShapeEditor> = {
    positionRulerAboveBBox(this: ShapeEditor){

        if (this.screenmap_pts.length === 0) return;
        // Auto-create the initial ruler only when there are none. If the user
        // has deleted all rulers, leave the canvas free until they explicitly
        // Insert one via the context menu.
        if (this.rulers.length > 0) return;
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        for (const [x, y] of this.screenmap_pts) {
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const bboxH = ymax - ymin;
        const gap = bboxH * 0.10;
        this.rulers.push({
            ax: xmin, ay: ymin - gap,
            bx: xmax, by: ymin - gap,
        });
    },
    hitTestRuler(this: ShapeEditor, cx: number, cy: number){

        // Returns the active ruler hit ({idx, kind}) or null. Walks rulers in
        // reverse order so the most-recently-added (drawn last, on top) wins
        // when two rulers overlap.
        const r = this.RULER_HANDLE_R + 4;
        for (let idx = this.rulers.length - 1; idx >= 0; idx--) {
            const ruler = this.rulers[idx];
            if (!ruler) continue;
            const [ax, ay] = this.toCanvasCoords(ruler.ax, ruler.ay);
            const [bx, by] = this.toCanvasCoords(ruler.bx, ruler.by);
            if (Math.hypot(cx - ax, cy - ay) <= r) return { idx, kind: 'a' as const };
            if (Math.hypot(cx - bx, cy - by) <= r) return { idx, kind: 'b' as const };
            const dx = bx - ax, dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq > 0) {
                const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / lenSq));
                const px = ax + t * dx, py = ay + t * dy;
                if (Math.hypot(cx - px, cy - py) <= 14) return { idx, kind: 'body' as const };
            }
        }
        return null;
    },
    _findRulerAtCanvasPoint(this: ShapeEditor, cx: number, cy: number): number{
    const hit = this.hitTestRuler(cx, cy);
    return hit ? hit.idx : -1;
},
    _insertRulerAt(this: ShapeEditor, worldX: number, worldY: number): void{
    const half = 30; // 60 cm wide, centered → ±30 cm
    this.rulers.push({
        ax: worldX - half, ay: worldY,
        bx: worldX + half, by: worldY,
    });
    this.setNeedsRender();
},
    _duplicateRuler(this: ShapeEditor, idx: number): void{
    const src = this.rulers[idx];
    if (!src) return;
    const dx = src.bx - src.ax, dy = src.by - src.ay;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const step = 10;
    this.rulers.push({
        ax: src.ax + px * step, ay: src.ay + py * step,
        bx: src.bx + px * step, by: src.by + py * step,
    });
    this.setNeedsRender();
},
    _deleteRuler(this: ShapeEditor, idx: number): void{
    if (idx < 0 || idx >= this.rulers.length) return;
    this.rulers.splice(idx, 1);
    if (this.rulerDrag?.idx === idx) {
        this.rulerDrag = null;
        this.rulerDragStart = null;
    } else if (this.rulerDrag && this.rulerDrag.idx > idx) {
        this.rulerDrag = { idx: this.rulerDrag.idx - 1, kind: this.rulerDrag.kind };
    }
    this.setNeedsRender();
},
    drawRuler(this: ShapeEditor){

        if (!this.overlayCtx || this.fitScale <= 0) return;
        if (this.rulers.length === 0) return;
        const ctx = this.overlayCtx;
        const pxPerCm = this.fitScale * this.camZoom;
        // Draw each ruler. The original implementation only had one; this loop
        // wraps the per-ruler drawing block below.
        for (const ruler of this.rulers) {
        const [ax, ay] = this.toCanvasCoords(ruler.ax, ruler.ay);
        const [bx, by] = this.toCanvasCoords(ruler.bx, ruler.by);
        const dx = bx - ax, dy = by - ay;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) continue;
        const lenCm = lenPx / pxPerCm;

        // Unit vector along ruler
        const ux = dx / lenPx, uy = dy / lenPx;
        // Normal (perpendicular, pointing "up" relative to the ruler direction)
        const nx = -uy, ny = ux;

        ctx.save();

        // ── Ruler body (dark band) ──
        const bandHalf = 10; // half-height of the ruler band
        ctx.beginPath();
        ctx.moveTo(ax + nx * bandHalf, ay + ny * bandHalf);
        ctx.lineTo(bx + nx * bandHalf, by + ny * bandHalf);
        ctx.lineTo(bx - nx * bandHalf, by - ny * bandHalf);
        ctx.lineTo(ax - nx * bandHalf, ay - ny * bandHalf);
        ctx.closePath();
        ctx.fillStyle = withAlpha(gfxColors.bgPopover(), 0.8);
        ctx.fill();
        ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.15);
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Tick marks ──
        const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
        let stepCm = 1;
        for (const s of niceSteps) {
            if (s * pxPerCm >= 8) { stepCm = s; break; }
        }
        const majorEvery = stepCm < 1 ? Math.round(1 / stepCm) : (stepCm < 10 ? Math.round(10 / stepCm) : 1);
        const nTicks = Math.floor(lenCm / stepCm);

        for (let i = 0; i <= nTicks; i++) {
            const d = i * stepCm * pxPerCm; // distance in px from A
            const tx = ax + ux * d;
            const ty = ay + uy * d;
            const isMajor = (i % majorEvery === 0);
            const tickLen = isMajor ? 8 : 4;

            ctx.strokeStyle = isMajor ? withAlpha(gfxColors.textStrong(), 0.6) : withAlpha(gfxColors.textStrong(), 0.25);
            ctx.lineWidth = isMajor ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(tx - nx * bandHalf, ty - ny * bandHalf);
            ctx.lineTo(tx - nx * (bandHalf - tickLen), ty - ny * (bandHalf - tickLen));
            ctx.stroke();
            // Mirror tick on the other side
            ctx.beginPath();
            ctx.moveTo(tx + nx * bandHalf, ty + ny * bandHalf);
            ctx.lineTo(tx + nx * (bandHalf - tickLen), ty + ny * (bandHalf - tickLen));
            ctx.stroke();

            // Labels on major ticks (above the ruler)
            if (isMajor && i > 0) {
                const cm = i * stepCm;
                const label = Number.isInteger(cm) ? cm.toString() : cm.toFixed(1);
                ctx.save();
                ctx.translate(tx + nx * (bandHalf + 10), ty + ny * (bandHalf + 10));
                ctx.rotate(Math.atan2(dy, dx));
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.5);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }

        // ── Total length label (centered, below ruler) ──
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        ctx.save();
        ctx.translate(mx - nx * (bandHalf + 12), my - ny * (bandHalf + 12));
        const angle = Math.atan2(dy, dx);
        // Flip text if ruler is angled so text would be upside-down
        const flipText = angle > Math.PI / 2 || angle < -Math.PI / 2;
        ctx.rotate(flipText ? angle + Math.PI : angle);
        ctx.font = 'bold 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.75);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lenCm.toFixed(2) + ' cm', 0, 0);
        ctx.restore();

        // ── Handle circles ──
        for (const [hx, hy] of [[ax, ay], [bx, by]] as [number, number][]) {
            ctx.beginPath();
            ctx.arc(hx, hy, this.RULER_HANDLE_R, 0, Math.PI * 2);
            ctx.fillStyle = withAlpha(gfxColors.accentBlue(), 0.85);
            ctx.fill();
            ctx.strokeStyle = gfxColors.textStrong();
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // "0" label at A handle
        ctx.save();
        ctx.translate(ax + nx * (bandHalf + 10), ay + ny * (bandHalf + 10));
        ctx.rotate(Math.atan2(dy, dx));
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = withAlpha(gfxColors.textStrong(), 0.5);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('0', 0, 0);
        ctx.restore();

        ctx.restore();
        } // end for each ruler
    },
};
