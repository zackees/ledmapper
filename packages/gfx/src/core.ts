/** DOM-free public entry point for renderer and pure geometry consumers. */
export { createGfxCore } from './gfx/gfx-core-headless.js';
export { normalizeScreenmap } from './gfx/screenmap.js';
export { createFramePacer } from './gfx/frame-pacer.js';
export { parseRgbFrames, hasFledMagic, readVideoFps } from './render/rgb-video.js';
export { PixelFormat, bytesPerLed, isSupportedFormat, prependFledHeader } from './render/rgb-video.js';
export { parse_screenmap_data_json, parseScreenmapMultiStrip, centerAndFitPoints, getStripColors, stripStartEndLabels } from './common.js';
export { resolveLedDiameter, computeFitScale } from './bloom-utils.js';
export { buildVideoChannelMap } from './moviemaker/transforms.js';
export type { GfxCore, CreateGfxCoreOptions } from './gfx/gfx-core-headless.js';
export type { FramePacer } from './gfx/frame-pacer.js';
export type { BloomConfig, Screenmap } from './gfx/types.js';
