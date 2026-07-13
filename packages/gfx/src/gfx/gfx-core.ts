/**
 * createGfx — Mode A main-thread factory.
 *
 * Composes the DOM-free `createGfxCore` (#163 Phase 3a) with the
 * main-thread presentation concerns: wrapper element, optional 2D
 * overlay canvas, responsive sizing, FPS-counter widget, and the
 * `f`-key toggle.
 *
 * This is the only place that touches `document` / `window` /
 * `localStorage`. The render core itself stays headless so it can
 * also run inside a Worker (#163 Phase 3c).
 */

import { wireResponsiveCanvas } from '../three-utils.js';
import { BLOOM_RENDER_PX } from '../bloom-utils.js';
import { createGfxCore } from './gfx-core-headless.js';
import { mountFpsWidget, resolveInitialVisibility, persistVisibility, isTypingTarget } from './fps.js';
import type { CreateGfxOptions, Gfx, Screenmap } from './types.js';

const DEFAULT_PANE_SIZE = 800;

export function createGfx(opts: CreateGfxOptions): Gfx {
    const paneSize = opts.paneSize ?? DEFAULT_PANE_SIZE;
    const renderPx = opts.renderPx ?? BLOOM_RENDER_PX;

    const ac = new AbortController();
    const signal = opts.signal ?? ac.signal;

    // --- DOM layer: wrapper + canvas (+ optional overlay) ---
    const wrapper = document.createElement('div');
    wrapper.className = 'lm-canvas-wrapper';
    opts.parent.appendChild(wrapper);

    const canvas = document.createElement('canvas');
    canvas.className = 'gfx-render-canvas';
    wrapper.appendChild(canvas);

    let overlayCanvas: HTMLCanvasElement | undefined;
    let overlayCtx: CanvasRenderingContext2D | undefined;
    if (opts.enableOverlay === true) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = paneSize;
        overlayCanvas.height = paneSize;
        overlayCanvas.className = 'gfx-overlay-canvas';
        wrapper.appendChild(overlayCanvas);
        const ctx = overlayCanvas.getContext('2d');
        if (!ctx) throw new Error('createGfx: overlay 2d context unavailable');
        overlayCtx = ctx;
    }

    // --- Render core: same code path the worker variant uses ---
    const core = createGfxCore({
        canvas,
        screenmap: opts.screenmap,
        paneSize,
        renderPx,
        ...(opts.bloom !== undefined ? { bloom: opts.bloom } : {}),
        ...(opts.diameter !== undefined ? { diameter: opts.diameter } : {}),
        ...(opts.targetFPS !== undefined ? { targetFPS: opts.targetFPS } : {}),
        ...(opts.preserveDrawingBuffer !== undefined ? { preserveDrawingBuffer: opts.preserveDrawingBuffer } : {}),
    });

    wireResponsiveCanvas({ wrapper, parent: opts.parent, maxSize: renderPx, signal });

    // --- FPS widget + `f`-key toggle + localStorage persistence ---
    let fpsVisible = resolveInitialVisibility(opts.showFps);
    let fpsWidget: { el: HTMLElement; dispose: () => void } | null = null;
    let sourceFps = opts.sourceFps;

    function refreshWidgetState() {
        if (fpsVisible && !fpsWidget) {
            fpsWidget = mountFpsWidget({
                wrapper,
                getStats: () => core.getStats(),
                getSourceFps: () => sourceFps,
                onClickHide: () => { setFpsVisible(false); },
            });
        } else if (!fpsVisible && fpsWidget) {
            fpsWidget.dispose();
            fpsWidget = null;
        }
    }
    function mountFpsCounter(el: HTMLElement): void {
        if (fpsWidget) fpsWidget.dispose();
        fpsWidget = mountFpsWidget({
            wrapper: el,
            getStats: () => core.getStats(),
            getSourceFps: () => sourceFps,
            onClickHide: () => { setFpsVisible(false); },
        });
        fpsVisible = true;
    }
    function unmountFpsCounter(): void {
        if (fpsWidget) { fpsWidget.dispose(); fpsWidget = null; }
        fpsVisible = false;
    }
    function setFpsVisible(v: boolean): void {
        fpsVisible = v;
        persistVisibility(v);
        refreshWidgetState();
    }
    function isFpsVisible(): boolean { return fpsVisible; }

    const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'f' && e.key !== 'F') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTypingTarget(e.target)) return;
        setFpsVisible(!fpsVisible);
    };
    document.addEventListener('keydown', onKey, { signal });
    refreshWidgetState();

    function dispose(): void {
        if (fpsWidget) { fpsWidget.dispose(); fpsWidget = null; }
        document.removeEventListener('keydown', onKey);
        core.dispose();
        if (!opts.signal) ac.abort();
    }

    const gfx: Gfx = {
        canvas,
        wrapper,
        get screenmap(): Screenmap { return core.screenmap; },
        ...(overlayCanvas !== undefined ? { overlayCanvas } : {}),
        ...(overlayCtx !== undefined ? { overlayCtx } : {}),
        pushFrame: (rgb) => { core.pushFrame(rgb); },
        setBloom: (cfg) => { core.setBloom(cfg); },
        getBloomStrength: () => core.getBloomStrength(),
        setScreenmap: (map) => { core.setScreenmap(map); },
        setDiameter: (px) => { core.setDiameter(px); },
        getDiameter: () => core.getDiameter(),
        setTargetFPS: (fps) => { core.setTargetFPS(fps); },
        setSourceFPS: (fps) => { sourceFps = fps; },
        setInterpolation: (enabled) => { core.setInterpolation(enabled); },
        getStats: () => core.getStats(),
        mountFpsCounter,
        unmountFpsCounter,
        setFpsVisible,
        isFpsVisible,
        dispose,
    };
    return gfx;
}
