/**
 * Convert one display-encoded sRGB channel into Three.js' linear working
 * space. Video gather samples are RGBA8 display values; vertex colors are
 * untagged floats, so they must be decoded before Three applies its output
 * transfer function.
 */
export function srgbChannelToLinear(value: number): number {
    const encoded = Math.min(Math.max(value, 0), 1);
    return encoded <= 0.04045
        ? encoded / 12.92
        : ((encoded + 0.055) / 1.055) ** 2.4;
}

/** Exact, allocation-free conversion table for the RGBA8 gather path. */
export const SRGB8_TO_LINEAR = Float32Array.from(
    { length: 256 },
    (_, value) => srgbChannelToLinear(value / 255),
);
