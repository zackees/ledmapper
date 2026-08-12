import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Color, SRGBColorSpace } from 'three';
import { SRGB8_TO_LINEAR, linearChannelToSrgbByte, srgbChannelToLinear } from '../../src/color-space';

describe('display RGB color management', () => {
    it('matches the standard sRGB inverse transfer function', () => {
        assert.equal(srgbChannelToLinear(0), 0);
        assert.equal(srgbChannelToLinear(1), 1);
        assert.ok(Math.abs(srgbChannelToLinear(0.04045) - 0.0031308) < 1e-7);
        assert.ok(Math.abs(srgbChannelToLinear(0.5) - 0.21404114048223255) < 1e-12);
    });

    it('round-trips every gathered byte through Three.js output conversion', () => {
        for (let byte = 0; byte < 256; byte++) {
            const linear = SRGB8_TO_LINEAR[byte] ?? 0;
            const encoded = new Color(linear, linear, linear)
                .getRGB(new Color(), SRGBColorSpace).r;
            // Lookup entries are Float32 and Three's shader transfer uses a
            // fast approximation. What matters at RGBA8 output is exact code
            // value recovery after quantization.
            assert.equal(Math.round(encoded * 255), byte, `byte ${byte}`);
        }
    });

    it('keeps shadow code values dark instead of applying the transfer twice', () => {
        const encoded = new Color(
            SRGB8_TO_LINEAR[16] ?? 0,
            SRGB8_TO_LINEAR[16] ?? 0,
            SRGB8_TO_LINEAR[16] ?? 0,
        ).getRGB(new Color(), SRGBColorSpace).r;
        assert.equal(Math.round(encoded * 255), 16);
    });

    it('quantizes linear-light values to display RGB8 only at the output boundary', () => {
        for (let byte = 0; byte < 256; byte++) {
            assert.equal(linearChannelToSrgbByte(SRGB8_TO_LINEAR[byte] ?? 0), byte);
        }
        assert.equal(linearChannelToSrgbByte(-1), 0);
        assert.equal(linearChannelToSrgbByte(2), 255);
    });
});
