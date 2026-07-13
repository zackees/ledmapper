export interface GatherSample {
    buffer: Uint8Array;
    numPts: number;
}

export interface ExtractedFrame {
    rgbPts: Uint8Array;
    avgBri: number;
    oobCount: number;
}

export function extractGatherToRgb(gather: GatherSample, channelMap: Int32Array | null = null): ExtractedFrame {
    const rgb = new Uint8Array(gather.numPts * 3);
    let total = 0;
    let inBounds = 0;
    for (let i = 0; i < gather.numPts; i++) {
        const src = i * 4;
        const logical = i * 3;
        if ((gather.buffer[src + 3] ?? 0) >= 128) {
            const r = gather.buffer[src] ?? 0;
            const g = gather.buffer[src + 1] ?? 0;
            const b = gather.buffer[src + 2] ?? 0;
            const dstLed = channelMap?.[i] ?? i;
            const dst = dstLed * 3;
            if (dst >= 0 && dst + 2 < rgb.length) {
                rgb[dst] = r; rgb[dst + 1] = g; rgb[dst + 2] = b;
            }
            total += r + g + b;
            inBounds++;
        } else {
            // Keep the logical slot black even when a channel map aliases it.
            rgb[logical] = 0; rgb[logical + 1] = 0; rgb[logical + 2] = 0;
        }
    }
    return { rgbPts: rgb, avgBri: inBounds ? total / (inBounds * 3 * 255) : 0, oobCount: gather.numPts - inBounds };
}

export function appendPayload(payload: Uint8Array, frame: Uint8Array, frameIndex: number, frameBytes: number): void {
    if (frame.length !== frameBytes) throw new Error(`frame-byte-count-mismatch:${String(frame.length)}:${String(frameBytes)}`);
    const offset = frameIndex * frameBytes;
    if (offset < 0 || offset + frameBytes > payload.length) throw new Error(`frame-count-overflow:${String(frameIndex)}`);
    payload.set(frame, offset);
}
