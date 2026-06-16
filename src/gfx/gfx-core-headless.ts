/**
 * createGfxCore — DOM-free render core. Issue #163 Phase 3a.
 *
 * The smallest possible Gfx that produces frames:
 *   - Accepts a canvas (HTMLCanvasElement on the main thread,
 *     OffscreenCanvas inside a Web Worker — both are supported by
 *     Three.js r170+).
 *   - No wrapper, no overlay, no FPS widget, no keyboard listener,
 *     no localStorage. Those concerns belong to the main-thread
 *     layer that wraps this core.
 *   - Owns the renderer + animation loop + auto-bloom controller +
 *     points mesh + screenmap normalization.
 *
 * This is what the worker variant (#163 §3) hosts directly after
 * receiving the transferred OffscreenCanvas. The existing
 * `createGfx({ parent, ... })` factory delegates to this for
 * everything renderer-shaped, then adds the DOM wrapper + widgets.
 */

import type { BufferGeometry, PointsMaterial, Points, Float32BufferAttribute } from 'three';

import {
    createCircleTexture,
    createRendererCore,
    rebuildPointsMesh,
    createAnimationLoop,
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
import { FpsMeter } from './fps';
import type { BloomConfig, Screenmap } from './types';

const INV_255 = 1 / 255;
const DEFAULT_PANE_SIZE = 800;
const DEFAULT_DIAMETER = 16;

export interface CreateGfxCoreOptions {
    /** Canvas to render into. HTMLCanvasElement on the main thread,
     *  OffscreenCanvas inside a Worker. */
    canvas: HTMLCanvasElement | OffscreenCanvas;
    /** Screenmap input (object, JSON string, or already-normalized). */
    screenmap: unknown;
    /** Internal render resolution. Default: BLOOM_RENDER_PX (2048). */
    renderPx?: number;
    /** Logical canvas size for camera + bloom geometry. Default 800. */
    paneSize?: number;
    /** Bloom configuration. Default `{ mode: 'auto' }`. */
    bloom?: BloomConfig;
    /** LED dot diameter in CSS px. Default 16. */
    diameter?: number;
    /** Target animation-loop FPS. Default 60. */
    targetFPS?: number;
    /** Keep WebGL backbuffer readable for `drawImage`/`captureStream`. */
    preserveDrawingBuffer?: boolean;
    /** Pixel ratio. Defaults to `window.devicePixelRatio` if available,
     *  else 1. Worker callers should pass the host's DPR explicitly. */
    devicePixelRatio?: number;
}

/** The slice of `Gfx` that has no DOM-side fields. */
export interface GfxCore {
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly screenmap: Screenmap;
    pushFrame(rgb: Uint8Array): void;
    setBloom(cfg: BloomConfig): void;
    getBloomStrength(): number;
    setScreenmap(map: unknown): void;
    setDiameter(px: number): void;
    getDiameter(): number;
    setTargetFPS(fps: number): void;
    getStats(): { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number };
    dispose(): void;
}

export function createGfxCore(opts: CreateGfxCoreOptions): GfxCore {
    const paneSize = opts.paneSize ?? DEFAULT_PANE_SIZE;
    const renderPx = opts.renderPx ?? BLOOM_RENDER_PX;
    const initialBloom: BloomConfig = opts.bloom ?? { mode: 'auto' };

    let screenmap = normalizeScreenmap(opts.screenmap, paneSize);

    const circleTexture = createCircleTexture(64);
    const { renderer, scene, camera } = createRendererCore({
        canvas: opts.canvas,
        width: paneSize,
        height: paneSize,
        renderPx,
        preserveDrawingBuffer: opts.preserveDrawingBuffer === true,
        ...(opts.devicePixelRatio !== undefined ? { devicePixelRatio: opts.devicePixelRatio } : {}),
    });

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

    const core: GfxCore = {
        canvas: opts.canvas,
        get screenmap(): Screenmap { return screenmap; },
        pushFrame(rgb: Uint8Array): void {
            lastFrame = rgb;
            pushMeter.tick(typeof performance !== 'undefined' ? performance.now() : Date.now());
        },
        setBloom(cfg: BloomConfig): void {
            applyBloomConfig(bloom, cfg);
        },
        getBloomStrength(): number { return bloom.getStrength(); },
        setScreenmap(map: unknown): void {
            screenmap = normalizeScreenmap(map, paneSize);
            rebuildPoints();
        },
        setDiameter(px: number): void {
            diameter = px;
            applyBloomGeometry(bloom, screenmap.points.map(([x, y]) => [x, y]), { ledPx: diameter, panePx: paneSize });
        },
        getDiameter(): number { return diameter; },
        setTargetFPS(fps: number): void { animLoop.setTargetFPS(fps); },
        getStats(): { renderFps: number; pushFps: number; frameTimeMs: number; framesRendered: number } {
            return {
                renderFps: renderMeter.getFps(),
                pushFps: pushMeter.getFps(),
                frameTimeMs: renderMeter.getMedianFrameMs(),
                framesRendered,
            };
        },
        dispose(): void {
            animLoop.stop();
            if (pointsMesh) {
                scene.remove(pointsMesh);
                pointsGeometry?.dispose();
                pointsMaterial?.dispose();
            }
            circleTexture.dispose();
            bloom.dispose();
            renderer.dispose();
        },
    };
    return core;
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
