/**
 * Machine enforcement of the `.fled` `video.color` contract.
 *
 * `docs/fled-format.md` ("Source color metadata") is the canonical spec.
 * Every rule it states gets a test here, so the spec cannot quietly drift
 * away from the code that implements it — a wrong color declaration is
 * invisible at runtime and outlives the tool that wrote it.
 *
 * The FastLED consumer mirrors these same rules in
 * `tests/fl/fled/fled_color.cpp`; the two suites are the two halves of one
 * cross-repo contract.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    DEFAULT_COLOR_TUPLE,
    FledColorError,
    buildVideoColor,
    defaultColorForFormat,
    pixelFormatHasDefaultTuple,
    readVideoColor,
    validateFledColor,
} from '../../packages/gfx/src/render/fled-color';
import { PixelFormat, bytesPerLed } from '../../packages/gfx/src/render/rgb-video';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Assert a call throws FledColorError with the given code. */
function assertRejects(fn: () => unknown, code: string, note: string): void {
    assert.throws(fn, (err: unknown) => {
        assert.ok(err instanceof FledColorError, `${note}: expected FledColorError, got ${String(err)}`);
        assert.equal(err.code, code, `${note}: wrong code`);
        assert.ok(err.message.length > 0, `${note}: message must be non-empty`);
        return true;
    }, note);
}

const CANONICAL = {
    primaries: 'bt709',
    transfer: 'srgb',
    matrix: 'rgb',
    range: 'full',
} as const;

describe('pixel format', () => {
    test('rgb16_linear is a defined v1 format at 6 bytes per LED', () => {
        assert.equal(PixelFormat.rgb16_linear, 0x05);
        assert.equal(bytesPerLed(PixelFormat.rgb16_linear), 6);
        // 0x06 and up stay reserved.
        assert.equal(bytesPerLed(0x06), null);
        assert.equal(bytesPerLed(0xff), null);
    });
});

describe('default tuple', () => {
    test('the canonical tuple is bt709/srgb/rgb/full', () => {
        assert.deepEqual({ ...DEFAULT_COLOR_TUPLE }, CANONICAL);
    });

    test('absent video.color resolves to the default tuple', () => {
        const c = validateFledColor(undefined, PixelFormat.rgb8);
        assert.equal(c.primaries, 'bt709');
        assert.equal(c.transfer, 'srgb');
        assert.equal(c.matrix, 'rgb');
        assert.equal(c.range, 'full');
        // The default is a compatibility interpretation, not an author's claim.
        assert.equal(c.declared, false);
    });

    test('the whole display-encoded family shares the tuple', () => {
        for (const format of [PixelFormat.rgb8, PixelFormat.rgba8, PixelFormat.rgb565le]) {
            const c = validateFledColor(undefined, format);
            assert.equal(c.transfer, 'srgb');
            assert.equal(c.primaries, 'bt709');
        }
    });

    test('rgb16_linear defaults to a linear transfer', () => {
        const c = validateFledColor(undefined, PixelFormat.rgb16_linear);
        assert.equal(c.transfer, 'linear');
        assert.equal(c.primaries, 'bt709');
        assert.equal(c.range, 'full');
    });

    test('a declared canonical tuple round-trips as declared', () => {
        const c = validateFledColor({ ...CANONICAL }, PixelFormat.rgb8);
        assert.equal(c.declared, true);
        assert.equal(c.transfer, 'srgb');
    });
});

describe('key inheritance', () => {
    test('missing keys inherit from the default tuple', () => {
        const c = validateFledColor({ primaries: 'display-p3' }, PixelFormat.rgb8);
        assert.equal(c.primaries, 'display-p3'); // explicit
        assert.equal(c.transfer, 'srgb');        // inherited
        assert.equal(c.matrix, 'rgb');           // inherited
        assert.equal(c.range, 'full');           // inherited
        assert.equal(c.declared, true);
    });

    test('bt2020 primaries and a bt709 transfer are recognized', () => {
        assert.equal(validateFledColor({ primaries: 'bt2020' }, PixelFormat.rgb8).primaries, 'bt2020');
        // sRGB transfer and the BT.709 OETF are deliberately distinct names.
        assert.equal(validateFledColor({ transfer: 'bt709' }, PixelFormat.rgb8).transfer, 'bt709');
    });

    test('gray8 and rgbw8 define no default tuple', () => {
        assert.equal(pixelFormatHasDefaultTuple(PixelFormat.rgb8), true);
        assert.equal(pixelFormatHasDefaultTuple(PixelFormat.rgb16_linear), true);
        assert.equal(pixelFormatHasDefaultTuple(PixelFormat.gray8), false);
        assert.equal(pixelFormatHasDefaultTuple(PixelFormat.rgbw8), false);
        assert.equal(defaultColorForFormat(PixelFormat.gray8), null);

        assertRejects(() => validateFledColor(undefined, PixelFormat.gray8), 'no-default-tuple', 'gray8 absent');
        assertRejects(() => validateFledColor(undefined, PixelFormat.rgbw8), 'no-default-tuple', 'rgbw8 absent');
    });

    test('a partial declaration cannot inherit without a tuple', () => {
        // This is the guard that stops a future YCbCr format from silently
        // inheriting matrix: "rgb".
        assertRejects(
            () => validateFledColor({ primaries: 'bt709' }, PixelFormat.rgbw8),
            'incomplete-for-format', 'rgbw8 partial',
        );
        assertRejects(
            () => validateFledColor({ primaries: 'bt709', transfer: 'srgb', matrix: 'rgb' }, PixelFormat.gray8),
            'incomplete-for-format', 'gray8 three-of-four',
        );
    });

    test('a complete declaration is accepted without a tuple', () => {
        const c = validateFledColor({ ...CANONICAL }, PixelFormat.rgbw8);
        assert.equal(c.transfer, 'srgb');
        assert.equal(c.declared, true);
    });
});

