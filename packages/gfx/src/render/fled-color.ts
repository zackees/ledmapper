/**
 * FLED `video.color` — source color metadata, validated.
 *
 * `docs/fled-format.md` ("Source color metadata") is the canonical spec and
 * this module is its machine-enforced form: every rule the spec states is a
 * branch here, so a producer cannot write a declaration the spec forbids and a
 * consumer cannot silently reinterpret one.
 *
 * The declaration describes the *encoded payload only* — independently of LED
 * layout, output chipset, and the physical emitter profile of the strip that
 * will display it.
 *
 * Why this is strict rather than lenient like `readVideoFps`: a wrong fps is a
 * visible timing bug someone notices and fixes. A wrong color declaration is
 * invisible — it silently changes what every pixel means, and the file outlives
 * the tool that wrote it. Rejecting loudly is the only way the two sides of the
 * contract stay honest.
 */

import { PixelFormat } from './rgb-video.js';

/** Named primary sets. `bt709` means BT.709/sRGB primaries with D65 white. */
export type FledColorPrimariesName = 'bt709' | 'display-p3' | 'bt2020';

/** A CIE xy chromaticity pair. */
export type FledChromaticity = readonly [number, number];

/** Explicit primaries, for sources no named set describes. */
export interface FledCustomPrimaries {
    readonly red: FledChromaticity;
    readonly green: FledChromaticity;
    readonly blue: FledChromaticity;
    readonly white: FledChromaticity;
}

/**
 * Transfer function. `srgb` is the piecewise sRGB function — it is NOT the
 * BT.709 camera OETF, which is why both names exist separately.
 */
export type FledColorTransfer = 'srgb' | 'bt709' | 'linear';

/** Component encoding. v1 defines only the identity (direct RGB) case. */
export type FledColorMatrix = 'rgb';

/** Code range. v1 defines only full range; `limited` is reserved. */
export type FledColorRange = 'full';

/** A resolved declaration. `declared` separates "the file said so" from
 *  "the default tuple was applied" — the default is a compatibility
 *  interpretation, not an author's statement. */
export interface FledColorMetadata {
    readonly primaries: FledColorPrimariesName | FledCustomPrimaries;
    readonly transfer: FledColorTransfer;
    readonly matrix: FledColorMatrix;
    readonly range: FledColorRange;
    readonly declared: boolean;
}

export type FledColorErrorCode =
    | 'no-default-tuple'
    | 'not-an-object'
    | 'unknown-primaries'
    | 'unknown-transfer'
    | 'unknown-matrix'
    | 'unknown-range'
    | 'transfer-conflicts-with-format'
    | 'limited-range-unsupported'
    | 'matrix-unsupported'
    | 'incomplete-for-format'
    | 'malformed-custom-primaries';

/** Thrown for any declaration the spec rejects. Mirrors `FledStreamError`'s
 *  shape so consumers handle both container-level failures the same way. */
export class FledColorError extends Error {
    readonly code: FledColorErrorCode;
    /** The offending `video.color` key, when the failure is field-scoped. */
    readonly field?: string;

    constructor(code: FledColorErrorCode, message: string, field?: string) {
        super(message);
        this.name = 'FledColorError';
        this.code = code;
        if (field !== undefined) this.field = field;
    }
}

/** The canonical default tuple. Absent metadata means exactly this. */
export const DEFAULT_COLOR_TUPLE = {
    primaries: 'bt709',
    transfer: 'srgb',
    matrix: 'rgb',
    range: 'full',
} as const;

const NAMED_PRIMARIES: readonly FledColorPrimariesName[] = ['bt709', 'display-p3', 'bt2020'];

/** Transfers that are recognized names but that no v1 payload can carry. A
 *  16-bit linear integer payload cannot faithfully hold PQ-decoded content. */
const RESERVED_TRANSFERS: readonly string[] = ['pq', 'hlg'];

const VALID_TRANSFERS: readonly FledColorTransfer[] = ['srgb', 'bt709', 'linear'];

/** Formats whose bytes are display-encoded RGB. */
const DISPLAY_ENCODED_RGB: readonly number[] = [
    PixelFormat.rgb8,
    PixelFormat.rgba8,
    PixelFormat.rgb565le,
];

/** Formats whose bytes are linear-light RGB. */
const LINEAR_RGB: readonly number[] = [PixelFormat.rgb16_linear];

