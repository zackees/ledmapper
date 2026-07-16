/**
 * @fastled/gfx — public API.
 *
 * Four entry points, one render core:
 *
 *   createGfxCore({ canvas, screenmap })       ← DOM-free; worker-safe (#163 Phase 3a)
 *   createGfx({ screenmap, parent })           ← main-thread; wrapper + widgets
 *   createGfxFromFled({ fled, parent })        ← main-thread; package + player + UI
 *   createGfxInWorker({ canvas, worker, ... }) ← main-thread proxy → Web Worker (#163 Phase 3c)
 *
 * Worker entry to ship in a `?worker` file:
 *
 *     import { runGfxWorker } from '@fastled/gfx/worker';
 *     runGfxWorker();
 *
 * See `types.ts` for the main-thread surface and `worker/protocol.ts`
 * for the message protocol. See issues #151 / #163 for design rationale.
 */

export { createGfx } from './gfx-core.js';
export { createGfxCore } from './gfx-core-headless.js';
export type { GfxCore, CreateGfxCoreOptions } from './gfx-core-headless.js';
export { createGfxFromFled } from './gfx-fled.js';
export { createPlayer } from './player.js';
export { createFramePacer } from './frame-pacer.js';
export type { FramePacer } from './frame-pacer.js';
export { normalizeScreenmap } from './screenmap.js';
export { wireBloomUi } from './bloom-ui.js';
export { createGfxInWorker } from './worker/create-gfx-in-worker.js';
export type { CreateGfxInWorkerOptions, GfxInWorker } from './worker/create-gfx-in-worker.js';
export { pushFramePayload } from './worker/protocol.js';
export type {
    GfxToWorker,
    WorkerToGfx,
    InitMessage,
    PushFrameMessage,
    StatsMessage,
} from './worker/protocol.js';
export type {
    Gfx,
    GfxWithPlayer,
    Player,
    PlayerControlLabels,
    PlayerControlsOptions,
    Screenmap,
    ScreenmapShape,
    BloomConfig,
    CreateGfxOptions,
    CreateGfxFromFledOptions,
} from './types.js';
