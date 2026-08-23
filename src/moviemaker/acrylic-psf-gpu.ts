/**
 * Custom PSF pipeline for the acrylic strategies (#493).
 *
 * Replaces UnrealBloomPass for bracket capture. UnrealBloom is a luminance
 * threshold + mip pyramid of separable Gaussians + tinted recombine, of which
 * the HDR path used only the Gaussians — and it structurally cannot give us
 * the one thing the acrylic model needs: a COVERAGE channel. This pipeline
 * blurs vec4(emission, coverage) — normalized-convolution style — so the
 * composite can separate "how much lit panel is nearby" (alpha) from "what
 * color is the light" (rgb / alpha, undiluted by the black gaps between
 * LEDs).
 *
 * Three brackets are produced by PROGRESSIVE blurring at descending
 * resolutions (1/2, 1/4, 1/8), so each bracket's sigma compounds on the
 * previous one and the wide bracket is genuinely wide for near-free cost.
 * The brackets are pure fields: no strength scaling and no threshold is
 * applied at capture — the composite owns all of that, which is what finally
 * makes a strategy's shader alone reproduce a render.
 */

import {
    HalfFloatType,
    LinearFilter,
    LinearSRGBColorSpace,
    Mesh,
    OrthographicCamera,
    PlaneGeometry,
    Scene,
    ShaderMaterial,
    Vector2,
    WebGLRenderTarget,
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

/**
 * Emission + coverage prep. Coverage is derived from emission rather than
 * sprite alpha so no renderer changes are needed: any texel with meaningful
 * energy is lit panel. The threshold is far below visible levels, so dim LEDs
 * still count as coverage while true black does not.
 */
const prepFragmentShader = /* glsl */`
precision highp float;

uniform sampler2D sourceFrame;
varying vec2 vUv;

void main() {
    vec3 emission = texture2D(sourceFrame, vUv).rgb;
    // Alpha carries DRIVE LEVEL, not binary occupancy (#496 Phase 3 semantic,
    // arrived early): binary coverage measured identical values over dimly
    // lit and fully driven neighborhoods (0.231 vs 0.239), so it could not
    // discriminate veil from pane. Drive-weighted alpha saturates at 30%
    // drive: dim panel admits dim glow, driven panel admits the white-out.
    float coverage = clamp(max(max(emission.r, emission.g), emission.b) / 0.30, 0.0, 1.0);
    gl_FragColor = vec4(emission, coverage);
}
`;

/** Separable 9-tap Gaussian; direction selects the axis. */
const blurFragmentShader = /* glsl */`
precision highp float;

uniform sampler2D sourceFrame;
uniform vec2 texelStep;
varying vec2 vUv;

void main() {
    // Normalized 9-tap Gaussian (sigma ~ 1.8 texels).
    float w0 = 0.2270270;
    float w1 = 0.1945946;
    float w2 = 0.1216216;
    float w3 = 0.0540541;
    float w4 = 0.0162162;
    vec4 sum = texture2D(sourceFrame, vUv) * w0;
    sum += (texture2D(sourceFrame, vUv + texelStep * 1.0)
        + texture2D(sourceFrame, vUv - texelStep * 1.0)) * w1;
    sum += (texture2D(sourceFrame, vUv + texelStep * 2.0)
        + texture2D(sourceFrame, vUv - texelStep * 2.0)) * w2;
    sum += (texture2D(sourceFrame, vUv + texelStep * 3.0)
        + texture2D(sourceFrame, vUv - texelStep * 3.0)) * w3;
    sum += (texture2D(sourceFrame, vUv + texelStep * 4.0)
        + texture2D(sourceFrame, vUv - texelStep * 4.0)) * w4;
    gl_FragColor = sum;
}
`;

export interface AcrylicPsfBrackets {
    /** Blurred vec4(emission, coverage) at three compounding sigmas. */
    low: Texture;
    mid: Texture;
    high: Texture;
}

export interface AcrylicPsfPipeline {
    /** Blur the raw emission texture into the three bracket fields. */
    render: (rawFrame: Texture) => AcrylicPsfBrackets;
    dispose: () => void;
}

function makeTarget(width: number, height: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
    });
    target.texture.colorSpace = LinearSRGBColorSpace;
    target.texture.generateMipmaps = false;
    return target;
}

