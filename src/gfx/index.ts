/**
 * @fastled/gfx — public API.
 *
 * Three entry points, one render core:
 *
 *   createGfxCore({ canvas, screenmap })       ← DOM-free; worker-safe (#163 Phase 3a)
 *   createGfx({ screenmap, parent })           ← main-thread; wrapper + widgets
 *   createGfxFromFled({ fled, parent })        ← main-thread; package + player + UI
 *
 * See `types.ts` for the full surface. See issues #151 / #163 for design rationale.
 */

export { createGfx } from './gfx-core';
export { createGfxCore } from './gfx-core-headless';
export type { GfxCore, CreateGfxCoreOptions } from './gfx-core-headless';
export { createGfxFromFled } from './gfx-fled';
export { createPlayer } from './player';
export { normalizeScreenmap } from './screenmap';
export { wireBloomUi } from './bloom-ui';
export type {
    Gfx,
    GfxWithPlayer,
    Player,
    Screenmap,
    BloomConfig,
    CreateGfxOptions,
    CreateGfxFromFledOptions,
} from './types';
