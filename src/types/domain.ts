/**
 * Shared domain types for the ledmapper application.
 * Phase 2 of the TypeScript migration.
 */

// ---------------------------------------------------------------------------
// Screenmap JSON interchange format
// ---------------------------------------------------------------------------

/** A single strip in the screenmap JSON format. */
export interface ScreenmapStrip {
    x: number[];
    y: number[];
    diameter?: number;
    pin?: string;
    video_offset?: number;
    video_offset_override?: boolean;
}

/** Top-level screenmap JSON object (v1: FastLED ScreenMap shape). */
export interface ScreenmapJson {
    /** Strip data keyed by strip name. Optional only to allow graceful validation of untrusted JSON. */
    map?: Record<string, ScreenmapStrip>;
    /** When present, must be 1 for the v1 parser to take this path. */
    version?: number;
}

// ---------------------------------------------------------------------------
// Screenmap v2 interchange format (see ledmapper issue #92)
// ---------------------------------------------------------------------------

/** A UI group entry in the v2 schema. Free-form metadata; only `color` is required. */
export interface ScreenmapV2Group {
    color: string;
    [key: string]: unknown;
}

/**
 * A v2 segment — one physical LED chain.
 *
 *   - `id`, `pin`, `group` required.
 *   - `x` and `y` required parallel float arrays of equal length.
 *   - `z` optional parallel float array (same length when present).
 *   - `parent` present iff this segment is a fork; value is another segment's `id`.
 *   - `offset` optional integer or null; only meaningful on forks. `null` or
 *     omitted = tip (parent's last LED). Non-negative N = forward index.
 *     Negative -N = N positions before the tip.
 */
export interface ScreenmapV2Segment {
    id: string;
    pin: number | string;
    group: string;
    x: number[];
    y: number[];
    z?: number[];
    /** LED diameter in cm. Preserved from v1 conversions; the editor's
     *  preview / FastLED ScreenMap export read it. Optional. */
    diameter?: number;
    parent?: string;
    offset?: number | null;
    /** Ledmapper-specific extension (not part of the canonical v2 schema):
     *  per-segment override of where this strip's frames start in the
     *  recorded video. Only meaningful when `video_offset_override` is true. */
    video_offset?: number;
    video_offset_override?: boolean;
}

/** Top-level v2 screenmap document. */
export interface ScreenmapV2 {
    /** When present, must be 2. */
    version?: 2;
    groups: Record<string, ScreenmapV2Group>;
    segments: ScreenmapV2Segment[];
}

// ---------------------------------------------------------------------------
// Multi-strip parse results
// ---------------------------------------------------------------------------

/** A single LED point from a parsed strip (flat [x, y] tuple). */
export type StripPoint = [number, number];

/** A parsed strip entry from parseScreenmapMultiStrip(). */
export interface ParsedStrip {
    name: string;
    points: StripPoint[];
    diameter: number | undefined;
    offset: number;
    count: number;
    video_offset: number;
    pin: string;
    videoOffsetOverride: boolean;
}

/** Return value of parseScreenmapMultiStrip(). */
export interface MultiStripParseResult {
    strips: ParsedStrip[];
    allPoints: StripPoint[];
    totalCount: number;
}

// ---------------------------------------------------------------------------
// RGB video format
// ---------------------------------------------------------------------------

/** Header metadata derived from a .fled video file's payload. */
export interface RgbVideoHeader {
    ledCount: number;
    frameCount: number;
    byteLength: number;
}

// ---------------------------------------------------------------------------
// Label layout engine
// ---------------------------------------------------------------------------

/** An input label anchor for the layout engine. */
export interface LabelAnchorInput {
    id: string;
    anchorX: number;
    anchorY: number;
    w: number;
    h: number;
    priority?: number;
}

/** A resolved label placement from the layout engine. */
export interface LabelPlacement {
    id: string;
    anchorX: number;
    anchorY: number;
    labelX: number;
    labelY: number;
    w: number;
    h: number;
    needsLeader: boolean;
    leaderX0: number;
    leaderY0: number;
    leaderX1: number;
    leaderY1: number;
    hidden: boolean;
    demoted: boolean;
}

