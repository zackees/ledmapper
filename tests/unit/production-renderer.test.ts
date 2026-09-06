import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFledArtifact } from '../../src/moviemaker/recording';
import { PixelFormat, encodeRgb16Linear } from '../../src/render/rgb-video';
import { productionComposition, productionOutputDimensions } from '../../src/production/compositor';
import {
    createProductionPreviewTopologyArgs,
    productionIrisPrerollFrames,
    renderProductionPreviewFrame,
    scheduleProductionFrames,
} from '../../src/production/production-renderer';

void test('buildFledArtifact validates and wraps RGB payload', () => {
    const artifact = buildFledArtifact(new Uint8Array(2 * 3 * 3), {
        frameCount: 2,
        fps: 30,
        ledCount: 3,
        screenmapJson: JSON.stringify({ map: {} }),
    });
    assert.equal(new TextDecoder().decode(artifact.bytes.slice(0, 4)), 'FLED');
    assert.equal(artifact.bytes[4], 1);
    assert.equal(artifact.frameCount, 2);
    assert.equal(artifact.mimeType, 'application/vnd.fastled.video');
});

void test('buildFledArtifact rejects payload mismatch', () => {
    assert.throws(() => buildFledArtifact(new Uint8Array(17), {
        frameCount: 2,
        fps: 30,
        ledCount: 3,
        screenmapJson: '{}',
    }), /payload length mismatch/);
});

void test('buildFledArtifact writes rgb16_linear with LE payload and mandatory metadata', () => {
    const payload = encodeRgb16Linear(new Uint16Array([0x1200, 0x1201, 0x1202]));
    const artifact = buildFledArtifact(payload, {
        frameCount: 1,
        fps: 30,
        ledCount: 1,
        screenmapJson: JSON.stringify({ map: {} }),
        pixelFormat: PixelFormat.rgb16_linear,
    });
    assert.equal(artifact.bytes[5], PixelFormat.rgb16_linear);
    assert.deepEqual([...artifact.bytes.slice(-6)], [...payload]);
    const json = JSON.parse(new TextDecoder().decode(artifact.bytes.slice(12, -6))) as {
        video: { color: { transfer: string } };
    };
    assert.equal(json.video.color.transfer, 'linear');
    assert.throws(
        () => buildFledArtifact(new Uint8Array(5), {
            frameCount: 1,
            fps: 30,
            ledCount: 1,
            screenmapJson: '{}',
            pixelFormat: PixelFormat.rgb16_linear,
        }),
        /payload length mismatch/,
    );
});

void test('productionComposition places source and preview side by side', () => {
    const layout = productionComposition({ width: 1920, height: 1080 }, 1280, 720, false);
    assert.ok(layout.source);
    assert.ok(layout.source.x < 960);
    assert.ok(layout.source.x + layout.source.width <= 960);
    assert.ok(layout.preview);
    assert.ok(layout.preview.x >= 960);
});

void test('productionComposition fills the output with the mapped LED preview', () => {
    const layout = productionComposition({ width: 1920, height: 1080 }, 1280, 720, false, 'mapped-led');
    assert.equal(layout.source, null);
    assert.deepEqual(layout.preview, { x: 420, y: 0, width: 1080, height: 1080 });
});

void test('mapped LED production stays at the native 1024 preview resolution', () => {
    assert.deepEqual(
        productionOutputDimensions({ width: 1080, height: 1080 }, 'mapped-led'),
        { width: 1024, height: 1024 },
    );
    assert.deepEqual(
        productionOutputDimensions({ width: 1920, height: 1080 }, 'side-by-side'),
        { width: 1920, height: 1080 },
    );
});

void test('hidden production composition expands source and omits preview', () => {
    const layout = productionComposition({ width: 1920, height: 1080 }, 1280, 720, true);
    assert.equal(layout.preview, null);
    assert.deepEqual(layout.source, { x: 0, y: 0, width: 1920, height: 1080 });
});

void test('60 FPS scheduling doubles 30 FPS source frames without changing duration', () => {
    let nextTimestamp = 0;
    let encoded = 0;
    for (let sourceFrame = 0; sourceFrame < 300; sourceFrame++) {
        const schedule = scheduleProductionFrames(sourceFrame / 30, 1 / 30, nextTimestamp, 60);
        encoded += schedule.timestamps.length;
        nextTimestamp = schedule.nextTimestamp;
    }
    assert.equal(encoded, 600);
    assert.ok(Math.abs(encoded / 60 - 10) < 1e-9);
});

void test('iris preroll covers four attack time constants at the output cadence', () => {
    assert.equal(productionIrisPrerollFrames(60), 48);
    assert.equal(productionIrisPrerollFrames(30), 24);
});

void test('production reuses preview topology metadata across temporal frames', () => {
    const topology = createProductionPreviewTopologyArgs();
    const calls: unknown[][] = [];
    const preview = {
        render: (...args: unknown[]) => calls.push(args),
    } as unknown as Parameters<typeof renderProductionPreviewFrame>[0];
    const points = [[0, 0], [1, 0]] as Parameters<typeof renderProductionPreviewFrame>[1];
    const sample = { rgbPts: new Uint8Array(6) };
    renderProductionPreviewFrame(preview, points, 0, sample, topology, 1000);
    renderProductionPreviewFrame(preview, points, 0, sample, topology, 1033);
    assert.equal(calls.length, 2);
    const [first, second] = calls as [unknown[], unknown[]];
    assert.equal(first[4], topology.pointChannelOffsets);
    assert.equal(second[4], topology.pointChannelOffsets);
    assert.equal(first[5], topology.shapes);
    assert.equal(second[5], topology.shapes);
    assert.equal(first[6], 1000);
    assert.equal(second[6], 1033);
});
