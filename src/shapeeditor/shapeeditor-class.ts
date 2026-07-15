// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// ShapeEditor class skeleton (fields, constructor, start, destroy).

import { type WebGLRenderer, type Scene, type OrthographicCamera, type BufferGeometry, type LineSegments, type Line, type Mesh, type Points, type BufferAttribute, type Texture, type PointsMaterial } from 'three';
import type { StripInfo } from './strips-model';

import type { PointArrayWithDiameter } from '../common';
import { type createLabelRenderer } from '../label-render';


import { type StripStore } from './strips-model';
import { type Selection } from './selection';
import type { PresetPickerHandle } from '../ui/preset-picker';
import type { DirectionArrowTransition, DirectionArrowTransitionPhase } from './direction-arrow-transition';

import type { UndoAction, OBBox, StripRotateObbSnapshot, GizmoDragStart, BgGizmoDragStart, BgImageBBox, GizmoHandle, RulerEntry, RulerDragStart, RulerDragHandle, ConnectorDrag, StartHandleDrag, PlacingState, PasteStateActive, StripDragPt, PresetEntry } from './shapeeditor-types';
import type { EditorCoreMethods } from './editor-core';
import type { EditorTransformMethods } from './editor-transform';
import type { EditorIoMethods } from './editor-io';
import type { EditorPointsMethods } from './editor-points';
import type { EditorHistoryMethods } from './editor-history';
import type { EditorStripsMethods } from './editor-strips';
import type { EditorConnectorsMethods } from './editor-connectors';
import type { EditorRendererMethods } from './editor-renderer';
import type { EditorHelpMethods } from './editor-help';
import type { EditorBackgroundMethods } from './editor-background';
import type { EditorRulersMethods } from './editor-rulers';
import type { EditorOverlayMethods } from './editor-overlay';
import type { EditorInteractionMethods } from './editor-interaction';
import type { EditorPanelsMethods } from './editor-panels';
import type { EditorPasteMethods } from './editor-paste';
import type { SnapDocumentTransform, StripSnapEngagement, StripSnapGeometry, StripSnapTargetSet } from './strip-snap-targets';

