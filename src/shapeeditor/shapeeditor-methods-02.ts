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
    const self = this;

        const a = action as Record<string, unknown>;
        if (action.type === 'move') {
            self.screenmap_pts[a.idx as number] = [...(a.newScreenmapPt as [number, number])];
            self.rawPts[a.idx as number] = [...(a.newRawPt as [number, number])];
        } else if (action.type === 'delete') {
            const idx = a.idx as number;
            self.screenmap_pts.splice(idx, 1);
            self.rawPts.splice(idx, 1);
            self._stripInfoOnDelete(idx);
            if (self.selectedIdx === idx) self.selectedIdx = -1;
            else if (self.selectedIdx > idx) self.selectedIdx--;
        } else if (action.type === 'insert') {
            const idx = a.idx as number;
            self.screenmap_pts.splice(idx, 0, [...(a.screenmapPt as [number, number])]);
            self.rawPts.splice(idx, 0, [...(a.rawPt as [number, number])]);
            self._stripInfoOnInsert(idx);
            self.selectedIdx = idx;
        } else if (action.type === 'transform') {
            self.setTransformValue(a.control as string, a.newValue as number);
            self.committedTransform[a.control as string] = a.newValue as number;
        } else if (action.type === 'strip-rename') {
            self.stripStore.renameStrip(a.stripIdx as number, a.newName as string);
        } else if (action.type === 'strip-reorder') {
            self._reorderStripPoints(a.fromIdx as number, a.toIdx as number);
            self.selection.onStripReorder(a.fromIdx as number, a.toIdx as number);
        } else if (action.type === 'strip-delete') {
            const removed = self._removeStripPoints(a.stripIdx as number);
            a.removed = removed; // ensure restore data is captured
            self.selection.onStripRemove(a.stripIdx as number);
            self.selectedIdx = -1;
        } else if (action.type === 'panel-place') {
            self._redoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            self._reverseStripInPlace(a.stripIdx as number);
        } else if (action.type === 'strip-offset') {
            self.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.newValue as number });
        } else if (action.type === 'strip-repin') {
            self._applyRepin(action);
        } else if (action.type === 'connector-retarget') {
            for (const sub of (a.subActions as UndoAction[])) self.applyAction(sub);
        } else if (action.type === 'pin-reorder') {
            self._applyPinOrder(a.newOrder as string[]);
        } else if (action.type === 'pin-rename') {
            self._applyPinRename(a.oldId as string, a.newId as string);
        } else if (action.type === 'vo-override-toggle') {
            self.stripStore.updateStrip(a.stripIdx as number, {
                videoOffsetOverride: a.newOverride as boolean,
                video_offset: a.newValue as number,
            });
        } else if (action.type === 'strip-translate') {
            self._applyStripTranslate(a.stripIdx as number, a.sdx as number, a.sdy as number);
        } else if (action.type === 'multi-translate') {
            self._applyMultiTranslate(a.idxs as number[], a.sdx as number, a.sdy as number);
        } else if (action.type === 'strip-rotate') {
            const deg = a.deltaDeg as number;
            self._applyStripRotate(
                a.stripIdx as number,
                deg * Math.PI / 180,
                a.centerSm as { x: number; y: number },
                a.centerRaw as { x: number; y: number },
            );
        } else if (action.type === 'paste-strips') {
            self._doPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof a.afterJson === 'string') {
                self.load_screenmap_data(a.afterJson);
            }
        }
    };

