// Named ShapeEditor method bundle: connectors.
import type { ShapeEditor } from './shapeeditor-class';
import type { StripEntry } from "./strips-model";
import { fireDialog } from "../ui/dialogs";
import type { UndoAction } from "./shapeeditor-types";
import { gfxColors, withAlpha } from "../ui/theme";
import { notePinMutation } from "../screenmap-store";
import { getPinColors } from "../common";
import type { GizmoHandle } from "./shapeeditor-types";

export interface EditorConnectorsMethods {
    _commitComposite: (subActions: UndoAction[], crossPin: boolean, toastStripName: string, toastPin: string) => boolean;
    doConnectorRetarget: (upIdx: number, tgtIdx: number) => boolean;
    doSplitPinAt: (downIdx: number) => boolean;
    _moveDownstreamToPinPrompt: (downIdx: number) => Promise<void>;
    _hideConnectorMenu: () => void;
    _openConnectorMenu: (upIdx: number, downIdx: number, clientX: number, clientY: number) => void;
    _hitChainArrowhead: (cx: number, cy: number) => GizmoHandle | null;
    _hitStartHandle: (cx: number, cy: number, excludeIdx: number) => number | null;
    _hitEndHandle: (cx: number, cy: number, excludeIdx: number) => number | null;
    _hitConnectorBody: (cx: number, cy: number) => GizmoHandle | null;
    _previewConnectorTarget: (upIdx: number, targetIdx: number | null) => void;
    _cancelConnectorDrag: () => void;
    _chainArrowCount: () => number;
    _crossPinBadgeCount: () => number;
    drawChainArrows: (pts: [number, number][]) => void;
    _drawChainDragGhost: () => void;
}