/**
 * Whether a pixel format defines a default color tuple.
 *
 * `gray8` carries no chromaticity and `rgbw8`'s white is a device primary that
 * RGB primaries cannot describe, so neither inherits one — their color
 * metadata is all-or-nothing. Scoping inheritance this way is what stops a
 * future YCbCr format from silently inheriting `matrix: "rgb"`.
 */
export function pixelFormatHasDefaultTuple(pixelFormat: number): boolean {
    return DISPLAY_ENCODED_RGB.includes(pixelFormat) || LINEAR_RGB.includes(pixelFormat);
}

/** The default tuple for a pixel format, or `null` if it defines none. */
export function defaultColorForFormat(pixelFormat: number): FledColorMetadata | null {
    if (!pixelFormatHasDefaultTuple(pixelFormat)) return null;
    return {
        primaries: DEFAULT_COLOR_TUPLE.primaries,
        transfer: LINEAR_RGB.includes(pixelFormat) ? 'linear' : 'srgb',
        matrix: DEFAULT_COLOR_TUPLE.matrix,
        range: DEFAULT_COLOR_TUPLE.range,
        declared: false,
    };
}

/**
 * The canonical `video.color` block a producer writes for a given payload
 * format. Producers use this rather than a literal so the declaration can
 * never drift from the bytes it describes.
 */
export function buildVideoColor(pixelFormat: number): {
    primaries: FledColorPrimariesName;
    transfer: FledColorTransfer;
    matrix: FledColorMatrix;
    range: FledColorRange;
} {
    const resolved = defaultColorForFormat(pixelFormat);
    if (resolved === null) {
        throw new FledColorError(
            'no-default-tuple',
            `pixel_format 0x${pixelFormat.toString(16).padStart(2, '0')} defines no default color tuple; declare all four keys explicitly.`,
        );
    }
    return {
        primaries: DEFAULT_COLOR_TUPLE.primaries,
        transfer: resolved.transfer,
        matrix: DEFAULT_COLOR_TUPLE.matrix,
        range: DEFAULT_COLOR_TUPLE.range,
    };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readChromaticity(value: unknown): FledChromaticity | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [x, y] = value as unknown[];
    if (typeof x !== 'number' || !isFinite(x)) return null;
    if (typeof y !== 'number' || !isFinite(y)) return null;
    return [x, y];
}

function readCustomPrimaries(value: Record<string, unknown>): FledCustomPrimaries {
    const red = readChromaticity(value.red);
    const green = readChromaticity(value.green);
    const blue = readChromaticity(value.blue);
    const white = readChromaticity(value.white);
    if (red === null || green === null || blue === null || white === null) {
        throw new FledColorError(
            'malformed-custom-primaries',
            'video.color.primaries object needs red/green/blue/white, each a [x, y] pair of finite numbers.',
            'primaries',
        );
    }
    return { red, green, blue, white };
}

function formatHex(pixelFormat: number): string {
    return `0x${pixelFormat.toString(16).padStart(2, '0')}`;
}

/**
 * Validate and resolve a `video.color` value against the payload's pixel
 * format. Throws `FledColorError` for anything the spec rejects.
 *
 * Pass `undefined` for an absent declaration: formats with a default tuple
 * resolve to it, formats without one throw `no-default-tuple`.
 */
