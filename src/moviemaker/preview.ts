/**
 * Three.js LED preview pane for the Video Maker.
 *
 * Replaces the old Canvas2D fillRect preview with a points mesh using the
 * shared circle sprite (same look as the demo page) plus FastLED-style
 * UnrealBloomPass bloom with an auto-bloom iris (shared createAutoBloom).
 *
 * The mesh is rebuilt only when the screenmap points change (array identity);
 * per frame only the color attribute is updated from the GPU gather sample.
 * The preview self-centers and self-scales, so translation and zoom of the
 * editor view cancel out — only rotation affects the rendered layout.
 */

import { WebGLRenderer, Scene, OrthographicCamera, Shape, ShapeGeometry, Mesh, MeshBasicMaterial, DoubleSide } from 'three';
import { createCircleTexture, rebuildPointsMesh } from '../three-utils';
import type { PointsMeshResult, StripPoint } from '../types/domain';
import { createAutoBloom } from '../auto-bloom';
import { attachContextLossWatchdog } from '../watchdogs';
import {
    PREVIEW_AUTO_FLOOR,
    PREVIEW_AUTO_MAX_DENSE,
    PREVIEW_AUTO_MAX_SPARSE,
    IRIS_DIAMETER_GAIN,
    BLOOM_RENDER_PX,
    compositeHdrBloomRgba,
} from '../bloom-utils';
import { estimateLedSize, resolvePointDiameterPx, STABLE_POINT_DIAMETER_MAX_PX } from './transforms';
import { createLogger } from '../debug-log';
import type { BloomProfile } from '../types/domain';
import { createGpuHdrBloomComposite } from './hdr-bloom-gpu';
import {
    DEFAULT_HDR_BLOOM_STRATEGY,
    resolveHdrBloomStrategy,
    type HdrBloomStrategyName,
} from './hdr-bloom-strategies';
import { SRGB8_TO_LINEAR } from '../color-space';

const log = createLogger('preview');

// FastLED's aesthetic camera margin so edge LEDs aren't clipped.
const AESTHETIC_MARGIN = 1.05;
const HDR_BLOOM_LOW = 0.20;
const HDR_BLOOM_MID = 0.55;
/** High bracket is reserved for powerful highlights, not zero-threshold haze. */
const HDR_HIGHLIGHT_THRESHOLD_DARK = 0.08;
const HDR_HIGHLIGHT_THRESHOLD_BRIGHT = 0.16;

export type HdrBloomCompositeMode = 'gpu-full' | 'cpu-full' | 'cpu-1024' | 'verify-full';

export interface HdrBloomVerification {
    comparedBytes: number;
    mismatchedBytes: number;
    maxChannelDelta: number;
    positiveDeltas: number;
    negativeDeltas: number;
    firstMismatch?: { byte: number; expected: number; actual: number };
}

export interface PreviewShape {
    type: 'el_wire' | 'el_panel';
    offset: number;
    vertices: StripPoint[];
    thickness?: number;
}

/** Preview density envelope (issue #49 keeps the floor binding on dense maps). */
const PREVIEW_PROFILE = {
    floor:     PREVIEW_AUTO_FLOOR,
    maxDense:  PREVIEW_AUTO_MAX_DENSE,
    maxSparse: PREVIEW_AUTO_MAX_SPARSE,
};

/**
 * Create the LED preview renderer inside `parent`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.parent - Container the WebGL canvas is appended to.
 * @param {number} [opts.side=400] - CSS pixel size of the (square) preview.
 * @param {number} [opts.maxBufferSize=1024] - Cap on the backing resolution.
 * @returns {{
 *   render: Function,
 *   dispose: Function,
 *   domElement: HTMLCanvasElement,
 *   setAutoBloom: (enabled: boolean) => void,
 *   setManualBloomStrength: (strength: number) => void,
 *   getCurrentBloomStrength: () => number,
 * }}
 */
