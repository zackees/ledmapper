import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    transformToCenter,
    createTransformedScreenmap,
    getFrameIndex,
    flattenColorFrames,
    parseResolution,
    computePreviewFactor,
    samplePixels,
    computeFps,
    estimateLedSize,
    overlayLedRadius,
    scaleToMaxDimension,
    mapClientPointToCanvasBacking,
} from '../../src/moviemaker/transforms';

describe('transformToCenter', () => {
    it('returns empty array for empty input', () => {
        assert.deepStrictEqual(transformToCenter([], 640, 480), []);
    });

    it('centers multiple distinct points', () => {
        const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const result = transformToCenter(pts, 640, 480);
        // Should be centered around (0,0)
        const xAvg = result.reduce((s, p) => s + p[0], 0) / result.length;
        const yAvg = result.reduce((s, p) => s + p[1], 0) / result.length;
        assert.ok(Math.abs(xAvg) < 0.001, `x center should be ~0, got ${xAvg}`);
        assert.ok(Math.abs(yAvg) < 0.001, `y center should be ~0, got ${yAvg}`);
    });

    it('does NOT produce NaN for a single point', () => {
        // BUG: single point → w=0, h=0 → scale=Infinity → 0*Infinity=NaN
        const result = transformToCenter([[5, 5]], 640, 480);
        assert.strictEqual(result.length, 1);
        assert.ok(!Number.isNaN(result[0]![0]), `x should not be NaN, got ${result[0]![0]}`);
        assert.ok(!Number.isNaN(result[0]![1]), `y should not be NaN, got ${result[0]![1]}`);
    });

    it('does NOT produce NaN for all-identical points', () => {
        // BUG: all points at same location → w=0, h=0 → NaN
        const result = transformToCenter([[3, 7], [3, 7], [3, 7]], 640, 480);
        for (let i = 0; i < result.length; i++) {
            assert.ok(!Number.isNaN(result[i]![0]), `pt[${i}].x should not be NaN`);
            assert.ok(!Number.isNaN(result[i]![1]), `pt[${i}].y should not be NaN`);
        }
    });

    it('does NOT produce Infinity for a single point', () => {
        const result = transformToCenter([[5, 5]], 640, 480);
        assert.ok(Number.isFinite(result[0]![0]), `x should be finite, got ${result[0]![0]}`);
        assert.ok(Number.isFinite(result[0]![1]), `y should be finite, got ${result[0]![1]}`);
    });

    it('handles collinear horizontal points (same y)', () => {
        // h=0 but w>0 — should still produce valid numbers
        const result = transformToCenter([[0, 5], [10, 5], [20, 5]], 640, 480);
        for (const pt of result) {
            assert.ok(Number.isFinite(pt[0]), `x should be finite`);
            assert.ok(Number.isFinite(pt[1]), `y should be finite`);
        }
        // All y values should be 0 (centered)
        for (const pt of result) {
            assert.ok(Math.abs(pt[1]) < 0.001, `y should be ~0 for horizontal line`);
        }
    });

    it('handles collinear vertical points (same x)', () => {
        const result = transformToCenter([[5, 0], [5, 10], [5, 20]], 640, 480);
        for (const pt of result) {
            assert.ok(Number.isFinite(pt[0]), `x should be finite`);
            assert.ok(Number.isFinite(pt[1]), `y should be finite`);
        }
    });

    it('does not mutate the input array', () => {
        const input = [[1, 2], [3, 4]];
        const copy = JSON.parse(JSON.stringify(input));
        transformToCenter(input, 640, 480);
        assert.deepStrictEqual(input, copy);
    });
});

describe('createTransformedScreenmap', () => {
    it('returns empty array for empty input', () => {
        assert.deepStrictEqual(createTransformedScreenmap([], 0, 1, [320, 240]), []);
    });

    it('applies translation without rotation or zoom', () => {
        const pts = [[0, 0], [10, 0]];
        const result = createTransformedScreenmap(pts, 0, 1, [100, 200]);
        assert.ok(Math.abs(result[0]![0] - 100) < 0.001);
        assert.ok(Math.abs(result[0]![1] - 200) < 0.001);
        assert.ok(Math.abs(result[1]![0] - 110) < 0.001);
        assert.ok(Math.abs(result[1]![1] - 200) < 0.001);
    });

    it('applies zoom correctly', () => {
        const pts = [[10, 0]];
        const result = createTransformedScreenmap(pts, 0, 2, [0, 0]);
        assert.ok(Math.abs(result[0]![0] - 20) < 0.001);
        assert.ok(Math.abs(result[0]![1] - 0) < 0.001);
    });

    it('applies 90-degree rotation correctly', () => {
        const pts = [[10, 0]];
        const result = createTransformedScreenmap(pts, 90, 1, [0, 0]);
        // (10,0) rotated 90° → (0, 10)
        assert.ok(Math.abs(result[0]![0]) < 0.001, `x should be ~0, got ${result[0]![0]}`);
        assert.ok(Math.abs(result[0]![1] - 10) < 0.001, `y should be ~10, got ${result[0]![1]}`);
    });

    it('does not mutate the input array', () => {
        const input = [[1, 2], [3, 4]];
        const copy = JSON.parse(JSON.stringify(input));
        createTransformedScreenmap(input, 45, 2, [100, 100]);
        assert.deepStrictEqual(input, copy);
    });
});

