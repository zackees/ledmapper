/**
 * Shared `.rgb` video parsing. A `.rgb` file is raw sequential RGB triplets
 * (3 bytes per LED per frame); frame count = totalBytes / (ledCount * 3).
 *
 * This is the single source of truth for slicing a flat byte buffer into
 * per-frame `Uint8Array`s. Tools keep their own orchestration (alerts,
 * persistence, autoplay) around this pure parse step.
 */

export interface RgbParseResult {
    /** Per-frame RGB byte slices (length ledCount*3 each). Empty on error. */
    frames: Uint8Array[];
    /** True when the buffer is not an integer number of full frames. */
    notMultiple: boolean;
}

/**
 * Slice a `.rgb` byte buffer into per-frame arrays for the given LED count.
 * Returns `notMultiple: true` (and no frames) when the buffer length is not a
 * whole multiple of one frame, so callers can decide how to surface the error.
 */
export function parseRgbFrames(buffer: ArrayBuffer | Uint8Array, ledCount: number): RgbParseResult {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const numPixels = bytes.length / 3;
    if (ledCount <= 0 || numPixels % ledCount !== 0) {
        return { frames: [], notMultiple: true };
    }
    const frameSize = ledCount * 3;
    const nFrames = numPixels / ledCount;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < nFrames; i++) {
        frames.push(bytes.slice(i * frameSize, (i + 1) * frameSize));
    }
    return { frames, notMultiple: false };
}
