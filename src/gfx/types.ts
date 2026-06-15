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
    /** Abort signal to dispose of the renderer + detach listeners. */
    signal?: AbortSignal;
}

export interface CreateGfxOptions extends GfxBaseOptions {
    screenmap: unknown;
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
    /** Push one frame of LED colors. Length = `screenmap.points.length * 3`. */
    pushFrame(rgb: Uint8Array): void;
    /** Update bloom mode / strength on the fly. */
    setBloom(cfg: BloomConfig): void;
    /** Swap the screenmap; rebuilds the points mesh. */
    setScreenmap(map: unknown): void;
    /** Snapshot of runtime stats. */
    getStats(): { fps: number; framesRendered: number };
    /** Stop the render loop, dispose GPU resources, detach listeners. */
    dispose(): void;
}

export interface GfxWithPlayer extends Gfx {
    readonly player: Player;
    /** Frames decoded from the .fled payload. Length and pixel format
     *  agree with the embedded screenmap; players use these via `seek`. */
    readonly frames: readonly Uint8Array[];
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
    mountControls(el: HTMLElement): void;
    /** Tear down a previously-mounted control strip. */
    unmountControls(): void;
}
