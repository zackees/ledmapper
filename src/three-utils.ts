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
} from 'three';

/**
 * Create a canvas-based circle texture for round points.
 * @param {number} size - Texture resolution in pixels.
 * @returns {THREE.CanvasTexture}
 */
export function createCircleTexture(size: number) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    return new CanvasTexture(canvas);
}

/**
 * Create a WebGLRenderer, orthographic camera (y-down), and optional overlay canvas.
 * @param {Object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {HTMLElement} opts.parent - Container element to append the wrapper to.
 * @param {number} [opts.clearColor=0x000000]
 * @param {boolean} [opts.enableOverlay=false]
 * @returns {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, wrapper: HTMLDivElement, overlayCanvas?: HTMLCanvasElement, overlayCtx?: CanvasRenderingContext2D }}
 */
export function createRendererAndScene({ width, height, parent, clearColor = 0x000000, enableOverlay = false }: { width: number; height: number; parent: HTMLElement; clearColor?: number; enableOverlay?: boolean }): any {
    const renderer = new WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(clearColor, 1);

    const scene = new Scene();

    // Orthographic camera: left=0, right=width, top=0, bottom=height
    // gives y-down coordinate convention matching canvas 2D
    const camera = new OrthographicCamera(0, width, 0, height, -1, 1);
    camera.position.z = 1;

    // Wrapper div for canvas stacking
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = width + 'px';
    wrapper.style.margin = '0 auto';
    parent.appendChild(wrapper);

    renderer.domElement.style.display = 'block';
    wrapper.appendChild(renderer.domElement);

    const result: any = { renderer, scene, camera, wrapper };

    if (enableOverlay) {
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;';
        wrapper.appendChild(overlayCanvas);
        result.overlayCanvas = overlayCanvas;
        result.overlayCtx = overlayCanvas.getContext('2d');
    }

    return result;
}

/**
 * Build a THREE.Points mesh from an array of [x,y] points.
 * @param {Object} opts
 * @param {number[][]} opts.points - Array of [x, y] coordinates.
 * @param {THREE.Texture} opts.circleTexture
 * @param {number} opts.diameter - Point size in CSS pixels.
 * @param {number[]} [opts.defaultColor=[0,0,0]] - RGB floats 0-1.
 * @returns {{ mesh: THREE.Points, geometry: THREE.BufferGeometry, material: THREE.PointsMaterial, colorAttribute: THREE.Float32BufferAttribute }}
 */
export function buildPointsMesh({ points, circleTexture, diameter, defaultColor = [0, 0, 0] }: { points: any[][]; circleTexture: any; diameter: number; defaultColor?: number[] }) {
    const count = points.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        positions[i3    ] = points[i][0];
        positions[i3 + 1] = points[i][1];
        positions[i3 + 2] = 0;
        colors[i3    ] = defaultColor[0];
        colors[i3 + 1] = defaultColor[1];
        colors[i3 + 2] = defaultColor[2];
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

/**
 * Dispose an existing Points mesh and rebuild from new point data.
 *
 * @param {Object} opts
 * @param {THREE.Scene} opts.scene
 * @param {{ mesh: THREE.Points, geometry: THREE.BufferGeometry, material: THREE.PointsMaterial }|null} opts.previous - Previous mesh to dispose, or null.
 * @param {number[][]} opts.points - Array of [x, y] coordinates.
 * @param {THREE.Texture} opts.circleTexture
 * @param {number} opts.diameter
 * @param {number[]} [opts.defaultColor=[0,0,0]]
 * @returns {{ mesh: THREE.Points, geometry: THREE.BufferGeometry, material: THREE.PointsMaterial, colorAttribute: THREE.Float32BufferAttribute }}
 */
export function rebuildPointsMesh({ scene, previous, points, circleTexture, diameter, defaultColor = [0, 0, 0] }: { scene: any; previous: any; points: any[][]; circleTexture: any; diameter: number; defaultColor?: number[] }) {
    if (previous) {
        scene.remove(previous.mesh);
        previous.geometry.dispose();
        previous.material.dispose();
    }
    const result = buildPointsMesh({ points, circleTexture, diameter, defaultColor });
    scene.add(result.mesh);
    return result;
}

/**
 * Wire a diameter slider to update a PointsMaterial's size.
 *
 * @param {Object} opts
 * @param {HTMLInputElement} opts.slider - The range input element.
 * @param {HTMLElement} opts.label - Element to display current value.
 * @param {function(): THREE.PointsMaterial|null} opts.getMaterial - Returns current material.
 * @param {AbortSignal} [opts.signal] - AbortSignal for cleanup.
 * @returns {function(): number} getDiameter — returns current diameter value.
 */
export function wireDiameterSlider({ slider, label, getMaterial, signal }: { slider: any; label: any; getMaterial: any; signal?: AbortSignal }) {
    function update() {
        const d = parseInt(slider.value);
        label.innerText = d;
        const mat = getMaterial();
        if (mat) mat.size = d;
    }
    slider.addEventListener('input', update, { signal });
    return () => parseInt(slider.value);
}

/**
 * Start a frame-rate-limited requestAnimationFrame loop.
 * @param {Object} opts
 * @param {number} opts.targetFPS - Initial target frames per second.
 * @param {function(number): void} opts.onFrame - Callback receiving timestamp.
 * @returns {{ setTargetFPS: function(number): void }}
 */
export function createAnimationLoop({ targetFPS, onFrame }: { targetFPS: number; onFrame: (time: number) => void }) {
    let fps = targetFPS;
    let lastFrameTime = 0;
    let rafId: any = null;
    let stopped = false;

    function animate(time: any) {
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
        setTargetFPS(newFPS: any) { fps = newFPS; },
        stop() { stopped = true; if (rafId) cancelAnimationFrame(rafId); }
    };
}