/** Canvas bounding box for layout constraint. */
export interface CanvasBounds {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** An obstacle box (soft blocker) for the layout engine. */
export interface ObstacleBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Options for the label layout engine. */
export interface LabelLayoutOptions {
    padding?: number;
    ringSlots?: number;
    ringSteps?: number;
    baseRadius?: number;
    radiusStep?: number;
    leaderThreshold?: number | null;
    canvasBounds?: CanvasBounds | null;
    obstacles?: ObstacleBox[] | (() => ObstacleBox[]) | null;
    seedSlots?: boolean;
}

/** Debug dump from the layout engine. */
export interface LabelLayoutDebugDump {
    placements: LabelPlacement[];
    counters: { layoutRuns: number; translations: number; cacheHits: number };
}

/** The stateful label layout engine API. */
export interface LabelLayoutEngine {
    layout(labels: LabelAnchorInput[], callOptions?: LabelLayoutOptions): LabelPlacement[];
    invalidate(): void;
    debugDump(): LabelLayoutDebugDump;
}

// ---------------------------------------------------------------------------
// Bloom profiles and ranges
// ---------------------------------------------------------------------------

/** Auto-bloom density profile constants. */
export interface BloomProfile {
    floor: number;
    maxDense: number;
    maxSparse: number;
}

/** Input to computeAutoBloomRange(). */
export interface BloomAutoRangeInput {
    ledSpacing: number;
    sceneExtent: number;
    profile?: Partial<BloomProfile>;
}

/** Output of computeAutoBloomRange() and bloomParamsForLedSize(). */
export interface BloomRange {
    min: number;
    max: number;
}

/**
 * Strength range plus the geometry-derived iris modulation depth.
 * `blowoutRisk` in [0,1]: 1 = full brightness/density modulation (default,
 * backward compatible), 0 = hold strength at `max` regardless of the frame
 * (small/sparse dots that never wash out).
 */
export interface BloomStrengthRange extends BloomRange {
    blowoutRisk?: number;
}

/** Output of bloomParamsForLedSize(). */
export interface BloomParams {
    radius: number;
    minStrength: number;
    maxStrength: number;
    /** Geometry-derived iris modulation depth in [0,1]; see BloomStrengthRange. */
    blowoutRisk: number;
}

/** Iris state for updateBloomIris() — mutated in place. */
export interface IrisState {
    currentBrightness: number;
    lastTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Three.js render context (createRendererAndScene return value)
// ---------------------------------------------------------------------------

import type {
    WebGLRenderer,
    Scene,
    OrthographicCamera,
} from 'three';

/** Return type of createRendererAndScene() without overlay. */
export interface RendererContext {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: OrthographicCamera;
    wrapper: HTMLDivElement;
}

/** Return type of createRendererAndScene() with overlay enabled. */
export interface RendererContextWithOverlay extends RendererContext {
    overlayCanvas: HTMLCanvasElement;
    overlayCtx: CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Points mesh (buildPointsMesh / rebuildPointsMesh)
// ---------------------------------------------------------------------------

import type { Points, BufferGeometry, PointsMaterial, Float32BufferAttribute } from 'three';

/** Return value of buildPointsMesh() / rebuildPointsMesh(). */
export interface PointsMeshResult {
    mesh: Points;
    geometry: BufferGeometry;
    material: PointsMaterial;
    colorAttribute: Float32BufferAttribute;
}

// ---------------------------------------------------------------------------
// Screenmap meta / backup sidecar
// ---------------------------------------------------------------------------

/** The screenmap meta sidecar stored in localStorage. */
export interface ScreenmapMeta {
    savedAt: number;
    source: string;
    ledCount: number;
    stripCount: number;
    pinCount: number;
}

/** The backup meta sidecar (extends ScreenmapMeta with optional presetFile). */
export interface BackupMeta extends ScreenmapMeta {
    presetFile?: string | null;
}

/** Return value of getBackup(). */
export interface ScreenmapBackup {
    json: string;
    meta: BackupMeta | null;
}

/** Internal map counts returned by _countMap(). */
export interface MapCounts {
    stripCount: number;
    ledCount: number;
    pinCount: number;
}

// ---------------------------------------------------------------------------
// Preset manifest
// ---------------------------------------------------------------------------

/** A single entry in the preset manifest. */
export interface ScreenmapPresetManifestEntry {
    file: string;
    name: string;
}

// ---------------------------------------------------------------------------
// SPA history / navigation API
// ---------------------------------------------------------------------------

/**
 * SPA navigation + browser-history facade. Route changes push real history
 * entries so the browser Back/Forward buttons move between tools. Tools can
 * also push *in-tool* view boundaries (same URL) with pushView/onPopView so the
 * Back button "goes back" within a tool without leaving the SPA.
 */
export interface SpaHistory {
    /** Navigate to a route path (pushes a history entry). */
    navigate: (path: string) => void;
    /** Push an in-tool view boundary on the current route (same URL). */
    pushView: (view: string, data?: unknown) => void;
    /** Replace the current history entry's in-tool view state. */
    replaceView: (view: string, data?: unknown) => void;
    /** Programmatic Back (equivalent to the browser Back button). */
    back: () => void;
    /**
     * Register a handler invoked when Back/Forward lands on the current route
     * (an in-tool view boundary). Returns an unsubscribe function. Cleared
     * automatically when the tool is torn down.
     */
    onPopView: (handler: (view: string | null, data: unknown) => void) => () => void;
    /** Preserve the mounted tool shell for route changes within that shell. */
    onRoutePath: (handler: (path: string) => void) => () => void;
}

// ---------------------------------------------------------------------------
// Tool init function type
// ---------------------------------------------------------------------------

/** Common signature for all tool entry points. */
export type ToolInitFn = (container: HTMLElement, nav?: SpaHistory) => (() => void) | undefined;

// ---------------------------------------------------------------------------
// Debug globals interfaces
// ---------------------------------------------------------------------------

/** Perf counters exposed on window.__perf */
export type PerfCounters = Record<string, number>;

/** Moviemaker debug hooks exposed on window.__mmDebug */
export interface MoviemakerDebugHooks {
    getState?: () => unknown;
    forceFrame?: () => void;
    [key: string]: unknown;
}

/** Label layout debug function exposed on window.__labelLayoutDebug */
export type LabelLayoutDebugHooks = (() => LabelLayoutDebugDump);

/** Shapeeditor debug hooks exposed on window.__shapeeditorDebug */
export interface ShapeeditorDebugHooks {
    getStripCount?: () => number;
    getStripLabels?: () => unknown;
    getSelectedStrip?: () => number | null;
    getStripNames?: () => string[];
    getLedCanvasPos?: (flatIdx: number) => { clientX: number; clientY: number; canvasX: number; canvasY: number } | null;
    simulateLedDrag?: (flatIdx: number, dxClient: number, dyClient: number, opts?: Record<string, unknown> | null) => boolean;
    getStripSnapState?: () => unknown;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Blur pipeline uniforms
// ---------------------------------------------------------------------------

/** Shader uniform values accepted by updateUniforms() in blur-pipeline. */
export interface BlurUniforms {
    blurRadius: number;
    sigma: number;
    brightness: number;
    maxBrightness: number;
    gamma: number;
}

/** Gather sample result from the GPU readback. */
export interface GatherSample {
    buffer: Uint8Array;
    numPts: number;
}

// ---------------------------------------------------------------------------
// Strip palette types
// ---------------------------------------------------------------------------

/** Per-strip color palette entry (index + HSL color string). */
export interface StripPaletteEntry {
    index: number;
    color: string;
}

/** Pin color entry. */
export interface PinColor {
    index: number;
    color: string;
}

// ---------------------------------------------------------------------------
// Video channel map
// ---------------------------------------------------------------------------

/** Input strip descriptor for buildVideoChannelMap(). */
export interface VideoChannelStrip {
    offset: number;
    count: number;
    video_offset: number;
}

// ---------------------------------------------------------------------------
// Frame brightness result
// ---------------------------------------------------------------------------

/** Return value of computeFrameBrightness(). */
export interface FrameBrightnessResult {
    avgBrightness: number;
    litCount: number;
    totalCount: number;
}
