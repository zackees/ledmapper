// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Prototype-installed methods (chunk 2/8).

import { ShapeEditor } from './shapeeditor-class';

import type { StripSnapshot } from './strips-model';

import { getStripColors } from '../common';
import { gfxColors } from '../ui/theme';

import { getScreenmap, getBackup, restoreBackup, notePinMutation } from '../screenmap-store';
import { safeStorage } from '../services/storage';

import type { UndoAction } from './shapeeditor-types';

ShapeEditor.prototype.applyAction = function (this: ShapeEditor, action: UndoAction) {

        const a = action as Record<string, unknown>;
        if (action.type === 'move') {
            this.screenmap_pts[a.idx as number] = [...(a.newScreenmapPt as [number, number])];
            this.rawPts[a.idx as number] = [...(a.newRawPt as [number, number])];
        } else if (action.type === 'delete') {
            const idx = a.idx as number;
            this.screenmap_pts.splice(idx, 1);
            this.rawPts.splice(idx, 1);
            this._stripInfoOnDelete(idx);
            if (this.selectedIdx === idx) this.selectedIdx = -1;
            else if (this.selectedIdx > idx) this.selectedIdx--;
        } else if (action.type === 'insert') {
            const idx = a.idx as number;
            this.screenmap_pts.splice(idx, 0, [...(a.screenmapPt as [number, number])]);
            this.rawPts.splice(idx, 0, [...(a.rawPt as [number, number])]);
            this._stripInfoOnInsert(idx);
            this.selectedIdx = idx;
        } else if (action.type === 'transform') {
            this.setTransformValue(a.control as string, a.newValue as number);
            this.committedTransform[a.control as string] = a.newValue as number;
        } else if (action.type === 'strip-rename') {
            this.stripStore.renameStrip(a.stripIdx as number, a.newName as string);
        } else if (action.type === 'strip-reorder') {
            this._reorderStripPoints(a.fromIdx as number, a.toIdx as number);
            this.selection.onStripReorder(a.fromIdx as number, a.toIdx as number);
        } else if (action.type === 'strip-delete') {
            const removed = this._removeStripPoints(a.stripIdx as number);
            a.removed = removed; // ensure restore data is captured
            this.selection.onStripRemove(a.stripIdx as number);
            this.selectedIdx = -1;
        } else if (action.type === 'panel-place') {
            this._redoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            this._reverseStripInPlace(a.stripIdx as number);
        } else if (action.type === 'strip-offset') {
            this.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.newValue as number });
        } else if (action.type === 'strip-repin') {
            this._applyRepin(action);
        } else if (action.type === 'connector-retarget') {
            for (const sub of (a.subActions as UndoAction[])) this.applyAction(sub);
        } else if (action.type === 'pin-reorder') {
            this._applyPinOrder(a.newOrder as string[]);
        } else if (action.type === 'pin-rename') {
            this._applyPinRename(a.oldId as string, a.newId as string);
        } else if (action.type === 'vo-override-toggle') {
            this.stripStore.updateStrip(a.stripIdx as number, {
                videoOffsetOverride: a.newOverride as boolean,
                video_offset: a.newValue as number,
            });
        } else if (action.type === 'strip-translate') {
            this._applyStripTranslate(a.stripIdx as number, a.sdx as number, a.sdy as number);
        } else if (action.type === 'multi-translate') {
            this._applyMultiTranslate(a.idxs as number[], a.sdx as number, a.sdy as number);
        } else if (action.type === 'strip-rotate') {
            const deg = a.deltaDeg as number;
            this._applyStripRotate(
                a.stripIdx as number,
                deg * Math.PI / 180,
                a.centerSm as { x: number; y: number },
                a.centerRaw as { x: number; y: number },
            );
        } else if (action.type === 'paste-strips') {
            this._doPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof a.afterJson === 'string') {
                this.load_screenmap_data(a.afterJson);
            }
        }
    };

