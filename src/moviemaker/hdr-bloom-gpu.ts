import {
    FramebufferTexture,
    Mesh,
    NearestFilter,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    type WebGLRenderer,
} from 'three';

const vertexShader = /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * GPU equivalent of compositeHdrBloomRgba(). Inputs are deliberately captured
 * as RGBA8 framebuffer textures: v1 made its decisions from already-quantized
 * canvas bytes, so retaining that quantization is required for byte identity.
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
    vec3 raw = texture2D(rawFrame, vUv).rgb;
    vec3 low = texture2D(lowFrame, vUv).rgb;
    vec3 mid = texture2D(midFrame, vUv).rgb;
    vec3 high = texture2D(highFrame, vUv).rgb;
    float highRisk = pixelWhiteMergeRisk(raw, high);
    float midRisk = pixelWhiteMergeRisk(raw, mid);
    float highWeight = 1.0 - v1Smoothstep(0.035, 0.20, highRisk);
    float midWeight = 1.0 - v1Smoothstep(0.05, 0.24, midRisk);
    vec3 upper = mix(mid, high, highWeight);
    vec3 bloomComposite = mix(low, upper, midWeight);
    vec3 composite = mix(raw, bloomComposite, shadowBloomWeight(raw, high));

    // Match Uint8ClampedArray(Math.round(...)) before the RGBA8 framebuffer
    // conversion. Values are non-negative, so JS Math.round is floor(x+.5).
    composite = floor(composite * 255.0 + 0.5) / 255.0;
    gl_FragColor = vec4(composite, 1.0);
}
`;

export interface GpuHdrBloomComposite {
    /** Capture the currently displayed framebuffer into one RGBA8 bracket. */
    capture: (bracket: 0 | 1 | 2 | 3) => void;
    /** Draw only the final v1 composite into the displayed framebuffer. */
    render: () => void;
    dispose: () => void;
}

export function createGpuHdrBloomComposite(
    renderer: WebGLRenderer,
    width: number,
    height: number,
): GpuHdrBloomComposite {
    const frames = Array.from({ length: 4 }, () => {
        const texture = new FramebufferTexture(width, height);
        texture.minFilter = NearestFilter;
        texture.magFilter = NearestFilter;
        texture.generateMipmaps = false;
        return texture;
    });
    const material = new ShaderMaterial({
        uniforms: {
            rawFrame: { value: frames[0] },
            lowFrame: { value: frames[1] },
            midFrame: { value: frames[2] },
            highFrame: { value: frames[3] },
        },
        vertexShader,
        fragmentShader: HDR_BLOOM_COMPOSITE_FRAGMENT_SHADER,
        depthTest: false,
        depthWrite: false,
        transparent: false,
    });
    const geometry = new PlaneGeometry(2, 2);
    const scene = new Scene();
    scene.add(new Mesh(geometry, material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    return {
        capture(bracket) {
            const texture = frames[bracket];
            if (texture) renderer.copyFramebufferToTexture(texture);
        },
        render() {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
        },
        dispose() {
            for (const texture of frames) texture.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}