describe('transfer must match the payload format', () => {
    test('display-encoded formats reject a linear transfer', () => {
        for (const format of [PixelFormat.rgb8, PixelFormat.rgba8, PixelFormat.rgb565le]) {
            assertRejects(
                () => validateFledColor({ transfer: 'linear' }, format),
                'transfer-conflicts-with-format', `format ${format} linear`,
            );
        }
    });

    test('reserved HDR transfers are rejected on every v1 format', () => {
        for (const transfer of ['pq', 'hlg']) {
            assertRejects(() => validateFledColor({ transfer }, PixelFormat.rgb8),
                'transfer-conflicts-with-format', `rgb8 ${transfer}`);
            assertRejects(() => validateFledColor({ transfer }, PixelFormat.rgb16_linear),
                'transfer-conflicts-with-format', `rgb16_linear ${transfer}`);
        }
    });

    test('rgb16_linear accepts only a linear transfer', () => {
        assert.equal(validateFledColor({ transfer: 'linear' }, PixelFormat.rgb16_linear).transfer, 'linear');
        assertRejects(
            () => validateFledColor({ transfer: 'srgb' }, PixelFormat.rgb16_linear),
            'transfer-conflicts-with-format', 'rgb16_linear srgb',
        );
    });
});

describe('reserved values', () => {
    test('limited range is rejected', () => {
        assertRejects(() => validateFledColor({ range: 'limited' }, PixelFormat.rgb8),
            'limited-range-unsupported', 'limited range');
    });

    test('non-rgb matrix values are rejected', () => {
        for (const matrix of ['bt709', 'bt2020ncl', 'ycbcr']) {
            assertRejects(() => validateFledColor({ matrix }, PixelFormat.rgb8),
                'matrix-unsupported', `matrix ${matrix}`);
        }
    });
});

describe('unrecognized values are rejected, never defaulted', () => {
    test('unknown names per field', () => {
        assertRejects(() => validateFledColor({ primaries: 'rec2100' }, PixelFormat.rgb8),
            'unknown-primaries', 'unknown primaries');
        assertRejects(() => validateFledColor({ transfer: 'gamma22' }, PixelFormat.rgb8),
            'unknown-transfer', 'unknown transfer');
        assertRejects(() => validateFledColor({ range: 'studio' }, PixelFormat.rgb8),
            'unknown-range', 'unknown range');
    });

    test('transfer "none" is not a valid value', () => {
        // Explicitly forbidden by the spec: it is ambiguous. Linear-light
        // producers say "linear" and use a format that permits it.
        assertRejects(() => validateFledColor({ transfer: 'none' }, PixelFormat.rgb8),
            'unknown-transfer', 'transfer none');
    });

    test('non-string scalars are rejected, not coerced', () => {
        assertRejects(() => validateFledColor({ transfer: 42 }, PixelFormat.rgb8),
            'unknown-transfer', 'numeric transfer');
        assertRejects(() => validateFledColor({ matrix: true }, PixelFormat.rgb8),
            'unknown-matrix', 'boolean matrix');
        assertRejects(() => validateFledColor({ range: null }, PixelFormat.rgb8),
            'unknown-range', 'null range');
    });

    test('video.color must be an object', () => {
        assertRejects(() => validateFledColor('bt709', PixelFormat.rgb8), 'not-an-object', 'string color');
        assertRejects(() => validateFledColor([1, 2], PixelFormat.rgb8), 'not-an-object', 'array color');
        assertRejects(() => validateFledColor(null, PixelFormat.rgb8), 'not-an-object', 'null color');
    });

    test('errors name the offending field', () => {
        assert.throws(() => validateFledColor({ range: 'studio' }, PixelFormat.rgb8), (err: unknown) => {
            assert.ok(err instanceof FledColorError);
            assert.equal(err.field, 'range');
            return true;
        });
    });
});

