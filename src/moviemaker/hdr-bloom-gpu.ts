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
 * HDR bloom is selected and composited in linear light. Selection thresholds
 * remain perceptual sRGB values so the established v1 highlight behavior is
 * preserved, but no bracket is quantized until the final canvas write.
 */
export const HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER = /* glsl */`
precision highp float;

uniform sampler2D rawFrame;
uniform sampler2D lowFrame;
uniform sampler2D midFrame;
uniform sampler2D highFrame;
varying vec2 vUv;

float v1Smoothstep(float edge0, float edge1, float value) {
    float t = clamp((value - edge0) / max(edge1 - edge0, 1e-9), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

vec3 linearToSrgb(vec3 value) {
    value = max(value, vec3(0.0));
    bvec3 cutoff = lessThanEqual(value, vec3(0.0031308));
    vec3 lower = value * 12.92;
    vec3 higher = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
    return mix(higher, lower, cutoff);
}

float pixelWhiteMergeRisk(vec3 raw, vec3 bloomed) {
    float rawMax = max(max(raw.r, raw.g), raw.b);
    if (rawMax < 0.04) return 0.0;
    float rawMin = min(min(raw.r, raw.g), raw.b);
    float bloomMax = max(max(bloomed.r, bloomed.g), bloomed.b);
    float bloomMin = min(min(bloomed.r, bloomed.g), bloomed.b);
    float rawSaturation = (rawMax - rawMin) / max(rawMax, 1e-9);
    float bloomSaturation = (bloomMax - bloomMin) / max(bloomMax, 1e-9);
    float colorWash = v1Smoothstep(0.72, 0.98, bloomMin)
        * max(rawSaturation - bloomSaturation, 0.0);
    float clippedDetail = v1Smoothstep(0.82, 0.995, bloomMax)
        * v1Smoothstep(0.03, 0.22, bloomMax - rawMax)
        * v1Smoothstep(0.30, 0.85, rawMax);
    return max(colorWash, clippedDetail * 0.65);
}

float shadowBloomWeight(vec3 raw, vec3 bloomed) {
    float rawMax = max(max(raw.r, raw.g), raw.b);
    if (rawMax >= 0.04) return 1.0;
    float bloomMax = max(max(bloomed.r, bloomed.g), bloomed.b);
    return v1Smoothstep(0.025, 0.14, bloomMax);
}

void main() {
    vec3 rawLinear = texture2D(rawFrame, vUv).rgb;
    vec3 lowLinear = texture2D(lowFrame, vUv).rgb;
    vec3 midLinear = texture2D(midFrame, vUv).rgb;
    vec3 highLinear = texture2D(highFrame, vUv).rgb;

    vec3 raw = linearToSrgb(rawLinear);
    vec3 mid = linearToSrgb(midLinear);
    vec3 high = linearToSrgb(highLinear);
    float highRisk = pixelWhiteMergeRisk(raw, high);
    float midRisk = pixelWhiteMergeRisk(raw, mid);
    float highWeight = 1.0 - v1Smoothstep(0.035, 0.20, highRisk);
    float midWeight = 1.0 - v1Smoothstep(0.05, 0.24, midRisk);
    vec3 upperLinear = mix(midLinear, highLinear, highWeight);
    vec3 bloomCompositeLinear = mix(lowLinear, upperLinear, midWeight);
    vec3 compositeLinear = mix(
        rawLinear,
        bloomCompositeLinear,
        shadowBloomWeight(raw, high)
    );

    // The default framebuffer is the sole quantization boundary. Explicitly
    // apply the output transfer here; ShaderMaterial does not add it for us.
    gl_FragColor = vec4(clamp(linearToSrgb(compositeLinear), 0.0, 1.0), 1.0);
}
`;

export interface GpuHdrBloomComposite {
    /** Render the unbloomed LED scene into a persistent RGBA16F bracket. */
    captureRaw: (scene: Scene, camera: Camera) => void;
    /** Copy one linear RGBA16F bloom result into its persistent bracket. */
    captureBloom: (bracket: 1 | 2 | 3, source: Texture) => void;
    /** Composite the four linear brackets and write display-sRGB to canvas. */
    render: () => void;
    dispose: () => void;
}

export function createGpuHdrBloomComposite(
    renderer: WebGLRenderer,
    width: number,
    height: number,
): GpuHdrBloomComposite {
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
        },
        vertexShader,
        fragmentShader: HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER,
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
