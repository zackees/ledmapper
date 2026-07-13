/** DOM-free public entry point for renderer and pure geometry consumers. */
export { createGfxCore } from './gfx/gfx-core-headless.js';
export { normalizeScreenmap } from './gfx/screenmap.js';
export { createFramePacer } from './gfx/frame-pacer.js';
export { parseRgbFrames, hasFledMagic, readVideoFps } from './render/rgb-video.js';
export type { GfxCore, CreateGfxCoreOptions } from './gfx/gfx-core-headless.js';
export type { FramePacer } from './gfx/frame-pacer.js';
export type { BloomConfig, Screenmap } from './gfx/types.js';
