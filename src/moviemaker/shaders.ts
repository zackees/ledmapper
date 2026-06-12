/**
 * Vertex shader for the two-pass Gaussian blur pipeline.
 * @type {string}
 */
export const BLUR_VERT = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/**
 * Fragment shader for the two-pass Gaussian blur pipeline.
 * Applies directional Gaussian blur, gamma correction, and brightness adjustment.
 * @type {string}
 */
export const BLUR_FRAG = `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float blurRadius;
    uniform float sigma;
    uniform float brightness;
    uniform float maxBrightness;
    uniform float gamma;
    uniform vec2 direction;
    varying vec2 vUv;

    float gaussianPdf(in float x, in float s) {
        return 0.39894 * exp(-0.5 * x * x / (s * s)) / s;
    }

    void main() {
        vec2 invSize = 1.0 / resolution;
        vec3 diffuseSum = vec3(0.0);
        float weightSum = 0.0;
        float totalWeight = 0.0;

        for (float i = -100.0; i <= 100.0; i++) {
            if (i > blurRadius || i < -blurRadius) continue;
            float weight = gaussianPdf(abs(i), max(sigma, 0.001));
            totalWeight += weight;
            vec2 sampleUv = vUv + direction * i * invSize;
            if (sampleUv.x >= 0.0 && sampleUv.x <= 1.0 &&
                sampleUv.y >= 0.0 && sampleUv.y <= 1.0) {
                diffuseSum += texture2D(tDiffuse, sampleUv).rgb * weight;
            }
            weightSum += weight;
        }

        vec3 color = diffuseSum / max(totalWeight, 0.001);
        color = pow(color, vec3(gamma)) * brightness;
        // Clamp to the max-brightness cap by subtracting the excess of the
        // brightest channel, preserving hue better than uniform scaling.
        float excess = max(max(color.r, max(color.g, color.b)) - maxBrightness, 0.0);
        color = max(color - vec3(excess), 0.0);
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
`;

/**
 * Fragment shader that copies a texture to the framebuffer unchanged.
 * Used to blit the offscreen output target to the visible canvas.
 * @type {string}
 */
export const COPY_FRAG = `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
    }
`;

/**
 * Fragment shader for the LED gather pass.
 * Each texel of the (small) gather target corresponds to one LED. tPositions
 * holds the LED's screenmap-local position in .rg (uploaded once per
 * screenmap) and a validity flag in .a (0 = padding texel past the LED
 * count). Rotate/zoom/translate are applied here as uniforms so dragging the
 * shape never re-uploads the position texture. Out-of-bounds LEDs output
 * transparent black so the CPU can tell them apart.
 * @type {string}
 */
export const GATHER_FRAG = `
    uniform sampler2D tPositions;
    uniform sampler2D tSource;
    uniform vec2 uResolution;
    uniform vec2 uTranslate;
    uniform float uZoom;
    uniform float uRotate;
    varying vec2 vUv;
    void main() {
        vec4 pos = texture2D(tPositions, vUv);
        if (pos.a < 0.5) {
            gl_FragColor = vec4(0.0);
            return;
        }
        float c = cos(uRotate);
        float s = sin(uRotate);
        vec2 p = vec2(pos.r * c - pos.g * s, pos.r * s + pos.g * c) * uZoom + uTranslate;
        // floor(p + 0.5) replicates the CPU path's Math.round pixel snap so
        // sampled colors are identical to the old baked-coordinate path.
        vec2 px = floor(p + 0.5);
        if (px.x < 0.0 || px.x >= uResolution.x || px.y < 0.0 || px.y >= uResolution.y) {
            gl_FragColor = vec4(0.0);
            return;
        }
        vec2 uv = vec2((px.x + 0.5) / uResolution.x,
                       (uResolution.y - 1.0 - px.y + 0.5) / uResolution.y);
        gl_FragColor = vec4(texture2D(tSource, uv).rgb, 1.0);
    }
`;
