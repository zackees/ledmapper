import {
    DataTexture,
    HalfFloatType,
    LinearFilter,
    LinearSRGBColorSpace,
    Mesh,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    RGBAFormat,
    UnsignedByteType,
    Vector2,
    Vector4,
    WebGLRenderTarget,
    type Camera,
    type Texture,
    type WebGLRenderer,
} from 'three';
import {
    CPU_ORACLE_HDR_BLOOM_STRATEGY,
    DEFAULT_HDR_BLOOM_STRATEGY,
    HDR_BLOOM_STRATEGIES,
    resolveHdrBloomStrategy,
    type HdrBloomBracketConfig,
    type HdrBloomStrategyName,
} from './hdr-bloom-strategies';

const vertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const copyFragmentShader = /* glsl */`
precision highp float;

uniform sampler2D sourceFrame;
varying vec2 vUv;

void main() {
    gl_FragColor = texture2D(sourceFrame, vUv);
}
`;

/**
 * The CPU-oracle strategy's composite shader.
 *
 * Every strategy's shader now lives in `hdr-bloom-strategies.ts`. This
 * re-export keeps the historical import path working. It is bound to the
 * oracle strategy rather than to whatever is currently default, because its
 * consumers compare it against the CPU composite in `bloom-utils.ts`.
 */
export const HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER =
    HDR_BLOOM_STRATEGIES[CPU_ORACLE_HDR_BLOOM_STRATEGY].fragmentShader;

export interface GpuHdrBloomComposite {
    /** Bracket-capture parameters owned by the active strategy. */
    brackets: HdrBloomBracketConfig;
    /** The captured raw-emission texture (input for a custom PSF pipeline). */
    rawTexture: Texture;
    /** Feed the effective bloom strength to strategies that scale in-shader. */
    setBloomStrength: (strength: number) => void;
    /** Render the unbloomed LED scene into a persistent RGBA16F bracket. */
    captureRaw: (scene: Scene, camera: Camera) => void;
    /**
     * Copy an externally rendered raw frame into the raw bracket. Used to
     * capture raw through the same composer path as the bloomed brackets, so
     * bracket-minus-raw is a pure blur (no MSAA edge disagreement -> no
     * black rings, #493).
     */
    captureRawFrom: (source: Texture) => void;
    /** Copy one linear RGBA16F bloom result into its persistent bracket. */
    captureBloom: (bracket: 1 | 2 | 3, source: Texture) => void;
    setGlobalBloomBias: (bias: number) => void;
    setBloomFrequencyBlend: (blend: number) => void;
    /** Upload the per-LED low/mid bloom-admission field. */
    setLocalBloomBias: (
        data: Uint8Array | null,
        width?: number,
        height?: number,
        rotationDegrees?: number,
        gridAspect?: readonly [number, number],
        cameraExtentScale?: number,
    ) => void;
    /** Composite the four linear brackets and write display-sRGB to canvas. */
    render: () => void;
    dispose: () => void;
}

