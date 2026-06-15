import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PixelFormat,
    bytesPerLed,
    buildFledHeader,
    prependFledHeader,
    parseRgbFrames,
    hasFledMagic,
} from '../../src/render/rgb-video';

// Reference JSON used by the round-trip + reference-vector tests.
// 31 UTF-8 bytes — see docs/fled-format.md test vector.
const REF_JSON = '{"map":{"a":{"x":[0],"y":[0]}}}';

function makeFrames(ledCount: number, nFrames: number, byte: number): Uint8Array {
    const out = new Uint8Array(ledCount * 3 * nFrames);
    out.fill(byte);
    return out;
}

test('hasFledMagic detects only the FLED prefix', () => {
    assert.equal(hasFledMagic(new Uint8Array([0x46, 0x4c, 0x45, 0x44, 0xff])), true);
    assert.equal(hasFledMagic(new Uint8Array([0x46, 0x4c, 0x45, 0x43])), false); // 'FLEC'
    assert.equal(hasFledMagic(new Uint8Array([0x46, 0x4c, 0x45])), false);       // truncated
    assert.equal(hasFledMagic(new Uint8Array(0)), false);
});

test('bytesPerLed returns null for unknown formats', () => {
    assert.equal(bytesPerLed(PixelFormat.rgb8), 3);
    assert.equal(bytesPerLed(PixelFormat.gray8), 1);
    assert.equal(bytesPerLed(PixelFormat.rgba8), 4);
    assert.equal(bytesPerLed(PixelFormat.rgbw8), 4);
    assert.equal(bytesPerLed(PixelFormat.rgb565le), 2);
    assert.equal(bytesPerLed(0xff), null);
});

test('buildFledHeader produces the documented 12+JSON byte layout', () => {
    const header = buildFledHeader(REF_JSON, PixelFormat.rgb8);
    // Magic
    assert.equal(header[0], 0x46);
    assert.equal(header[1], 0x4c);
    assert.equal(header[2], 0x45);
    assert.equal(header[3], 0x44);
    // Version
    assert.equal(header[4], 1);
    // Pixel format
    assert.equal(header[5], PixelFormat.rgb8);
    // Reserved bytes must be zero
    assert.equal(header[6], 0);
    assert.equal(header[7], 0);
    // JSON length LE = 31
    assert.equal(header[8], 31);
    assert.equal(header[9], 0);
    assert.equal(header[10], 0);
    assert.equal(header[11], 0);
    // Total length = 12 + jsonBytes
    assert.equal(header.length, 12 + 31);
});

test('round-trip: prepend + parse recovers JSON and frames byte-exact', () => {
    const ledCount = 4;
    const nFrames = 3;
    const payload = makeFrames(ledCount, nFrames, 0xab);
    const file = prependFledHeader(payload, REF_JSON, PixelFormat.rgb8);

    const result = parseRgbFrames(file, ledCount);

    assert.equal(result.isFled, true);
    assert.equal(result.fledError, null);
    assert.equal(result.notMultiple, false);
    assert.equal(result.embeddedJson, REF_JSON);
    assert.equal(result.pixelFormat, PixelFormat.rgb8);
    assert.equal(result.frames.length, nFrames);
    for (const frame of result.frames) {
        assert.equal(frame.length, ledCount * 3);
        for (const b of frame) assert.equal(b, 0xab);
    }
});

test('reference vector: 1-LED 1-frame red round-trips through known bytes', () => {
    // Reproduces the test vector in docs/fled-format.md.
    const payload = new Uint8Array([0xff, 0x00, 0x00]);
    const file = prependFledHeader(payload, REF_JSON, PixelFormat.rgb8);
    assert.equal(file.length, 12 + 31 + 3, 'expected total length 46 bytes');

    const result = parseRgbFrames(file, 1);
    assert.equal(result.embeddedJson, REF_JSON);
    assert.equal(result.frames.length, 1);
    const f0 = result.frames[0];
    assert.ok(f0, 'expected one frame');
    assert.equal(f0[0], 0xff);
    assert.equal(f0[1], 0x00);
    assert.equal(f0[2], 0x00);
});

