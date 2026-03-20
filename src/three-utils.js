import * as THREE from 'three';

/**
 * Create a canvas-based circle texture for round points.
 * @param {number} size - Texture resolution in pixels.
 * @returns {THREE.CanvasTexture}
 */
export function createCircleTexture(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
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
export function createRendererAndScene({ width, height, parent, clearColor = 0x000000, enableOverlay = false }) {
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(clearColor, 1);

    const scene = new THREE.Scene();

    // Orthographic camera: left=0, right=width, top=0, bottom=height
    // gives y-down coordinate convention matching canvas 2D
    const camera = new THREE.OrthographicCamera(0, width, 0, height, -1, 1);
    camera.position.z = 1;

    // Wrapper div for canvas stacking
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = width + 'px';
    wrapper.style.margin = '0 auto';
    parent.appendChild(wrapper);

    renderer.domElement.style.display = 'block';
    wrapper.appendChild(renderer.domElement);

    const result = { renderer, scene, camera, wrapper };

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
export function buildPointsMesh({ points, circleTexture, diameter, defaultColor = [0, 0, 0] }) {
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const colorAttribute = new THREE.Float32BufferAttribute(colors, 3);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colorAttribute);

    const material = new THREE.PointsMaterial({
        size: diameter,
        sizeAttenuation: false,
        vertexColors: true,
        map: circleTexture,
        alphaTest: 0.5,
        depthTest: false,
        depthWrite: false,
    });

    const mesh = new THREE.Points(geometry, material);

    return { mesh, geometry, material, colorAttribute };
}

/**
 * Start a frame-rate-limited requestAnimationFrame loop.
 * @param {Object} opts
 * @param {number} opts.targetFPS - Initial target frames per second.
 * @param {function(number): void} opts.onFrame - Callback receiving timestamp.
 * @returns {{ setTargetFPS: function(number): void }}
 */
export function createAnimationLoop({ targetFPS, onFrame }) {
    let fps = targetFPS;
    let lastFrameTime = 0;

    function animate(time) {
        requestAnimationFrame(animate);
        const interval = 1000 / fps;
        const delta = time - lastFrameTime;
        if (delta < interval) return;
        lastFrameTime = time - (delta % interval);
        onFrame(time);
    }

    requestAnimationFrame(animate);

    return {
        setTargetFPS(newFPS) { fps = newFPS; }
    };
}
