/**
 * Offline every-frame capture (issue #257 / #255 Phase 2).
 *
 * Realtime capture races the compositor and can only approach 100%. For
 * FILE sources there is no reason to race at all: demux the original File
 * (mediabunny), decode every frame with WebCodecs (hardware, typically
 * faster than realtime), push each decoded frame through the existing
 * blur+gather pipeline, and await each tiny readback — one in, one out,
 * `captured === container frame count`, bit-exact.
 *
 * mediabunny is dynamically imported so its chunk only loads when an
 * offline capture actually starts.
 */

import { snapFps } from './frame-pacing';
import { createLogger } from '../debug-log';

const log = createLogger('offline-capture');

export interface OfflineCaptureResult {
    /** Recording-ready per-frame LED byte arrays, in presentation order. */
    frames: Uint8Array[];
    /** Container-declared frame rate, snapped to common rates. */
    fps: number;
    /** Container frame count (the every-frame target). */
    total: number;
    /** True when the user cancelled mid-decode (frames are partial). */
    cancelled: boolean;
    /** Wall-clock capture duration in ms. */
    elapsedMs: number;
}

/** WebCodecs present? (mediabunny needs VideoDecoder for compressed video.) */
export function isOfflineCaptureSupported(): boolean {
    return typeof VideoDecoder !== 'undefined';
}

/**
 * Run the offline pass. Returns null when this FILE can't take the offline
 * path (no video track, codec not decodable here) — the caller falls back
 * to the realtime capture path. Throws only on unexpected errors.
 *
 * @param captureFrame Renders + samples one decoded frame and returns the
 *   recording-ready bytes (channel-mapped copy), or null to drop the frame.
 *   Backpressure is inherent: the next frame is not decoded-consumed until
 *   this resolves.
 */
export async function runOfflineCapture({ file, captureFrame, onProgress, isCancelled }: {
    file: File;
    captureFrame: (frame: VideoFrame) => Promise<Uint8Array | null>;
    onProgress: (done: number, total: number) => void;
    isCancelled: () => boolean;
}): Promise<OfflineCaptureResult | null> {
    const t0 = performance.now();
    const mb = await import('mediabunny');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });

    const track = await input.getPrimaryVideoTrack();
    if (!track) {
        log.warn('no-video-track', { file: file.name });
        return null;
    }
    if (!(await track.canDecode())) {
        log.warn('codec-not-decodable', { file: file.name });
        return null;
    }

    const stats = await track.computePacketStats();
    const total = stats.packetCount;
    const fps = snapFps(stats.averagePacketRate);
    log.info('offline-capture-start', { file: file.name, total, fps });

    const frames: Uint8Array[] = [];
    let cancelled = false;
    const sink = new mb.VideoSampleSink(track);
    for await (const sample of sink.samples()) {
        if (isCancelled()) {
            cancelled = true;
            sample.close();
            break;
        }
        const videoFrame = sample.toVideoFrame();
        try {
            const bytes = await captureFrame(videoFrame);
            if (bytes) frames.push(bytes);
        } finally {
            videoFrame.close();
            sample.close();
        }
        onProgress(frames.length, total);
    }

    const elapsedMs = Math.round(performance.now() - t0);
    log.info('offline-capture-done', { captured: frames.length, total, cancelled, elapsedMs });
    if (!cancelled && frames.length !== total) {
        // The whole point of this path is exactness — a mismatch is a bug
        // (dropped decode, pipeline refusal), never something to hide.
        log.warn('offline-capture-incomplete', { captured: frames.length, total });
    }
    return { frames, fps, total, cancelled, elapsedMs };
}
