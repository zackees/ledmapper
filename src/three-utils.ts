import {
    CanvasTexture,
    WebGLRenderer,
    Scene,
    OrthographicCamera,
    BufferGeometry,
    Float32BufferAttribute,
    DynamicDrawUsage,
    PointsMaterial,
    Points,
    type Texture,
} from 'three';

import type { RendererContext, RendererContextWithOverlay, PointsMeshResult } from './types/domain';
import { wireSliderReadout } from './ui/sliders';

/** Create a canvas-based circle texture for round points. */
export function createCircleTexture(size: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('createCircleTexture: 2d context unavailable');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    return new CanvasTexture(canvas);
}

/** Create a WebGLRenderer, orthographic camera (y-down), and optional overlay canvas. */
export function createRendererAndScene({ width, height, parent, clearColor = 0x000000, enableOverlay = false, renderPx, preserveDrawingBuffer = false }: { width: number; height: number; parent: HTMLElement; clearColor?: number; enableOverlay?: boolean; renderPx?: number; preserveDrawingBuffer?: boolean }): RendererContextWithOverlay | RendererContext {
    // preserveDrawingBuffer keeps the backbuffer readable after compositing so
    // consumers can drawImage()/readback the canvas outside the draw call (e.g.
    // the Movie Player's frame-grab recorder). Slightly costlier; off by default.
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer });
    renderer.setSize(width, height);
    // When renderPx is given, render to a fixed backing-buffer size (renderPx²)
    // regardless of window.devicePixelRatio, so bloom output is identical across
    // platforms/displays (the canvas downsamples to its CSS size). Falls back to
    // devicePixelRatio for non-bloom consumers.
    const pixelRatio = (typeof renderPx === 'number' && renderPx > 0)
        ? renderPx / width
        : window.devicePixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(clearColor, 1);

    const scene = new Scene();

    const camera = new OrthographicCamera(0, width, 0, height, -1, 1);
    camera.position.z = 1;

    const wrapper = document.createElement('div');
    // Display geometry is driven entirely by CSS now — see
    // `.lm-canvas-wrapper` in global.css. `aspect-ratio: 1` plus
    // `max-block-size: 100%` and `max-inline-size: 100%` make the
    // browser pick the largest square that fits the wrapper's flex
    // parent. The WebGL drawing buffer below stays at `renderPx`
    // (= BLOOM_RENDER_PX) — the canvas's `width/height: 100%` rescales
    // that fixed buffer down to whatever the wrapper's computed size
    // is. Same picture, any viewport.
    wrapper.className = 'lm-canvas-wrapper';
    parent.appendChild(wrapper);

    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    wrapper.appendChild(renderer.domElement);

    if (enableOverlay) {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        wrapper.appendChild(overlayCanvas);
        const overlayCtx = overlayCanvas.getContext('2d');
        if (!overlayCtx) throw new Error('createRendererAndScene: overlay 2d context unavailable');
        return { renderer, scene, camera, wrapper, overlayCanvas, overlayCtx };
    }

    return { renderer, scene, camera, wrapper };
}

/** Build a THREE.Points mesh from an array of [x,y] points. */
export function buildPointsMesh({ points, circleTexture, diameter, defaultColor = [0, 0, 0] }: { points: number[][]; circleTexture: Texture; diameter: number; defaultColor?: number[] }): PointsMeshResult {
    const count = points.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const r = defaultColor[0] ?? 0;
    const g = defaultColor[1] ?? 0;
    const b = defaultColor[2] ?? 0;

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const pt = points[i];
        positions[i3    ] = pt?.[0] ?? 0;
        positions[i3 + 1] = pt?.[1] ?? 0;
        positions[i3 + 2] = 0;
        colors[i3    ] = r;
        colors[i3 + 1] = g;
        colors[i3 + 2] = b;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const colorAttribute = new Float32BufferAttribute(colors, 3);
    colorAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('color', colorAttribute);

    const material = new PointsMaterial({
        size: diameter,
        sizeAttenuation: false,
        vertexColors: true,
        map: circleTexture,
        alphaTest: 0.5,
        depthTest: false,
        depthWrite: false,
    });

    const mesh = new Points(geometry, material);

    return { mesh, geometry, material, colorAttribute };
}

/** Dispose an existing Points mesh and rebuild from new point data. */
export function rebuildPointsMesh({ scene, previous, points, circleTexture, diameter, defaultColor = [0, 0, 0] }: { scene: Scene; previous: PointsMeshResult | null | undefined; points: number[][]; circleTexture: Texture; diameter: number; defaultColor?: number[] }): PointsMeshResult {
    if (previous) {
        scene.remove(previous.mesh);
        previous.geometry.dispose();
        previous.material.dispose();
    }
    const result = buildPointsMesh({ points, circleTexture, diameter, defaultColor });
    scene.add(result.mesh);
    return result;
}

/** Wire a diameter slider to update a PointsMaterial's size. */
export function wireDiameterSlider({ slider, label, getMaterial, signal }: { slider: HTMLInputElement; label: HTMLElement; getMaterial: () => PointsMaterial | null; signal?: AbortSignal }): () => number {
    const baseOpts = {
        slider,
        readout: label,
        onChange: (raw: string) => {
            const mat = getMaterial();
            if (mat) mat.size = parseInt(raw);
        },
    };
    wireSliderReadout(signal !== undefined ? { ...baseOpts, signal } : baseOpts);
    return () => parseInt(slider.value);
}

/**
 * Deprecated, no-op. The canvas wrapper now sizes itself via CSS
 * (`.lm-canvas-wrapper` in global.css uses `aspect-ratio: 1` +
 * `max-block-size: 100%` + `max-inline-size: 100%`) — the browser
 * computes the largest fitting square automatically, with the
 * WebGL drawing buffer downsampling to the wrapper's CSS size.
 * No JS measurement / ResizeObserver / window-resize listener
 * needed.
 *
 * Kept as an exported no-op for one release so external consumers
 * (e.g. legacy embeds, the upcoming `@fastled/gfx` package, #137)
 * can drop the call site without an import error. Slated for
 * removal once the package extracts.
 */
export function wireResponsiveCanvas(_opts: {
    wrapper: HTMLElement;
    parent: HTMLElement;
    maxSize?: number;
    signal?: AbortSignal;
}): void {
    /* intentionally empty — see docstring */
}

/** Start a frame-rate-limited requestAnimationFrame loop. */
export function createAnimationLoop({ targetFPS, onFrame }: { targetFPS: number; onFrame: (time: number) => void }): { setTargetFPS: (fps: number) => void; stop: () => void } {
    let fps = targetFPS;
    let lastFrameTime = 0;
    let rafId: number | null = null;
    let stopped = false;

    function animate(time: number) {
        if (stopped) return;
        rafId = requestAnimationFrame(animate);
        const interval = 1000 / fps;
        const delta = time - lastFrameTime;
        if (delta < interval) return;
        lastFrameTime = time - (delta % interval);
        onFrame(time);
    }
    rafId = requestAnimationFrame(animate);

    return {
        setTargetFPS(newFPS: number) { fps = newFPS; },
        stop() { stopped = true; if (rafId !== null) cancelAnimationFrame(rafId); }
    };
}