ShapeEditor.prototype.applyInverse = function (this: ShapeEditor, action: UndoAction) {
    const self = this;

        const a = action as Record<string, unknown>;
        if (action.type === 'move') {
            self.screenmap_pts[a.idx as number] = [...(a.oldScreenmapPt as [number, number])];
            self.rawPts[a.idx as number] = [...(a.oldRawPt as [number, number])];
        } else if (action.type === 'delete') {
            const idx = a.idx as number;
            self.screenmap_pts.splice(idx, 0, a.screenmapPt as [number, number]);
            self.rawPts.splice(idx, 0, a.rawPt as [number, number]);
            // Restore stripInfo from snapshot taken before delete
            self._restoreStripInfo(a.stripSnapshot as StripSnapshot);
            self.selectedIdx = idx;
        } else if (action.type === 'insert') {
            const idx = a.idx as number;
            self.screenmap_pts.splice(idx, 1);
            self.rawPts.splice(idx, 1);
            // Restore stripInfo from snapshot taken before insert
            self._restoreStripInfo(a.stripSnapshot as StripSnapshot);
            if (self.selectedIdx === idx) self.selectedIdx = -1;
            else if (self.selectedIdx > idx) self.selectedIdx--;
        } else if (action.type === 'transform') {
            self.setTransformValue(a.control as string, a.oldValue as number);
            self.committedTransform[a.control as string] = a.oldValue as number;
        } else if (action.type === 'strip-rename') {
            self.stripStore.renameStrip(a.stripIdx as number, a.oldName as string);
        } else if (action.type === 'strip-reorder') {
            self._reorderStripPoints(a.toIdx as number, a.fromIdx as number);
            self.selection.onStripReorder(a.toIdx as number, a.fromIdx as number);
        } else if (action.type === 'strip-delete') {
            self._insertStripPoints(a.stripIdx as number, a.removed as ReturnType<typeof self._removeStripPoints>);
        } else if (action.type === 'panel-place') {
            self._undoPanelPlace(action);
        } else if (action.type === 'strip-reverse') {
            // self-inverse
            self._reverseStripInPlace(a.stripIdx as number);
        } else if (action.type === 'strip-offset') {
            self.stripStore.updateStrip(a.stripIdx as number, { video_offset: a.oldValue as number });
        } else if (action.type === 'strip-repin') {
            self._revertRepin(action);
        } else if (action.type === 'connector-retarget') {
            const subs = a.subActions as UndoAction[];
            for (let i = subs.length - 1; i >= 0; i--) {
                const sub = subs[i];
                if (sub) self.applyInverse(sub);
            }
        } else if (action.type === 'pin-reorder') {
            self._applyPinOrder(a.oldOrder as string[]);
        } else if (action.type === 'pin-rename') {
            self._applyPinRename(a.newId as string, a.oldId as string);
        } else if (action.type === 'vo-override-toggle') {
            self.stripStore.updateStrip(a.stripIdx as number, {
                videoOffsetOverride: a.oldOverride as boolean,
                video_offset: a.oldValue as number,
            });
        } else if (action.type === 'strip-translate') {
            self._applyStripTranslate(a.stripIdx as number, -(a.sdx as number), -(a.sdy as number));
        } else if (action.type === 'multi-translate') {
            self._applyMultiTranslate(a.idxs as number[], -(a.sdx as number), -(a.sdy as number));
        } else if (action.type === 'strip-rotate') {
            const deg = a.deltaDeg as number;
            self._applyStripRotate(
                a.stripIdx as number,
                -deg * Math.PI / 180,
                a.centerSm as { x: number; y: number },
                a.centerRaw as { x: number; y: number },
            );
        } else if (action.type === 'paste-strips') {
            self._undoPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof a.beforeJson === 'string' && (a.beforeJson).length > 0) {
                self.load_screenmap_data(a.beforeJson);
            } else {
                // No prior working copy — clear back to a fresh empty state.
                safeStorage.remove('lm:screenmap');
                safeStorage.remove('lm:screenmap-meta');
                self.stripStore.load(null);
                self.screenmap_pts = [[0, 0]];
                self.rawPts = [[0, 0]];
                self.stripInfo = null;
                self.renderStripsPanel();
                self.setNeedsGeometryUpdate();
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
    const self = this;

        if (self.undoStack.length === 0) return;
        const action = self.undoStack.pop();
        if (!action) return;
        self.applyInverse(action);
        self.redoStack.push(action);
        self.updateUndoRedoButtons();
        self.setNeedsGeometryUpdate();
        if (self.isPinMutationAction(action)) notePinMutation();
        if (self.isStripAction(action)) {
            self._persistMultiStrip();
            self.renderStripsPanel();
        }
        if (self.undoStack.length === 0) {
            self.clearDirty();
        } else {
            self.markDirty();
        }
    };

ShapeEditor.prototype.performRedo = function (this: ShapeEditor) {
    const self = this;

        if (self.redoStack.length === 0) return;
        const action = self.redoStack.pop();
        if (!action) return;
        self.applyAction(action);
        self.undoStack.push(action);
        self.updateUndoRedoButtons();
        self.setNeedsGeometryUpdate();
        if (self.isPinMutationAction(action)) notePinMutation();
        if (self.isStripAction(action)) {
            self._persistMultiStrip();
            self.renderStripsPanel();
        }
        self.markDirty();
    };

ShapeEditor.prototype.updateUndoRedoButtons = function (this: ShapeEditor) {
    const self = this;

        self.dom_btn_undo.disabled = self.undoStack.length === 0;
        self.dom_btn_redo.disabled = self.redoStack.length === 0;
        self.dom_btn_reset.disabled = self.undoStack.length === 0 && self.redoStack.length === 0;
    };

ShapeEditor.prototype._snapshotStripInfo = function (this: ShapeEditor) {
    const self = this;
 return self.stripStore.snapshot(); };

ShapeEditor.prototype._restoreStripInfo = function (this: ShapeEditor, snap: StripSnapshot) {
    const self = this;
 self.stripStore.restore(snap); };

ShapeEditor.prototype._stripInfoOnDelete = function (this: ShapeEditor, idx: number) {
    const self = this;
 self.stripStore.onDelete(idx); };

ShapeEditor.prototype._stripInfoOnInsert = function (this: ShapeEditor, idx: number) {
    const self = this;
 self.stripStore.onInsert(idx); };

ShapeEditor.prototype.deletePoint = function (this: ShapeEditor, idx: number) {
    const self = this;

        if (idx < 0 || idx >= self.screenmap_pts.length) return;
        self.pushUndo({
            type: 'delete',
            idx,
            screenmapPt: [...(self.screenmap_pts[idx] ?? [0, 0])],
            rawPt: [...(self.rawPts[idx] ?? [0, 0])],
            stripSnapshot: self._snapshotStripInfo(),
        });
        self.screenmap_pts.splice(idx, 1);
        self.rawPts.splice(idx, 1);
        self._stripInfoOnDelete(idx);
        if (self.selectedIdx === idx) self.selectedIdx = -1;
        else if (self.selectedIdx > idx) self.selectedIdx--;
        self.selection.onPointDelete(idx);
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.insertPointAt = function (this: ShapeEditor, insertIdx: number, screenmapPt: [number, number], rawPt: [number, number]) {
    const self = this;

        self.pushUndo({
            type: 'insert',
            idx: insertIdx,
            screenmapPt: [...screenmapPt],
            rawPt: [...rawPt],
            stripSnapshot: self._snapshotStripInfo(),
        });
        self.screenmap_pts.splice(insertIdx, 0, screenmapPt);
        self.rawPts.splice(insertIdx, 0, rawPt);
        self._stripInfoOnInsert(insertIdx);
        self.selection.onPointInsert(insertIdx);
        self.selectedIdx = insertIdx;
        self.syncPointSelection(insertIdx);
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.insertBetween = function (this: ShapeEditor, edgeIdx: number) {
    const self = this;

        if (edgeIdx < 0 || edgeIdx >= self.screenmap_pts.length - 1) return;
        const a = edgeIdx, b = edgeIdx + 1;
        const pa = self.screenmap_pts[a] ?? [0, 0], pb = self.screenmap_pts[b] ?? [0, 0];
        const ra = self.rawPts[a] ?? [0, 0], rb = self.rawPts[b] ?? [0, 0];
        const newScreenmap: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const newRaw: [number, number] = [(ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2];
        self.insertPointAt(a + 1, newScreenmap, newRaw);
    };

ShapeEditor.prototype.insertShiftForward = function (this: ShapeEditor) {
    const self = this;

        const N = self.screenmap_pts.length;
        if (N < 2) return;
        const sLast = self.screenmap_pts[N - 1] ?? [0, 0], sPrev = self.screenmap_pts[N - 2] ?? [0, 0];
        const rLast = self.rawPts[N - 1] ?? [0, 0], rPrev = self.rawPts[N - 2] ?? [0, 0];
        const dx = sLast[0] - sPrev[0];
        const dy = sLast[1] - sPrev[1];
        const newScreenmap: [number, number] = [sLast[0] + dx, sLast[1] + dy];
        const rdx = rLast[0] - rPrev[0];
        const rdy = rLast[1] - rPrev[1];
        const newRaw: [number, number] = [rLast[0] + rdx, rLast[1] + rdy];
        self.insertPointAt(N, newScreenmap, newRaw);
    };

ShapeEditor.prototype.insertShiftBack = function (this: ShapeEditor) {
    const self = this;

        const N = self.screenmap_pts.length;
        if (N < 2) return;
        const sFirst = self.screenmap_pts[0] ?? [0, 0], sSecond = self.screenmap_pts[1] ?? [0, 1];
        const rFirst = self.rawPts[0] ?? [0, 0], rSecond = self.rawPts[1] ?? [0, 1];
        const dx = sFirst[0] - sSecond[0];
        const dy = sFirst[1] - sSecond[1];
        const newScreenmap: [number, number] = [sFirst[0] + dx, sFirst[1] + dy];
        const rdx = rFirst[0] - rSecond[0];
        const rdy = rFirst[1] - rSecond[1];
        const newRaw: [number, number] = [rFirst[0] + rdx, rFirst[1] + rdy];
        self.insertPointAt(0, newScreenmap, newRaw);
    };

ShapeEditor.prototype.canvasToScreenmapCoords = function (this: ShapeEditor, canvasX: number, canvasY: number): [number, number] {
    const self = this;

        const { sX, sY, cosR, sinR, tx, ty } = self.getCurrentTransform();
        const wx = (canvasX - self.canvasW / 2) / self.camZoom - self.camPanX;
        const wy = (canvasY - self.canvasH / 2) / self.camZoom - self.camPanY;
        const dx = wx - tx, dy = wy - ty;
        return [(dx * cosR + dy * sinR) / sX, (-dx * sinR + dy * cosR) / sY];
    };

ShapeEditor.prototype.screenmapToRawCoords = function (this: ShapeEditor, sx: number, sy: number): [number, number] {
    const self = this;

        const rp0 = self.rawPts[0] ?? [0, 0];
        const sp0 = self.screenmap_pts[0] ?? [0, 0];
        return [
            rp0[0] + (sx - sp0[0]) / self.fitScale,
            rp0[1] + (sy - sp0[1]) / self.fitScale,
        ];
    };

ShapeEditor.prototype.findNearestEdge = function (this: ShapeEditor, canvasX: number, canvasY: number) {
    const self = this;

        if (self.lastTransformedPts.length < 2) return null;
        let bestDist = Infinity;
        let bestIdx = -1;
        let bestT = 0;
        let bestStripIdx = -1;
        const selectedStripIdx = self.selection.getStripIdx();
        const strips = self.stripInfo?.strips ?? [{ offset: 0, count: self.lastTransformedPts.length }];

        for (let stripIdx = 0; stripIdx < strips.length; stripIdx++) {
            const strip = strips[stripIdx];
            if (!strip) continue;
            const start = Math.max(0, strip.offset);
            const end = Math.min(self.lastTransformedPts.length, strip.offset + strip.count);
            // A flattened last-of-A -> first-of-B segment is not rendered,
            // so it must never become an invisible click target.
            for (let i = start; i < end - 1; i++) {
                const ltp_i = self.lastTransformedPts[i] ?? [0, 0];
                const ltp_i1 = self.lastTransformedPts[i + 1] ?? [0, 0];
                const [ax, ay] = self.toCanvasCoords(ltp_i[0], ltp_i[1]);
                const [bx, by] = self.toCanvasCoords(ltp_i1[0], ltp_i1[1]);

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
    const self = this;

        self.selectedIdx = -1;
        self.selection.clear();
        self.pointEditStripIdx = null;
        self.stripDragActive = false;
        self.stripDragIdx = -1;
        self.stripDragStartScreenmap = null;
        self.stripDragStartRaw = null;
        self.stripSnapActive = false;
        self.stripSnapXTargets = [];
        self.stripSnapYTargets = [];
        self.stripSnapStartCenter = null;
        self.stripSnapEngagedX = null;
        self.stripSnapEngagedY = null;
        self.stripRotateActive = false;
        self.stripRotateIdx = -1;
        self.stripRotateStartScreenmap = null;
        self.stripRotateStartRaw = null;
        self.stripRotateCenterSm = null;
        self.stripRotateCenterRaw = null;
        self.stripRotateStartAngle = 0;
        self.stripRotateLastDeg = 0;
        self.stripRotateHover = false;
        self.altQuasimode = false;
        self.isDragging = false;
        self.isPanning = false;
        self.rightButtonDown = false;
        self.rightClickMoved = false;
        self.gizmoActive = null;
        self.gizmoHover = null;
        self.gizmoDragStart = null;
        self.multiSelectedIdxs = new Set<number>();
        self.marqueeActive = false;
        self._marqueeBaseSelection = new Set<number>();
        self.multiDragActive = false;
        self.multiDragStartScreenmap = new Map<number, [number, number]>();
        self.multiDragStartRaw = new Map<number, [number, number]>();
        self.multiDragLastSdx = 0;
        self.multiDragLastSdy = 0;
        self._pendingMarquee = null;
        self.camPanX = 0;
        self.camPanY = 0;
        self.camZoom = 1;
        self.committedTransform.scale = 1;
        self.committedTransform.scaleX = 1;
        self.committedTransform.scaleY = 1;
        self.committedTransform.rotate = 0;
        self.committedTransform.translateX = 0;
        self.committedTransform.translateY = 0;
        self.undoStack.length = 0;
        self.redoStack.length = 0;
        self.updateUndoRedoButtons();
        self.hideContextMenu();
        self.lastBuiltPointCount = -1; // force full rebuild on next load
        self.setNeedsGeometryUpdate();
    };

ShapeEditor.prototype.showContextMenu = function (this: ShapeEditor, clientX: number, clientY: number, idx: number, edgeIdx: number, insideBBox?: boolean) {
    const self = this;

        self.ctxMenuIdx = idx;
        const onPointOrEdge = idx >= 0 || edgeIdx >= 0;
        // File ops: hide when on a point or edge
        if (self.ctxFileOps) self.ctxFileOps.style.display = onPointOrEdge ? 'none' : '';
        if (self.ctxFileOpsSep) self.ctxFileOpsSep.style.display = onPointOrEdge ? 'none' : '';
        // Save enabled when dirty
        const canSave = !self.dom_btn_save.disabled;
        if (self.ctxBtnSave) { self.ctxBtnSave.disabled = !canSave; self.ctxBtnSave.style.opacity = canSave ? '1' : '0.4'; }
        // Show delete only when a point is targeted
        if (self.ctxBtnDelete) self.ctxBtnDelete.style.display = idx >= 0 ? 'block' : 'none';
        // Show insert-between only when an edge is targeted
        if (self.ctxBtnInsertBetween) self.ctxBtnInsertBetween.style.display = edgeIdx >= 0 ? 'block' : 'none';
        // Shift insert: only when on a point/edge or inside the bbox
        const showShiftInsert = onPointOrEdge || insideBBox;
        const canInsert = self.screenmap_pts.length >= 2;
        if (self.ctxBtnInsertFwd) { self.ctxBtnInsertFwd.style.display = showShiftInsert ? 'block' : 'none'; self.ctxBtnInsertFwd.disabled = !canInsert; self.ctxBtnInsertFwd.style.opacity = canInsert ? '1' : '0.4'; }
        if (self.ctxBtnInsertBack) { self.ctxBtnInsertBack.style.display = showShiftInsert ? 'block' : 'none'; self.ctxBtnInsertBack.disabled = !canInsert; self.ctxBtnInsertBack.style.opacity = canInsert ? '1' : '0.4'; }
        // Copy strip only when a strip is selected
        if (self.ctxBtnCopyStrip) {
            const sIdx = self.selection.getStripIdx();
            self.ctxBtnCopyStrip.style.display = (sIdx !== null && sIdx >= 0) ? 'block' : 'none';
        }
        // Ruler buttons. Insert is always available. Duplicate / Delete only
        // when a ruler was under the right-click point (ctxMenuRulerIdx >= 0).
        if (self.ctxBtnInsertRuler) self.ctxBtnInsertRuler.style.display = 'block';
        const onRuler = self.ctxMenuRulerIdx >= 0;
        if (self.ctxBtnDuplicateRuler) self.ctxBtnDuplicateRuler.style.display = onRuler ? 'block' : 'none';
        if (self.ctxBtnDeleteRuler) self.ctxBtnDeleteRuler.style.display = onRuler ? 'block' : 'none';
        // Position - keep on screen. Must be an explicit 'block': the
        // .shapeeditor-ctx-menu class now carries `display: none` (inline
        // styles hoisted to CSS in #170), so clearing the inline value with
        // '' falls back to the class and the menu never appears.
        if (self.ctxMenu) { self.ctxMenu.style.left = `${String(clientX)}px`; self.ctxMenu.style.top = `${String(clientY)}px`; self.ctxMenu.style.display = 'block'; }
    };

ShapeEditor.prototype.hideContextMenu = function (this: ShapeEditor) {
    const self = this;

        if (self.ctxMenu) self.ctxMenu.style.display = 'none';
        if (self.ctxLoadSubmenu) self.ctxLoadSubmenu.style.display = 'none';
        self.ctxMenuIdx = -1;
        self.ctxMenuRulerIdx = -1;
        if (self.highlightedEdgeIdx >= 0) {
            self.highlightedEdgeIdx = -1;
            self.setNeedsRender();
        }
    };

ShapeEditor.prototype.hslAccentForStrip = function (this: ShapeEditor, s: number, total: number): string {

        if (total <= 1) return gfxColors.accentBlue();
        const colors = getStripColors(total);
        return colors[s] ?? gfxColors.accentBlue();
    };

ShapeEditor.prototype._withinPinNeighbor = function (this: ShapeEditor, stripIdx: number, dir: 1 | -1) {
    const self = this;

        const strips = self.stripStore.getStrips();
        if (stripIdx < 0 || stripIdx >= strips.length) return -1;
        const pin = self._pinOfStrip(self.nn(strips[stripIdx]));
        let i = stripIdx + dir;
        while (i >= 0 && i < strips.length) {
            if (self._pinOfStrip(self.nn(strips[i])) === pin) return i;
            i += dir;
        }
        return -1;
    };

ShapeEditor.prototype.renderStripsPanel = function (this: ShapeEditor) {
    const self = this;

        const strips = self.stripStore.getStrips();
        self.dom_strips_list.innerHTML = '';
        // Keep the panel visible whenever we have a backup to surface — even
        // when no strips are currently loaded — so the user can find "Restore
        // backup…" after pressing New.
        const haveBackup = !!getBackup();
        if (strips.length === 0) {
            self.dom_strips_panel.style.display = haveBackup ? '' : 'none';
            self.renderSelectedStripRow();
            return;
        }
        self.dom_strips_panel.style.display = '';
        self.dom_strips_list.classList.toggle('chain-mode', self.editorMode === 'chain');
        self.dom_strips_list.classList.toggle('reorder-mode', self.editorMode === 'reorder');
        const selStripIdx = self.selection.getStripIdx();
        const total = strips.length;

        // Group strip indices under pins in first-appearance order (§1.1).
        const pinOrder: string[] = [];
        const groups = new Map<string, number[]>();
        for (let i = 0; i < strips.length; i++) {
            const p = self._pinOfStrip(self.nn(strips[i]));
            if (!groups.has(p)) { groups.set(p, []); pinOrder.push(p); }
            groups.get(p)?.push(i);
        }

        const buildStripRow = (i: number) => {
            const s = self.nn(strips[i]);
            const row = document.createElement('div');
            row.className = 'strip-row' + (i === selStripIdx ? ' active' : '');
            row.dataset.stripIdx = String(i);
            row.dataset.pinId = self._pinOfStrip(s);

            const grip = document.createElement('span');
            grip.className = 'strip-grip';
            grip.textContent = '⠿';
            grip.title = 'Drag within pin to reorder | drag onto a pin header to repin';
            grip.draggable = true;
            grip.dataset.stripIdx = String(i);
            row.appendChild(grip);

            const swatch = document.createElement('span');
            swatch.className = 'strip-swatch';
            swatch.style.background = self.hslAccentForStrip(i, total);
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

            row.appendChild(mkBtn('▲', 'Move up within pin', 'up', self._withinPinNeighbor(i, -1) < 0));
            row.appendChild(mkBtn('▼', 'Move down within pin', 'down', self._withinPinNeighbor(i, 1) < 0));
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
            const idxs = self.nn(groups.get(pin), `pin ${pin} missing from groups`);
            const ledTotal = idxs.reduce((a: number, i: number) => a + self.nn(strips[i]).count, 0);
            const det = document.createElement('details');
            det.className = 'pin-group';
            det.dataset.pinId = pin;
            det.open = !self.collapsedPins.has(pin);
            det.addEventListener('toggle', () => {
                if (det.open) self.collapsedPins.delete(pin);
                else self.collapsedPins.add(pin);
            }, { signal: self.signal });

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
                body.appendChild(buildStripRow(self.nn(idxs[k])));
                // Connector rows between same-pin strips — visible only in
                // Chain mode (§1.6); click opens the inline connector menu.
                if (self.editorMode === 'chain' && k < idxs.length - 1) {
                    connectorN++;
                    const cr = document.createElement('div');
                    cr.className = 'connector-row';
                    cr.dataset.upIdx = String(self.nn(idxs[k]));
                    cr.dataset.downIdx = String(self.nn(idxs[k + 1]));
                    cr.textContent = `──(${String(connectorN)})──▶`;
                    cr.title = 'Connector — click for Swap / Split / Move options';
                    body.appendChild(cr);
                }
            }
            det.appendChild(body);

            self.dom_strips_list.appendChild(det);
        }
        self.renderSelectedStripRow();
    };

ShapeEditor.prototype.renderBackupRow = function (this: ShapeEditor) {
    const self = this;

        const b = getBackup();
        if (!b?.meta) {
            self.dom_strips_backup_row.style.display = 'none';
            self.dom_strips_btn_restore_backup.disabled = true;
            return;
        }
        const m = b.meta;
        const stripCount = typeof m.stripCount === 'number' ? m.stripCount : 0;
        const ledCount = typeof m.ledCount === 'number' ? m.ledCount : 0;
        const when: string = typeof m.savedAt === 'number' ? self._relativeTime(m.savedAt) as string : '';
        const summary = `${String(stripCount)} strip${stripCount === 1 ? '' : 's'} · ${String(ledCount)} LED${ledCount === 1 ? '' : 's'} · ${when}`;
        self.dom_strips_backup_summary.textContent = summary;
        self.dom_strips_backup_row.style.display = '';
        self.dom_strips_btn_restore_backup.disabled = false;
    };

ShapeEditor.prototype.doRestoreBackupFromButton = function (this: ShapeEditor) {
    const self = this;

        const b = getBackup();
        if (!b) return;
        const beforeJson = getScreenmap();
        const restored = restoreBackup();
        if (!restored) return;
        self.pushUndo({
            type: 'restore-backup',
            beforeJson: typeof beforeJson === 'string' ? beforeJson : null,
            afterJson: restored,
        });
        self.load_screenmap_data(restored);
        self.renderBackupRow();
        void self._toastSuccess('Backup restored');
    };

ShapeEditor.prototype.setEditorMode = function (this: ShapeEditor, mode: string | null) {
    const self = this;

        const m = (mode === 'chain' || mode === 'reorder') ? mode : null;
        if (m === self.editorMode) return;
        self.editorMode = m;
        self.connectorDrag = null;
        self.startHandleDrag = null;
        if (m) (self.dom_strips_panel as HTMLDetailsElement).open = true;
        self.dom_strips_btn_chain.classList.toggle('active', m === 'chain');
        self.dom_strips_btn_chain.setAttribute('aria-pressed', m === 'chain' ? 'true' : 'false');
        self.dom_strips_btn_reorder.classList.toggle('active', m === 'reorder');
        self.dom_strips_btn_reorder.setAttribute('aria-pressed', m === 'reorder' ? 'true' : 'false');
        // Reorder mode dims the canvas (§1.6); wrapper exists post-initRenderer.
        if (self.wrapper) self.wrapper.classList.toggle('canvas-dim', m === 'reorder');
        self._hideConnectorMenu();
        self.renderStripsPanel();
        self._updateHintStrip();
        self.setNeedsRender();
    };

ShapeEditor.prototype.renderSelectedStripRow = function (this: ShapeEditor) {
    const self = this;

        const strips = self.stripStore.getStrips();
        const sIdx = self.selection.getStripIdx();
        if (sIdx === null || sIdx < 0 || sIdx >= strips.length) {
            self.dom_strips_selected_row.style.display = 'none';
            return;
        }
        const s = self.nn(strips[sIdx]);
        const pin = self._pinOfStrip(s);
        self.dom_strips_selected_row.style.display = '';
        self.dom_strips_selected_label.textContent = `Selected: ${s.name} (${String(pin)})`;
        self.dom_strips_move_pin.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Move to pin…';
        placeholder.selected = true;
        placeholder.disabled = true;
        self.dom_strips_move_pin.appendChild(placeholder);
        for (const p of self.stripStore.getPinOrder()) {
            if (p === pin) continue;
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            self.dom_strips_move_pin.appendChild(opt);
        }
        const newOpt = document.createElement('option');
        newOpt.value = '__new__';
        newOpt.textContent = 'New pin…';
        self.dom_strips_move_pin.appendChild(newOpt);
    };

ShapeEditor.prototype._reverseStripInPlace = function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        const info = self.stripStore.get();
        if (!info) return false;
        const strip = info.strips[stripIdx];
        if (!strip || strip.count < 2) return false;
        const lo = strip.offset, hi = strip.offset + strip.count;
        // Reverse the flat slice in both screenmap_pts and rawPts.
        const sm = self.screenmap_pts.slice(lo, hi).reverse();
        const rw = self.rawPts.slice(lo, hi).reverse();
        for (let i = 0; i < sm.length; i++) {
            self.screenmap_pts[lo + i] = self.nn(sm[i]);
            self.rawPts[lo + i] = self.nn(rw[i]);
        }
        if (Array.isArray(strip.points)) strip.points.reverse();
        if (Array.isArray(info.allPoints)) {
            for (let i = 0; i < sm.length; i++) info.allPoints[lo + i] = [self.nn(sm[i])[0], self.nn(sm[i])[1]];
        }
        return true;
    };

ShapeEditor.prototype.doReverseStrip = function (this: ShapeEditor, stripIdx: number) {
    const self = this;

        if (!self._reverseStripInPlace(stripIdx)) return;
        self.pushUndo({ type: 'strip-reverse', stripIdx });
        self._persistMultiStrip();
        self.renderStripsPanel();
        self.setNeedsGeometryUpdate();
    };
