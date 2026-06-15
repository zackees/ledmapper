/**
 * @fastled/gfx — public API.
 *
 * Two constructors, one render core:
 *
 *   createGfx({ screenmap, parent })           ← caller streams pixels
 *   createGfxFromFled({ fled, parent })        ← package + player + UI
 *
 * See `types.ts` for the full surface. See issue #151 for design rationale.
 */

export { createGfx } from './gfx-core';
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
