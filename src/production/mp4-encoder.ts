import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';

export interface Mp4CanvasEncoder {
    addFrame(timestampSeconds: number, durationSeconds: number): Promise<void>;
    finalize(): Promise<Blob>;
    cancel(): Promise<void>;
}

/** Create a strict H.264/MP4 encoder. No WebM or realtime fallback is allowed. */
export async function createMp4CanvasEncoder({
    canvas,
    width,
    height,
}: {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    width: number;
    height: number;
}): Promise<Mp4CanvasEncoder> {
    if (!(await canEncodeVideo('avc', { width, height, bitrate: QUALITY_HIGH }))) {
        throw new Error('MP4_ENCODING_UNSUPPORTED');
    }
    const target = new BufferTarget();
    const output = new Output({
        format: new Mp4OutputFormat(),
        target,
    });
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
            if (!target.buffer || target.buffer.byteLength === 0) {
                throw new Error('MP4 encoder returned an empty artifact');
            }
            return new Blob([target.buffer], { type: 'video/mp4' });
        },
        async cancel() {
            if (done) return;
            done = true;
            await output.cancel();
        },
    };
}
