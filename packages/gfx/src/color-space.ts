/** Display-sRGB byte to linear-light lookup for RGB8 FLED playback. */
export const SRGB8_TO_LINEAR = Float32Array.from({ length: 256 }, (_, byte) => {
    const encoded = byte / 255;
    return encoded <= 0.04045
        ? encoded / 12.92
        : ((encoded + 0.055) / 1.055) ** 2.4;
});
