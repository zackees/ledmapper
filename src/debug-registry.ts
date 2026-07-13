/**
 * Per-tool debug-state registry exposed on `window.__lmDebug`.
 *
 * Generalizes the ad-hoc `window.__shapeeditorDebug` pattern (see
 * src/shapeeditor/shapeeditor-init.ts) into a standard registry any tool can
 * plug into. Prior art: Excalidraw's `window.h`, tldraw's `window.editor`.
 *
 * Contract:
 * - Each tool calls `registerDebugState(tool, hooks)` once during its
 *   `init()`, and `unregisterDebugState(tool)` in the destroy function it
 *   returns to the router (see router.ts's `loadRoute` teardown).
 * - `getState()` must compute a plain, JSON-serializable snapshot AT CALL
 *   TIME — never a cached object, and never a Three.js object or a function
 *   value — so it survives a Playwright `page.evaluate()` round-trip and is
 *   safe to embed in the copy-diagnostics payload (a separate, in-flight PR
 *   consumes this via optional chaining).
 * - `getState()` ships always-on, including in production builds.
 */

import type { ShapeeditorDebugHooks } from './types/domain';

/** Live debug state for the Mapped Video Maker (src/moviemaker). */
export interface MoviemakerDebugState {
    screenmapValid: boolean;
    ledCount: number;
    stripCount: number;
    sourceActive: boolean;
    sourceType: string | null;
    sourceName: string | null;
    playing: boolean;
    recordingActive: boolean;
    recordFormat: string;
    /** LEDs whose sample position falls outside the video frame (#250). */
    oobLeds: number;
    /** Recording frame rate: 30 until the rVFC estimator locks on (#256). */
    detectedFps: number;
    /** Live recording pacing counters (#256/#266); zeros when not recording. */
    captureStats: { captured: number; skipped: number; duplicatesDropped: number };
    offlineCapture: {
        backend: 'idle' | 'worker' | 'main' | 'realtime';
        workerActive: boolean;
        done: number;
        total: number;
        progressMessages: number;
        lastFallbackReason: string | null;
    };
}

/** Live debug state for the Movie Player (src/movieplayer). */
export interface MovieplayerDebugState {
    frameCount: number;
    ledCount: number;
    playing: boolean;
    loaded: boolean;
}

/** Live debug state for the Play demo (src/demo). */
export interface DemoDebugState {
    frameCount: number;
    ledCount: number;
    playing: boolean;
    filename: string;
    sourceFps: number;
}

/** Live debug state for the Screenmap Editor (src/shapeeditor). */
export interface ShapeeditorDebugState {
    stripCount: number;
    totalPoints: number;
    dirty: boolean;
    directionArrowCount: number;
    directionArrowAlpha: number;
    directionArrowLayers: { count: number; opacity: number }[];
    directionArrowTransitionPhase: 'idle' | 'settling' | 'crossfading';
}

/**
 * Shapeeditor's registry entry additionally carries a reference to the
 * existing `__shapeeditorDebug` methods object (kept as-is — 16 existing
 * specs depend on it) so `window.__lmDebug.shapeeditor` is a complete
 * alternate access point without duplicating any of its logic.
 */
export interface ShapeeditorDebugEntry {
    getState: () => ShapeeditorDebugState;
    debug: ShapeeditorDebugHooks;
}

/**
 * Per-tool debug-state registry, keyed by tool name. Deliberately has no
 * index signature — every entry is declared explicitly so unregistered
 * tools/typos are caught at compile time, and no entry ever carries `any`.
 */
export interface LmDebugRegistry {
    demo?: { getState: () => DemoDebugState };
    moviemaker?: { getState: () => MoviemakerDebugState };
    movieplayer?: { getState: () => MovieplayerDebugState };
    shapeeditor?: ShapeeditorDebugEntry;
}

declare global {
    interface Window {
        __lmDebug?: LmDebugRegistry;
    }
}

/** Tool names that may register a debug-state entry. */
export type LmDebugToolName = keyof LmDebugRegistry;

/**
 * Register a tool's live debug hooks on `window.__lmDebug`, creating the
 * registry object lazily on first use. Call once from the tool's `init()`.
 */
export function registerDebugState(tool: 'moviemaker', hooks: NonNullable<LmDebugRegistry['moviemaker']>): void;
export function registerDebugState(tool: 'movieplayer', hooks: NonNullable<LmDebugRegistry['movieplayer']>): void;
export function registerDebugState(tool: 'shapeeditor', hooks: NonNullable<LmDebugRegistry['shapeeditor']>): void;
export function registerDebugState(tool: 'demo', hooks: NonNullable<LmDebugRegistry['demo']>): void;
export function registerDebugState(
    tool: LmDebugToolName,
    hooks: NonNullable<LmDebugRegistry['moviemaker']> | NonNullable<LmDebugRegistry['movieplayer']> | NonNullable<LmDebugRegistry['shapeeditor']> | NonNullable<LmDebugRegistry['demo']>,
): void {
    const registry = (window.__lmDebug ??= {});
    switch (tool) {
        case 'demo':
            registry.demo = hooks as NonNullable<LmDebugRegistry['demo']>;
            return;
        case 'moviemaker':
            registry.moviemaker = hooks as NonNullable<LmDebugRegistry['moviemaker']>;
            return;
        case 'movieplayer':
            registry.movieplayer = hooks as NonNullable<LmDebugRegistry['movieplayer']>;
            return;
        case 'shapeeditor':
            registry.shapeeditor = hooks as NonNullable<LmDebugRegistry['shapeeditor']>;
            return;
    }
}

/**
 * Remove a tool's entry from `window.__lmDebug`. Call from the destroy
 * function the tool returns to the router so the entry disappears the
 * moment the tool is torn down.
 */
export function unregisterDebugState(tool: LmDebugToolName): void {
    const registry = window.__lmDebug;
    if (!registry) return;
    switch (tool) {
        case 'demo':
            delete registry.demo;
            return;
        case 'moviemaker':
            delete registry.moviemaker;
            return;
        case 'movieplayer':
            delete registry.movieplayer;
            return;
        case 'shapeeditor':
            delete registry.shapeeditor;
            return;
    }
}
