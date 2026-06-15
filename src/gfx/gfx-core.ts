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

    const animLoop = createAnimationLoop({
        targetFPS: opts.targetFPS ?? 60,
        onFrame() {
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
        },
    });

    function pushFrame(rgb: Uint8Array): void {
        lastFrame = rgb;
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

    function getStats(): { fps: number; framesRendered: number } {
        return { fps: 60, framesRendered };
    }

    function dispose(): void {
        animLoop.stop();
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