ShapeEditor.prototype.applyInverse = function (this: ShapeEditor, action: UndoAction) {

        const a = action as Record<string, unknown>;
        if (action.type === 'move') {
            this.screenmap_pts[a.idx as number] = [...(a.oldScreenmapPt as [number, number])];
            this.rawPts[a.idx as number] = [...(a.oldRawPt as [number, number])];
        } else if (action.type === 'delete') {
            const idx = a.idx as number;
            this.screenmap_pts.splice(idx, 0, a.screenmapPt as [number, number]);
            this.rawPts.splice(idx, 0, a.rawPt as [number, number]);
            // Restore stripInfo from snapshot taken before delete
            this._restoreStripInfo(a.stripSnapshot as StripSnapshot);
            this.selectedIdx = idx;
        } else if (action.type === 'insert') {
            const idx = a.idx as number;
            this.screenmap_pts.splice(idx, 1);
            this.rawPts.splice(idx, 1);
            // Restore stripInfo from snapshot taken before insert
            this._restoreStripInfo(a.stripSnapshot as StripSnapshot);
            if (this.selectedIdx === idx) this.selectedIdx = -1;
            else if (this.selectedIdx > idx) this.selectedIdx--;
        } else if (action.type === 'transform') {
            this.setTransformValue(a.control as string, a.oldValue as number);
            this.committedTransform[a.control as string] = a.oldValue as number;
        } else if (action.type === 'strip-rename') {
            this.stripStore.renameStrip(a.stripIdx as number, a.oldName as string);
        } else if (action.type === 'strip-reorder') {
            this._reorderStripPoints(a.toIdx as number, a.fromIdx as number);
            this.selection.onStripReorder(a.toIdx as number, a.fromIdx as number);
        } else if (action.type === 'strip-delete') {
            this._insertStripPoints(a.stripIdx as number, a.removed as ReturnType<typeof this._removeStripPoints>);
        } else if (action.type === 'panel-place') {
            this._undoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            // self-inverse
            this._reverseStripInPlace(a.stripIdx as number);
        } else if (action.type === 'strip-offset') {
            this.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.oldValue as number });
        } else if (action.type === 'strip-repin') {
            this._revertRepin(action);
        } else if (action.type === 'connector-retarget') {
            const subs = a.subActions as UndoAction[];
            for (let i = subs.length - 1; i >= 0; i--) {
                const sub = subs[i];
                if (sub) this.applyInverse(sub);
            }
        } else if (action.type === 'pin-reorder') {
            this._applyPinOrder(a.oldOrder as string[]);
        } else if (action.type === 'pin-rename') {
            this._applyPinRename(a.newId as string, a.oldId as string);
        } else if (action.type === 'vo-override-toggle') {
            this.stripStore.updateStrip(a.stripIdx as number, {
                videoOffsetOverride: a.oldOverride as boolean,
                video_offset: a.oldValue as number,
            });
        } else if (action.type === 'strip-translate') {
            this._applyStripTranslate(a.stripIdx as number, -(a.sdx as number), -(a.sdy as number));
        } else if (action.type === 'multi-translate') {
            this._applyMultiTranslate(a.idxs as number[], -(a.sdx as number), -(a.sdy as number));
        } else if (action.type === 'strip-rotate') {
            const deg = a.deltaDeg as number;
            this._applyStripRotate(
                a.stripIdx as number,
                -deg * Math.PI / 180,
                a.centerSm as { x: number; y: number },
                a.centerRaw as { x: number; y: number },
            );
        } else if (action.type === 'paste-strips') {
            this._undoPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof a.beforeJson === 'string' && (a.beforeJson).length > 0) {
                this.load_screenmap_data(a.beforeJson);
            } else {
                // No prior working copy — clear back to a fresh empty state.
                safeStorage.remove('lm:screenmap');
                safeStorage.remove('lm:screenmap-meta');
                this.stripStore.load(null);
                this.screenmap_pts = [[0, 0]];
                this.rawPts = [[0, 0]];
                this.stripInfo = null;
                this.renderStripsPanel();
                this.setNeedsGeometryUpdate();
            }
        }
    };

