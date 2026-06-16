/**
 * createGfx — Mode A: caller owns the screenmap and drives frames.
 *
 * Builds a Three.js renderer + scene + points mesh + bloom pipeline
 * around the provided screenmap. Exposes `pushFrame` so the caller
 * can drive the LED colors at any rate. No player, no DOM controls.
 *
 * This is the primitive that `createGfxFromFled` also uses: the player
 * just owns the time-axis bookkeeping and calls `pushFrame` from its
 * own RAF loop.
 */

import type { BufferGeometry, PointsMaterial, Points, Float32BufferAttribute } from 'three';

import {
    createCircleTexture,
    createRendererAndScene,
    rebuildPointsMesh,
    createAnimationLoop,
    wireResponsiveCanvas,
} from '../three-utils';
import { createAutoBloom } from '../auto-bloom';
import { applyBloomGeometry } from '../render/bloom-geometry';
import {
    BLOOM_RENDER_PX,
    DEMO_AUTO_FLOOR,
    DEMO_AUTO_MAX_DENSE,
    DEMO_AUTO_MAX_SPARSE,
    DEMO_BLOOM_MAX_STRENGTH,
    DEMO_BLOOM_RADIUS,
    DEMO_BLOOM_AREA_REF,
    IRIS_DIAMETER_GAIN,
} from '../bloom-utils';
import { normalizeScreenmap } from './screenmap';
import type { CreateGfxOptions, Gfx, BloomConfig, Screenmap } from './types';
import type { RendererContextWithOverlay } from '../types/domain';
import { FpsMeter, mountFpsWidget, resolveInitialVisibility, persistVisibility, isTypingTarget } from './fps';

const INV_255 = 1 / 255;
const DEFAULT_PANE_SIZE = 800;
const DEFAULT_DIAMETER = 16;