export const editorConnectorsMethods: EditorConnectorsMethods & ThisType<ShapeEditor> = {
    _commitComposite(this: ShapeEditor, subActions: UndoAction[], crossPin: boolean, toastStripName: string, toastPin: string){

        if (subActions.length === 0) return false;
        this.pushUndo({ type: 'connector-retarget', subActions });
        notePinMutation();
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
        if (crossPin) this._maybeShowRepinToast(toastStripName, toastPin);
        return true;
    },
    doConnectorRetarget(this: ShapeEditor, upIdx: number, tgtIdx: number){

        const strips = this.stripStore.getStrips();
        if (upIdx < 0 || upIdx >= strips.length) return false;
        if (tgtIdx < 0 || tgtIdx >= strips.length) return false;
        if (upIdx === tgtIdx) return false;
        const upStrip = this.nn(strips[upIdx]);
        const tgtStrip = this.nn(strips[tgtIdx]);
        const upPin = this._pinOfStrip(upStrip);
        const tgtPin = this._pinOfStrip(tgtStrip);
        const subActions = [];
        let crossPin = false;
        if (tgtPin !== upPin) {
            const repin = this._makeRepinAction(tgtIdx, upPin);
            this.applyAction(repin);
            subActions.push(repin);
            crossPin = true;
        }
        // Indices may have shifted after the repin — locate by object.
        const curIdx = strips.indexOf(tgtStrip);
        const upIdxNow = strips.indexOf(upStrip);
        if (curIdx < 0 || upIdxNow < 0) return false;
        const toIdx = curIdx < upIdxNow ? upIdxNow : upIdxNow + 1;
        if (toIdx !== curIdx) {
            const reorder = { type: 'strip-reorder', fromIdx: curIdx, toIdx };
            this.applyAction(reorder);
            subActions.push(reorder);
        }
        return this._commitComposite(subActions, crossPin, tgtStrip.name, upPin);
    },
    doSplitPinAt(this: ShapeEditor, downIdx: number){

        const strips = this.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return false;
        const pin = this._pinOfStrip(s);
        const moving = [];
        for (let i = downIdx; i < strips.length; i++) {
            if (this._pinOfStrip(this.nn(strips[i])) === pin) moving.push(this.nn(strips[i]));
            else break;
        }
        if (moving.length === 0) return false;
        const newPin = this._nextFreePinId();
        const subActions = [];
        for (const obj of moving) {
            const idx = strips.indexOf(obj);
            if (idx < 0) continue;
            const repin = this._makeRepinAction(idx, newPin);
            this.applyAction(repin);
            subActions.push(repin);
        }
        return this._commitComposite(subActions, true, s.name, newPin);
    },
    async _moveDownstreamToPinPrompt(this: ShapeEditor, downIdx: number){

        const strips = this.stripStore.getStrips();
        const s = strips[downIdx];
        if (!s) return;
        const curPin = this._pinOfStrip(s);
        const options: Record<string, unknown> = {};
        for (const p of this.stripStore.getPinOrder()) {
            if (p !== curPin) options[p] = p;
        }
        options.__new__ = 'New pin…';
        if (this.signal.aborted) return;
        const swalResult2 = await fireDialog({
            title: `Move "${s.name}" to pin`,
            input: 'select',
            inputOptions: options,
            showCancelButton: true,
        });
        const value2: unknown = swalResult2.value;
        if (typeof value2 !== 'string' || !value2) return;
        this.doRepinStrip(downIdx, value2 === '__new__' ? this._nextFreePinId() : value2);
    },
    _hideConnectorMenu(this: ShapeEditor){

        if (this.connectorMenuEl) {
            this.connectorMenuEl.remove();
            this.connectorMenuEl = null;
        }
    },
    _openConnectorMenu(this: ShapeEditor, upIdx: number, downIdx: number, clientX: number, clientY: number){

        this._hideConnectorMenu();
        const menu = document.createElement('div');
        menu.className = 'connector-menu';
        const mk = (label: string, fn: () => void) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.addEventListener('click', () => { this._hideConnectorMenu(); fn(); }, { signal: this.signal });
            menu.appendChild(b);
        };
        mk('Swap upstream', () => { this.doReorderStrip(downIdx, upIdx); });
        mk('Split pin here', () => { this.doSplitPinAt(downIdx); });
        mk('Move downstream to pin…', () => { void this._moveDownstreamToPinPrompt(downIdx); });
        menu.style.left = `${String(Math.min(clientX, window.innerWidth - 200))}px`;
        menu.style.top = `${String(Math.min(clientY, window.innerHeight - 110))}px`;
        document.body.appendChild(menu);
        this.connectorMenuEl = menu;
    },
    _hitChainArrowhead(this: ShapeEditor, cx: number, cy: number){

        for (const c of this._chainGeom.connectors) {
            if (c.hx === undefined || c.hy === undefined) continue;
            const dx = cx - c.hx, dy = cy - c.hy;
            if (dx * dx + dy * dy <= 14 * 14) return c;
        }
        return null;
    },
    _hitStartHandle(this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null{

        for (const st of this._chainGeom.starts) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    },
    _hitEndHandle(this: ShapeEditor, cx: number, cy: number, excludeIdx: number): number | null{

        for (const st of this._chainGeom.ends) {
            if (st.strip === excludeIdx) continue;
            const dx = cx - st.x, dy = cy - st.y;
            if (dx * dx + dy * dy <= 12 * 12) return st.strip ?? null;
        }
        return null;
    },
    _hitConnectorBody(this: ShapeEditor, cx: number, cy: number){

        for (const c of this._chainGeom.connectors) {
            if (c.x1 === undefined || c.y1 === undefined || c.x2 === undefined || c.y2 === undefined) continue;
            const vx = c.x2 - c.x1, vy = c.y2 - c.y1;
            const lenSq = vx * vx + vy * vy;
            if (lenSq < 1) continue;
            let t = ((cx - c.x1) * vx + (cy - c.y1) * vy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const px = c.x1 + t * vx, py = c.y1 + t * vy;
            const dx = cx - px, dy = cy - py;
            if (dx * dx + dy * dy <= 8 * 8) return c;
        }
        return null;
    },
    _previewConnectorTarget(this: ShapeEditor, upIdx: number, targetIdx: number | null){

        this.renderStripsPanel();
        if (targetIdx === null) return;
        const upRow = this.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(upIdx)}"]`);
        const tgtRow = this.dom_strips_list.querySelector(`.strip-row[data-strip-idx="${String(targetIdx)}"]`);
        if (upRow && tgtRow && upRow !== tgtRow) {
            upRow.after(tgtRow);
            tgtRow.classList.add('preview-move');
        }
    },
    _cancelConnectorDrag(this: ShapeEditor){

        if (!this.connectorDrag && !this.startHandleDrag) return;
        this.connectorDrag = null;
        this.startHandleDrag = null;
        this.renderStripsPanel();
        this.setNeedsRender();
    },
    _chainArrowCount(this: ShapeEditor){

        if (!this.showChainArrows && this.editorMode !== 'chain') return 0;
        if (!this.stripInfo || this.stripInfo.strips.length <= 1) return 0;
        let drawable = 0;
        for (let s = 0; s < this.stripInfo.strips.length - 1; s++) {
            const a = this.nn(this.stripInfo.strips[s]), b = this.nn(this.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && this._pinOfStrip(a) === this._pinOfStrip(b)) drawable++;
        }
        return drawable;
    },
    _crossPinBadgeCount(this: ShapeEditor){

        if (!this.showChainArrows && this.editorMode !== 'chain') return 0;
        if (!this.stripInfo || this.stripInfo.strips.length <= 1) return 0;
        let n = 0;
        for (let s = 0; s < this.stripInfo.strips.length - 1; s++) {
            const a = this.nn(this.stripInfo.strips[s]), b = this.nn(this.stripInfo.strips[s + 1]);
            if (a.count > 0 && b.count > 0 && this._pinOfStrip(a) !== this._pinOfStrip(b)) n++;
        }
        return n;
    },
    drawChainArrows(this: ShapeEditor, pts: [number, number][]){

        const strips = this._si().strips;
        const ctx = this._octx();
        const pinOrder = this.stripStore.getPinOrder();
        const pinColors = getPinColors(pinOrder.length);
        const pinColorOf = (strip: StripEntry) => {
            const i = pinOrder.indexOf(this._pinOfStrip(strip));
            return pinColors[i >= 0 ? i : 0] ?? gfxColors.accentBlue();
        };
        // Refresh canvas-space geometry used by Chain-mode hit-tests.
        this._chainGeom.connectors.length = 0;
        this._chainGeom.starts.length = 0;
        this._chainGeom.ends.length = 0;
        this._chainGeom.crossBadges.length = 0;
        for (let s = 0; s < strips.length; s++) {
            const st = this.nn(strips[s]);
            if (st.count <= 0) continue;
            const si = st.offset;
            const ei = st.offset + st.count - 1;
            if (si >= pts.length || ei >= pts.length) continue;
            this._chainGeom.starts.push({ strip: s, x: this.nn(pts[si])[0], y: this.nn(pts[si])[1] });
            this._chainGeom.ends.push({ strip: s, x: this.nn(pts[ei])[0], y: this.nn(pts[ei])[1] });
        }
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = gfxColors.accentBlue();
        ctx.fillStyle = gfxColors.accentBlue();
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        let badgeN = 1;
        for (let s = 0; s < strips.length - 1; s++) {
            const a = this.nn(strips[s]), b = this.nn(strips[s + 1]);
            if (a.count <= 0 || b.count <= 0) continue;
            const aLast = a.offset + a.count - 1;
            const bFirst = b.offset;
            if (aLast >= pts.length || bFirst >= pts.length) continue;
            const [x1, y1] = this.nn(pts[aLast]);
            const [x2, y2] = this.nn(pts[bFirst]);
            if (this._pinOfStrip(a) !== this._pinOfStrip(b)) {
                // Cross-pin boundary: no arrow — pin-tinted dot near the next
                // strip's Start (§1.7).
                const tint = pinColorOf(b);
                ctx.setLineDash([]);
                ctx.fillStyle = tint;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = withAlpha(gfxColors.textStrong(), 0.8);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x2 + 12, y2 - 12, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = tint;
                ctx.font = '9px "IBM Plex Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(this._pinOfStrip(b), x2 + 21, y2 - 12);
                ctx.strokeStyle = gfxColors.accentBlue();
                ctx.fillStyle = gfxColors.accentBlue();
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                this._chainGeom.crossBadges.push({ up: s, down: s + 1, x: x2 + 12, y: y2 - 12 });
                continue;
            }
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            // arrowhead at target
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 4) {
                const ang = Math.atan2(dy, dx);
                const al = 10, ah = 0.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 - al * Math.cos(ang - ah), y2 - al * Math.sin(ang - ah));
                ctx.lineTo(x2 - al * Math.cos(ang + ah), y2 - al * Math.sin(ang + ah));
                ctx.closePath();
                ctx.fill();
                ctx.setLineDash([6, 4]);
            }
            // numbered badge at midpoint
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.setLineDash([]);
            ctx.fillStyle = gfxColors.bgPopoverStrong();
            ctx.beginPath();
            ctx.arc(mx, my, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = gfxColors.accentBlue();
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = gfxColors.accentBlue();
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(badgeN), mx, my);
            ctx.setLineDash([6, 4]);
            badgeN++;
            this._chainGeom.connectors.push({ x: x1, y: y1, up: s, down: s + 1, x1, y1, x2, y2, hx: x2, hy: y2 });
        }
        ctx.restore();
    },
    _drawChainDragGhost(this: ShapeEditor){

        const ctx = this._octx();
        const drag = this.connectorDrag ?? this.startHandleDrag;
        if (!drag) return;
        let ax: number | null = null, ay: number | null = null;
        if (this.connectorDrag) {
            const cdrag = this.connectorDrag;
            const end = this._chainGeom.ends.find((e) => e.strip === cdrag.upIdx);
            if (end) { ax = end.x; ay = end.y; }
        } else if (this.startHandleDrag) {
            const shdrag = this.startHandleDrag;
            const start = this._chainGeom.starts.find((e) => e.strip === shdrag.stripIdx);
            if (start) { ax = start.x; ay = start.y; }
        }
        if (ax === null || ay === null) return;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = gfxColors.accentCyan();
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(drag.x, drag.y);
        ctx.stroke();
        if (drag.targetIdx !== null) {
            const handles = this.connectorDrag ? this._chainGeom.starts : this._chainGeom.ends;
            const h = handles.find((e) => e.strip === drag.targetIdx);
            if (h) {
                ctx.setLineDash([]);
                ctx.strokeStyle = gfxColors.accentCyan();
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(h.x, h.y, 13, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.restore();
    },
};