ShapeEditor.prototype.isStripAction = function (this: ShapeEditor, action: UndoAction | null | undefined) {

        return action && (
            action.type === 'strip-rename'
            || action.type === 'strip-reorder'
            || action.type === 'strip-delete'
            || action.type === 'panel-place'
            || action.type === 'strip-reverse'
            || action.type === 'strip-offset'
            || action.type === 'strip-repin'
            || action.type === 'connector-retarget'
            || action.type === 'pin-reorder'
            || action.type === 'pin-rename'
            || action.type === 'vo-override-toggle'
            || action.type === 'strip-translate'
            || action.type === 'strip-rotate'
            || action.type === 'paste-strips'
        );
    };

ShapeEditor.prototype.isPinMutationAction = function (this: ShapeEditor, action: UndoAction | null | undefined) {

        return action && (
            action.type === 'strip-repin'
            || action.type === 'connector-retarget'
            || action.type === 'strip-delete'
            || action.type === 'pin-reorder'
            || action.type === 'pin-rename'
            || action.type === 'panel-place'
            || action.type === 'paste-strips'
            || action.type === 'restore-backup'
        );
    };

ShapeEditor.prototype.performUndo = function (this: ShapeEditor) {

        if (this.undoStack.length === 0) return;
        const action = this.undoStack.pop();
        if (!action) return;
        this.applyInverse(action);
        this.redoStack.push(action);
        this.updateUndoRedoButtons();
        this.setNeedsGeometryUpdate();
        if (this.isPinMutationAction(action)) notePinMutation();
        if (this.isStripAction(action)) {
            this._persistMultiStrip();
            this.renderStripsPanel();
        }
        if (this.undoStack.length === 0) {
            this.clearDirty();
        } else {
            this.markDirty();
        }
    };

ShapeEditor.prototype.performRedo = function (this: ShapeEditor) {

        if (this.redoStack.length === 0) return;
        const action = this.redoStack.pop();
        if (!action) return;
        this.applyAction(action);
        this.undoStack.push(action);
        this.updateUndoRedoButtons();
        this.setNeedsGeometryUpdate();
        if (this.isPinMutationAction(action)) notePinMutation();
        if (this.isStripAction(action)) {
            this._persistMultiStrip();
            this.renderStripsPanel();
        }
        this.markDirty();
    };

ShapeEditor.prototype.updateUndoRedoButtons = function (this: ShapeEditor) {

        this.dom_btn_undo.disabled = this.undoStack.length === 0;
        this.dom_btn_redo.disabled = this.redoStack.length === 0;
        this.dom_btn_reset.disabled = this.undoStack.length === 0 && this.redoStack.length === 0;
    };

ShapeEditor.prototype._snapshotStripInfo = function (this: ShapeEditor) {
 return this.stripStore.snapshot(); };

ShapeEditor.prototype._restoreStripInfo = function (this: ShapeEditor, snap: StripSnapshot) {
 this.stripStore.restore(snap); };

ShapeEditor.prototype._stripInfoOnDelete = function (this: ShapeEditor, idx: number) {
 this.stripStore.onDelete(idx); };

ShapeEditor.prototype._stripInfoOnInsert = function (this: ShapeEditor, idx: number) {
 this.stripStore.onInsert(idx); };

ShapeEditor.prototype.deletePoint = function (this: ShapeEditor, idx: number) {

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
    };

ShapeEditor.prototype.insertPointAt = function (this: ShapeEditor, insertIdx: number, screenmapPt: [number, number], rawPt: [number, number]) {

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
    };

