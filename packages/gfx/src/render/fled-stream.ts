import { bytesPerLed, hasFledMagic } from './rgb-video.js';

const HEADER_BYTES = 12;

export interface FledStreamMetadata {
    /** The complete fixed header plus embedded JSON bytes. */
    header: Uint8Array;
    embeddedJson: string;
    pixelFormat: number;
    bytesPerPixel: number;
    /** Total source bytes when the caller knows it, otherwise null. */
    expectedTotalBytes: number | null;
}

export interface FledStreamOptions {
    /** A known source length, such as File.size or an uncompressed Content-Length. */
    expectedTotalBytes?: number;
    signal?: AbortSignal;
    /** Return the complete byte size of one decoded frame. */
    onMetadata: (metadata: FledStreamMetadata) => number | Promise<number>;
    onFrame: (frame: Uint8Array, index: number) => void | Promise<void>;
}

export interface FledStreamResult {
    embeddedJson: string;
    pixelFormat: number;
    frameSize: number;
    frameCount: number;
    header: Uint8Array;
}

/** Errors raised while decoding a progressive FLED stream. */
export class FledStreamError extends Error {
    readonly code:
        | 'aborted'
        | 'bad-magic'
        | 'unsupported-version'
        | 'truncated-header'
        | 'truncated-json'
        | 'bad-utf8'
        | 'unknown-format'
        | 'invalid-frame-size'
        | 'not-multiple'
        | 'empty';

    constructor(code: FledStreamError['code'], message: string) {
        super(message);
        this.name = 'FledStreamError';
        this.code = code;
    }
}

class ByteQueue {
    private readonly chunks: Uint8Array[] = [];
    private headOffset = 0;
    length = 0;

    append(chunk: Uint8Array): void {
        if (chunk.length === 0) return;
        this.chunks.push(chunk);
        this.length += chunk.length;
    }

    peek(size: number): Uint8Array {
        if (size < 0 || size > this.length) throw new RangeError('ByteQueue.peek size is unavailable');
        const out = new Uint8Array(size);
        this.copyInto(out, 0, size);
        return out;
    }

    take(size: number): Uint8Array {
        if (size < 0 || size > this.length) throw new RangeError('ByteQueue.take size is unavailable');
        const out = new Uint8Array(size);
        let written = 0;
        while (written < size) {
            const chunk = this.chunks[0];
            if (!chunk) throw new Error('ByteQueue unexpectedly empty');
            const available = chunk.length - this.headOffset;
            const count = Math.min(available, size - written);
            out.set(chunk.subarray(this.headOffset, this.headOffset + count), written);
            written += count;
            this.headOffset += count;
            this.length -= count;
            if (this.headOffset === chunk.length) {
                this.chunks.shift();
                this.headOffset = 0;
            }
        }
        return out;
    }

    private copyInto(out: Uint8Array, outOffset: number, size: number): void {
        let remaining = size;
        let chunkIndex = 0;
        let offset = this.headOffset;
        while (remaining > 0) {
            const chunk = this.chunks[chunkIndex];
            if (!chunk) throw new Error('ByteQueue unexpectedly empty');
            const available = chunk.length - offset;
            const count = Math.min(available, remaining);
            out.set(chunk.subarray(offset, offset + count), outOffset);
            outOffset += count;
            remaining -= count;
            chunkIndex++;
            offset = 0;
        }
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new FledStreamError('aborted', 'FLED stream loading was cancelled.');
}

function parseMetadata(queue: ByteQueue, expectedTotalBytes: number | null): FledStreamMetadata | null {
    if (queue.length < HEADER_BYTES) return null;
    const fixed = queue.peek(HEADER_BYTES);
    if (!hasFledMagic(fixed)) throw new FledStreamError('bad-magic', 'The stream does not begin with a FLED header.');
    if (fixed[4] !== 1) {
        throw new FledStreamError('unsupported-version', `FLED format version ${String(fixed[4])} is not supported.`);
    }
    const pixelFormat = fixed[5] ?? 0;
    const bytesPerPixel = bytesPerLed(pixelFormat);
    if (bytesPerPixel === null) {
        throw new FledStreamError('unknown-format', `FLED pixel format 0x${pixelFormat.toString(16).padStart(2, '0')} is not supported.`);
    }
    const jsonLength = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength).getUint32(8, true);
    const headerLength = HEADER_BYTES + jsonLength;
    if (expectedTotalBytes !== null && expectedTotalBytes < headerLength) {
        throw new FledStreamError('truncated-json', 'The source ends before the embedded FLED metadata.');
    }
    if (queue.length < headerLength) return null;
    const header = queue.take(headerLength);
    let embeddedJson: string;
    try {
        embeddedJson = new TextDecoder('utf-8', { fatal: true }).decode(header.subarray(HEADER_BYTES));
    } catch {
        throw new FledStreamError('bad-utf8', 'The embedded FLED metadata is not valid UTF-8.');
    }
    return { header, embeddedJson, pixelFormat, bytesPerPixel, expectedTotalBytes };
}

