/**
 * createGfxInWorker — main-thread factory that runs the gfx package's
 * render core inside a Web Worker against a transferred OffscreenCanvas.
 *
 * Issue #163 Phase 3c. The consumer provides the worker instance; the
 * package doesn't know how it was bundled (Vite `?worker` import,
 * `import.meta.url`, etc.), making this portable across bundlers.
 *
 * Example:
 *
 *     const worker = new Worker(
 *         new URL('./gfx-worker-entry.ts', import.meta.url),
 *         { type: 'module' }
 *     );
 *     const gfx = await createGfxInWorker({
 *         canvas,                                 // HTMLCanvasElement
 *         screenmap,
 *         worker,
 *         paneSize: 800,
 *     });
 *     gfx.pushFrame(rgbBytes);                    // ArrayBuffer transferred
 *
 *     gfx.onStats((stats) => console.log(stats));
 *     gfx.onError((e) => console.error(e));
 *
 *     gfx.dispose();                              // terminates the worker
 */

import { BLOOM_RENDER_PX } from '../../bloom-utils.js';
import { normalizeScreenmap } from '../screenmap.js';
import type { BloomConfig, Screenmap } from '../types.js';
import type { GfxToWorker, WorkerToGfx } from './protocol.js';
import { pushFramePayload } from './protocol.js';

const DEFAULT_PANE_SIZE = 800;
const DEFAULT_DIAMETER = 16;
const DEFAULT_TARGET_FPS = 60;

export interface CreateGfxInWorkerOptions {
    /** Main-thread canvas the worker will composite into. */
    canvas: HTMLCanvasElement;
    /** Screenmap input (object, JSON string, or already-normalized). */
    screenmap: unknown;
    /** Worker instance. Caller controls how it was constructed so this
     *  package stays bundler-agnostic. */
    worker: Worker;
    paneSize?: number;
    renderPx?: number;
    bloom?: BloomConfig;
    diameter?: number;
    targetFPS?: number;
    preserveDrawingBuffer?: boolean;
    /** Override the main-thread DPR forwarded to the worker. Defaults
     *  to `window.devicePixelRatio`. */
    devicePixelRatio?: number;
    /** Reject the returned Promise if `ready` doesn't land in this many
     *  ms. Default 10000. */
    initTimeoutMs?: number;
}

export interface GfxInWorker {
    readonly canvas: HTMLCanvasElement;
    readonly screenmap: Screenmap;
    readonly worker: Worker;
    pushFrame(rgb: Uint8Array): void;
    setBloom(cfg: BloomConfig): void;
    setScreenmap(map: unknown): void;
    setDiameter(px: number): void;
    setTargetFPS(fps: number): void;
    /** Subscribe to stats messages (throttled to ~4 Hz by the worker).
     *  Returns an unsubscribe fn. */
    onStats(cb: (stats: { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number }) => void): () => void;
    /** Subscribe to auto-bloom strength changes for keeping a
     *  main-thread bloom UI in sync. */
    onBloomStrength(cb: (value: number) => void): () => void;
    /** Subscribe to errors thrown inside the worker. */
    onError(cb: (err: { message: string; stack?: string }) => void): () => void;
    /** Terminate the worker and detach all listeners. */
    dispose(): void;
}

export async function createGfxInWorker(opts: CreateGfxInWorkerOptions): Promise<GfxInWorker> {
    if (!('transferControlToOffscreen' in opts.canvas)) {
        throw new Error('createGfxInWorker: HTMLCanvasElement.transferControlToOffscreen not supported. ImageBitmap fallback is a future-phase deliverable.');
    }

    const paneSize = opts.paneSize ?? DEFAULT_PANE_SIZE;
    const renderPx = opts.renderPx ?? BLOOM_RENDER_PX;
    const screenmap = normalizeScreenmap(opts.screenmap, paneSize);

    const statsListeners = new Set<(s: { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number }) => void>();
    const bloomListeners = new Set<(v: number) => void>();
    const errorListeners = new Set<(e: { message: string; stack?: string }) => void>();

    const onMessage = (ev: MessageEvent<WorkerToGfx>) => {
        const m = ev.data;
        switch (m.type) {
            case 'ready':
                // resolved by the init promise below
                break;
            case 'stats':
                for (const cb of statsListeners) cb(m.stats);
                break;
            case 'bloomStrength':
                for (const cb of bloomListeners) cb(m.value);
                break;
            case 'error':
                for (const cb of errorListeners) cb({ message: m.message, ...(m.stack !== undefined ? { stack: m.stack } : {}) });
                break;
        }
    };
    opts.worker.addEventListener('message', onMessage);

    const offscreen = opts.canvas.transferControlToOffscreen();

    const readyPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            opts.worker.removeEventListener('message', onReady);
            reject(new Error('createGfxInWorker: worker did not signal ready in time'));
        }, opts.initTimeoutMs ?? 10000);
        function onReady(ev: MessageEvent<WorkerToGfx>) {
            if (ev.data.type === 'ready') {
                clearTimeout(timeout);
                opts.worker.removeEventListener('message', onReady);
                resolve();
            } else if (ev.data.type === 'error') {
                clearTimeout(timeout);
                opts.worker.removeEventListener('message', onReady);
                reject(new Error(`createGfxInWorker: worker init error: ${ev.data.message}`));
            }
        }
        opts.worker.addEventListener('message', onReady);
    });

    const initMsg: GfxToWorker = {
        type: 'init',
        canvas: offscreen,
        screenmap,
        paneSize,
        renderPx,
        bloom: opts.bloom ?? { mode: 'auto' },
        diameter: opts.diameter ?? DEFAULT_DIAMETER,
        targetFPS: opts.targetFPS ?? DEFAULT_TARGET_FPS,
        preserveDrawingBuffer: opts.preserveDrawingBuffer === true,
        devicePixelRatio: opts.devicePixelRatio
            ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
    };
    opts.worker.postMessage(initMsg, [offscreen]);

    await readyPromise;

    function send(msg: GfxToWorker, transfer?: Transferable[]): void {
        if (transfer && transfer.length > 0) {
            opts.worker.postMessage(msg, transfer);
        } else {
            opts.worker.postMessage(msg);
        }
    }

    let disposed = false;
    function dispose(): void {
        if (disposed) return;
        disposed = true;
        try { send({ type: 'dispose' }); } catch { /* worker may already be terminated */ }
        opts.worker.removeEventListener('message', onMessage);
        opts.worker.terminate();
        statsListeners.clear();
        bloomListeners.clear();
        errorListeners.clear();
    }

    const gfx: GfxInWorker = {
        canvas: opts.canvas,
        screenmap,
        worker: opts.worker,
        pushFrame(rgb: Uint8Array): void {
            const { msg, transfer } = pushFramePayload(rgb);
            send(msg, transfer);
        },
        setBloom(cfg: BloomConfig): void { send({ type: 'setBloom', cfg }); },
        setScreenmap(map: unknown): void {
            send({ type: 'setScreenmap', map: normalizeScreenmap(map, paneSize) });
        },
        setDiameter(px: number): void { send({ type: 'setDiameter', px }); },
        setTargetFPS(fps: number): void { send({ type: 'setTargetFPS', fps }); },
        onStats(cb): () => void {
            statsListeners.add(cb);
            return () => { statsListeners.delete(cb); };
        },
        onBloomStrength(cb): () => void {
            bloomListeners.add(cb);
            return () => { bloomListeners.delete(cb); };
        },
        onError(cb): () => void {
            errorListeners.add(cb);
            return () => { errorListeners.delete(cb); };
        },
        dispose,
    };
    return gfx;
}