ShapeEditor.prototype.insertBetween = function (this: ShapeEditor, edgeIdx: number) {

        if (edgeIdx < 0 || edgeIdx >= this.screenmap_pts.length - 1) return;
        const a = edgeIdx, b = edgeIdx + 1;
        const pa = this.screenmap_pts[a] ?? [0, 0], pb = this.screenmap_pts[b] ?? [0, 0];
        const ra = this.rawPts[a] ?? [0, 0], rb = this.rawPts[b] ?? [0, 0];
        const newScreenmap: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const newRaw: [number, number] = [(ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2];
        this.insertPointAt(a + 1, newScreenmap, newRaw);
    };

ShapeEditor.prototype.insertShiftForward = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.insertShiftBack = function (this: ShapeEditor) {

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
    };

ShapeEditor.prototype.canvasToScreenmapCoords = function (this: ShapeEditor, canvasX: number, canvasY: number): [number, number] {

        const { sX, sY, cosR, sinR, tx, ty } = this.getCurrentTransform();
        const wx = (canvasX - this.canvasW / 2) / this.camZoom - this.camPanX;
        const wy = (canvasY - this.canvasH / 2) / this.camZoom - this.camPanY;
        const dx = wx - tx, dy = wy - ty;
        return [(dx * cosR + dy * sinR) / sX, (-dx * sinR + dy * cosR) / sY];
    };

ShapeEditor.prototype.screenmapToRawCoords = function (this: ShapeEditor, sx: number, sy: number): [number, number] {

        const rp0 = this.rawPts[0] ?? [0, 0];
        const sp0 = this.screenmap_pts[0] ?? [0, 0];
        return [
            rp0[0] + (sx - sp0[0]) / this.fitScale,
            rp0[1] + (sy - sp0[1]) / this.fitScale,
        ];
    };

ShapeEditor.prototype.findNearestEdge = function (this: ShapeEditor, canvasX: number, canvasY: number) {

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
    };

ShapeEditor.prototype.clearEditingState = function (this: ShapeEditor) {

        this.selectedIdx = -1;
        this.selection.clear();
        this.pointEditStripIdx = null;
        this.stripDragActive = false;
        this.stripDragIdx = -1;
        this.stripDragStartScreenmap = null;
        this.stripDragStartRaw = null;
        this.stripSnapActive = false;
        this.stripSnapXTargets = [];
        this.stripSnapYTargets = [];
        this.stripSnapStartCenter = null;
        this.stripSnapEngagedX = null;
        this.stripSnapEngagedY = null;
        this.stripRotateActive = false;
        this.stripRotateIdx = -1;
        this.stripRotateStartScreenmap = null;
        this.stripRotateStartRaw = null;
        this.stripRotateCenterSm = null;
        this.stripRotateCenterRaw = null;
        this.stripRotateStartAngle = 0;
        this.stripRotateLastDeg = 0;
        this.stripRotateHover = false;
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
    };

ShapeEditor.prototype.showContextMenu = function (this: ShapeEditor, clientX: number, clientY: number, idx: number, edgeIdx: number, insideBBox?: boolean) {

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
    };

ShapeEditor.prototype.hideContextMenu = function (this: ShapeEditor) {

        if (this.ctxMenu) this.ctxMenu.style.display = 'none';
        if (this.ctxLoadSubmenu) this.ctxLoadSubmenu.style.display = 'none';
        this.ctxMenuIdx = -1;
        this.ctxMenuRulerIdx = -1;
        if (this.highlightedEdgeIdx >= 0) {
            this.highlightedEdgeIdx = -1;
            this.setNeedsRender();
        }
    };

ShapeEditor.prototype.hslAccentForStrip = function (this: ShapeEditor, s: number, total: number): string {

        if (total <= 1) return gfxColors.accentBlue();
        const colors = getStripColors(total);
        return colors[s] ?? gfxColors.accentBlue();
    };

ShapeEditor.prototype._withinPinNeighbor = function (this: ShapeEditor, stripIdx: number, dir: 1 | -1) {

        const strips = this.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const pin = this._pinOfStrip(this.nn(strips[stripIdx]));
        let i = stripIdx + dir;
        while (i >= 0 && i < strips.length) {
            if (this._pinOfStrip(this.nn(strips[i])) === pin) return i;
            i += dir;
        }
        return -1;
    };

ShapeEditor.prototype.renderStripsPanel = function (this: ShapeEditor) {

        const strips = this.stripStore.getStrips();
        this.dom_strips_list.innerHTML = '';
        // Keep the panel visible whenever we have a backup to surface — even
        // when no strips are currently loaded — so the user can find "Restore
        // backup…" after pressing New.
        const haveBackup = !!getBackup();
        if (strips.length === 0) {
            this.dom_strips_panel.style.display = haveBackup ? '' : 'none';
            this.renderSelectedStripRow();
            return;
        }
        this.dom_strips_panel.style.display = '';
        this.dom_strips_list.classList.toggle('chain-mode', this.editorMode === 'chain');
        this.dom_strips_list.classList.toggle('reorder-mode', this.editorMode === 'reorder');
        const selStripIdx = this.selection.getStripIdx();
        const total = strips.length;

        // Group strip indices under pins in first-appearance order (§1.1).
        const pinOrder: string[] = [];
        const groups = new Map<string, number[]>();
        for (let i = 0; i < strips.length; i++) {
            const p = this._pinOfStrip(this.nn(strips[i]));
            if (!groups.has(p)) { groups.set(p, []); pinOrder.push(p); }
            groups.get(p)?.push(i);
        }

        const buildStripRow = (i: number) => {
            const s = this.nn(strips[i]);
            const row = document.createElement('div');
            row.className = 'strip-row' + (i === selStripIdx ? ' active' : '');
            row.dataset.stripIdx = String(i);
            row.dataset.pinId = this._pinOfStrip(s);

            const grip = document.createElement('span');
            grip.className = 'strip-grip';
            grip.textContent = '⠿';
            grip.title = 'Drag within pin to reorder | drag onto a pin header to repin';
            grip.draggable = true;
            grip.dataset.stripIdx = String(i);
            row.appendChild(grip);

            const swatch = document.createElement('span');
            swatch.className = 'strip-swatch';
            swatch.style.background = this.hslAccentForStrip(i, total);
            row.appendChild(swatch);

            const name = document.createElement('span');
            name.className = 'strip-name';
            name.textContent = s.name;
            row.appendChild(name);

            const count = document.createElement('span');
            count.className = 'strip-count';
            count.textContent = `${String(s.count)} LED${s.count === 1 ? '' : 's'}`;
            row.appendChild(count);

            const mkBtn = (label: string, title: string, action: string, disabled: boolean) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'strip-btn';
                b.textContent = label;
                b.title = title;
                b.dataset.action = action;
                b.dataset.stripIdx = String(i);
                if (disabled) b.disabled = true;
                return b;
            };

            row.appendChild(mkBtn('▲', 'Move up within pin', 'up', this._withinPinNeighbor(i, -1) < 0));
            row.appendChild(mkBtn('▼', 'Move down within pin', 'down', this._withinPinNeighbor(i, 1) < 0));
            row.appendChild(mkBtn('Rev', 'Reverse LED order', 'reverse', s.count < 2));
            row.appendChild(mkBtn('Rename', 'Rename strip', 'rename', false));
            row.appendChild(mkBtn('×', 'Delete strip', 'delete', strips.length <= 1));

            // video_offset display: read-only unless this strip's LOCK
            // (videoOffsetOverride) is engaged (§1.4).
            const overridden = s.videoOffsetOverride;
            const off = document.createElement('input');
            off.type = 'number';
            off.className = 'strip-offset' + (overridden ? '' : ' derived');
            off.min = '0';
            off.step = '1';
            off.title = overridden
                ? 'video_offset (manual override)'
                : 'video_offset (derived from pin order — engage LOCK to edit)';
            off.value = String(typeof s.video_offset === 'number' ? s.video_offset : s.offset);
            off.dataset.stripIdx = String(i);
            off.dataset.role = 'video-offset';
            off.readOnly = !overridden;
            row.appendChild(off);

            const lock = document.createElement('button');
            lock.type = 'button';
            lock.className = 'strip-btn strip-lock' + (overridden ? ' engaged' : '');
            lock.textContent = overridden ? '🔒' : '🔓';
            lock.title = overridden
                ? 'Unlock: re-derive video_offset from pin order'
                : 'Lock: override video_offset manually';
            lock.dataset.action = 'lock';
            lock.dataset.stripIdx = String(i);
            lock.setAttribute('aria-pressed', overridden ? 'true' : 'false');
            row.appendChild(lock);

            return row;
        };

        let connectorN = 0;
        for (const pin of pinOrder) {
            const idxs = this.nn(groups.get(pin), `pin ${pin} missing from groups`);
            const ledTotal = idxs.reduce((a: number, i: number) => a + this.nn(strips[i]).count, 0);
            const det = document.createElement('details');
            det.className = 'pin-group';
            det.dataset.pinId = pin;
            det.open = !this.collapsedPins.has(pin);
            det.addEventListener('toggle', () => {
                if (det.open) this.collapsedPins.delete(pin);
                else this.collapsedPins.add(pin);
            }, { signal: this.signal });

            const sum = document.createElement('summary');
            sum.className = 'pin-header';
            sum.dataset.pinId = pin;
            sum.draggable = true;
            sum.title = 'Drag to reorder pins | click name to rename';

            const pinName = document.createElement('span');
            pinName.className = 'pin-name';
            pinName.textContent = pin;
            pinName.dataset.pinId = pin;
            pinName.title = 'Click to rename pin';
            sum.appendChild(pinName);

            const pinMeta = document.createElement('span');
            pinMeta.className = 'pin-meta';
            pinMeta.textContent = `${String(idxs.length)} strip${idxs.length === 1 ? '' : 's'} · ${String(ledTotal)} LED${ledTotal === 1 ? '' : 's'}`;
            sum.appendChild(pinMeta);

            const addStrip = document.createElement('button');
            addStrip.type = 'button';
            addStrip.className = 'strip-btn pin-add-strip';
            addStrip.textContent = '+ strip';
            addStrip.title = `Insert a new strip on ${pin}`;
            addStrip.dataset.action = 'add-strip';
            addStrip.dataset.pinId = pin;
            sum.appendChild(addStrip);

            det.appendChild(sum);

            const body = document.createElement('div');
            body.className = 'pin-strips';
            for (let k = 0; k < idxs.length; k++) {
                body.appendChild(buildStripRow(this.nn(idxs[k])));
                // Connector rows between same-pin strips — visible only in
                // Chain mode (§1.6); click opens the inline connector menu.
                if (this.editorMode === 'chain' && k < idxs.length - 1) {
                    connectorN++;
                    const cr = document.createElement('div');
                    cr.className = 'connector-row';
                    cr.dataset.upIdx = String(this.nn(idxs[k]));
                    cr.dataset.downIdx = String(this.nn(idxs[k + 1]));
                    cr.textContent = `──(${String(connectorN)})──▶`;
                    cr.title = 'Connector — click for Swap / Split / Move options';
                    body.appendChild(cr);
                }
            }
            det.appendChild(body);

            this.dom_strips_list.appendChild(det);
        }
        this.renderSelectedStripRow();
    };

