/** Dedicated-worker entry point. Import this file from a consumer worker. */
export { runGfxWorker } from './gfx/worker/worker-host.js';
export type {
    GfxCapability,
    GfxToWorker,
    WorkerToGfx,
    InitMessage,
    PushFrameMessage,
    StatsMessage,
} from './gfx/worker/protocol.js';
export { GFX_CAPABILITIES, GFX_PROTOCOL_VERSION } from './gfx/worker/protocol.js';
