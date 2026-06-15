/**
 * FLED video container — Phase 1.
 *
 * A FLED file is a tiny self-describing container: a 12-byte fixed header
 * followed by UTF-8 JSON metadata and then format-specific frame data.
 * See `docs/fled-format.md` for the canonical spec; the magic / enum /
 * layout below are normative.
 *
 * This module is the single source of truth for both the producer
 * (moviemaker) and the consumer (movieplayer) sides of the container.
 *
 * Legacy: pre-FLED files were raw RGB triplets with no header. Anything
 * whose first 4 bytes are not `FLED` is treated as legacy; callers decide
 * whether to accept it (Movie Player rejects; the embedded `.rgb` parse
 * path can still slice raw frames against a known LED count).
 */

// "FLED" — 0x46 0x4C 0x45 0x44 — the same four bytes regardless of host
// endianness because they're written byte-by-byte.
const FLED_MAGIC: readonly [number, number, number, number] = [0x46, 0x4C, 0x45, 0x44];
const FLED_VERSION = 1;
const HEADER_BYTES = 12;

/** Pixel format byte. Generator emits only `rgb8` in Phase 1. */
export const PixelFormat = {
    rgb8: 0x00,
    gray8: 0x01,
    rgba8: 0x02,
    rgbw8: 0x03,
    rgb565le: 0x04,
} as const;
export type PixelFormatCode = (typeof PixelFormat)[keyof typeof PixelFormat];

const BYTES_PER_LED: Record<number, number> = {
    [PixelFormat.rgb8]: 3,
    [PixelFormat.gray8]: 1,
    [PixelFormat.rgba8]: 4,
    [PixelFormat.rgbw8]: 4,
    [PixelFormat.rgb565le]: 2,
};

/** Bytes per LED for a `pixel_format` enum value, or `null` if unknown. */
export function bytesPerLed(format: number): number | null {
    return BYTES_PER_LED[format] ?? null;
}

/** Whether the format byte is one this build knows how to consume. Phase
 * 1 only `rgb8` is wired through movieplayer; the others are reserved.
 */
export function isSupportedFormat(format: number): boolean {
    return format === PixelFormat.rgb8;
}

export interface RgbParseResult {
    /** Per-frame byte slices. Empty on error. */
    frames: Uint8Array[];
    /** True when the payload byte count is not an integer number of full frames. */
    notMultiple: boolean;
    /** Embedded screenmap JSON when the file is FLED-formatted, else `null`. */
    embeddedJson: string | null;
    /** Detected pixel format. `null` when the file is legacy headerless. */
    pixelFormat: number | null;
    /** True when the file is FLED-formatted (magic + valid header found). */
    isFled: boolean;
    /** Error code for FLED files that couldn't be parsed. `null` on success
     *  or for legacy files (which are not "errors" per se — caller decides). */
    fledError: 'bad-magic' | 'unsupported-version' | 'truncated-header' | 'truncated-json' | 'bad-utf8' | 'unknown-format' | null;
}

/** Build the 12-byte fixed header plus JSON bytes. */
export function buildFledHeader(json: string, pixelFormat: PixelFormatCode = PixelFormat.rgb8): Uint8Array {
    const jsonBytes = new TextEncoder().encode(json);
    const buf = new Uint8Array(HEADER_BYTES + jsonBytes.length);
    const dv = new DataView(buf.buffer);
    buf[0] = FLED_MAGIC[0];
    buf[1] = FLED_MAGIC[1];
    buf[2] = FLED_MAGIC[2];
    buf[3] = FLED_MAGIC[3];
    buf[4] = FLED_VERSION;
    buf[5] = pixelFormat;
    // bytes 6, 7 reserved (already zero)
    dv.setUint32(8, jsonBytes.length, /* littleEndian */ true);
    buf.set(jsonBytes, HEADER_BYTES);
    return buf;
}

