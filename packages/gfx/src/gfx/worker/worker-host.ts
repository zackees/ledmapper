/**
 * Worker-side entry: `runGfxWorker()`.
 *
 * The consumer ships a worker file that does:
 *
 *     import { runGfxWorker } from '@fastled/gfx/worker';
 *     runGfxWorker();
 *
 * Then on the main thread:
 *
 *     const worker = new Worker(new URL('./my-gfx-worker.ts', import.meta.url),
 *                                { type: 'module' });
 *     const gfx = await createGfxInWorker({ canvas, screenmap, worker });
 *
 * `runGfxWorker` listens on `self.onmessage`, dispatches to the
 * underlying `createGfxCore`, and emits typed `WorkerToGfx` messages
 * back to the host. Issue #163 Phase 3c.
 */

import { createGfxCore } from '../gfx-core-headless.js';
import type { GfxCore } from '../gfx-core-headless.js';
import type {
    GfxToWorker,
    WorkerToGfx,
} from './protocol.js';
import { GFX_CAPABILITIES, GFX_PROTOCOL_VERSION } from './protocol.js';

const STATS_INTERVAL_MS = 250;
const BLOOM_POLL_INTERVAL_MS = 100;

/** Minimal type for the worker scope we touch. Avoids dragging in the
 *  full `WebWorker` lib via tsconfig, which would collide with the
 *  package's DOM-typed code paths on the main thread. */
interface MinimalWorkerScope {
    postMessage(msg: WorkerToGfx, transfer?: Transferable[]): void;
    onmessage: ((ev: MessageEvent<GfxToWorker>) => void) | null;
}

export function runGfxWorker(): void {
    // Dedicated worker globals: `self` is the worker scope.
    const scope = self as unknown as MinimalWorkerScope;

    let core: GfxCore | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let bloomTimer: ReturnType<typeof setInterval> | null = null;
    let lastBloomStrength = -1;

    function post(msg: WorkerToGfx, transfer?: Transferable[]): void {
        if (transfer && transfer.length > 0) {
            scope.postMessage(msg, transfer);
        } else {
            scope.postMessage(msg);
        }
    }

    function shutdown(): void {
        if (statsTimer !== null) { clearInterval(statsTimer); statsTimer = null; }
        if (bloomTimer !== null) { clearInterval(bloomTimer); bloomTimer = null; }
        if (core !== null) { core.dispose(); core = null; }
    }

    scope.onmessage = (ev: MessageEvent<GfxToWorker>) => {
        try {
            const msg = ev.data;
            switch (msg.type) {
                case 'init':
                    if (msg.protocolVersion !== GFX_PROTOCOL_VERSION) {
                        post({ type: 'error', code: 'protocol-mismatch', message: `Unsupported protocol ${String(msg.protocolVersion)}; expected ${String(GFX_PROTOCOL_VERSION)}` });
                        return;
                    }
                    if (core !== null) {
                        post({ type: 'error', message: 'init: already initialized' });
                        return;
                    }
                    core = createGfxCore({
                        canvas: msg.canvas,
                        screenmap: msg.screenmap,
                        paneSize: msg.paneSize,
                        renderPx: msg.renderPx,
                        bloom: msg.bloom,
                        diameter: msg.diameter,
                        targetFPS: msg.targetFPS,
                        preserveDrawingBuffer: msg.preserveDrawingBuffer,
                        devicePixelRatio: msg.devicePixelRatio,
                    });
                    statsTimer = setInterval(() => {
                        if (core !== null) post({ type: 'stats', stats: core.getStats() });
                    }, STATS_INTERVAL_MS);
                    bloomTimer = setInterval(() => {
                        if (core === null) return;
                        const v = core.getBloomStrength();
                        if (v !== lastBloomStrength) {
                            lastBloomStrength = v;
                            post({ type: 'bloomStrength', value: v });
                        }
                    }, BLOOM_POLL_INTERVAL_MS);
                    post({ type: 'ready', protocolVersion: GFX_PROTOCOL_VERSION, capabilities: GFX_CAPABILITIES });
                    break;
                case 'pushFrame':
                    if (core === null) return;
                    core.pushFrame(new Uint8Array(msg.buffer, 0, msg.length));
                    break;
                case 'setBloom':
                    if (core !== null) core.setBloom(msg.cfg);
                    break;
                case 'setScreenmap':
                    if (core !== null) core.setScreenmap(msg.map);
                    break;
                case 'setDiameter':
                    if (core !== null) core.setDiameter(msg.px);
                    break;
                case 'setTargetFPS':
                    if (core !== null) core.setTargetFPS(msg.fps);
                    break;
                case 'dispose':
                    shutdown();
                    break;
            }
        } catch (e: unknown) {
            const err = e as Error;
            post({ type: 'error', message: err.message, ...(err.stack !== undefined ? { stack: err.stack } : {}) });
            // Any thrown exception during init/dispatch means the worker
            // is in an indeterminate state. Tear down so dangling timers
            // (statsTimer, bloomTimer) don't leak. Issue #180.
            shutdown();
        }
    };
}
