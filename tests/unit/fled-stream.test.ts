import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFledHeader, PixelFormat } from '../../packages/gfx/src/render/rgb-video';
import { FledStreamError, streamFled } from '../../packages/gfx/src/render/fled-stream';

const METADATA = JSON.stringify({ map: { strip1: { x: [0, 1], y: [0, 0] } }, video: { fps: 2 } });

function ignoreFrame(): void { return; }

function concat(...parts: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function chunkStream(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                controller.enqueue(bytes.slice(offset, offset + chunkSize));
            }
            controller.close();
        },
    });
}

test('streamFled emits frames across arbitrary header, JSON, and frame chunk boundaries', async () => {
    const header = buildFledHeader(METADATA, PixelFormat.rgb8);
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const frames: Uint8Array[] = [];
    let metadataSeen = '';
    const result = await streamFled(chunkStream(concat(header, payload), 1), {
        expectedTotalBytes: header.length + payload.length,
        onMetadata: (metadata) => {
            metadataSeen = metadata.embeddedJson;
            return 6;
        },
        onFrame: (frame) => { frames.push(frame); },
    });

    assert.equal(metadataSeen, METADATA);
    assert.equal(result.frameCount, 2);
    assert.equal(result.frameSize, 6);
    assert.deepEqual([...frames[0] ?? []], [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...frames[1] ?? []], [7, 8, 9, 10, 11, 12]);
    assert.deepEqual([...result.header], [...header]);
});

test('streamFled rejects a known payload length that is not frame-aligned before emitting frames', async () => {
    const header = buildFledHeader(METADATA, PixelFormat.rgb8);
    const payload = new Uint8Array([1, 2, 3, 4]);
    let emitted = 0;
    await assert.rejects(
        streamFled(chunkStream(concat(header, payload), 7), {
            expectedTotalBytes: header.length + payload.length,
            onMetadata: () => 6,
            onFrame: () => { emitted++; return; },
        }),
        (error: unknown) => error instanceof FledStreamError && error.code === 'not-multiple',
    );
    assert.equal(emitted, 0);
});

test('streamFled rejects a trailing partial frame when the source length is unknown', async () => {
    const header = buildFledHeader(METADATA, PixelFormat.rgb8);
    await assert.rejects(
        streamFled(chunkStream(concat(header, new Uint8Array([1, 2, 3, 4])), 3), {
            onMetadata: () => 6,
            onFrame: ignoreFrame,
        }),
        (error: unknown) => error instanceof FledStreamError && error.code === 'not-multiple',
    );
});

test('streamFled supports cancellation while waiting for the next chunk', async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
            streamController.enqueue(buildFledHeader(METADATA, PixelFormat.rgb8));
            release = () => { streamController.close(); };
        },
    });
    const pending = streamFled(stream, {
        signal: controller.signal,
        onMetadata: () => 6,
        onFrame: ignoreFrame,
    });
    controller.abort();
    release?.();
    await assert.rejects(pending, (error: unknown) => error instanceof FledStreamError && error.code === 'aborted');
});
