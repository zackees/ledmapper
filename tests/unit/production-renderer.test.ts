import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFledArtifact } from '../../src/moviemaker/recording';
import { productionComposition } from '../../src/production/compositor';

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

void test('productionComposition places source and preview side by side', () => {
    const layout = productionComposition({ width: 1920, height: 1080 }, 1280, 720, false);
    assert.ok(layout.source.x < 960);
    assert.ok(layout.source.x + layout.source.width <= 960);
    assert.ok(layout.preview);
    assert.ok(layout.preview.x >= 960);
});

void test('hidden production composition expands source and omits preview', () => {
    const layout = productionComposition({ width: 1920, height: 1080 }, 1280, 720, true);
    assert.equal(layout.preview, null);
    assert.deepEqual(layout.source, { x: 0, y: 0, width: 1920, height: 1080 });
});
