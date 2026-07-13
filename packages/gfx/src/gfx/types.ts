/**
 * Public types for the @fastled/gfx package.
 *
 * Shape is deliberately small: a Screenmap (the LED geometry), a
 * FrameData (the LED colors), and the option bags for the two
 * constructors. See `index.ts` for the entry points and #151 for the
 * design rationale.
 */

/** Parsed-or-raw screenmap. The constructors accept either:
 *  - the v1 / v2 JSON object straight off the wire,
 *  - the JSON encoded as a string,
 *  - or an already-parsed `{ points, strips? }` shape from `parseScreenmap`.
 *
 * Internally we normalize on `Screenmap`.
 */
export interface ScreenmapInput {
    /** Raw JSON object or string, OR a pre-normalized Screenmap. */
    value: unknown;
}

/** Normalized screenmap consumed by the renderer. */
export interface Screenmap {
    /** Per-LED [x, y] in source units. Flat, in wiring order. */
    points: readonly (readonly [number, number])[];
    /** Optional per-strip metadata (start offset + count + name). */
    strips?: readonly { name: string; offset: number; count: number }[];
    /** Declared LED diameter in source units, if any. */
    diameter?: number;
}

/** Bloom configuration. `auto` lets the engine pick per-frame strength
 *  from luma + density; numeric values pin it manually. `off` disables. */
export type BloomConfig =
    | { mode: 'auto' }
    | { mode: 'off' }
    | { mode: 'manual'; strength: number };

/** Common options shared by both constructors. */
export interface GfxBaseOptions {
    /** Where to mount the canvas. The package owns the wrapper element. */
    parent: HTMLElement;
    /** Internal render resolution. Default: BLOOM_RENDER_PX (2048). */
    renderPx?: number;
    /** Logical canvas size in CSS pixels used for the orthographic camera
     *  and `applyBloomGeometry` math. Defaults to 800; the CSS display
     *  size is driven by `wireResponsiveCanvas` independently. */
    paneSize?: number;
    /** Bloom configuration. Default: `{ mode: 'auto' }`. */
    bloom?: BloomConfig;
    /** LED dot diameter in CSS pixels. Defaults to 16 if the screenmap
     *  has no declared diameter; otherwise scaled from the screenmap. */
    diameter?: number;
    /** Target animation-loop frames-per-second. Defaults to 60. */
    targetFPS?: number;
    /** Mount a 2D overlay canvas on top of the WebGL canvas. The
     *  returned `Gfx.overlayCanvas` and `Gfx.overlayCtx` are populated
     *  when this is true. Useful for connection-line / label drawing
     *  that the consumer owns. */
    enableOverlay?: boolean;
    /** Initial visibility of the FPS counter overlay. localStorage value
     *  at `gfx.fps.visible` (set by `f`-key toggle / click-to-hide)
     *  overrides this whenever it's present. Default `false`. */
    showFps?: boolean;
    /** Keep the WebGL backbuffer readable after compositing so consumers
     *  can `drawImage()` / `captureStream()` the canvas. Off by default
     *  (cheaper); turn on for recording or external readback. */
    preserveDrawingBuffer?: boolean;
    /** Abort signal to dispose of the renderer + detach listeners. */
    signal?: AbortSignal;
    /** Optional theme snapshot for worker-safe consumers. */
    colors?: Readonly<Record<string, string>>;
}

export interface CreateGfxOptions extends GfxBaseOptions {
    screenmap: unknown;
    /** Stable source/native FPS shown by the user-facing stats widget.
     *  When omitted, the widget falls back to measured push delivery. */
    sourceFps?: number;
}

export interface CreateGfxFromFledOptions extends GfxBaseOptions {
    fled: Blob | ArrayBuffer | Uint8Array;
    /** Start playback immediately. Default: true. */
    autoplay?: boolean;
    /** Frames-per-second for playback. Defaults to 30 if the .fled
     *  payload doesn't carry an FPS hint in its embedded metadata. */
    fps?: number;
}