test('zero-frame metadata-only .fled is valid (frames empty, JSON present)', () => {
    const file = prependFledHeader(new Uint8Array(0), REF_JSON, PixelFormat.rgb8);
    const result = parseRgbFrames(file, 1);
    assert.equal(result.isFled, true);
    assert.equal(result.fledError, null);
    assert.equal(result.notMultiple, false);
    assert.equal(result.embeddedJson, REF_JSON);
    assert.equal(result.frames.length, 0);
});

test('legacy headerless RGB still parses with embeddedJson=null', () => {
    const ledCount = 4;
    const nFrames = 2;
    const payload = makeFrames(ledCount, nFrames, 0x33);
    const result = parseRgbFrames(payload, ledCount);

    assert.equal(result.isFled, false);
    assert.equal(result.embeddedJson, null);
    assert.equal(result.pixelFormat, null);
    assert.equal(result.fledError, null);
    assert.equal(result.frames.length, nFrames);
});

test('legacy headerless: non-multiple length reports notMultiple', () => {
    // 7 bytes can never be a whole number of RGB frames for ledCount=2 (6 per frame).
    const result = parseRgbFrames(new Uint8Array(7), 2);
    assert.equal(result.notMultiple, true);
    assert.equal(result.frames.length, 0);
    assert.equal(result.embeddedJson, null);
});

test('FLED file with unsupported version is rejected cleanly', () => {
    const file = buildFledHeader(REF_JSON, PixelFormat.rgb8);
    file[4] = 99; // version
    const result = parseRgbFrames(file, 1);
    assert.equal(result.isFled, true);
    assert.equal(result.fledError, 'unsupported-version');
    assert.equal(result.frames.length, 0);
});

test('FLED file with unknown pixel_format is rejected cleanly', () => {
    const file = buildFledHeader(REF_JSON, PixelFormat.rgb8);
    file[5] = 0x7f; // unknown format
    const result = parseRgbFrames(file, 1);
    assert.equal(result.isFled, true);
    assert.equal(result.fledError, 'unknown-format');
    assert.equal(result.pixelFormat, 0x7f);
});

test('FLED file with truncated header is rejected cleanly', () => {
    // Magic only, no version/format/length.
    const result = parseRgbFrames(new Uint8Array([0x46, 0x4c, 0x45, 0x44, 0x01, 0x00]), 1);
    assert.equal(result.isFled, true);
    assert.equal(result.fledError, 'truncated-header');
});

test('FLED file with json_length larger than buffer is rejected cleanly', () => {
    const header = buildFledHeader(REF_JSON, PixelFormat.rgb8);
    // Overwrite json_length to claim 9999 bytes — the trailing buffer is far shorter.
    const dv = new DataView(header.buffer);
    dv.setUint32(8, 9999, true);
    const result = parseRgbFrames(header, 1);
    assert.equal(result.fledError, 'truncated-json');
});

test('FLED file with invalid UTF-8 in JSON region is rejected cleanly', () => {
    // Build a header that claims 4 bytes of JSON, then append a lone
    // continuation byte sequence that is not valid UTF-8.
    const buf = new Uint8Array(12 + 4);
    buf[0] = 0x46; buf[1] = 0x4c; buf[2] = 0x45; buf[3] = 0x44;
    buf[4] = 1;
    buf[5] = PixelFormat.rgb8;
    new DataView(buf.buffer).setUint32(8, 4, true);
    buf[12] = 0xff; buf[13] = 0xff; buf[14] = 0xff; buf[15] = 0xff; // invalid utf-8
    const result = parseRgbFrames(buf, 1);
    assert.equal(result.fledError, 'bad-utf8');
});

test('FLED frames at non-multiple length report notMultiple but keep JSON', () => {
    // 1 LED rgb8 = 3 bytes/frame. A 4-byte payload is not a clean multiple.
    const file = prependFledHeader(new Uint8Array([1, 2, 3, 4]), REF_JSON, PixelFormat.rgb8);
    const result = parseRgbFrames(file, 1);
    assert.equal(result.notMultiple, true);
    assert.equal(result.frames.length, 0);
    assert.equal(result.embeddedJson, REF_JSON, 'JSON should still be surfaced even when frames mismatch');
});
