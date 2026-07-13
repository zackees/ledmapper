import { snapFps } from './frame-pacing';
import { createLogger } from '../debug-log';

const log = createLogger('offline-capture');

export interface OfflineCaptureResult {
    frames: Uint8Array[];
    fps: number;
    total: number;
    cancelled: boolean;
    elapsedMs: number;
}

export function isOfflineCaptureSupported(): boolean { return typeof VideoDecoder !== 'undefined'; }
export function isOfflineCaptureWorkerSupported(): boolean {
    return typeof Worker !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export async function runOfflineCapture({ file, captureFrame, onProgress, isCancelled }: {
    file: File;
    captureFrame: (frame: VideoFrame) => Promise<Uint8Array | null>;
    onProgress: (done: number, total: number) => void;
    isCancelled: () => boolean;
}): Promise<OfflineCaptureResult | null> {
    const t0 = performance.now();
    const mb = await import('mediabunny');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return null;
        const stats = await track.computePacketStats();
        const total = stats.packetCount;
        const fps = snapFps(stats.averagePacketRate);
        const frames: Uint8Array[] = [];
        let cancelled = false;
        const sink = new mb.VideoSampleSink(track);
        for await (const sample of sink.samples()) {
            let videoFrame: VideoFrame | null = null;
            try {
                if (isCancelled()) { cancelled = true; break; }
                videoFrame = sample.toVideoFrame();
                const bytes = await captureFrame(videoFrame);
                if (!bytes) throw new Error('offline capture readback unavailable');
                frames.push(bytes);
            } finally {
                videoFrame?.close();
                sample.close();
            }
            onProgress(frames.length, total);
        }
        const elapsedMs = Math.round(performance.now() - t0);
        if (!cancelled && frames.length !== total) throw new Error(`offline-capture-incomplete:${String(frames.length)}:${String(total)}`);
        log.info('offline-capture-done', { captured: frames.length, total, cancelled, elapsedMs });
        return { frames, fps, total, cancelled, elapsedMs };
    } finally {
        input.dispose();
    }
}
