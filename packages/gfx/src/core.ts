/** DOM-free public entry point for renderer and pure geometry consumers. */
export { createGfxCore } from './gfx/gfx-core-headless.js';
export { normalizeScreenmap } from './gfx/screenmap.js';
export { createFramePacer } from './gfx/frame-pacer.js';
export { parseRgbFrames, hasFledMagic, readVideoFps } from './render/rgb-video.js';
export { PixelFormat, bytesPerLed, isSupportedFormat, prependFledHeader } from './render/rgb-video.js';
export { FledStreamError, streamFled } from './render/fled-stream.js';
export type { FledStreamMetadata, FledStreamOptions, FledStreamResult } from './render/fled-stream.js';
export { parse_screenmap_data_json, parseScreenmapMultiStrip, centerAndFitPoints, getStripColors, stripStartEndLabels } from './common.js';
export { resolveLedDiameter, computeFitScale } from './bloom-utils.js';
export { buildVideoChannelMap } from './moviemaker/transforms.js';
export type { GfxCore, CreateGfxCoreOptions } from './gfx/gfx-core-headless.js';
export type { FramePacer } from './gfx/frame-pacer.js';
export type { BloomConfig, Screenmap, ScreenmapShape } from './gfx/types.js';
