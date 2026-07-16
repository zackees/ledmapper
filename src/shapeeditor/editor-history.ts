// Named ShapeEditor method bundle: history.
import type { ShapeEditor } from './shapeeditor-class';
import { safeStorage } from "../services/storage";
import type { UndoAction } from "./shapeeditor-types";
import type { StripSnapshot } from "./strips-model";
import { notePinMutation } from "../screenmap-store";

export interface EditorHistoryMethods {
    pushUndo: (action: UndoAction) => void;
    applyAction: (action: UndoAction) => void;
    applyInverse: (action: UndoAction) => void;
    isStripAction: (action: UndoAction | null | undefined) => boolean | null | undefined;
    isPinMutationAction: (action: UndoAction | null | undefined) => boolean | null | undefined;
    performUndo: () => void;
    performRedo: () => void;
    updateUndoRedoButtons: () => void;
}

export const editorHistoryMethods: EditorHistoryMethods & ThisType<ShapeEditor> = {
    pushUndo(this: ShapeEditor, action: UndoAction){

        this.undoStack.push(action);
        this.redoStack.length = 0;
        this.updateUndoRedoButtons();
        this.markDirty();
    },
    applyAction(this: ShapeEditor, action: UndoAction){

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
        } else if (action.type === 'group-selection-translate') {
            for (const idx of a.stripIdxs as number[]) this._applyStripTranslate(idx, a.sdx as number, a.sdy as number);
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
        } else if (action.type === 'group-selection-rotate') {
            const deg = a.deltaDeg as number;
            for (const idx of a.stripIdxs as number[]) this._applyStripRotate(idx, deg * Math.PI / 180, a.centerSm as { x: number; y: number }, a.centerRaw as { x: number; y: number });
        } else if (action.type === 'paste-strips') {
            this._doPasteStrips(action);
        } else if (action.type === 'restore-backup') {
            if (typeof a.afterJson === 'string') {
                this.load_screenmap_data(a.afterJson);
            }
        }
    },
    applyInverse(this: ShapeEditor, action: UndoAction){

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
        } else if (action.type === 'group-selection-translate') {
            for (const idx of a.stripIdxs as number[]) this._applyStripTranslate(idx, -(a.sdx as number), -(a.sdy as number));
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
        } else if (action.type === 'group-selection-rotate') {
            const deg = a.deltaDeg as number;
            for (const idx of a.stripIdxs as number[]) this._applyStripRotate(idx, -deg * Math.PI / 180, a.centerSm as { x: number; y: number }, a.centerRaw as { x: number; y: number });
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
    },
    isStripAction(this: ShapeEditor, action: UndoAction | null | undefined){

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
            || action.type === 'group-selection-translate'
            || action.type === 'strip-rotate'
            || action.type === 'group-selection-rotate'
            || action.type === 'paste-strips'
        );
    },
    isPinMutationAction(this: ShapeEditor, action: UndoAction | null | undefined){

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
    },
    performUndo(this: ShapeEditor){

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
    },
    performRedo(this: ShapeEditor){

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
    },
    updateUndoRedoButtons(this: ShapeEditor){

        // Mirrors the old direct `dom_btn_reset.disabled = undoStack.length
        // === 0 && redoStack.length === 0` write: every call site here is
        // immediately followed by a markDirty()/clearDirty() call that can
        // supersede this with the broader "uncommitted change" dirty flag
        // (e.g. mid-drag preview), so this is the synchronous fallback for
        // the one call site (clearEditingState) that isn't.
        this._dirty = this.undoStack.length > 0 || this.redoStack.length > 0;
        this.refreshCommandStates();
    },
};