/** Prepend a freshly-built FLED header to a raw payload buffer. */
export function prependFledHeader(payload: Uint8Array, json: string, pixelFormat: PixelFormatCode = PixelFormat.rgb8): Uint8Array {
    const header = buildFledHeader(json, pixelFormat);
    const out = new Uint8Array(header.length + payload.length);
    out.set(header, 0);
    out.set(payload, header.length);
    return out;
}

/**
 * Slice a buffer into per-frame arrays.
 *
 * - If the buffer starts with `FLED` magic, the header is parsed, JSON is
 *   extracted, and frames are sliced from the post-JSON payload using the
 *   pixel format declared in the header. `ledCount` is ignored when an
 *   embedded screenmap is present — the caller is expected to use the JSON
 *   to derive count themselves (this function still needs it for the
 *   ultimate slice, so callers must pass the count derived from JSON).
 *
 * - If the buffer does not start with `FLED`, it is treated as legacy
 *   headerless RGB8 with the provided `ledCount`, same as before this spec.
 */
export function parseRgbFrames(buffer: ArrayBuffer | Uint8Array, ledCount: number): RgbParseResult {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Legacy path: not FLED magic → raw RGB8 triplets.
    if (!hasFledMagic(bytes)) {
        return parseLegacyRgb8(bytes, ledCount);
    }

    if (bytes.length < HEADER_BYTES) {
        return failed('truncated-header');
    }
    const version = bytes[4] ?? 0;
    if (version !== FLED_VERSION) {
        return failed('unsupported-version');
    }
    const pixelFormat = bytes[5] ?? 0;
    const bpl = bytesPerLed(pixelFormat);
    if (bpl === null) {
        return failed('unknown-format', pixelFormat);
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = dv.getUint32(8, /* littleEndian */ true);
    const payloadOffset = HEADER_BYTES + jsonLength;
    if (payloadOffset > bytes.length) {
        return failed('truncated-json', pixelFormat);
    }

    let embeddedJson: string;
    try {
        embeddedJson = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES, payloadOffset));
    } catch {
        return failed('bad-utf8', pixelFormat);
    }

    if (ledCount <= 0) {
        return { frames: [], notMultiple: true, embeddedJson, pixelFormat, isFled: true, fledError: null };
    }
    const payload = bytes.subarray(payloadOffset);
    const frameSize = ledCount * bpl;
    if (payload.length % frameSize !== 0) {
        return { frames: [], notMultiple: true, embeddedJson, pixelFormat, isFled: true, fledError: null };
    }
    const nFrames = payload.length / frameSize;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < nFrames; i++) {
        frames.push(payload.slice(i * frameSize, (i + 1) * frameSize));
    }
    return { frames, notMultiple: false, embeddedJson, pixelFormat, isFled: true, fledError: null };
}

/** Quick magic check that doesn't require parsing the rest of the header. */
export function hasFledMagic(bytes: Uint8Array): boolean {
    return bytes.length >= 4
        && bytes[0] === FLED_MAGIC[0]
        && bytes[1] === FLED_MAGIC[1]
        && bytes[2] === FLED_MAGIC[2]
        && bytes[3] === FLED_MAGIC[3];
}

function parseLegacyRgb8(bytes: Uint8Array, ledCount: number): RgbParseResult {
    const numPixels = bytes.length / 3;
    if (ledCount <= 0 || numPixels % ledCount !== 0) {
        return { frames: [], notMultiple: true, embeddedJson: null, pixelFormat: null, isFled: false, fledError: null };
    }
    const frameSize = ledCount * 3;
    const nFrames = numPixels / ledCount;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < nFrames; i++) {
        frames.push(bytes.slice(i * frameSize, (i + 1) * frameSize));
    }
    return { frames, notMultiple: false, embeddedJson: null, pixelFormat: null, isFled: false, fledError: null };
}

function failed(error: NonNullable<RgbParseResult['fledError']>, pixelFormat: number | null = null): RgbParseResult {
    return { frames: [], notMultiple: false, embeddedJson: null, pixelFormat, isFled: true, fledError: error };
}