export function validateFledColor(value: unknown, pixelFormat: number): FledColorMetadata {
    const fallback = defaultColorForFormat(pixelFormat);

    if (value === undefined) {
        if (fallback === null) {
            throw new FledColorError(
                'no-default-tuple',
                `video.color is absent and pixel_format ${formatHex(pixelFormat)} defines no default color tuple.`,
            );
        }
        return fallback;
    }

    if (!isPlainObject(value)) {
        throw new FledColorError('not-an-object', 'video.color must be a JSON object.');
    }

    const hasPrimaries = value.primaries !== undefined;
    const hasTransfer = value.transfer !== undefined;
    const hasMatrix = value.matrix !== undefined;
    const hasRange = value.range !== undefined;

    // Key inheritance is scoped to formats that define a default tuple.
    if (fallback === null && !(hasPrimaries && hasTransfer && hasMatrix && hasRange)) {
        throw new FledColorError(
            'incomplete-for-format',
            `pixel_format ${formatHex(pixelFormat)} defines no default color tuple: video.color must declare primaries, transfer, matrix and range, or be absent.`,
        );
    }

    // ---- primaries ----
    let primaries: FledColorPrimariesName | FledCustomPrimaries =
        fallback?.primaries ?? DEFAULT_COLOR_TUPLE.primaries;
    if (hasPrimaries) {
        const raw = value.primaries;
        if (isPlainObject(raw)) {
            primaries = readCustomPrimaries(raw);
        } else if (typeof raw === 'string' && (NAMED_PRIMARIES as readonly string[]).includes(raw)) {
            primaries = raw as FledColorPrimariesName;
        } else {
            throw new FledColorError(
                'unknown-primaries',
                `video.color.primaries ${JSON.stringify(raw)} is not a recognized name (${NAMED_PRIMARIES.join(', ')}) or a custom xy object.`,
                'primaries',
            );
        }
    }

    // ---- transfer ----
    let transfer: FledColorTransfer = fallback?.transfer ?? 'srgb';
    if (hasTransfer) {
        const raw = value.transfer;
        if (typeof raw === 'string' && RESERVED_TRANSFERS.includes(raw)) {
            throw new FledColorError(
                'transfer-conflicts-with-format',
                `video.color.transfer "${raw}" is reserved: no v1 pixel format can carry it.`,
                'transfer',
            );
        }
        if (typeof raw !== 'string' || !(VALID_TRANSFERS as readonly string[]).includes(raw)) {
            throw new FledColorError(
                'unknown-transfer',
                `video.color.transfer ${JSON.stringify(raw)} is not a recognized transfer function (${VALID_TRANSFERS.join(', ')}).`,
                'transfer',
            );
        }
        transfer = raw as FledColorTransfer;
    }

    // The transfer has to agree with what the payload bytes actually hold.
    if (DISPLAY_ENCODED_RGB.includes(pixelFormat) && transfer === 'linear') {
        throw new FledColorError(
            'transfer-conflicts-with-format',
            `pixel_format ${formatHex(pixelFormat)} is display-encoded; it must not carry linear-light samples. Use a linear pixel format instead.`,
            'transfer',
        );
    }
    if (LINEAR_RGB.includes(pixelFormat) && transfer !== 'linear') {
        throw new FledColorError(
            'transfer-conflicts-with-format',
            `pixel_format ${formatHex(pixelFormat)} holds linear-light samples and requires transfer: "linear".`,
            'transfer',
        );
    }

    // ---- matrix ----
    if (hasMatrix) {
        const raw = value.matrix;
        if (typeof raw !== 'string') {
            throw new FledColorError(
                'unknown-matrix',
                `video.color.matrix ${JSON.stringify(raw)} is not a recognized value.`,
                'matrix',
            );
        }
        if (raw !== 'rgb') {
            // Recognized-but-reserved YCbCr coefficient sets land here too:
            // a YCbCr payload needs a pixel format that does not exist yet.
            throw new FledColorError(
                'matrix-unsupported',
                `video.color.matrix "${raw}" is reserved; v1 defines only "rgb".`,
                'matrix',
            );
        }
    }

    // ---- range ----
    if (hasRange) {
        const raw = value.range;
        if (typeof raw !== 'string') {
            throw new FledColorError(
                'unknown-range',
                `video.color.range ${JSON.stringify(raw)} is not a recognized value.`,
                'range',
            );
        }
        if (raw === 'limited') {
            throw new FledColorError(
                'limited-range-unsupported',
                'video.color.range "limited" is reserved and unsupported in v1.',
                'range',
            );
        }
        if (raw !== 'full') {
            throw new FledColorError(
                'unknown-range',
                `video.color.range "${raw}" is not a recognized value.`,
                'range',
            );
        }
    }

    return { primaries, transfer, matrix: 'rgb', range: 'full', declared: true };
}

/**
 * Read and validate `video.color` out of a FLED envelope JSON string.
 *
 * Unparseable JSON and a missing `video` block both mean "undeclared", which
 * resolves to the format's default tuple — that is the historical
 * interpretation and must keep working. A declaration that is *present but
 * invalid* throws, because silently reinterpreting it is the exact failure
 * this metadata exists to prevent.
 */
export function readVideoColor(embeddedJson: string | null, pixelFormat: number): FledColorMetadata {
    let raw: unknown;
    if (embeddedJson) {
        try {
            const meta = JSON.parse(embeddedJson) as { video?: unknown };
            if (isPlainObject(meta.video)) raw = meta.video.color;
        } catch {
            /* not JSON — treat as undeclared, same as a legacy file */
        }
    }
    return validateFledColor(raw, pixelFormat);
}