// Prototype bundles are composed into this class through the typed interface below.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ShapeEditor {
    // Drag preview (issue #111): during a gizmo drag the geometry buffer is
    // frozen at the values captured in `gizmoDragStart`; the live transform
    // delta is applied as a model matrix on the points mesh / outline, and a
    // matching ctx affine on the overlay. `_dragPreviewActive` tracks whether
    // we last applied that delta so animate() can reset on the way out.
    declare _dragPreviewActive: boolean;
    // Multi-LED marquee selection + group drag.
    declare multiSelectedIdxs: Set<number>;
    declare marqueeActive: boolean;
    declare marqueeStartCx: number;
    declare marqueeStartCy: number;
    declare marqueeCurCx: number;
    declare marqueeCurCy: number;
    declare marqueeMode: 'replace' | 'add' | 'toggle';
    declare _marqueeBaseSelection: Set<number>;
    // Ctrl+mousedown on empty area is ambiguous: a click means "append point"
    // (existing power-user shortcut) and a drag means marquee select. Defer
    // the decision to mousemove (drag past threshold â†’ marquee) / mouseup
    // (no movement â†’ append).
    declare _pendingMarquee: { cx: number; cy: number; mode: 'replace' | 'add' | 'toggle'; appendOnClick: boolean } | null;
    declare multiDragActive: boolean;
    declare multiDragStartCanvasX: number;
    declare multiDragStartCanvasY: number;
    declare multiDragStartScreenmap: Map<number, [number, number]>;
    declare multiDragStartRaw: Map<number, [number, number]>;
    declare multiDragLastSdx: number;
    declare multiDragLastSdy: number;
    declare qei: (sel: string) => HTMLInputElement;
    declare qeb: (sel: string) => HTMLButtonElement;
    declare mainEl: HTMLElement;
    declare dom_btn_new: HTMLButtonElement;
    declare dom_btn_upload_screenmap: HTMLInputElement;
    declare dom_btn_load_screenmap: HTMLButtonElement;
    declare dom_sel_preset_mount: HTMLElement;
    declare presetPicker: PresetPickerHandle | null;
    declare dom_txt_scale: HTMLInputElement;
    declare dom_txt_scale_x: HTMLInputElement;
    declare dom_txt_scale_y: HTMLInputElement;
    declare dom_txt_rotate: HTMLInputElement;
    declare dom_txt_translate_x: HTMLInputElement;
    declare dom_txt_translate_y: HTMLInputElement;
    declare dom_txt_diameter: HTMLInputElement;
    declare dom_chk_snap_back: HTMLInputElement;
    declare dom_rng_snap_back_px: HTMLInputElement;
    declare dom_rng_snap_back_px_val: HTMLElement;
    declare snapBackEnabled: boolean;
    declare snapBackPx: number;
    declare dom_transform_overlay: HTMLElement;
    declare dom_btn_overlay_collapse: HTMLButtonElement;
    declare dom_btn_overlay_expand: HTMLButtonElement;
    declare overlayCollapsed: boolean;
    declare dom_btn_save: HTMLButtonElement;
    declare dom_btn_reset: HTMLButtonElement;
    declare dom_btn_undo: HTMLButtonElement;
    declare dom_btn_redo: HTMLButtonElement;
    declare dom_bg_accordion: HTMLElement;
    declare dom_btn_upload_image: HTMLInputElement;
    declare dom_txt_image_opacity: HTMLInputElement;
    declare dom_txt_image_scale: HTMLInputElement;
    declare dom_txt_image_rotate: HTMLInputElement;
    declare dom_txt_image_tx: HTMLInputElement;
    declare dom_txt_image_ty: HTMLInputElement;
    declare dom_btn_remove_image: HTMLButtonElement;
    declare ac: AbortController;
    declare SCALE_MIN: number;
    declare SCALE_MAX: number;
    declare screenmap_pts: PointArrayWithDiameter;
    declare rawPts: [number, number][];
    declare origWidth: number;
    declare origHeight: number;
    declare fitScale: number;
    declare origDiameter: number;
    declare stripStore: StripStore;
    declare stripInfo: StripInfo | null;
    declare selection: Selection;
    declare editorMode: string | null;
    declare connectorDrag: ConnectorDrag | null;
    declare startHandleDrag: StartHandleDrag | null;
    declare _chainGeom: { connectors: GizmoHandle[]; starts: GizmoHandle[]; ends: GizmoHandle[]; crossBadges: GizmoHandle[] };
    declare labelRenderer: ReturnType<typeof createLabelRenderer>;
    declare canvasW: number;
    declare canvasH: number;
    declare renderer: WebGLRenderer | null;
    declare scene: Scene | null;
    declare camera: OrthographicCamera | null;
    declare wrapper: HTMLElement | null;
    declare pointsMesh: Points | null;
    declare pointsGeometry: BufferGeometry | null;
    declare pointsMaterial: PointsMaterial | null;
    declare circleTexture: Texture;
    declare gridLines: LineSegments | null;
    declare bgImageMesh: Mesh | null;
    declare bgImageTexture: Texture | null;
    declare screenmapOutline: Line | null;
    declare infoDiv: HTMLElement | null;
    declare placeholderDiv: HTMLElement | null;
    declare overlayCanvas: HTMLCanvasElement | null;
    declare overlayCtx: CanvasRenderingContext2D | null;
    declare tooltipLedIdx: number;
    declare tooltip: HTMLElement | null;
    declare lastTransformedPts: [number, number][];
    declare isHovering: boolean;
    declare overlayAlpha: number;
    declare directionArrowCount: number;
    declare directionArrowLayers: { count: number; opacity: number }[];
    declare directionArrowTransitionPhase: DirectionArrowTransitionPhase;
    declare directionArrowTransition: DirectionArrowTransition;
    declare ptsBBox: OBBox | null;
    declare geometryDirty: boolean;
    declare frameDirty: boolean;
    declare lastBuiltPointCount: number;
    declare pointsColorAttr: BufferAttribute | null;
    declare selectedIdx: number;
    declare isDragging: boolean;
    declare dragStartCanvasX: number;
    declare dragStartCanvasY: number;
    declare dragStartScreenmapPt: [number, number] | null;
    declare dragStartRawPt: [number, number] | null;
    declare pointEditStripIdx: number | null;
    declare stripDragActive: boolean;
    declare stripDragIdx: number;
    declare stripDragStartScreenmap: StripDragPt[] | null;
    declare stripDragStartRaw: StripDragPt[] | null;
    declare stripDragLastSdx: number;
    declare stripDragLastSdy: number;
    declare stripSnapStartGeometry: StripSnapGeometry | null;
    declare stripSnapTransform: SnapDocumentTransform | null;
    declare stripSnapTargets: StripSnapTargetSet;
    declare stripSnapEngagement: StripSnapEngagement;
    // Per-strip (sub-group) rotation handle â€” independent of the
    // whole-screenmap rotation gizmo. Active only while the user is
    // dragging the strip's dedicated rotate handle.
    declare stripRotateActive: boolean;
    declare stripRotateIdx: number;
    declare stripRotateStartScreenmap: [number, number][] | null;
    declare stripRotateStartRaw: [number, number][] | null;
    declare stripRotateCenterSm: { x: number; y: number } | null;
    declare stripRotateCenterRaw: { x: number; y: number } | null;
    declare stripRotateStartAngle: number;
    declare stripRotateLastDeg: number;
    declare stripRotateHover: boolean;
    declare stripRotateObbSnapshot: StripRotateObbSnapshot | null;
    declare stripRotateDrawRevision: number;
    declare stripRotateLastDrawnVisual: {
        obb: StripRotateObbSnapshot;
        handle: { anchorX: number; anchorY: number; handleX: number; handleY: number; centerX: number; centerY: number };
    } | null;
    declare altQuasimode: boolean;
    declare ctxMenu: HTMLElement | null;
    declare ctxMenuIdx: number;
    declare ctxBtnSave: HTMLButtonElement | null;
    declare ctxBtnLoadScreenmap: HTMLButtonElement | null;
    declare ctxLoadSubmenu: HTMLElement | null;
    declare ctxLoadImageInput: HTMLInputElement | null;
    declare ctxFileOps: HTMLElement | null;
    declare ctxFileOpsSep: HTMLElement | null;
    declare ctxBtnDelete: HTMLButtonElement | null;
    declare ctxBtnInsertBetween: HTMLButtonElement | null;
    declare ctxBtnInsertFwd: HTMLButtonElement | null;
    declare ctxBtnInsertBack: HTMLButtonElement | null;
    declare ctxBtnCopyStrip: HTMLButtonElement | null;
    declare ctxRulerSep: HTMLElement | null;
    declare ctxBtnInsertRuler: HTMLButtonElement | null;
    declare ctxBtnDuplicateRuler: HTMLButtonElement | null;
    declare ctxBtnDeleteRuler: HTMLButtonElement | null;
    declare hintStripTextEl: HTMLElement | null;
    declare hintStripHelpBtn: HTMLButtonElement | null;
    declare _autoOpenHelpScheduled: boolean;
    declare highlightedEdgeIdx: number;
    declare loadedPresets: PresetEntry[];
    declare layoutLoadGeneration: number;
    declare ctxBtnClass: string;
    declare camPanX: number;
    declare camPanY: number;
    declare camZoom: number;
    declare isPanning: boolean;
    declare panStartX: number;
    declare panStartY: number;
    declare panStartCamX: number;
    declare panStartCamY: number;
    declare rightButtonDown: boolean;
    declare rightClickMoved: boolean;
    declare zoomStartY: number;
    declare zoomStartLevel: number;
    declare gizmoActive: string | null;
    declare gizmoHover: string | null;
    declare gizmoDragStart: GizmoDragStart | null;
    declare shiftHeld: boolean;
    declare bgImageFitW: number;
    declare bgImageFitH: number;
    declare bgImageBBox: BgImageBBox | null;
    declare bgGizmoActive: string | null;
    declare bgGizmoHover: string | null;
    declare bgGizmoDragStart: BgGizmoDragStart | null;
    declare committedTransform: Record<string, number>;
    declare undoStack: UndoAction[];
    declare redoStack: UndoAction[];
    declare dom_strips_panel: HTMLElement;
    declare dom_strips_list: HTMLElement;
    declare collapsedPins: Set<unknown>;
    declare dom_strips_backup_row: HTMLElement;
    declare dom_strips_backup_summary: HTMLElement;
    declare dom_strips_btn_restore_backup: HTMLButtonElement;
    declare dom_strips_btn_add_pin: HTMLElement;
    declare dom_strips_btn_chain: HTMLElement;
    declare dom_strips_btn_reorder: HTMLElement;
    declare dom_strips_selected_row: HTMLElement;
    declare dom_strips_selected_label: HTMLElement;
    declare dom_strips_move_pin: HTMLSelectElement;
    declare dom_strips_rotate_left: HTMLButtonElement;
    declare dom_strips_rotate_right: HTMLButtonElement;
    declare dom_strips_rotate_degrees: HTMLInputElement;
    declare dom_strips_rotate_apply: HTMLButtonElement;
    declare dom_strips_show_chain: HTMLInputElement;
    declare showChainArrows: boolean;
    declare connectorMenuEl: HTMLDivElement | null;
    declare rafId: number | null;
    declare _gestureNoticeShown: boolean;
    declare screenmapDropTarget: Element;
    declare imageDropTarget: Element;
    declare bgImageObjectURL: string | null;
    declare bgImageControls: (HTMLInputElement | HTMLButtonElement)[];
    declare deleteBgConfirmEl: HTMLElement | null;
    declare rulers: RulerEntry[];
    declare rulerDrag: RulerDragHandle | null;
    declare rulerDragStart: RulerDragStart | null;
    declare ctxMenuRulerIdx: number;
    declare ctxMenuClickX: number;
    declare ctxMenuClickY: number;
    declare RULER_HANDLE_R: number;
    declare LONG_PRESS_MS: number;
    declare LONG_PRESS_MOVE_TOL: number;
    declare touchMode: string;
    declare touchStartClientX: number;
    declare touchStartClientY: number;
    declare touchStartCanvasX: number;
    declare touchStartCanvasY: number;
    declare longPressTimer: ReturnType<typeof setTimeout> | null;
    declare multiPanStartCamPanX: number;
    declare multiPanStartCamPanY: number;
    declare multiPinchStartZoom: number;
    declare multiStartCentroid: [number, number] | null;
    declare multiStartDist: number;
    declare placingState: PlacingState | null;
    declare pendingNewStripPin: string | null;
    declare pasteState: PasteStateActive | null;
    declare dom_panel_buttons: HTMLElement;
    declare dom_pp_wiring: HTMLSelectElement;
    declare dom_pp_corner: HTMLSelectElement;
    declare dom_pp_rotation: HTMLSelectElement;
    declare dom_pp_flipH: HTMLInputElement;
    declare dom_pp_flipV: HTMLInputElement;
    declare dom_pp_spacing: HTMLInputElement;
    declare dom_pp_snap: HTMLInputElement;
    declare dom_pp_grid: HTMLInputElement;
    declare dom_pp_status: HTMLElement;
    declare dom_pp_open_dialog: HTMLElement;
    declare signal: AbortSignal;
    declare container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this._construct();
    }

    declare _construct: () => void;
    declare start: () => void;
    declare destroy: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ShapeEditor extends
    EditorCoreMethods,
    EditorTransformMethods,
    EditorIoMethods,
    EditorPointsMethods,
    EditorHistoryMethods,
    EditorStripsMethods,
    EditorConnectorsMethods,
    EditorRendererMethods,
    EditorHelpMethods,
    EditorBackgroundMethods,
    EditorRulersMethods,
    EditorOverlayMethods,
    EditorInteractionMethods,
    EditorPanelsMethods,
    EditorPasteMethods
{}