describe('getFrameIndex', () => {
    it('returns 0 at recording start', () => {
        assert.strictEqual(getFrameIndex(1000000, 1000000, 30), 0);
    });

    it('returns correct frame at exact boundary', () => {
        // At 30fps, frame time = 33333.33us
        const frameTimeUs = (1 / 30) * 1e6;
        assert.strictEqual(getFrameIndex(1000000 + frameTimeUs, 1000000, 30), 1);
    });

    it('returns correct frame mid-interval', () => {
        const frameTimeUs = (1 / 30) * 1e6;
        assert.strictEqual(getFrameIndex(1000000 + frameTimeUs * 2.5, 1000000, 30), 2);
    });

    it('handles 60fps correctly', () => {
        const frameTimeUs = (1 / 60) * 1e6;
        assert.strictEqual(getFrameIndex(1000000 + frameTimeUs * 5, 1000000, 60), 5);
    });
});

describe('flattenColorFrames', () => {
    it('returns null for empty frames array', () => {
        // BUG: endRecording previously downloaded a 0-byte file instead of warning
        const result = flattenColorFrames([]);
        assert.strictEqual(result, null);
    });

    it('flattens single frame correctly', () => {
        const frame = new Uint8Array([255, 0, 0, 0, 255, 0]);
        const result = flattenColorFrames([frame]);
        assert.deepStrictEqual(result, frame);
    });

    it('flattens multiple frames in order', () => {
        const f1 = new Uint8Array([1, 2, 3]);
        const f2 = new Uint8Array([4, 5, 6]);
        const f3 = new Uint8Array([7, 8, 9]);
        const result = flattenColorFrames([f1, f2, f3]);
        assert.deepStrictEqual(result, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it('preserves exact byte values', () => {
        const frame = new Uint8Array([0, 127, 255]);
        const result = flattenColorFrames([frame])!;
        assert.strictEqual(result[0], 0);
        assert.strictEqual(result[1], 127);
        assert.strictEqual(result[2], 255);
    });
});

describe('parseResolution', () => {
    it('parses standard landscape', () => {
        assert.deepStrictEqual(parseResolution('640x480'), { width: 640, height: 480 });
    });

    it('parses HD', () => {
        assert.deepStrictEqual(parseResolution('1280x720'), { width: 1280, height: 720 });
    });

    it('parses portrait', () => {
        assert.deepStrictEqual(parseResolution('1080x1920'), { width: 1080, height: 1920 });
    });
});

describe('computePreviewFactor', () => {
    it('scales square screenmap to fit box', () => {
        // 4 points forming a 100x100 square centered at (200,200)
        const pts = [[150, 150], [250, 150], [250, 250], [150, 250]];
        const factor = computePreviewFactor(pts, 200);
        // xspan=100, yspan=100, factor = (200/100)*0.8 = 1.6
        assert.ok(Math.abs(factor - 1.6) < 0.001, `factor should be 1.6, got ${factor}`);
    });

    it('scales wide screenmap to fit box', () => {
        const pts = [[0, 100], [500, 100], [500, 200], [0, 200]];
        const factor = computePreviewFactor(pts, 200);
        // xspan=500, yspan=100, factor = (200/500)*0.8 = 0.32
        assert.ok(Math.abs(factor - 0.32) < 0.001, `factor should be 0.32, got ${factor}`);
    });

    it('does NOT overflow box for horizontal collinear points', () => {
        // BUG: yspan=0, condition (xspan>0 && yspan>0) is false, factor stays 1
        // With xspan=400, factor*0.8=0.8, content spans 400*0.8=320 > boxSize=200
        const pts = [[0, 50], [200, 50], [400, 50]];
        const factor = computePreviewFactor(pts, 200);
        const maxExtent = 400 * factor; // points span 400 in x
        assert.ok(maxExtent <= 200, `content should fit in 200px box, but spans ${maxExtent}px`);
    });

    it('does NOT overflow box for vertical collinear points', () => {
        const pts = [[50, 0], [50, 200], [50, 400]];
        const factor = computePreviewFactor(pts, 200);
        const maxExtent = 400 * factor;
        assert.ok(maxExtent <= 200, `content should fit in 200px box, but spans ${maxExtent}px`);
    });

    it('handles single point', () => {
        const factor = computePreviewFactor([[100, 100]], 200);
        assert.ok(Number.isFinite(factor), 'factor should be finite');
        assert.ok(factor > 0, 'factor should be positive');
    });
});

describe('samplePixels', () => {
    // Create a 4x4 RGBA buffer (all white = 255,255,255,255)
    function makeBuffer(w: number, h: number, r: number, g: number, b: number) {
        const buf = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            buf[i * 4]     = r;
            buf[i * 4 + 1] = g;
            buf[i * 4 + 2] = b;
            buf[i * 4 + 3] = 255;
        }
        return buf;
    }

    it('samples in-bounds point correctly', () => {
        const buf = makeBuffer(4, 4, 100, 150, 200);
        // Point at (1, 1) in canvas coords → flippedY = (4-1)-1 = 2
        const result = samplePixels(buf, [[1, 1]], 4, 4);
        assert.strictEqual(result.rgbPts[0], 100);
        assert.strictEqual(result.rgbPts[1], 150);
        assert.strictEqual(result.rgbPts[2], 200);
    });

    it('returns zeros for out-of-bounds point', () => {
        const buf = makeBuffer(4, 4, 100, 150, 200);
        const result = samplePixels(buf, [[-1, -1]], 4, 4);
        assert.strictEqual(result.rgbPts[0], 0);
        assert.strictEqual(result.rgbPts[1], 0);
        assert.strictEqual(result.rgbPts[2], 0);
    });

    it('avgBri is NOT diluted by out-of-bounds points', () => {
        // BUG: divides by numPts (3) instead of in-bounds count (1)
        // Buffer is all white (255,255,255)
        const buf = makeBuffer(4, 4, 255, 255, 255);
        // 1 in-bounds point + 2 out-of-bounds points
        const pts = [[1, 1], [-1, -1], [99, 99]];
        const result = samplePixels(buf, pts, 4, 4);
        // Only 1 point is in-bounds and it's white → avgBri should be 1.0
        // BUG: currently gives totalBri / (3 * 3 * 255) instead of / (1 * 3 * 255)
        assert.ok(result.avgBri > 0.9,
            `avgBri should be ~1.0 for white in-bounds point, got ${result.avgBri}`);
    });

    it('avgBri is 0 when all points are out-of-bounds', () => {
        const buf = makeBuffer(4, 4, 255, 255, 255);
        const result = samplePixels(buf, [[-1, -1], [99, 99]], 4, 4);
        assert.strictEqual(result.avgBri, 0);
    });
});

describe('computeFps', () => {
    it('computes 60fps for 16.67ms delta', () => {
        const fps = computeFps(1016.67, 1000);
        assert.strictEqual(fps, 60);
    });

    it('does NOT return Infinity for zero delta', () => {
        // BUG: 1000 / 0 = Infinity
        const fps = computeFps(1000, 1000);
        assert.ok(Number.isFinite(fps), `FPS should be finite, got ${fps}`);
    });

    it('does NOT return negative for reversed timestamps', () => {
        const fps = computeFps(999, 1000);
        assert.ok(fps >= 0, `FPS should be non-negative, got ${fps}`);
    });
});

describe('estimateLedSize', () => {
    it('returns distance between first two points', () => {
        const size = estimateLedSize([[0, 0], [3, 4]]);
        assert.ok(Math.abs(size - 5) < 0.001, `should be 5, got ${size}`);
    });

    it('returns 1.0 for fewer than 2 points', () => {
        assert.strictEqual(estimateLedSize([]), 1.0);
        assert.strictEqual(estimateLedSize([[5, 5]]), 1.0);
    });

    it('does NOT return 0 for coincident first two points', () => {
        // BUG: returns 0 when first two points are at same location
        const size = estimateLedSize([[10, 20], [10, 20], [10, 25]]);
        assert.ok(size > 0, `LED size should be > 0, got ${size}`);
    });

    it('returns positive size for very close but distinct points', () => {
        const size = estimateLedSize([[0, 0], [0.001, 0]]);
        assert.ok(size > 0, `LED size should be > 0, got ${size}`);
    });
});

describe('scaleToMaxDimension', () => {
    it('returns native dimensions when maxDim is 0', () => {
        assert.deepStrictEqual(scaleToMaxDimension(1920, 1080, 0), { width: 1920, height: 1080 });
    });

    it('returns native dimensions when already within maxDim', () => {
        assert.deepStrictEqual(scaleToMaxDimension(320, 240, 480), { width: 320, height: 240 });
    });

    it('scales landscape video by larger dimension', () => {
        const result = scaleToMaxDimension(1920, 1080, 480);
        // scale = 480/1920 = 0.25 → 480x270
        assert.strictEqual(result.width, 480);
        assert.strictEqual(result.height, 270);
    });

    it('scales portrait video by larger dimension', () => {
        const result = scaleToMaxDimension(1080, 1920, 480);
        // scale = 480/1920 = 0.25 → 270x480
        assert.strictEqual(result.width, 270);
        assert.strictEqual(result.height, 480);
    });

    it('scales square video correctly', () => {
        const result = scaleToMaxDimension(1000, 1000, 500);
        assert.strictEqual(result.width, 500);
        assert.strictEqual(result.height, 500);
    });

    it('never returns dimensions smaller than 1', () => {
        const result = scaleToMaxDimension(10000, 1, 100);
        // scale = 100/10000 = 0.01 → width=100, height=round(0.01)=0 → clamped to 1
        assert.strictEqual(result.width, 100);
        assert.ok(result.height >= 1, `height should be >= 1, got ${result.height}`);
    });

    it('handles negative maxDim as native', () => {
        assert.deepStrictEqual(scaleToMaxDimension(640, 480, -1), { width: 640, height: 480 });
    });
});

describe('mapClientPointToCanvasBacking', () => {
    it('preserves coordinates when display and backing sizes match', () => {
        assert.deepStrictEqual(
            mapClientPointToCanvasBacking(640, 818, 720, 1280, { left: 100, top: 50, width: 720, height: 1280 }),
            [540, 768],
        );
    });

    it('maps a downscaled portrait Native canvas into backing pixels', () => {
        assert.deepStrictEqual(
            mapClientPointToCanvasBacking(761.5, 673.90625, 720, 1280, { left: 439, top: 214.90625, width: 430, height: 765 }),
            [540, 768],
        );
    });

    it('maps an upscaled 480p display into its smaller backing store', () => {
        assert.deepStrictEqual(
            mapClientPointToCanvasBacking(761.5, 673.90625, 270, 480, { left: 439, top: 214.90625, width: 430, height: 765 }),
            [202.5, 288],
        );
    });

    it('maps a scaled landscape canvas with a non-zero page offset', () => {
        assert.deepStrictEqual(
            mapClientPointToCanvasBacking(820, 370, 1920, 1080, { left: 100, top: 100, width: 960, height: 540 }),
            [1440, 540],
        );
    });

    it('rejects a collapsed display box instead of mixing coordinate spaces', () => {
        assert.strictEqual(
            mapClientPointToCanvasBacking(400, 300, 720, 1280, { left: 100, top: 50, width: 0, height: 765 }),
            null,
        );
        assert.strictEqual(
            mapClientPointToCanvasBacking(400, 300, 720, 1280, { left: 100, top: 50, width: 430, height: 0 }),
            null,
        );
        assert.strictEqual(
            mapClientPointToCanvasBacking(400, 300, 0, 1280, { left: 100, top: 50, width: 430, height: 765 }),
            null,
        );
        assert.strictEqual(
            mapClientPointToCanvasBacking(400, 300, 720, 0, { left: 100, top: 50, width: 430, height: 765 }),
            null,
        );
    });
});

describe('overlayLedRadius', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0]];

    it('uses the declared diameter when present (issue #47)', () => {
        // diameter 4 at zoom 1 -> radius 2, NOT spacing/2 = 5
        assert.strictEqual(overlayLedRadius(pts, 1, 4), 2);
    });

    it('scales the declared diameter with zoom', () => {
        assert.strictEqual(overlayLedRadius(pts, 3, 4), 6);
    });

    it('falls back to the spacing heuristic when diameter is null', () => {
        assert.strictEqual(overlayLedRadius(pts, 1, null), 5);
    });

    it('ignores non-positive declared diameters', () => {
        assert.strictEqual(overlayLedRadius(pts, 1, 0), 5);
        assert.strictEqual(overlayLedRadius(pts, 1, -2), 5);
    });
});
