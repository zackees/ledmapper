import { linearChannelToSrgbByte, srgbChannelToLinear } from '../color-space';

export interface GatherSample {
    /** Linear-light RGBA samples (RGBA16F render target read as float). */
    buffer: Float32Array | Uint8Array;
    numPts: number;
}

export interface ExtractedFrame {
    rgbPts: Uint8Array;
    /** Unquantized linear-light RGB for the mapped MP4 render path. */
    linearRgbPts?: Float32Array;
    avgBri: number;
    oobCount: number;
}

export function extractGatherToRgb(gather: GatherSample, channelMap: Int32Array | null = null): ExtractedFrame {
    const rgb = new Uint8Array(gather.numPts * 3);
    const isLinear = gather.buffer instanceof Float32Array;
    const linearRgb = isLinear ? new Float32Array(gather.numPts * 3) : undefined;
    let total = 0;
    let inBounds = 0;
    for (let i = 0; i < gather.numPts; i++) {
        const src = i * 4;
        const logical = i * 3;
        const alpha = gather.buffer[src + 3] ?? 0;
        if (alpha >= (isLinear ? 0.5 : 128)) {
            const lr = isLinear ? gather.buffer[src] ?? 0 : srgbChannelToLinear((gather.buffer[src] ?? 0) / 255);
            const lg = isLinear ? gather.buffer[src + 1] ?? 0 : srgbChannelToLinear((gather.buffer[src + 1] ?? 0) / 255);
            const lb = isLinear ? gather.buffer[src + 2] ?? 0 : srgbChannelToLinear((gather.buffer[src + 2] ?? 0) / 255);
            const r = isLinear ? linearChannelToSrgbByte(lr) : gather.buffer[src] ?? 0;
            const g = isLinear ? linearChannelToSrgbByte(lg) : gather.buffer[src + 1] ?? 0;
            const b = isLinear ? linearChannelToSrgbByte(lb) : gather.buffer[src + 2] ?? 0;
            const dstLed = channelMap?.[i] ?? i;
            const dst = dstLed * 3;
            if (dst >= 0 && dst + 2 < rgb.length) {
                rgb[dst] = r; rgb[dst + 1] = g; rgb[dst + 2] = b;
                if (linearRgb) {
                    linearRgb[dst] = lr;
                    linearRgb[dst + 1] = lg;
                    linearRgb[dst + 2] = lb;
                }
            }
            total += r + g + b;
            inBounds++;
        } else {
            // Keep the logical slot black even when a channel map aliases it.
            rgb[logical] = 0; rgb[logical + 1] = 0; rgb[logical + 2] = 0;
        }
    }
    return {
        rgbPts: rgb,
        ...(linearRgb ? { linearRgbPts: linearRgb } : {}),
        avgBri: inBounds ? total / (inBounds * 3 * 255) : 0,
        oobCount: gather.numPts - inBounds,
    };
}

export function appendPayload(payload: Uint8Array, frame: Uint8Array, frameIndex: number, frameBytes: number): void {
    if (frame.length !== frameBytes) throw new Error(`frame-byte-count-mismatch:${String(frame.length)}:${String(frameBytes)}`);
    const offset = frameIndex * frameBytes;
    if (offset < 0 || offset + frameBytes > payload.length) throw new Error(`frame-count-overflow:${String(frameIndex)}`);
    payload.set(frame, offset);
}