/**
 * Decode a FLED byte stream without waiting for the complete payload.
 * `onMetadata` supplies the frame size after validating the embedded map;
 * `onFrame` receives each complete frame in source order.
 */
export async function streamFled(
    stream: ReadableStream<Uint8Array>,
    options: FledStreamOptions,
): Promise<FledStreamResult> {
    const expectedTotalBytes = options.expectedTotalBytes ?? null;
    if (expectedTotalBytes !== null && (!Number.isSafeInteger(expectedTotalBytes) || expectedTotalBytes < 0)) {
        throw new RangeError('expectedTotalBytes must be a non-negative safe integer');
    }
    const reader = stream.getReader();
    const queue = new ByteQueue();
    let metadata: FledStreamMetadata | null = null;
    let frameSize = 0;
    let frameCount = 0;
    let totalPayloadBytes = 0;

    try {
        while (true) {
            throwIfAborted(options.signal);
            const result = await reader.read();
            if (result.done) break;
            queue.append(result.value);

            if (metadata === null) {
                metadata = parseMetadata(queue, expectedTotalBytes);
                if (metadata !== null) {
                    frameSize = await options.onMetadata(metadata);
                    if (!Number.isSafeInteger(frameSize) || frameSize <= 0) {
                        throw new FledStreamError('invalid-frame-size', 'The embedded screenmap produced an invalid frame size.');
                    }
                    if (expectedTotalBytes !== null) {
                        const payloadBytes = expectedTotalBytes - metadata.header.length;
                        if (payloadBytes % frameSize !== 0) {
                            throw new FledStreamError('not-multiple', 'The FLED payload is not a whole number of frames.');
                        }
                    }
                }
            }

            if (metadata !== null) {
                while (queue.length >= frameSize) {
                    throwIfAborted(options.signal);
                    const frame = queue.take(frameSize);
                    await options.onFrame(frame, frameCount);
                    frameCount++;
                    totalPayloadBytes += frame.length;
                }
            }
        }
    } catch (error: unknown) {
        if (options.signal?.aborted && !(error instanceof FledStreamError && error.code === 'aborted')) {
            throw new FledStreamError('aborted', 'FLED stream loading was cancelled.');
        }
        throw error;
    } finally {
        try { await reader.cancel(); } catch { /* the source may already be closed */ }
        reader.releaseLock();
    }

    throwIfAborted(options.signal);
    if (metadata === null) {
        if (queue.length < HEADER_BYTES) throw new FledStreamError('truncated-header', 'The FLED header is incomplete.');
        throw new FledStreamError('truncated-json', 'The embedded FLED metadata is incomplete.');
    }
    if (queue.length !== 0) throw new FledStreamError('not-multiple', 'The FLED payload ends with a partial frame.');
    if (frameCount === 0) throw new FledStreamError('empty', 'The FLED file does not contain any video frames.');
    if (expectedTotalBytes !== null && metadata.header.length + totalPayloadBytes !== expectedTotalBytes) {
        throw new FledStreamError('truncated-json', 'The FLED stream ended before its declared length.');
    }
    return {
        embeddedJson: metadata.embeddedJson,
        pixelFormat: metadata.pixelFormat,
        frameSize,
        frameCount,
        header: metadata.header,
    };
}
