import { AppendOnlyStreamTarget, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';

export interface Mp4CanvasEncoder {
    addFrame(timestampSeconds: number, durationSeconds: number): Promise<void>;
    finalize(): Promise<Blob | null>;
    cancel(): Promise<void>;
}

/** Create a strict H.264/MP4 encoder. No WebM or realtime fallback is allowed. */
export async function createMp4CanvasEncoder({
    canvas,
    width,
    height,
    writable,
}: {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
    /** Optional append-only destination. Fragmented MP4 permits true streaming. */
    writable?: WritableStream<Uint8Array>;
}): Promise<Mp4CanvasEncoder> {
    if (!(await canEncodeVideo('avc', { width, height, bitrate: QUALITY_HIGH }))) {
        throw new Error('MP4_ENCODING_UNSUPPORTED');
    }
    const bufferTarget = writable ? null : new BufferTarget();
    const target = writable ? new AppendOnlyStreamTarget(writable) : bufferTarget;
    const output = new Output({
        format: new Mp4OutputFormat(writable ? { fastStart: 'fragmented' } : {}),
        target,
    });
    // Mediabunny otherwise stamps mvhd/tkhd/mdhd with Date.now(). That makes
    // two byte-identical H.264 streams differ in exactly 12 MP4 header bytes.
    // Pin the ISO-BMFF epoch value before start so local and streamed renders
    // are reproducible as whole files, not merely as decoded video frames.
    const muxer = output._muxer as unknown as { creationTime?: number };
    if (typeof muxer.creationTime !== 'number') throw new Error('MP4_ENCODING_UNSUPPORTED');
    muxer.creationTime = 0;
    const source = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        keyFrameInterval: 2,
    });
    output.addVideoTrack(source);
    await output.start();
    let done = false;

    return {
        async addFrame(timestampSeconds, durationSeconds) {
            if (done) throw new Error('MP4 encoder is closed');
            await source.add(timestampSeconds, durationSeconds);
        },
        async finalize() {
            if (done) throw new Error('MP4 encoder is closed');
            done = true;
            await output.finalize();
            if (writable) return null;
            if (!bufferTarget?.buffer || bufferTarget.buffer.byteLength === 0) {
                throw new Error('MP4 encoder returned an empty artifact');
            }
            return new Blob([bufferTarget.buffer], { type: 'video/mp4' });
        },
        async cancel() {
            if (done) return;
            done = true;
            await output.cancel();
        },
    };
}