export function createGfx(opts: CreateGfxOptions): Gfx {
    const paneSize = opts.paneSize ?? DEFAULT_PANE_SIZE;
    const renderPx = opts.renderPx ?? BLOOM_RENDER_PX;
    const initialBloom: BloomConfig = opts.bloom ?? { mode: 'auto' };

    let screenmap = normalizeScreenmap(opts.screenmap, paneSize);

    const ac = new AbortController();
    const signal = opts.signal ?? ac.signal;
    const circleTexture = createCircleTexture(64);

    const enableOverlay = opts.enableOverlay === true;
    const ctx = createRendererAndScene({
        width: paneSize,
        height: paneSize,
        parent: opts.parent,
        renderPx,
        enableOverlay,
        preserveDrawingBuffer: opts.preserveDrawingBuffer === true,
    });
    const { renderer, scene, camera, wrapper } = ctx;
    const overlay = enableOverlay
        ? {
            overlayCanvas: (ctx as RendererContextWithOverlay).overlayCanvas,
            overlayCtx: (ctx as RendererContextWithOverlay).overlayCtx,
        }
        : null;
    wireResponsiveCanvas({ wrapper, parent: opts.parent, maxSize: renderPx, signal });

    // Auto-bloom controller (UI-less). `wireBloomControls` is opt-in and
    // not bundled here — see `mountBloomControls` follow-up in #151.
    const bloom = createAutoBloom({
        renderer, scene, camera,
        width: paneSize, height: paneSize,
        profile: {
            floor:     DEMO_AUTO_FLOOR,
            maxDense:  DEMO_AUTO_MAX_DENSE,
            maxSparse: DEMO_AUTO_MAX_SPARSE,
        },
        paramOverrides: {
            baseMax:    DEMO_BLOOM_MAX_STRENGTH,
            baseRadius: DEMO_BLOOM_RADIUS,
            refArea:    DEMO_BLOOM_AREA_REF,
        },
        minFloorMode: 'size',
        useBlowoutRisk: true,
        diameterGain: IRIS_DIAMETER_GAIN,
    });
    applyBloomConfig(bloom, initialBloom);

    let diameter = opts.diameter ?? DEFAULT_DIAMETER;

    let pointsGeometry: BufferGeometry | undefined;
    let pointsMaterial: PointsMaterial | undefined;
    let pointsMesh: Points | undefined;
    let colorAttribute: Float32BufferAttribute | undefined;

    function rebuildPoints() {
        const previous = (pointsMesh && pointsGeometry && pointsMaterial && colorAttribute)
            ? { mesh: pointsMesh, geometry: pointsGeometry, material: pointsMaterial, colorAttribute }
            : null;
        const result = rebuildPointsMesh({
            scene, previous,
            points: screenmap.points.map(([x, y]) => [x, y]),
            circleTexture,
            diameter,
        });
        pointsGeometry = result.geometry;
        pointsMaterial = result.material;
        pointsMesh = result.mesh;
        colorAttribute = result.colorAttribute;
        applyBloomGeometry(bloom, screenmap.points.map(([x, y]) => [x, y]), { ledPx: diameter, panePx: paneSize });
    }
    rebuildPoints();

    let lastFrame: Uint8Array | null = null;
    let framesRendered = 0;
    const renderMeter = new FpsMeter();
    const pushMeter = new FpsMeter();

    const animLoop = createAnimationLoop({
        targetFPS: opts.targetFPS ?? 60,
        onFrame(time: number) {
            if (!colorAttribute || screenmap.points.length === 0) return;
            if (lastFrame) {
                const arr = colorAttribute.array as Float32Array;
                const n = screenmap.points.length;
                for (let i = 0; i < n; i++) {
                    const i3 = i * 3;
                    arr[i3    ] = (lastFrame[i3    ] ?? 0) * INV_255;
                    arr[i3 + 1] = (lastFrame[i3 + 1] ?? 0) * INV_255;
                    arr[i3 + 2] = (lastFrame[i3 + 2] ?? 0) * INV_255;
                }
                colorAttribute.needsUpdate = true;
                bloom.frame(lastFrame);
            }
            if (pointsMaterial) pointsMaterial.size = diameter * bloom.getDiameterScale();
            bloom.render();
            framesRendered++;
            renderMeter.tick(time);
        },
    });

    function pushFrame(rgb: Uint8Array): void {
        lastFrame = rgb;
        pushMeter.tick(performance.now());
    }

    function setBloom(cfg: BloomConfig): void {
        applyBloomConfig(bloom, cfg);
    }

    function getBloomStrength(): number {
        return bloom.getStrength();
    }

    function setScreenmap(map: unknown): void {
        screenmap = normalizeScreenmap(map, paneSize);
        rebuildPoints();
    }

    function setDiameter(px: number): void {
        diameter = px;
        applyBloomGeometry(bloom, screenmap.points.map(([x, y]) => [x, y]), { ledPx: diameter, panePx: paneSize });
    }

    function getDiameter(): number {
        return diameter;
    }

    function setTargetFPS(fps: number): void {
        animLoop.setTargetFPS(fps);
    }

    function getStats(): { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number } {
        return {
            renderFps: renderMeter.getFps(),
            pushFps: pushMeter.getFps(),
            frameTimeMs: renderMeter.getMedianFrameMs(),
            framesRendered,
        };
    }

    // FPS counter widget — mounted into gfx.wrapper at the top-right.
    // Toggle state persists via localStorage; an `f`-key shortcut and
    // click-to-hide are wired here so consumers don't have to.
    let fpsVisible = resolveInitialVisibility(opts.showFps);
    let fpsWidget: { el: HTMLElement; dispose: () => void } | null = null;
    function refreshWidgetState() {
        if (fpsVisible && !fpsWidget) {
            fpsWidget = mountFpsWidget({
                wrapper, getStats,
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
            wrapper: el, getStats,
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
        animLoop.stop();
        if (fpsWidget) { fpsWidget.dispose(); fpsWidget = null; }
        document.removeEventListener('keydown', onKey);
        if (pointsMesh) {
            scene.remove(pointsMesh);
            pointsGeometry?.dispose();
            pointsMaterial?.dispose();
        }
        circleTexture.dispose();
        bloom.dispose();
        renderer.dispose();
        if (!opts.signal) ac.abort();
    }

    const gfx: Gfx = {
        canvas: renderer.domElement,
        wrapper,
        get screenmap(): Screenmap { return screenmap; },
        ...(overlay ? { overlayCanvas: overlay.overlayCanvas, overlayCtx: overlay.overlayCtx } : {}),
        pushFrame,
        setBloom,
        getBloomStrength,
        setScreenmap,
        setDiameter,
        getDiameter,
        setTargetFPS,
        getStats,
        mountFpsCounter,
        unmountFpsCounter,
        setFpsVisible,
        isFpsVisible,
        dispose,
    };
    return gfx;
}

function applyBloomConfig(bloom: ReturnType<typeof createAutoBloom>, cfg: BloomConfig): void {
    switch (cfg.mode) {
        case 'auto':
            bloom.setAuto(true);
            break;
        case 'off':
            bloom.setAuto(false);
            bloom.setManualStrength(0);
            break;
        case 'manual':
            bloom.setAuto(false);
            bloom.setManualStrength(cfg.strength);
            break;
    }
}