ShapeEditor.prototype.renderBackupRow = function (this: ShapeEditor) {

        const b = getBackup();
        if (!b?.meta) {
            this.dom_strips_backup_row.style.display = 'none';
            this.dom_strips_btn_restore_backup.disabled = true;
            return;
        }
        const m = b.meta;
        const stripCount = typeof m.stripCount === 'number' ? m.stripCount : 0;
        const ledCount = typeof m.ledCount === 'number' ? m.ledCount : 0;
        const when: string = typeof m.savedAt === 'number' ? this._relativeTime(m.savedAt) : '';
        const summary = `${String(stripCount)} strip${stripCount === 1 ? '' : 's'} · ${String(ledCount)} LED${ledCount === 1 ? '' : 's'} · ${when}`;
        this.dom_strips_backup_summary.textContent = summary;
        this.dom_strips_backup_row.style.display = '';
        this.dom_strips_btn_restore_backup.disabled = false;
    };

ShapeEditor.prototype.doRestoreBackupFromButton = function (this: ShapeEditor) {

        const b = getBackup();
        if (!b) return;
        const beforeJson = getScreenmap();
        const restored = restoreBackup();
        if (!restored) return;
        this.pushUndo({
            type: 'restore-backup',
            beforeJson: typeof beforeJson === 'string' ? beforeJson : null,
            afterJson: restored,
        });
        this.load_screenmap_data(restored);
        this.renderBackupRow();
        void this._toastSuccess('Backup restored');
    };

