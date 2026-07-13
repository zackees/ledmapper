/**
 * Worker-side entry point. Re-exports `runGfxWorker` so consumers can do:
 *
 *     // my-gfx-worker.ts (consumer code)
 *     import { runGfxWorker } from '@fastled/gfx/worker';
 *     runGfxWorker();
 *
 * The published package will expose this path via its `exports` map.
 *
 * Issue #163 Phase 3c.
 */

export { runGfxWorker } from './worker-host.js';
export type {
    GfxCapability,
    GfxToWorker,
    WorkerToGfx,
    InitMessage,
    PushFrameMessage,
    StatsMessage,
} from './protocol.js';
export { GFX_CAPABILITIES, GFX_PROTOCOL_VERSION } from './protocol.js';
