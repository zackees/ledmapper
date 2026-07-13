/**
 * Typed message protocol for the worker variant.
 *
 * Host (main thread) ↔ Worker. All messages are POJOs so they survive
 * the structured clone. Transferables are listed in each message's
 * doc string; the proxy passes them as the second argument to
 * `postMessage`.
 *
 * Issue #163 Phase 3c. The shape lives in its own file so consumers
 * implementing custom proxies don't have to import the runtime
 * (worker-host.ts pulls in Three.js — heavy).
 */

import type { BloomConfig, Screenmap } from '../types.js';

/** Wire contract version. Increment only for incompatible message changes. */
export const GFX_PROTOCOL_VERSION = 1 as const;
export type GfxCapability = 'offscreen-canvas' | 'transferable-frames' | 'stats' | 'bloom-strength';
export const GFX_CAPABILITIES: readonly GfxCapability[] = [
    'offscreen-canvas', 'transferable-frames', 'stats', 'bloom-strength',
];

export interface InitMessage {
    type: 'init';
    protocolVersion: number;
    capabilities: readonly GfxCapability[];
    /** OffscreenCanvas transferred from the main thread. */
    canvas: OffscreenCanvas;
    /** Already-normalized screenmap (parsed on the main thread so the
     *  worker doesn't have to load common.ts). */
    screenmap: Screenmap;
    paneSize: number;
    renderPx: number;
    bloom: BloomConfig;
    diameter: number;
    targetFPS: number;
    preserveDrawingBuffer: boolean;
    /** Host device pixel ratio. Forwarded so the worker's pixel-ratio
     *  fallback (`1.0` when `window` is absent) doesn't drop fidelity. */
    devicePixelRatio: number;
    /** CSS color snapshot captured on the main thread; workers have no DOM. */
    colors?: Readonly<Record<string, string>>;
}

export interface PushFrameMessage {
    type: 'pushFrame';
    /** Underlying buffer; transferred so the main-thread copy is
     *  neutered. Worker re-wraps as Uint8Array. */
    buffer: ArrayBuffer;
    length: number;
}

export interface SetBloomMessage   { type: 'setBloom';      cfg: BloomConfig }
export interface SetScreenmapMessage { type: 'setScreenmap'; map: Screenmap }
export interface SetDiameterMessage { type: 'setDiameter';   px: number }
export interface SetTargetFPSMessage { type: 'setTargetFPS';  fps: number }
export interface DisposeMessage     { type: 'dispose' }

export type GfxToWorker =
    | InitMessage
    | PushFrameMessage
    | SetBloomMessage
    | SetScreenmapMessage
    | SetDiameterMessage
    | SetTargetFPSMessage
    | DisposeMessage;

export interface ReadyMessage {
    type: 'ready';
    protocolVersion: typeof GFX_PROTOCOL_VERSION;
    capabilities: readonly GfxCapability[];
}
export interface StatsMessage {
    type: 'stats';
    stats: { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number };
}
export interface BloomStrengthMessage { type: 'bloomStrength'; value: number }
export interface ErrorMessage { type: 'error'; message: string; stack?: string; code?: string }

export type WorkerToGfx =
    | ReadyMessage
    | StatsMessage
    | BloomStrengthMessage
    | ErrorMessage;

/** Helper: build a `pushFrame` payload along with its transferables. */
export function pushFramePayload(rgb: Uint8Array): { msg: PushFrameMessage; transfer: Transferable[] } {
    // ArrayBufferView.buffer might be a SAB or a section of a larger
    // ArrayBuffer; we copy a fresh ArrayBuffer when the input is a
    // view to keep the transfer simple and predictable.
    const isExactBuffer = rgb.byteOffset === 0 && rgb.byteLength === rgb.buffer.byteLength;
    const buffer = isExactBuffer
        ? rgb.buffer as ArrayBuffer
        : rgb.slice().buffer;
    return {
        msg: { type: 'pushFrame', buffer, length: rgb.byteLength },
        transfer: [buffer],
    };
}