ShapeEditor.prototype.setEditorMode = function (this: ShapeEditor, mode: string | null) {

        const m = (mode === 'chain' || mode === 'reorder') ? mode : null;
        if (m === this.editorMode) return;
        this.editorMode = m;
        this.connectorDrag = null;
        this.startHandleDrag = null;
        if (m) (this.dom_strips_panel as HTMLDetailsElement).open = true;
        this.dom_strips_btn_chain.classList.toggle('active', m === 'chain');
        this.dom_strips_btn_chain.setAttribute('aria-pressed', m === 'chain' ? 'true' : 'false');
        this.dom_strips_btn_reorder.classList.toggle('active', m === 'reorder');
        this.dom_strips_btn_reorder.setAttribute('aria-pressed', m === 'reorder' ? 'true' : 'false');
        // Reorder mode dims the canvas (§1.6); wrapper exists post-initRenderer.
        if (this.wrapper) this.wrapper.classList.toggle('canvas-dim', m === 'reorder');
        this._hideConnectorMenu();
        this.renderStripsPanel();
        this._updateHintStrip();
        this.setNeedsRender();
    };

ShapeEditor.prototype.renderSelectedStripRow = function (this: ShapeEditor) {

        const strips = this.stripStore.getStrips();
        const sIdx = this.selection.getStripIdx();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            this.dom_strips_selected_row.style.display = 'none';
            return;
        }
        const s = this.nn(strips[sIdx]);
        const pin = this._pinOfStrip(s);
        this.dom_strips_selected_row.style.display = '';
        this.dom_strips_selected_label.textContent = `Selected: ${s.name} (${pin})`;
        this.dom_strips_move_pin.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Move to pin…';
        placeholder.selected = true;
        placeholder.disabled = true;
        this.dom_strips_move_pin.appendChild(placeholder);
        for (const p of this.stripStore.getPinOrder()) {
            if (p === pin) continue;
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            this.dom_strips_move_pin.appendChild(opt);
        }
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = 'New pin…';
        this.dom_strips_move_pin.appendChild(newOpt);
    };

