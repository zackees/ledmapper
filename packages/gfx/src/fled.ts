/** FLED container and headless playback entry point. */
export { createGfxFromFled } from './gfx/gfx-fled.js';
export { createPlayer } from './gfx/player.js';
export { parseRgbFrames, hasFledMagic, readVideoFps } from './render/rgb-video.js';
export { FledColorError, validateFledColor, readVideoColor, buildVideoColor, defaultColorForFormat, pixelFormatHasDefaultTuple, DEFAULT_COLOR_TUPLE } from './render/fled-color.js';
export type { FledColorMetadata, FledColorErrorCode, FledColorTransfer, FledColorMatrix, FledColorRange, FledColorPrimariesName, FledCustomPrimaries } from './render/fled-color.js';
export type { GfxWithPlayer, Player, CreateGfxFromFledOptions } from './gfx/types.js';
