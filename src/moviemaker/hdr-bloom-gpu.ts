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
uniform float globalBloomBias;
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

float srgbToLinear(float value) {
    return value <= 0.04045
        ? value / 12.92
        : pow((value + 0.055) / 1.055, 2.4);
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
    vec3 low = linearToSrgb(lowLinear);
    vec3 mid = linearToSrgb(midLinear);
    vec3 high = linearToSrgb(highLinear);
    float highRisk = pixelWhiteMergeRisk(raw, high);
    float midRisk = pixelWhiteMergeRisk(raw, mid);
    // Local white-merge risk protects color; global mapped-LED luminance then
    // chooses which exposure bracket the whole frame should favor.
    float highWeight = (1.0 - v1Smoothstep(0.035, 0.20, highRisk))
        * mix(1.0, 0.15, globalBloomBias);
    float midWeight = (1.0 - v1Smoothstep(0.05, 0.24, midRisk))
        * mix(1.0, 0.35, globalBloomBias);
    vec3 upperLinear = mix(midLinear, highLinear, highWeight);
    vec3 selectedLinear = mix(lowLinear, upperLinear, midWeight);

    // Preserve the sharp frame. Only the shared neutral component comes from
    // HDR bracket selection; chromatic spill comes from the calibrated mid
    // bracket. Treating all selected RGB as bloom lets broad orange midtones
    // become a scene-wide veil and flattens their contrast with highlights.
    vec3 selectedAdded = max(selectedLinear - rawLinear, vec3(0.0));
    float neutralBloom = min(min(selectedAdded.r, selectedAdded.g), selectedAdded.b);
    float protectedNeutral = neutralBloom * shadowBloomWeight(raw, high);
    // Split bloom into neutral energy (the only part capable of driving a
    // color toward white) and chromatic residual. Global exposure controls the
    // former. The latter comes from the full high bracket so powerful colored
    // highlights retain their bleed even in a globally bright scene.
    vec3 highAdded = max(highLinear - rawLinear, vec3(0.0));
    float highNeutral = min(min(highAdded.r, highAdded.g), highAdded.b);
    vec3 highChroma = max(highAdded - vec3(highNeutral), vec3(0.0));
    float highAddedEnergy = max(max(highAdded.r, highAdded.g), highAdded.b);
    float chromaEnergy = max(max(highChroma.r, highChroma.g), highChroma.b);
    float chromaPurity = chromaEnergy / max(highAddedEnergy, 1e-9);
    float sceneChromaScale = mix(1.0, 0.65, globalBloomBias);
    float chromaGate = v1Smoothstep(srgbToLinear(0.015), srgbToLinear(0.07), chromaEnergy)
        * v1Smoothstep(0.08, 0.40, chromaPurity)
        * sceneChromaScale;

    // Hue-preserving shoulder: scale the complete chroma vector uniformly.
    // Unlike per-channel clipping this cannot desaturate a red/yellow/blue halo
    // as it gets brighter. The asymptote is perceptual sRGB 0.46.
    float chromaShoulder = srgbToLinear(0.40);
    float mappedChromaEnergy = chromaShoulder
        * (1.0 - exp(-chromaEnergy / max(chromaShoulder, 1e-9)));
    float chromaScale = chromaEnergy > 1e-9
        ? mappedChromaEnergy / chromaEnergy
        : 0.0;
    vec3 chromaticBloom = highChroma * chromaScale * chromaGate;

    // Saturated highlights need less neutral lift. Suppressing shared RGB here
    // preserves saturation while leaving neutral/white highlights under the
    // established global exposure and HDR bracket selector.
    float saturationProtection = v1Smoothstep(0.15, 0.65, chromaPurity);
    protectedNeutral *= mix(1.0, 0.30, saturationProtection);

    float rawMax = max(max(raw.r, raw.g), raw.b);
    float darkMask = 1.0 - v1Smoothstep(0.02, 0.12, rawMax);
    float baseLimitSrgb = mix(0.18, 0.11, globalBloomBias);
    float neutralLimit = mix(1.0, srgbToLinear(baseLimitSrgb), darkMask);
    float neutralHeadroom = max(min(min(
        1.0 - rawLinear.r,
        1.0 - rawLinear.g
    ), 1.0 - rawLinear.b), 0.0);
    float neutralAdded = min(min(protectedNeutral, neutralLimit), neutralHeadroom);

    // Apply a single headroom scale to the chroma vector. All channels keep
    // their ratio, so gamut protection cannot turn colored bleed white.
    vec3 baseWithNeutral = rawLinear + vec3(neutralAdded);
    vec3 available = max(vec3(1.0) - baseWithNeutral, vec3(0.0));
    float hueSafeScale = 1.0;
    if (chromaticBloom.r > 1e-9) hueSafeScale = min(hueSafeScale, available.r / chromaticBloom.r);
    if (chromaticBloom.g > 1e-9) hueSafeScale = min(hueSafeScale, available.g / chromaticBloom.g);
    if (chromaticBloom.b > 1e-9) hueSafeScale = min(hueSafeScale, available.b / chromaticBloom.b);
    vec3 compositeLinear = baseWithNeutral + chromaticBloom * clamp(hueSafeScale, 0.0, 1.0);

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
    setGlobalBloomBias: (bias: number) => void;
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
            globalBloomBias: { value: 0 },
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