export function createAcrylicPsfPipeline(
    renderer: WebGLRenderer,
    width: number,
    height: number,
): AcrylicPsfPipeline {
    // Levels at 1/2, 1/4, 1/8 resolution. Each level ping-pongs a separable
    // blur, seeded from the previous level, so sigma compounds.
    const levels = [2, 4, 8].map((divisor) => {
        const w = Math.max(Math.round(width / divisor), 8);
        const h = Math.max(Math.round(height / divisor), 8);
        return {
            a: makeTarget(w, h),
            b: makeTarget(w, h),
            texel: new Vector2(1 / w, 1 / h),
            /** Extra blur iterations at this level (each = one H+V pass). */
            // Level 0 widened (1 -> 3 iterations): a too-narrow tight lobe
            // leaves deep valleys between splats that the ring detector flags
            // (dip-recover between neighboring dots). UnrealBloom's brackets
            // never had this because each summed five mips.
            iterations: divisor === 2 ? 4 : 2,
        };
    });

    const prepMaterial = new ShaderMaterial({
        uniforms: { sourceFrame: { value: null as Texture | null } },
        vertexShader,
        fragmentShader: prepFragmentShader,
        depthTest: false,
        depthWrite: false,
    });
    const blurMaterial = new ShaderMaterial({
        uniforms: {
            sourceFrame: { value: null as Texture | null },
            texelStep: { value: new Vector2() },
        },
        vertexShader,
        fragmentShader: blurFragmentShader,
        depthTest: false,
        depthWrite: false,
    });

    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, prepMaterial);
    const fsScene = new Scene();
    fsScene.add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    function runPass(
        material: ShaderMaterial,
        source: Texture,
        destination: WebGLRenderTarget,
    ): void {
        mesh.material = material;
        const uniform = material.uniforms.sourceFrame;
        if (uniform) uniform.value = source;
        renderer.setRenderTarget(destination);
        renderer.clear();
        renderer.render(fsScene, camera);
    }

    function blurLevel(
        level: (typeof levels)[number],
        seed: Texture,
    ): Texture {
        let source = seed;
        let first = true;
        for (let i = 0; i < level.iterations; i++) {
            const step = blurMaterial.uniforms.texelStep;
            if (step) (step.value as Vector2).set(level.texel.x, 0);
            runPass(blurMaterial, first ? source : level.b.texture, level.a);
            if (step) (step.value as Vector2).set(0, level.texel.y);
            runPass(blurMaterial, level.a.texture, level.b);
            first = false;
            source = level.b.texture;
        }
        return level.b.texture;
    }

    return {
        render(rawFrame) {
            const [l0, l1, l2] = levels;
            // Prep pass writes emission+coverage straight into level 0's
            // ping target (downsampling to 1/2 in the same draw).
            runPass(prepMaterial, rawFrame, l0!.a);
            // Seed level 0's blur from the prepped half-res field.
            let seed: Texture = l0!.a.texture;
            const stepA = blurMaterial.uniforms.texelStep;
            if (stepA) (stepA.value as Vector2).set(0, l0!.texel.y);
            runPass(blurMaterial, seed, l0!.b);
            if (stepA) (stepA.value as Vector2).set(l0!.texel.x, 0);
            runPass(blurMaterial, l0!.b.texture, l0!.a);
            seed = l0!.a.texture;
            const low = seed;
            const mid = blurLevel(l1!, low);
            const high = blurLevel(l2!, mid);
            renderer.setRenderTarget(null);
            return { low, mid, high };
        },
        dispose() {
            for (const level of levels) {
                level.a.dispose();
                level.b.dispose();
            }
            geometry.dispose();
            prepMaterial.dispose();
            blurMaterial.dispose();
        },
    };
}
