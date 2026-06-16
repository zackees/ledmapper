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

export { createGfx } from './gfx-core';
export { createGfxCore } from './gfx-core-headless';
export type { GfxCore, CreateGfxCoreOptions } from './gfx-core-headless';
export { createGfxFromFled } from './gfx-fled';
export { createPlayer } from './player';
export { normalizeScreenmap } from './screenmap';
export { wireBloomUi } from './bloom-ui';
export { createGfxInWorker } from './worker/create-gfx-in-worker';
export type { CreateGfxInWorkerOptions, GfxInWorker } from './worker/create-gfx-in-worker';
export { pushFramePayload } from './worker/protocol';
export type {
    GfxToWorker,
    WorkerToGfx,
    InitMessage,
    PushFrameMessage,
    StatsMessage,
} from './worker/protocol';
export type {
    Gfx,
    GfxWithPlayer,
    Player,
    PlayerControlLabels,
    PlayerControlsOptions,
    Screenmap,
    BloomConfig,
    CreateGfxOptions,
    CreateGfxFromFledOptions,
} from './types';
