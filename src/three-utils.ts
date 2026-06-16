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

/** Create a canvas-based circle texture for round points.
 *
 *  Worker-safe: prefers `OffscreenCanvas` when `document` is unavailable
 *  (dedicated workers). Three.js wraps it via `CanvasTexture` identically
 *  to an HTMLCanvasElement. Issue #163 Phase 3a. */
export function createCircleTexture(size: number): CanvasTexture {
    // Two branches because the TS overloads for `getContext('2d')` on
    // HTMLCanvasElement vs OffscreenCanvas don't unify — each side
    // narrows to its own context type.
    if (typeof document === 'undefined') {
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('createCircleTexture: 2d context unavailable');
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
        return new CanvasTexture(canvas as unknown as HTMLCanvasElement);
    }
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

/**
 * Headless renderer core. Build a Three.js WebGLRenderer over an
 * existing canvas (HTMLCanvasElement on the main thread,
 * OffscreenCanvas inside a worker). No wrapper element, no DOM
 * mounting, no overlay — those are presentation concerns belonging
 * to the main-thread layer. Issue #163 Phase 3a.
 *
 * When `devicePixelRatio` is omitted, falls back to
 * `window.devicePixelRatio` if available, else 1 (worker context).
 */
export function createRendererCore({
    canvas, width, height, clearColor = 0x000000, renderPx,
    preserveDrawingBuffer = false, devicePixelRatio,
}: {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
    clearColor?: number;
    renderPx?: number;
    preserveDrawingBuffer?: boolean;
    devicePixelRatio?: number;
}): { renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera } {
    const renderer = new WebGLRenderer({
        canvas: canvas as HTMLCanvasElement,
        antialias: false,
        preserveDrawingBuffer,
    });
    renderer.setSize(width, height, false); // updateStyle=false: no DOM style writes
    const dpr = devicePixelRatio
        ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    const pixelRatio = (typeof renderPx === 'number' && renderPx > 0)
        ? renderPx / width
        : dpr;
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(clearColor, 1);

    const scene = new Scene();
    const camera = new OrthographicCamera(0, width, 0, height, -1, 1);
    camera.position.z = 1;

    return { renderer, scene, camera };
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
 * Resize `wrapper` to the largest square that fits inside `parent`.
 *
 * Why JS instead of pure CSS: when the parent is flex-sized with
 * `min-height: 0`, percent rules on the child (`max-block-size: 100%`)
 * don't see a "definite" containing-block height and silently fall
 * back to `auto`, letting the wrapper grow past its flex slot. The
 * JS path is bullet-proof: neutralize the wrapper to 0×0 (so it
 * stops dragging the parent's intrinsic-size around), read
 * `parent.getBoundingClientRect()` (the actual flex-allocated rect),
 * pick `min(width, height)` as the new square side.
 *
 * The WebGL drawing buffer is NOT touched — callers keep their fixed
 * render resolution (e.g. `BLOOM_RENDER_PX`). The canvas's CSS
 * `width: 100%; height: 100%` downsamples that buffer to the wrapper.
 *
 * `maxSize` caps the CSS size so we never UPSCALE a fixed-resolution
 * intermediate.
 *
 * Re-fits on parent resize (`ResizeObserver`) and window resize.
 * Listeners detach on `signal.abort()`.
 */
export function wireResponsiveCanvas({
    wrapper,
    parent,
    maxSize,
    signal,
}: {
    wrapper: HTMLElement;
    parent: HTMLElement;
    /** Cap the CSS side at this many pixels. Usually `BLOOM_RENDER_PX`. */
    maxSize?: number;
    signal?: AbortSignal;
}): void {
    function fit() {
        // Step 1: shrink the wrapper so its content stops contributing
        // to the parent's intrinsic-size calculation. The parent then
        // sizes to its pure flex contract.
        wrapper.style.width = '0px';
        wrapper.style.height = '0px';
        // Step 2: read the parent's actual rendered rect.
        const r = parent.getBoundingClientRect();
        const cs = getComputedStyle(parent);
        const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        // Step 3: subtract sibling space. When `parent` is a flex
        // column that also holds a controls strip / toolbar (above
        // or below the canvas), those siblings eat into the room
        // the wrapper can use. Without this the helper picks
        // `min(parent.width, parent.height)` and lets the wrapper
        // overflow past the mode bar — it never noticed the controls
        // were stealing 44px. Direction of subtraction follows the
        // parent's flex-direction; gap is also accounted for.
        const flexDirection = cs.flexDirection;
        const isRow = flexDirection === 'row' || flexDirection === 'row-reverse';
        let siblingMain = 0;
        let siblingCount = 0;
        for (const child of Array.from(parent.children)) {
            if (child === wrapper) continue;
            const cr = (child as HTMLElement).getBoundingClientRect();
            siblingMain += isRow ? cr.width : cr.height;
            siblingCount++;
        }
        const gap = parseFloat(cs.rowGap || cs.gap || '0') || 0;
        const totalGap = siblingCount > 0 ? gap * siblingCount : 0;
        const availW = r.width - padX - (isRow ? siblingMain + totalGap : 0);
        const availH = r.height - padY - (isRow ? 0 : siblingMain + totalGap);
        const cap = maxSize ?? Number.POSITIVE_INFINITY;
        const size = Math.max(Math.floor(Math.min(availW, availH, cap)), 1);
        wrapper.style.width = `${String(size)}px`;
        wrapper.style.height = `${String(size)}px`;
    }
    fit();
    const observer = new ResizeObserver(() => { fit(); });
    observer.observe(parent);
    const listenerOpts: AddEventListenerOptions = signal !== undefined ? { signal } : {};
    window.addEventListener('resize', fit, listenerOpts);
    if (signal !== undefined) {
        signal.addEventListener('abort', () => { observer.disconnect(); }, { once: true });
    }
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
