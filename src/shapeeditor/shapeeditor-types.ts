// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Type-only module for the ShapeEditor refactor.

import type { CatalogEntry, PanelOpts } from './panel-catalog';

/** Undo/redo action object — discriminated by `type`, extra fields vary per action. */
interface UndoAction { type: string; [key: string]: unknown }

/** Insert-dialog / accordion form values. */
interface InsertDialogOpts {
    catalogId: string;
    wiring: string;
    corner: string;
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    spacing: number;
    snap: boolean;
    grid: number;
    place?: string | undefined;
}

/** An oriented bounding box in canvas space. */
interface OBBox { cx: number; cy: number; hw: number; hh: number; cos: number; sin: number; }

/** Gizmo drag-start snapshot. */
interface GizmoDragStart { scale: number; scaleX: number; scaleY: number; rotate: number; translateX: number; translateY: number; canvasX: number; canvasY: number; bboxCenter: { x: number; y: number } | null; }

/** Image gizmo drag-start snapshot. */
interface BgGizmoDragStart { scale: number; rotate: number; tx: number; ty: number; canvasX: number; canvasY: number; bboxCenter: { x: number; y: number } | null; }

/** Image bounding box in canvas space. */
interface BgImageBBox { cx: number; cy: number; hw: number; hh: number; cos: number; sin: number; }

/** Gizmo handle hit-test result. */
interface GizmoHandle { id?: string; x: number; y: number; r?: number; cursor?: string; strip?: number; up?: number; down?: number; x1?: number; y1?: number; x2?: number; y2?: number; hx?: number; hy?: number; }

/** One ruler entry. Endpoints are in screenmap (world) coordinates. */
interface RulerEntry { ax: number; ay: number; bx: number; by: number; }

/** Active ruler drag — which ruler, which handle, and the snapshot at drag start. */
interface RulerDragStart { cx: number; cy: number; ax: number; ay: number; bx: number; by: number; }
interface RulerDragHandle { idx: number; kind: 'a' | 'b' | 'body'; }

/** Connector drag state. */
interface ConnectorDrag { upIdx: number; x: number; y: number; targetIdx: number | null; }

interface StartHandleDrag { stripIdx: number; x: number; y: number; targetIdx: number | null; }

/** Panel placing state. */
interface PlacingState { entry: CatalogEntry; opts: PanelOpts; localPts: [number, number][]; ghostWorld: [number, number] | null; }

/** Paste state. */
interface PasteStateItem { name: string; points: [number, number][]; diameter?: number; video_offset?: number; offsetsLocal?: [number, number][]; }

interface PasteStateActive { strips: PasteStateItem[]; ghostWorld: [number, number] | null; totalCount: number; }

interface PresetEntry { file: string; name: string; }

/** Strip drag start snapshot. */
type StripDragPt = [number, number];

export type {
    UndoAction,
    InsertDialogOpts,
    OBBox,
    GizmoDragStart,
    BgGizmoDragStart,
    BgImageBBox,
    GizmoHandle,
    RulerEntry,
    RulerDragStart,
    RulerDragHandle,
    ConnectorDrag,
    StartHandleDrag,
    PlacingState,
    PasteStateItem,
    PasteStateActive,
    StripDragPt,
    PresetEntry,
};