describe('custom primaries', () => {
    const CUSTOM = {
        red: [0.640, 0.330],
        green: [0.300, 0.600],
        blue: [0.150, 0.060],
        white: [0.3127, 0.3290],
    };

    test('a full xy set is accepted and preserved', () => {
        const c = validateFledColor({ primaries: CUSTOM }, PixelFormat.rgb8);
        assert.deepEqual(c.primaries, CUSTOM);
        assert.equal(c.transfer, 'srgb'); // unstated keys still inherit
    });

    test('malformed sets are rejected', () => {
        const { white: _white, ...missingWhite } = CUSTOM;
        assertRejects(() => validateFledColor({ primaries: missingWhite }, PixelFormat.rgb8),
            'malformed-custom-primaries', 'missing white');
        assertRejects(() => validateFledColor({ primaries: { ...CUSTOM, red: [0.64] } }, PixelFormat.rgb8),
            'malformed-custom-primaries', 'one-element pair');
        assertRejects(() => validateFledColor({ primaries: { ...CUSTOM, red: '0.64,0.33' } }, PixelFormat.rgb8),
            'malformed-custom-primaries', 'string pair');
        assertRejects(() => validateFledColor({ primaries: { ...CUSTOM, red: [0.64, Number.NaN] } }, PixelFormat.rgb8),
            'malformed-custom-primaries', 'NaN component');
    });
});

describe('readVideoColor over an envelope', () => {
    test('reads a declared block', () => {
        const json = JSON.stringify({ map: {}, video: { fps: 60, color: CANONICAL } });
        const c = readVideoColor(json, PixelFormat.rgb8);
        assert.equal(c.declared, true);
        assert.equal(c.transfer, 'srgb');
    });

    test('legacy envelopes resolve to the default tuple', () => {
        // Absent metadata must keep working: this is the historical
        // interpretation of every pre-color .fled file.
        for (const json of [null, '', '{}', '{"video":{"fps":30}}', 'not json']) {
            const c = readVideoColor(json, PixelFormat.rgb8);
            assert.equal(c.declared, false, `json=${String(json)}`);
            assert.equal(c.transfer, 'srgb');
        }
    });

    test('a present but invalid block throws rather than being reinterpreted', () => {
        const json = JSON.stringify({ video: { color: { transfer: 'linear' } } });
        assertRejects(() => readVideoColor(json, PixelFormat.rgb8),
            'transfer-conflicts-with-format', 'invalid declared block');
    });

    test('video.format is ignored, per spec, not rejected', () => {
        // "Consumers must ignore any video.format key if present."
        const json = JSON.stringify({ video: { format: 'rgb8', color: CANONICAL } });
        assert.equal(readVideoColor(json, PixelFormat.rgb8).declared, true);
    });
});

describe('producer', () => {
    test('buildVideoColor derives the block from the payload format', () => {
        assert.deepEqual(buildVideoColor(PixelFormat.rgb8), CANONICAL);
        assert.deepEqual(buildVideoColor(PixelFormat.rgb16_linear), { ...CANONICAL, transfer: 'linear' });
    });

    test('what the producer writes always validates', () => {
        // The round trip that keeps producer and validator honest.
        for (const format of [PixelFormat.rgb8, PixelFormat.rgba8, PixelFormat.rgb565le, PixelFormat.rgb16_linear]) {
            const written = buildVideoColor(format);
            const parsed = validateFledColor(written, format);
            assert.equal(parsed.declared, true);
            assert.equal(parsed.transfer, written.transfer);
        }
    });

    test('buildVideoColor refuses formats with no default tuple', () => {
        assertRejects(() => buildVideoColor(PixelFormat.gray8), 'no-default-tuple', 'gray8 producer');
    });
});

describe('source-tree parity', () => {
    // The app tree and the gfx package keep byte-identical copies of these
    // modules, and nothing else in the repo enforces that. A drifted copy
    // means the player and the recorder disagree about the contract.
    for (const rel of ['render/fled-color.ts', 'render/rgb-video.ts']) {
        test(`src/${rel} matches packages/gfx/src/${rel}`, () => {
            const app = readFileSync(resolve(REPO_ROOT, 'src', rel), 'utf8');
            const pkg = readFileSync(resolve(REPO_ROOT, 'packages/gfx/src', rel), 'utf8');
            assert.equal(app, pkg, `src/${rel} has drifted from the gfx package copy`);
        });
    }
});
