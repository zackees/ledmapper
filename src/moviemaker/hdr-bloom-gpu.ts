import {
    HalfFloatType,
    LinearFilter,
    LinearSRGBColorSpace,
    Mesh,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    WebGLRenderTarget,
    type Camera,
    type Texture,
    type WebGLRenderer,
} from 'three';
import {
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
 * The default strategy's composite shader.
 *
 * Every strategy's shader (including this one) now lives in
 * `hdr-bloom-strategies.ts`. This re-export keeps the historical import path
 * working for callers and tests that only care about the shipped default.
 */
export const HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER =
    HDR_BLOOM_STRATEGIES[DEFAULT_HDR_BLOOM_STRATEGY].fragmentShader;

export interface GpuHdrBloomComposite {
    /** Bracket-capture parameters owned by the active strategy. */
    brackets: HdrBloomBracketConfig;
    /** Render the unbloomed LED scene into a persistent RGBA16F bracket. */
    captureRaw: (scene: Scene, camera: Camera) => void;
    /** Copy one linear RGBA16F bloom result into its persistent bracket. */
    captureBloom: (bracket: 1 | 2 | 3, source: Texture) => void;
    setGlobalBloomBias: (bias: number) => void;
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

    return {
        brackets: strategy.brackets,
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
        setGlobalBloomBias(bias) {
            const uniform = material.uniforms.globalBloomBias;
            if (uniform) uniform.value = Math.min(Math.max(bias, 0), 1);
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
        },
    };
}