export function createGpuHdrBloomComposite(
    renderer: WebGLRenderer,
    width: number,
    height: number,
    strategyName: HdrBloomStrategyName = DEFAULT_HDR_BLOOM_STRATEGY,
): GpuHdrBloomComposite {
    const strategy = resolveHdrBloomStrategy(strategyName);
    let localBloomBiasTexture = new DataTexture(
        new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType,
    );
    localBloomBiasTexture.minFilter = LinearFilter;
    localBloomBiasTexture.magFilter = LinearFilter;
    localBloomBiasTexture.generateMipmaps = false;
    localBloomBiasTexture.needsUpdate = true;
    const frames = Array.from({ length: 4 }, () => {
        const target = new WebGLRenderTarget(width, height, {
            type: HalfFloatType,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            depthBuffer: false,
        });
        target.texture.colorSpace = LinearSRGBColorSpace;
        target.texture.generateMipmaps = false;
        return target;
    });
    const copyMaterial = new ShaderMaterial({
        uniforms: { sourceFrame: { value: null as Texture | null } },
        vertexShader,
        fragmentShader: copyFragmentShader,
        depthTest: false,
        depthWrite: false,
    });
    const material = new ShaderMaterial({
        uniforms: {
            rawFrame: { value: frames[0]?.texture },
            lowFrame: { value: frames[1]?.texture },
            midFrame: { value: frames[2]?.texture },
            highFrame: { value: frames[3]?.texture },
            globalBloomBias: { value: 0 },
            bloomFrequencyBlend: { value: 0 },
            bloomStrength: { value: 1 },
            localBloomBias: { value: localBloomBiasTexture },
            localBloomBiasEnabled: { value: 0 },
            localBloomGridSample: { value: new Vector4(0, 0, 0.5, 0.5) },
            localBloomPanelAspect: { value: new Vector2(1, 1) },
            localBloomRotation: { value: new Vector2(1, 0) },
            localBloomCameraExtentScale: { value: 1.05 },
        },
        vertexShader,
        fragmentShader: strategy.fragmentShader,
        depthTest: false,
        depthWrite: false,
        transparent: false,
    });
    const geometry = new PlaneGeometry(2, 2);
    const copyScene = new Scene();
    copyScene.add(new Mesh(geometry, copyMaterial));
    const compositeScene = new Scene();
    compositeScene.add(new Mesh(geometry, material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const rawFrameTarget = frames[0];
    if (!rawFrameTarget) throw new Error('HDR composite raw bracket missing');
    return {
        brackets: strategy.brackets,
        rawTexture: rawFrameTarget.texture,
        setBloomStrength(strength) {
            const uniform = material.uniforms.bloomStrength;
            if (uniform) uniform.value = Math.max(strength, 0);
        },
        captureRaw(scene, sourceCamera) {
            renderer.setRenderTarget(frames[0] ?? null);
            renderer.clear();
            renderer.render(scene, sourceCamera);
        },
        captureBloom(bracket, source) {
            const sourceUniform = copyMaterial.uniforms.sourceFrame;
            if (sourceUniform) sourceUniform.value = source;
            renderer.setRenderTarget(frames[bracket] ?? null);
            renderer.clear();
            renderer.render(copyScene, camera);
        },
        captureRawFrom(source) {
            const sourceUniform = copyMaterial.uniforms.sourceFrame;
            if (sourceUniform) sourceUniform.value = source;
            renderer.setRenderTarget(frames[0] ?? null);
            renderer.clear();
            renderer.render(copyScene, camera);
        },
        setGlobalBloomBias(bias) {
            const uniform = material.uniforms.globalBloomBias;
            if (uniform) uniform.value = Math.min(Math.max(bias, 0), 1);
        },
        setBloomFrequencyBlend(blend) {
            const uniform = material.uniforms.bloomFrequencyBlend;
            if (uniform) uniform.value = Math.min(Math.max(blend, 0), 1);
        },
        setLocalBloomBias(
            data,
            width = 1,
            height = 1,
            rotationDegrees = 0,
            gridAspect = [1, 1],
            cameraExtentScale = 1.05,
        ) {
            const enabled = material.uniforms.localBloomBiasEnabled;
            if (!data || width < 2 || height < 2 || data.length !== width * height * 4) {
                if (enabled) enabled.value = 0;
                return;
            }
            const image = localBloomBiasTexture.image;
            if (image.width !== width || image.height !== height) {
                localBloomBiasTexture.dispose();
                localBloomBiasTexture = new DataTexture(
                    data, width, height, RGBAFormat, UnsignedByteType,
                );
                localBloomBiasTexture.minFilter = LinearFilter;
                localBloomBiasTexture.magFilter = LinearFilter;
                localBloomBiasTexture.generateMipmaps = false;
                const textureUniform = material.uniforms.localBloomBias;
                if (textureUniform) textureUniform.value = localBloomBiasTexture;
            } else {
                localBloomBiasTexture.image.data = data;
            }
            localBloomBiasTexture.needsUpdate = true;
            const sample = material.uniforms.localBloomGridSample;
            if (sample) (sample.value as Vector4).set(
                (width - 1) / width,
                (height - 1) / height,
                0.5 / width,
                0.5 / height,
            );
            const aspect = material.uniforms.localBloomPanelAspect;
            if (aspect) (aspect.value as Vector2).set(
                Math.max(gridAspect[0], 1e-6),
                Math.max(gridAspect[1], 1e-6),
            );
            const radians = rotationDegrees * Math.PI / 180;
            const rotation = material.uniforms.localBloomRotation;
            if (rotation) (rotation.value as Vector2).set(Math.cos(radians), Math.sin(radians));
            const extent = material.uniforms.localBloomCameraExtentScale;
            if (extent) extent.value = Math.max(cameraExtentScale, 1e-6);
            if (enabled) enabled.value = 1;
        },
        render() {
            renderer.setRenderTarget(null);
            renderer.render(compositeScene, camera);
        },
        dispose() {
            for (const frame of frames) frame.dispose();
            geometry.dispose();
            copyMaterial.dispose();
            material.dispose();
            localBloomBiasTexture.dispose();
        },
    };
}