ShapeEditor.prototype._reverseStripInPlace = function (this: ShapeEditor, stripIdx: number) {

        const info = this.stripStore.get();
        if (!info) return false;
        const strip = info.strips[stripIdx];
        if (!strip || strip.count < 2) return false;
        const lo = strip.offset, hi = strip.offset + strip.count;
        // Reverse the flat slice in both screenmap_pts and rawPts.
        const sm = this.screenmap_pts.slice(lo, hi).reverse();
        const rw = this.rawPts.slice(lo, hi).reverse();
        for (let i = 0; i < sm.length; i++) {
            this.screenmap_pts[lo + i] = this.nn(sm[i]);
            this.rawPts[lo + i] = this.nn(rw[i]);
        }
        if (Array.isArray(strip.points)) strip.points.reverse();
        if (Array.isArray(info.allPoints)) {
            for (let i = 0; i < sm.length; i++) info.allPoints[lo + i] = [this.nn(sm[i])[0], this.nn(sm[i])[1]];
        }
        return true;
    };

ShapeEditor.prototype.doReverseStrip = function (this: ShapeEditor, stripIdx: number) {

        if (!this._reverseStripInPlace(stripIdx)) return;
        this.pushUndo({ type: 'strip-reverse', stripIdx });
        this._persistMultiStrip();
        this.renderStripsPanel();
        this.setNeedsGeometryUpdate();
    };