/** What both constructors return. */
export interface Gfx {
    /** The underlying canvas element (inside `wrapper`). */
    readonly canvas: HTMLCanvasElement;
    /** The wrapper div the package mounted into `parent`. */
    readonly wrapper: HTMLElement;
    /** The normalized screenmap currently in use. */
    readonly screenmap: Screenmap;
    /** 2D overlay canvas, present only when `enableOverlay: true`. */
    readonly overlayCanvas?: HTMLCanvasElement;
    /** 2D overlay context, present only when `enableOverlay: true`. */
    readonly overlayCtx?: CanvasRenderingContext2D;
    /** Push one frame of LED colors. Length = `screenmap.points.length * 3`. */
    pushFrame(rgb: Uint8Array): void;
    /** Update bloom mode / strength on the fly. */
    setBloom(cfg: BloomConfig): void;
    /** Current bloom strength (auto-driven or manually pinned). */
    getBloomStrength(): number;
    /** Swap the screenmap; rebuilds the points mesh. */
    setScreenmap(map: unknown): void;
    /** Set the LED dot diameter in CSS pixels. Re-applies bloom geometry. */
    setDiameter(px: number): void;
    /** Current LED dot diameter in CSS pixels (pre-iris scaling). */
    getDiameter(): number;
    /** Change the animation-loop target FPS on the fly. */
    setTargetFPS(fps: number): void;
    /** Update the stable source/native rate shown by the FPS widget. This
     *  does not change the measured `getStats().pushFps` diagnostic. */
    setSourceFPS(fps: number): void;
    /** Enable render-rate frame interpolation — blend between the two most
     *  recent source keyframes so a low-fps source is smooth on a
     *  higher-refresh display. Opt-in; default off. */
    setInterpolation(enabled: boolean): void;
    /** Snapshot of runtime stats. Three signals:
     *  - `renderFps`: rate of internal animation-loop completed frames
     *  - `pushFps`:   rate at which `pushFrame()` was called
     *  - `frameTimeMs`: median inter-frame delta (P50, recent window)
     *  - `framesRendered`: monotonic counter
     */
    getStats(): { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number };
    /** Mount the FPS counter widget into a custom element. By default
     *  the package mounts it inside `gfx.wrapper` already; use this
     *  only if you want it in a different parent. */
    mountFpsCounter(el: HTMLElement): void;
    /** Tear down a previously-mounted (or auto-mounted) FPS counter. */
    unmountFpsCounter(): void;
    /** Show/hide the FPS counter at runtime. Persists to localStorage. */
    setFpsVisible(v: boolean): void;
    /** Whether the FPS counter is currently visible. */
    isFpsVisible(): boolean;
    /** Stop the render loop, dispose GPU resources, detach listeners. */
    dispose(): void;
}

export interface GfxWithPlayer extends Gfx {
    readonly player: Player;
    /** Frames decoded from the .fled payload. Length and pixel format
     *  agree with the embedded screenmap; players use these via `seek`. */
    readonly frames: readonly Uint8Array[];
}

export interface PlayerControlLabels {
    play: string;
    pause: string;
}

export interface PlayerControlsOptions {
    /**
     * Accessible labels for the optional control strip. The gfx package
     * does not provide English defaults so consumers can localize at the
     * mount edge.
     */
    labels?: Partial<PlayerControlLabels>;
}

/** Headless player controller. UI is opt-in via `mountControls`. */
export interface Player {
    /** Is the player currently advancing through frames? */
    readonly playing: boolean;
    /** Total duration in seconds. */
    readonly duration: number;
    /** Current playhead in seconds. */
    readonly currentTime: number;
    /** Total frame count. */
    readonly frameCount: number;
    /** Effective frames-per-second from the source. */
    readonly fps: number;
    /** Playback rate multiplier. 1.0 = realtime, 2.0 = 2× speed, etc. */
    speed: number;
    /** Whether to wrap around at the end. */
    loop: boolean;

    play(): void;
    pause(): void;
    /** Jump to `t` seconds; clamped to `[0, duration]`. */
    seek(t: number): void;

    /** Subscribe to time updates; returns an unsubscribe fn. */
    onTimeUpdate(cb: (t: number) => void): () => void;
    /** Fires once when the playhead reaches `duration` and loop=false. */
    onEnded(cb: () => void): () => void;

    /** Build a minimal play/pause/scrub control strip into `el`. */
    mountControls(el: HTMLElement, options?: PlayerControlsOptions): void;
    /** Tear down a previously-mounted control strip. */
    unmountControls(): void;
}
