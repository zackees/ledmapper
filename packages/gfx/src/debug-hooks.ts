/**
 * One-directional, tree-shakeable coupling point between `three-utils.ts`
 * (statically imported by nearly every tool) and `debug-panel.ts` (dynamically
 * imported only behind the `?debug` flag — see issue #228).
 *
 * `three-utils.ts` calls `registerRenderer()` every time it builds a renderer.
 * Normally that's a no-op (`handler` is null). When the debug panel loads, it
 * calls `setRendererHandler()` to start receiving renderers so it can attach
 * a stats-gl overlay. This file has zero dependencies on stats-gl/lil-gui/eruda,
 * so importing it from `three-utils.ts` does not pull those libraries into the
 * mainline bundle.
 */

import type { WebGLRenderer } from 'three';

type RendererHandler = (renderer: WebGLRenderer) => void;

let handler: RendererHandler | null = null;

/** Called by three-utils.createRendererAndScene() whenever a renderer is built. */
export function registerRenderer(renderer: WebGLRenderer): void {
    handler?.(renderer);
}

/** Installed by debug-panel.ts once it loads. Pass `null` to detach. */
export function setRendererHandler(fn: RendererHandler | null): void {
    handler = fn;
}