export function createLedPreview({
    parent,
    side = 400,
    maxBufferSize = 1024,
    bloomProfile = PREVIEW_PROFILE,
    bloomDiameterGain = IRIS_DIAMETER_GAIN,
    bloomUseBlowoutRisk = false,
    enableHdrBloom = false,
    hdrBloomCompositeMode = 'gpu-full',
    hdrBloomStrategy = DEFAULT_HDR_BLOOM_STRATEGY,
}: {
    parent: HTMLElement;
    side?: number;
    maxBufferSize?: number;
    /** Production can request a tighter dense-panel bloom envelope. */
    bloomProfile?: BloomProfile;
    /** Production output keeps physical LED diameters stable by using 0. */
    bloomDiameterGain?: number;
    /** Modulate bloom according to dot area and neighbour overlap. */
    bloomUseBlowoutRisk?: boolean;
    /** Composite three full-resolution bloom brackets over a sharp base. */
    enableHdrBloom?: boolean;
    /** GPU is production; CPU modes retain the v1 oracle and 1024 experiment. */
    hdrBloomCompositeMode?: HdrBloomCompositeMode;
    /** Which composite algorithm to run. See `hdr-bloom-strategies.ts`. */
    hdrBloomStrategy?: HdrBloomStrategyName;
}) {
    // Render to a fixed backing-buffer size (independent of devicePixelRatio) so
    // bloom output is identical across platforms; capped at maxBufferSize. The
    // canvas downsamples to its CSS size, keeping circles crisp.
    const pixelRatio = Math.min(BLOOM_RENDER_PX, maxBufferSize) / side;

    // The CPU composite mirrors the default strategy only. Verifying any other
    // strategy against it would diff two different algorithms and report a
    // meaningless mismatch, so refuse the combination outright.
    if (enableHdrBloom
        && hdrBloomCompositeMode !== 'gpu-full'
        && !resolveHdrBloomStrategy(hdrBloomStrategy).supportsCpuOracle) {
        throw new Error(
            `HDR bloom strategy '${hdrBloomStrategy}' has no CPU oracle; `
            + `composite mode '${hdrBloomCompositeMode}' requires `
            + `'${DEFAULT_HDR_BLOOM_STRATEGY}'.`,
        );
    }
    const verifiesGpuHdrComposite = enableHdrBloom && hdrBloomCompositeMode === 'verify-full';
    const usesCpuHdrComposite = enableHdrBloom
        && (hdrBloomCompositeMode === 'cpu-full' || hdrBloomCompositeMode === 'cpu-1024');
    const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: usesCpuHdrComposite });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(side, side);
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.display = 'block';
    const hdrOutputCanvas = usesCpuHdrComposite ? document.createElement('canvas') : null;
    if (hdrOutputCanvas) {
        const cpuCompositeSize = hdrBloomCompositeMode === 'cpu-1024'
            ? Math.min(side, renderer.domElement.width)
            : renderer.domElement.width;
        hdrOutputCanvas.width = cpuCompositeSize;
        hdrOutputCanvas.height = cpuCompositeSize;
        hdrOutputCanvas.style.width = `${String(side)}px`;
        hdrOutputCanvas.style.height = `${String(side)}px`;
        hdrOutputCanvas.style.display = 'block';
        renderer.domElement.style.display = 'none';
        parent.appendChild(hdrOutputCanvas);
    } else {
        parent.appendChild(renderer.domElement);
    }

    // Log-only watchdog (issue #226) — see attachContextLossWatchdog doc.
    attachContextLossWatchdog({ canvas: renderer.domElement, tool: 'moviemaker-preview' });

    const scene = new Scene();
    // y-down camera (top < bottom) matching screenmap/canvas conventions;
    // bounds are refit to the rotated point bbox in fitCamera().
    //
    // near/far bracket the z=0 mesh plane with margin (camera sits at z=1).
    // The previous near=-1/far=1 put the points EXACTLY on the far plane —
    // a clip-space knife edge that happened to render but is precision-
    // dependent. Hardening only; the black-pane bug itself was the frozen
    // color copy in render() below.
    const camera = new OrthographicCamera(-1, 1, -1, 1, 0.1, 10);
    camera.position.z = 1;

    const circleTexture = createCircleTexture(64);
    // Shared auto-bloom controller. bloomResolution is the pane size; the
    // density floor stays binding on dense maps (minFloorMode 'density'), and
    // the preview always fully modulates the iris (no geometry blowout term).
    const bloom = createAutoBloom({
        renderer, scene, camera,
        width: side, height: side,
        profile: bloomProfile,
        paramOverrides: { bloomResolution: side },
        minFloorMode: 'density',
        useBlowoutRisk: bloomUseBlowoutRisk,
        diameterGain: bloomDiameterGain,
    });
    const hdrWidth = renderer.domElement.width;
    const hdrHeight = renderer.domElement.height;
    const hdrCpuWidth = hdrOutputCanvas?.width ?? 0;
    const hdrCpuHeight = hdrOutputCanvas?.height ?? 0;
    const hdrCanvases = usesCpuHdrComposite || verifiesGpuHdrComposite
        ? Array.from({ length: 4 }, () => document.createElement('canvas'))
        : [];
    for (const canvas of hdrCanvases) {
        canvas.width = verifiesGpuHdrComposite ? hdrWidth : hdrCpuWidth;
        canvas.height = verifiesGpuHdrComposite ? hdrHeight : hdrCpuHeight;
    }
    const hdrContexts = hdrCanvases.map((canvas) => canvas.getContext('2d', { willReadFrequently: true }));
    const hdrOutputContext = hdrOutputCanvas?.getContext('2d') ?? null;
    const hdrWorkWidth = verifiesGpuHdrComposite ? hdrWidth : hdrCpuWidth;
    const hdrWorkHeight = verifiesGpuHdrComposite ? hdrHeight : hdrCpuHeight;
    const hdrPixels = new Uint8ClampedArray(hdrWorkWidth * hdrWorkHeight * 4);
    const hdrGpuComposite = enableHdrBloom
        && (hdrBloomCompositeMode === 'gpu-full' || verifiesGpuHdrComposite)
        ? createGpuHdrBloomComposite(renderer, hdrWidth, hdrHeight, hdrBloomStrategy)
        : null;
    const hdrVerificationCanvas = verifiesGpuHdrComposite ? document.createElement('canvas') : null;
    if (hdrVerificationCanvas) {
        hdrVerificationCanvas.width = hdrWidth;
        hdrVerificationCanvas.height = hdrHeight;
    }
    const hdrVerificationContext = hdrVerificationCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    let hdrVerification: HdrBloomVerification | null = null;

    let meshData: PointsMeshResult | null = null;
    let cachedPts: StripPoint[] | null = null;
    let cachedPointChannelOffsets: number[] | null = null;
    let cachedShapes: PreviewShape[] | null = null;
    let shapeMeshes: { mesh: Mesh; material: MeshBasicMaterial; offset: number }[] = [];
    let cachedRotate: number | null = null;
    let cachedLedDiameter: number | null = null;
    let ledWorldRadius = 0.5;
    let ledSpacing = 1;
    let sceneExtent = 1;
    // Base dot size (CSS px) before the iris diameter modulation is applied.
    let baseLedPx = 0.75;

    function shapePolygon(shape: PreviewShape): StripPoint[] {
        if (shape.type === 'el_panel') return shape.vertices;
        const radius = (shape.thickness ?? 1) / 2;
        const left: StripPoint[] = [];
        const right: StripPoint[] = [];
        for (let i = 0; i < shape.vertices.length; i++) {
            const p = shape.vertices[i];
            if (!p) continue;
            const a = shape.vertices[Math.max(0, i - 1)] ?? p;
            const b = shape.vertices[Math.min(shape.vertices.length - 1, i + 1)] ?? p;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const length = Math.hypot(dx, dy) || 1;
            const nx = -dy / length * radius, ny = dx / length * radius;
            left.push([p[0] + nx, p[1] + ny]);
            right.push([p[0] - nx, p[1] - ny]);
        }
        return [...left, ...right.reverse()];
    }

    function rebuildShapes(shapes: PreviewShape[]) {
        for (const entry of shapeMeshes) {
            scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.material.dispose();
        }
        shapeMeshes = [];
        for (const shape of shapes) {
            const polygon = shapePolygon(shape);
            const first = polygon[0];
            if (!first || polygon.length < 3) continue;
            const path = new Shape();
            path.moveTo(first[0], first[1]);
            for (const point of polygon.slice(1)) path.lineTo(point[0], point[1]);
            path.closePath();
            const geometry = new ShapeGeometry(path);
            const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, side: DoubleSide });
            const mesh = new Mesh(geometry, material);
            mesh.renderOrder = 1;
            scene.add(mesh);
            shapeMeshes.push({ mesh, material, offset: shape.offset });
        }
    }

    function rebuild(localPts: StripPoint[], ledDiameter: number | null, shapes: PreviewShape[]) {
        meshData = rebuildPointsMesh({
            scene,
            previous: meshData,
            points: localPts,
            circleTexture,
            diameter: 1, // real size set in fitCamera()
        });
        // The screenmap's declared diameter (already in localPts units)
        // always wins; the spacing heuristic is only a fallback for maps
        // that declare none.
        ledSpacing = estimateLedSize(localPts);
        const dia = (typeof ledDiameter === 'number' && ledDiameter > 0)
            ? ledDiameter
            : ledSpacing;
        ledWorldRadius = dia / 2;
        rebuildShapes(shapes);
    }

    /**
     * Fit the orthographic camera to the rotated point bbox, FastLED-style:
     * half-extent = (extent/2 + maxLedVisualRadius) * 1.05.
     * Rotation is applied via mesh.rotation.z (same x/y math as the editor's
     * y-down transform since the camera maps world y downward).
     */
    function fitCamera(localPts: StripPoint[], rotate: number, shapes: PreviewShape[], ledDiameter: number | null) {
        const rad = rotate * Math.PI / 180;
        const cos_r = Math.cos(rad), sin_r = Math.sin(rad);
        let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
        const geometryPoints = [...localPts, ...shapes.flatMap((shape) => shape.vertices)];
        // Keep the unrotated panel dimensions as an oriented bounding box.
        // The camera must fit the rotated AABB (diamond + black corners), but
        // bloom coverage must be normalized against the active panel itself.
        let obbXmin = Infinity, obbXmax = -Infinity, obbYmin = Infinity, obbYmax = -Infinity;
        for (const [x, y] of geometryPoints) {
            if (x < obbXmin) obbXmin = x;
            if (x > obbXmax) obbXmax = x;
            if (y < obbYmin) obbYmin = y;
            if (y > obbYmax) obbYmax = y;
        }
        const orientedPanelExtent = Math.max(obbXmax - obbXmin, obbYmax - obbYmin, 1e-6);
        for (const [x0, y0] of geometryPoints) {
            const x = x0 * cos_r - y0 * sin_r;
            const y = x0 * sin_r + y0 * cos_r;
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
        }
        const cx = (xmin + xmax) / 2;
        const cy = (ymin + ymax) / 2;
        const extent = Math.max(xmax - xmin, ymax - ymin, 1e-6);
        const half = Math.max((extent / 2 + (ledDiameter !== null ? ledWorldRadius : 0)) * AESTHETIC_MARGIN, 1e-6);

        // Store scene extent so auto-bloom range can use it.
        sceneExtent = Math.max(xmax - xmin, ymax - ymin, 1e-6);

        camera.left = cx - half;
        camera.right = cx + half;
        camera.top = cy - half;     // y-down
        camera.bottom = cy + half;
        camera.updateProjectionMatrix();

        if (!meshData) return;
        meshData.mesh.rotation.z = rad;
        for (const entry of shapeMeshes) entry.mesh.rotation.z = rad;
        // PointsMaterial.size is in CSS pixels: the renderer multiplies the
        // size uniform by its pixelRatio internally, so the world→pixel
        // mapping must use the CSS pane size, not the drawing-buffer size.
        const worldToPx = side / (half * 2);
        const physicalPx = resolvePointDiameterPx(ledDiameter, worldToPx);
        // Undeclared sparse points use a stable CSS-pixel fallback so their
        // visual size does not grow with arbitrary map spacing. Declared
        // physical diameters remain authoritative.
        baseLedPx = physicalPx;
        meshData.material.size = baseLedPx;

        // Reproportion the bloom kernel + density envelope to the rendered dots.
        bloom.setGeometry({
            ledPx: baseLedPx,
            // At 45° the camera's square contains four black corner triangles.
            // Using `side` here makes the panel look artificially sparse and
            // gives auto-bloom too much headroom. This is the OBB's actual
            // rendered edge length within that camera instead.
            panePx: worldToPx * orientedPanelExtent,
            ledCount: localPts.length + shapeMeshes.length,
            ledSpacing,
            sceneExtent,
        });

    }

    /**
     * Render one preview frame.
     *
     * @param {Array<[number,number]>} localPts - LED positions in screenmap-local coords (centered at origin).
     * @param {number} rotate - rotation in degrees.
     * @param {{rgbPts: Uint8Array}|null} lastSample - most recent GPU gather sample.
     * @param {number|null} [ledDiameter=null] - the screenmap's declared LED
     *        diameter, scaled into localPts units; null falls back to the
     *        spacing heuristic.
     */
    let dbgFrames = 0;
    function render(localPts: StripPoint[], rotate: number, lastSample: { rgbPts: Uint8Array; linearRgbPts?: Float32Array; [key: string]: unknown } | null, ledDiameter: number | null = null, pointChannelOffsets: number[] = [], shapes: PreviewShape[] = [], mediaTimeMs?: number) {
        if ((localPts.length === 0 && shapes.length === 0) || !lastSample) {
            if (dbgFrames < 3) { dbgFrames++; log.debug('render-skip', { pts: localPts.length, shapes: shapes.length, hasSample: !!lastSample }); }
            renderer.clear();
            return;
        }
        // Debug-gated heartbeat (~every 5s at 60fps): sample brightness +
        // mesh state, so a future "pane is black" report can be triaged from
        // the ?lmlog=debug event trail alone (that's how THIS bug was found).
        dbgFrames++;
        if (dbgFrames % 300 === 1) {
            const s = lastSample.rgbPts;
            let sum = 0;
            for (const v of s) sum += v;
            log.debug('render-frame', {
                pts: localPts.length,
                avg: Math.round(sum / s.length),
                matSize: meshData?.material.size ?? null,
                meshInScene: scene.children.length > 0,
            });
        }
        if (localPts !== cachedPts || ledDiameter !== cachedLedDiameter || pointChannelOffsets !== cachedPointChannelOffsets || shapes !== cachedShapes) {
            cachedPts = localPts;
            cachedLedDiameter = ledDiameter;
            cachedPointChannelOffsets = pointChannelOffsets;
            cachedShapes = shapes;
            rebuild(localPts, ledDiameter, shapes);
            cachedRotate = null; // force camera refit
        }
        if (rotate !== cachedRotate) {
            cachedRotate = rotate;
            fitCamera(localPts, rotate, shapes, ledDiameter);
        }

        // Per-frame color update: Uint8 0-255 → Float32 0-1, every frame.
        //
        // Do NOT skip this based on sample-reference identity (the old #181
        // "optimization"): moviemaker reuses ONE sampleRgbPts buffer and
        // rewrites it in place each frame, so the reference never changes.
        // The identity check froze the colors at the first sampled frame —
        // video frame 0, typically black — and the pane rendered permanently
        // black while every upstream stage was healthy (#221 item 1). The
        // copy is ~3 floats per LED per frame; even a 64x64 quad map is a
        // trivial 12K writes.
        const src = lastSample.rgbPts;
        const linearSrc = lastSample.linearRgbPts;
        if (meshData) {
            const arr = meshData.colorAttribute.array as Float32Array;
            const count = Math.min(localPts.length, Math.floor(src.length / 3));
            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                const channel = pointChannelOffsets[i] ?? i;
                const c3 = channel * 3;
                // Gather bytes are display-encoded sRGB. Three.js vertex
                // colors are linear working-space values, so passing bytes / 255
                // directly makes Three apply the output transfer twice and
                // dramatically lifts shadows (for example, 16 becomes ~71).
                arr[i3    ] = linearSrc?.[c3] ?? SRGB8_TO_LINEAR[src[c3]     ?? 0] ?? 0;
                arr[i3 + 1] = linearSrc?.[c3 + 1] ?? SRGB8_TO_LINEAR[src[c3 + 1] ?? 0] ?? 0;
                arr[i3 + 2] = linearSrc?.[c3 + 2] ?? SRGB8_TO_LINEAR[src[c3 + 2] ?? 0] ?? 0;
            }
            meshData.colorAttribute.needsUpdate = true;
        }

        for (const entry of shapeMeshes) {
            const c3 = entry.offset * 3;
            entry.material.color.setRGB(
                linearSrc?.[c3] ?? SRGB8_TO_LINEAR[src[c3] ?? 0] ?? 0,
                linearSrc?.[c3 + 1] ?? SRGB8_TO_LINEAR[src[c3 + 1] ?? 0] ?? 0,
                linearSrc?.[c3 + 2] ?? SRGB8_TO_LINEAR[src[c3 + 2] ?? 0] ?? 0,
            );
        }

        const globalBloomBias = bloom.frame(src, mediaTimeMs);
        // Modest geometry-gated diameter modulation; dense layouts remain
        // stable to avoid subpixel aliasing bands across the LED lattice.
        const modulatedSize = baseLedPx * bloom.getDiameterScale();
        if (meshData) {
            meshData.material.size = ledDiameter === null
                ? Math.min(modulatedSize, STABLE_POINT_DIAMETER_MAX_PX)
                : modulatedSize;
        }
        if (hdrGpuComposite && meshData) {
            // Keep the sharp scene and all bloom brackets in linear RGBA16F.
            // The composite writes display-sRGB to the canvas exactly once.
            hdrGpuComposite.captureRaw(scene, camera);
            hdrGpuComposite.setGlobalBloomBias(globalBloomBias);
            const strength = bloom.bloomPass.strength;
            const threshold = bloom.bloomPass.threshold;
            // Bracket capture belongs to the active strategy: these parameters
            // co-evolved with each composite shader, so a shader alone does not
            // reproduce a past render.
            const {
                factors, strengthScale, radiusScales, highThresholdDark, highThresholdBright,
            } = hdrGpuComposite.brackets;
            const scaledStrength = strength * strengthScale;
            const radius = bloom.bloomPass.radius;
            for (let bracket = 0; bracket < factors.length; bracket++) {
                // Keep the high bracket at the requested full strength. The
                // HDR compositor attenuates neutral (white-building) energy
                // while retaining the high bracket's chromatic spill.
                bloom.bloomPass.strength = scaledStrength * (factors[bracket] ?? 1);
                // A strategy may want brackets at different spatial scales, not
                // just different intensities.
                bloom.bloomPass.radius = radius * (radiusScales[bracket] ?? 1);
                bloom.bloomPass.threshold = bracket === 2
                    ? highThresholdDark
                        + (highThresholdBright - highThresholdDark) * globalBloomBias
                    : 0;
                const texture = bloom.renderToTexture();
                if (texture) hdrGpuComposite.captureBloom((bracket + 1) as 1 | 2 | 3, texture);
                const bracketContext = hdrContexts[bracket + 1];
                if (bracketContext) {
                    bloom.render();
                    bracketContext.drawImage(renderer.domElement, 0, 0);
                }
            }
            bloom.bloomPass.strength = strength;
            bloom.bloomPass.threshold = threshold;
            bloom.bloomPass.radius = radius;
            hdrGpuComposite.render();
            if (hdrVerification === null && hdrVerificationContext && (mediaTimeMs ?? 0) >= 2000) {
                const [raw, low, mid, high] = hdrContexts;
                if (raw && low && mid && high) {
                    renderer.setRenderTarget(null);
                    renderer.render(scene, camera);
                    raw.drawImage(renderer.domElement, 0, 0);
                    const reference = compositeHdrBloomRgba(
                        raw.getImageData(0, 0, hdrWidth, hdrHeight).data,
                        low.getImageData(0, 0, hdrWidth, hdrHeight).data,
                        mid.getImageData(0, 0, hdrWidth, hdrHeight).data,
                        high.getImageData(0, 0, hdrWidth, hdrHeight).data,
                        hdrPixels,
                        globalBloomBias,
                    );
                    hdrVerificationContext.drawImage(renderer.domElement, 0, 0);
                    const actual = hdrVerificationContext.getImageData(0, 0, hdrWidth, hdrHeight).data;
                    let mismatchedBytes = 0;
                    let maxChannelDelta = 0;
                    let positiveDeltas = 0;
                    let negativeDeltas = 0;
                    let firstMismatch: HdrBloomVerification['firstMismatch'];
                    for (let byte = 0; byte < reference.length; byte++) {
                        const expected = reference[byte] ?? 0;
                        const observed = actual[byte] ?? 0;
                        const signedDelta = observed - expected;
                        const delta = Math.abs(signedDelta);
                        if (delta !== 0) {
                            mismatchedBytes++;
                            if (signedDelta > 0) positiveDeltas++; else negativeDeltas++;
                            firstMismatch ??= { byte, expected, actual: observed };
                        }
                        if (delta > maxChannelDelta) maxChannelDelta = delta;
                    }
                    hdrVerification = {
                        comparedBytes: reference.length,
                        mismatchedBytes,
                        maxChannelDelta,
                        positiveDeltas,
                        negativeDeltas,
                        ...(firstMismatch ? { firstMismatch } : {}),
                    };
                    log.info('hdr-gpu-verification', hdrVerification);
                }
            }
            return;
        }
        const [rawContext, lowContext, midContext, highContext] = hdrContexts;
        if (hdrOutputContext && rawContext && lowContext && midContext && highContext && meshData) {
            // Full-resolution HDR bloom bracket: a sharp base plus low, medium,
            // and high bloom. The spatial composite preserves the high bracket
            // in halos and uses restrained bloom only where LED cores wash out.
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            rawContext.drawImage(renderer.domElement, 0, 0, hdrCpuWidth, hdrCpuHeight);
            const strength = bloom.bloomPass.strength;
            const threshold = bloom.bloomPass.threshold;
            const factors = [HDR_BLOOM_LOW, HDR_BLOOM_MID, 1];
            for (let bracket = 0; bracket < factors.length; bracket++) {
                bloom.bloomPass.strength = strength * (factors[bracket] ?? 1);
                bloom.bloomPass.threshold = bracket === 2
                    ? HDR_HIGHLIGHT_THRESHOLD_DARK
                        + (HDR_HIGHLIGHT_THRESHOLD_BRIGHT - HDR_HIGHLIGHT_THRESHOLD_DARK) * globalBloomBias
                    : 0;
                bloom.render();
                const bracketContext = hdrContexts[bracket + 1];
                if (bracketContext) bracketContext.drawImage(renderer.domElement, 0, 0, hdrCpuWidth, hdrCpuHeight);
            }
            bloom.bloomPass.strength = strength;
            bloom.bloomPass.threshold = threshold;
            const imageData = hdrOutputContext.createImageData(hdrCpuWidth, hdrCpuHeight);
            imageData.data.set(compositeHdrBloomRgba(
                rawContext.getImageData(0, 0, hdrCpuWidth, hdrCpuHeight).data,
                lowContext.getImageData(0, 0, hdrCpuWidth, hdrCpuHeight).data,
                midContext.getImageData(0, 0, hdrCpuWidth, hdrCpuHeight).data,
                highContext.getImageData(0, 0, hdrCpuWidth, hdrCpuHeight).data,
                hdrPixels,
                globalBloomBias,
            ));
            hdrOutputContext.putImageData(imageData, 0, 0);
            return;
        }
        bloom.render();
    }

    /**
     * Enable or disable auto-bloom density scaling.
     * @param {boolean} enabled
     */
    function setAutoBloom(enabled: boolean) {
        bloom.setAuto(enabled);
    }

    /**
     * Enable or disable the bloom pass entirely for the preview.
     * @param {boolean} enabled
     */
    function setBloomEnabled(enabled: boolean) {
        bloom.setEnabled(enabled);
    }

    /**
     * Set the manual bloom strength (used when autoBloom is disabled).
     * @param {number} strength
     */
    function setManualBloomStrength(strength: number) {
        bloom.setManualStrength(strength);
    }

    /**
     * Return the current bloom pass strength (auto or manual).
     * @returns {number}
     */
    function getCurrentBloomStrength() {
        return bloom.getStrength();
    }

    function getHdrBloomVerification() {
        return hdrVerification;
    }

    function dispose() {
        if (meshData) {
            scene.remove(meshData.mesh);
            meshData.geometry.dispose();
            meshData.material.dispose();
            meshData = null;
        }
        for (const entry of shapeMeshes) {
            scene.remove(entry.mesh);
            entry.mesh.geometry.dispose();
            entry.material.dispose();
        }
        shapeMeshes = [];
        circleTexture.dispose();
        hdrGpuComposite?.dispose();
        bloom.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        hdrOutputCanvas?.remove();
    }

    return { render, dispose, domElement: hdrOutputCanvas ?? renderer.domElement, setAutoBloom, setBloomEnabled, setManualBloomStrength, getCurrentBloomStrength, getHdrBloomVerification };
}
