// Named ShapeEditor method bundle: points.
import type { ShapeEditor } from './shapeeditor-class';

export interface EditorPointsMethods {
    syncPointSelection: (idx: number) => void;
    _spliceArray: <T>(arr: T[], idx: number, count: number) => T[];
    deletePoint: (idx: number) => void;
    insertPointAt: (insertIdx: number, screenmapPt: [number, number], rawPt: [number, number]) => void;
    insertBetween: (edgeIdx: number) => void;
    insertShiftForward: () => void;
    insertShiftBack: () => void;
    canvasToScreenmapCoords: (canvasX: number, canvasY: number) => [number, number];
    screenmapToRawCoords: (sx: number, sy: number) => [number, number];
    findNearestEdge: (canvasX: number, canvasY: number) => { idx: number; stripIdx: number; t: number; distSq: number } | null;
    clearEditingState: () => void;
    showContextMenu: (clientX: number, clientY: number, idx: number, edgeIdx: number, insideBBox?: boolean) => void;
    hideContextMenu: () => void;
    hitTestLED: (canvasX: number, canvasY: number) => number;
    hitTestLEDCandidates: (canvasX: number, canvasY: number) => { idx: number; stripIdx: number; distSq: number }[];
}

export const editorPointsMethods: EditorPointsMethods & ThisType<ShapeEditor> = {
    syncPointSelection(this: ShapeEditor, idx: number){

        if (idx >= 0) {
            const sIdx = this.stripStore.findStripForIndex(idx);
            this.selection.selectPoint(idx, sIdx);
        } else if (this.selection.getPointIdx() !== null) {
            // Clear point but keep strip selection if explicit
            this.selection.selectPoint(null, this.selection.getStripIdx());
        }
    },
    _spliceArray<T>(this: ShapeEditor, arr: T[], idx: number, count: number): T[]{

        return arr.splice(idx, count);
    },
    deletePoint(this: ShapeEditor, idx: number){

        if (idx < 0 || idx >= this.screenmap_pts.length) return;
        this.pushUndo({
            type: 'delete',
            idx,
            screenmapPt: [...(this.screenmap_pts[idx] ?? [0, 0])],
            rawPt: [...(this.rawPts[idx] ?? [0, 0])],
            stripSnapshot: this._snapshotStripInfo(),
        });
        this.screenmap_pts.splice(idx, 1);
        this.rawPts.splice(idx, 1);
        this._stripInfoOnDelete(idx);
        if (this.selectedIdx === idx) this.selectedIdx = -1;
        else if (this.selectedIdx > idx) this.selectedIdx--;
        this.selection.onPointDelete(idx);
        this.setNeedsGeometryUpdate();
    },
    insertPointAt(this: ShapeEditor, insertIdx: number, screenmapPt: [number, number], rawPt: [number, number]){

        this.pushUndo({
            type: 'insert',
            idx: insertIdx,
            screenmapPt: [...screenmapPt],
            rawPt: [...rawPt],
            stripSnapshot: this._snapshotStripInfo(),
        });
        this.screenmap_pts.splice(insertIdx, 0, screenmapPt);
        this.rawPts.splice(insertIdx, 0, rawPt);
        this._stripInfoOnInsert(insertIdx);
        this.selection.onPointInsert(insertIdx);
        this.selectedIdx = insertIdx;
        this.syncPointSelection(insertIdx);
        this.setNeedsGeometryUpdate();
    },
    insertBetween(this: ShapeEditor, edgeIdx: number){

        if (edgeIdx < 0 || edgeIdx >= this.screenmap_pts.length - 1) return;
        const a = edgeIdx, b = edgeIdx + 1;
        const pa = this.screenmap_pts[a] ?? [0, 0], pb = this.screenmap_pts[b] ?? [0, 0];
        const ra = this.rawPts[a] ?? [0, 0], rb = this.rawPts[b] ?? [0, 0];
        const newScreenmap: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const newRaw: [number, number] = [(ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2];
        this.insertPointAt(a + 1, newScreenmap, newRaw);
    },
    insertShiftForward(this: ShapeEditor){

        const N = this.screenmap_pts.length;
        if (N < 2) return;
        const sLast = this.screenmap_pts[N - 1] ?? [0, 0], sPrev = this.screenmap_pts[N - 2] ?? [0, 0];
        const rLast = this.rawPts[N - 1] ?? [0, 0], rPrev = this.rawPts[N - 2] ?? [0, 0];
        const dx = sLast[0] - sPrev[0];
        const dy = sLast[1] - sPrev[1];
        const newScreenmap: [number, number] = [sLast[0] + dx, sLast[1] + dy];
        const rdx = rLast[0] - rPrev[0];
        const rdy = rLast[1] - rPrev[1];
        const newRaw: [number, number] = [rLast[0] + rdx, rLast[1] + rdy];
        this.insertPointAt(N, newScreenmap, newRaw);
    },
    insertShiftBack(this: ShapeEditor){

        const N = this.screenmap_pts.length;
        if (N < 2) return;
        const sFirst = this.screenmap_pts[0] ?? [0, 0], sSecond = this.screenmap_pts[1] ?? [0, 1];
        const rFirst = this.rawPts[0] ?? [0, 0], rSecond = this.rawPts[1] ?? [0, 1];
        const dx = sFirst[0] - sSecond[0];
        const dy = sFirst[1] - sSecond[1];
        const newScreenmap: [number, number] = [sFirst[0] + dx, sFirst[1] + dy];
        const rdx = rFirst[0] - rSecond[0];
        const rdy = rFirst[1] - rSecond[1];
        const newRaw: [number, number] = [rFirst[0] + rdx, rFirst[1] + rdy];
        this.insertPointAt(0, newScreenmap, newRaw);
    },
    canvasToScreenmapCoords(this: ShapeEditor, canvasX: number, canvasY: number): [number, number]{

        const { sX, sY, cosR, sinR, tx, ty } = this.getCurrentTransform();
        const wx = (canvasX - this.canvasW / 2) / this.camZoom - this.camPanX;
        const wy = (canvasY - this.canvasH / 2) / this.camZoom - this.camPanY;
        const dx = wx - tx, dy = wy - ty;
        return [(dx * cosR + dy * sinR) / sX, (-dx * sinR + dy * cosR) / sY];
    },
    screenmapToRawCoords(this: ShapeEditor, sx: number, sy: number): [number, number]{

        const rp0 = this.rawPts[0] ?? [0, 0];
        const sp0 = this.screenmap_pts[0] ?? [0, 0];
        return [
            rp0[0] + (sx - sp0[0]) / this.fitScale,
            rp0[1] + (sy - sp0[1]) / this.fitScale,
        ];
    },
    findNearestEdge(this: ShapeEditor, canvasX: number, canvasY: number){

        if (this.lastTransformedPts.length < 2) return null;
        let bestDist = Infinity;
        let bestIdx = -1;
        let bestT = 0;
        let bestStripIdx = -1;
        const selectedStripIdx = this.selection.getStripIdx();
        const strips = this.stripInfo?.strips ?? [{ offset: 0, count: this.lastTransformedPts.length }];

        for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
            const strip = strips[stripIdx];
            if (!strip) continue;
            const start = Math.max(0, strip.offset);
            const end = Math.min(this.lastTransformedPts.length, strip.offset + strip.count);
            // A flattened last-of-A -> first-of-B segment is not rendered,
            // so it must never become an invisible click target.
            for (let i = start; i < end - 1; i++) {
                const ltp_i = this.lastTransformedPts[i] ?? [0, 0];
                const ltp_i1 = this.lastTransformedPts[i + 1] ?? [0, 0];
                const [ax, ay] = this.toCanvasCoords(ltp_i[0], ltp_i[1]);
                const [bx, by] = this.toCanvasCoords(ltp_i1[0], ltp_i1[1]);

                const dx = bx - ax, dy = by - ay;
                const lenSq = dx * dx + dy * dy;
                let t = lenSq > 0 ? ((canvasX - ax) * dx + (canvasY - ay) * dy) / lenSq : 0;
                t = Math.max(0, Math.min(1, t));

                const px = ax + t * dx, py = ay + t * dy;
                const distSq = (canvasX - px) * (canvasX - px) + (canvasY - py) * (canvasY - py);
                const tied = Math.abs(distSq - bestDist) < 0.01;
                const selectedWinsTie = tied && stripIdx === selectedStripIdx && bestStripIdx !== selectedStripIdx;
                const topmostWinsTie = tied && stripIdx > bestStripIdx && bestStripIdx !== selectedStripIdx;

                if (distSq < bestDist - 0.01 || selectedWinsTie || topmostWinsTie) {
                    bestDist = distSq;
                    bestIdx = i;
                    bestT = t;
                    bestStripIdx = stripIdx;
                }
            }
        }

        return bestIdx >= 0 ? { idx: bestIdx, stripIdx: bestStripIdx, t: bestT, distSq: bestDist } : null;
    },
    clearEditingState(this: ShapeEditor){

        this.selectedIdx = -1;
        this.selection.clear();
        this.pointEditStripIdx = null;
        this.stripDragActive = false;
        this.stripDragIdx = -1;
        this.stripDragStartScreenmap = null;
        this.stripDragStartRaw = null;
        this._clearStripSnapState();
        this.stripRotateActive = false;
        this.stripRotateIdx = -1;
        this.stripRotateStartScreenmap = null;
        this.stripRotateStartRaw = null;
        this.stripRotateCenterSm = null;
        this.stripRotateCenterRaw = null;
        this.stripRotateStartAngle = 0;
        this.stripRotateLastDeg = 0;
        this.stripRotateHover = false;
        this.stripRotateObbSnapshot = null;
        this.altQuasimode = false;
        this.isDragging = false;
        this.isPanning = false;
        this.rightButtonDown = false;
        this.rightClickMoved = false;
        this.gizmoActive = null;
        this.gizmoHover = null;
        this.gizmoDragStart = null;
        this.multiSelectedIdxs = new Set<number>();
        this.marqueeActive = false;
        this._marqueeBaseSelection = new Set<number>();
        this.multiDragActive = false;
        this.multiDragStartScreenmap = new Map<number, [number, number]>();
        this.multiDragStartRaw = new Map<number, [number, number]>();
        this.multiDragLastSdx = 0;
        this.multiDragLastSdy = 0;
        this._pendingMarquee = null;
        this.camPanX = 0;
        this.camPanY = 0;
        this.camZoom = 1;
        this.committedTransform.scale = 1;
        this.committedTransform.scaleX = 1;
        this.committedTransform.scaleY = 1;
        this.committedTransform.rotate = 0;
        this.committedTransform.translateX = 0;
        this.committedTransform.translateY = 0;
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this.updateUndoRedoButtons();
        this.hideContextMenu();
        this.lastBuiltPointCount = -1; // force full rebuild on next load
        this.setNeedsGeometryUpdate();
    },
    showContextMenu(this: ShapeEditor, clientX: number, clientY: number, idx: number, edgeIdx: number, insideBBox?: boolean){

        this.ctxMenuIdx = idx;
        const onPointOrEdge = idx >= 0 || edgeIdx >= 0;
        // File ops: hide when on a point or edge
        if (this.ctxFileOps) this.ctxFileOps.style.display = onPointOrEdge ? 'none' : '';
        if (this.ctxFileOpsSep) this.ctxFileOpsSep.style.display = onPointOrEdge ? 'none' : '';
        // Save enabled when dirty
        const canSave = !this.dom_btn_save.disabled;
        if (this.ctxBtnSave) { this.ctxBtnSave.disabled = !canSave; this.ctxBtnSave.style.opacity = canSave ? '1' : '0.4'; }
        // Show delete only when a point is targeted
        if (this.ctxBtnDelete) this.ctxBtnDelete.style.display = idx >= 0 ? 'block' : 'none';
        // Show insert-between only when an edge is targeted
        if (this.ctxBtnInsertBetween) this.ctxBtnInsertBetween.style.display = edgeIdx >= 0 ? 'block' : 'none';
        // Shift insert: only when on a point/edge or inside the bbox
        const showShiftInsert = onPointOrEdge || insideBBox;
        const canInsert = this.screenmap_pts.length >= 2;
        if (this.ctxBtnInsertFwd) { this.ctxBtnInsertFwd.style.display = showShiftInsert ? 'block' : 'none'; this.ctxBtnInsertFwd.disabled = !canInsert; this.ctxBtnInsertFwd.style.opacity = canInsert ? '1' : '0.4'; }
        if (this.ctxBtnInsertBack) { this.ctxBtnInsertBack.style.display = showShiftInsert ? 'block' : 'none'; this.ctxBtnInsertBack.disabled = !canInsert; this.ctxBtnInsertBack.style.opacity = canInsert ? '1' : '0.4'; }
        // Copy strip only when a strip is selected
        if (this.ctxBtnCopyStrip) {
            const sIdx = this.selection.getStripIdx();
            this.ctxBtnCopyStrip.style.display = (sIdx !== null && sIdx >= 0) ? 'block' : 'none';
        }
        // Ruler buttons. Insert is always available. Duplicate / Delete only
        // when a ruler was under the right-click point (ctxMenuRulerIdx >= 0).
        if (this.ctxBtnInsertRuler) this.ctxBtnInsertRuler.style.display = 'block';
        const onRuler = this.ctxMenuRulerIdx >= 0;
        if (this.ctxBtnDuplicateRuler) this.ctxBtnDuplicateRuler.style.display = onRuler ? 'block' : 'none';
        if (this.ctxBtnDeleteRuler) this.ctxBtnDeleteRuler.style.display = onRuler ? 'block' : 'none';
        // Position - keep on screen. Must be an explicit 'block': the
        // .shapeeditor-ctx-menu class now carries `display: none` (inline
        // styles hoisted to CSS in #170), so clearing the inline value with
        // '' falls back to the class and the menu never appears.
        if (this.ctxMenu) { this.ctxMenu.style.left = `${String(clientX)}px`; this.ctxMenu.style.top = `${String(clientY)}px`; this.ctxMenu.style.display = 'block'; }
    },
    hideContextMenu(this: ShapeEditor){

        if (this.ctxMenu) this.ctxMenu.style.display = 'none';
        if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'none';
        this.ctxMenuIdx = -1;
        this.ctxMenuRulerIdx = -1;
        if (this.highlightedEdgeIdx >= 0) {
            this.highlightedEdgeIdx = -1;
            this.setNeedsRender();
        }
    },
    hitTestLEDCandidates(this: ShapeEditor, canvasX: number, canvasY: number){
        if (this.lastTransformedPts.length === 0) return [];
        const threshold = 10;
        const threshSq = threshold * threshold;
        const strips = this.stripInfo?.strips ?? [{ offset: 0, count: this.lastTransformedPts.length }];
        const candidates: { idx: number; stripIdx: number; distSq: number }[] = [];
        for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
            const strip = strips[stripIdx];
            if (!strip) continue;
            for (let i = Math.max(0, strip.offset); i < Math.min(this.lastTransformedPts.length, strip.offset + strip.count); i++) {
                const point = this.nn(this.lastTransformedPts[i]);
                const [cx, cy] = this.toCanvasCoords(point[0], point[1]);
                const dx = canvasX - cx, dy = canvasY - cy;
                const distSq = dx * dx + dy * dy;
                if (distSq <= threshSq) candidates.push({ idx: i, stripIdx, distSq });
            }
        }
        return candidates.sort((a, b) => a.distSq - b.distSq || a.stripIdx - b.stripIdx || a.idx - b.idx);
    },
    hitTestLED(this: ShapeEditor, canvasX: number, canvasY: number){
        const candidates = this.hitTestLEDCandidates(canvasX, canvasY);
        if (!Array.isArray(candidates) || candidates.length === 0) return -1;
        const selectedStripIdx = this.selection.getStripIdx();
        const selected = candidates.find((candidate) => candidate.stripIdx === selectedStripIdx);
        return (selected ?? candidates[candidates.length - 1])?.idx ?? -1;
    },
};
