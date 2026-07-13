import { snapFps } from './frame-pacing';
import { createLogger } from '../debug-log';
import { createBlurPipeline } from './blur-pipeline';
import { appendPayload, extractGatherToRgb } from './offline-capture-frame';
import type { OfflineCaptureHostMessage, OfflineCaptureWorkerMessage, OfflineRenderConfig } from './offline-capture-protocol';
import type * as MediaBunny from 'mediabunny';

const log = createLogger('offline-capture-worker');

export interface OfflineWorkerScope {
    postMessage(message: OfflineCaptureWorkerMessage, transfer?: Transferable[]): void;
    addEventListener(type: 'message', listener: (event: MessageEvent<OfflineCaptureHostMessage>) => void): void;
}

export interface OfflineWorkerDeps {
    loadMediaBunny?: () => Promise<typeof MediaBunny>;
    createPipeline?: (config: OfflineRenderConfig) => ReturnType<typeof createBlurPipeline>;
    now?: () => number;
    hasVideoDecoder?: () => boolean;
    hasOffscreenCanvas?: () => boolean;
}

function post(scope: OfflineWorkerScope, message: OfflineCaptureWorkerMessage, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer);
}

function validateConfig(config: OfflineRenderConfig): void {
    if (!Number.isInteger(config.width) || config.width <= 0 || !Number.isInteger(config.height) || config.height <= 0 || !Number.isInteger(config.pointCount) || config.pointCount <= 0) throw new Error('invalid offline render dimensions');
    if (config.pointsBuffer.byteLength !== config.pointCount * 2 * Float32Array.BYTES_PER_ELEMENT) throw new Error('invalid offline points buffer');
    if (config.channelMapBuffer && config.channelMapBuffer.byteLength !== config.pointCount * Int32Array.BYTES_PER_ELEMENT) throw new Error('invalid offline channel map');
}

export function runOfflineCaptureWorker(scope: OfflineWorkerScope, deps: OfflineWorkerDeps = {}): void {
    let cancelJob: string | null = null;
    scope.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'cancel') { cancelJob = message.jobId; return; }
        cancelJob = null;
        void runJob(scope, message, deps).catch((error: unknown) => {
            const stack = error instanceof Error ? error.stack : undefined;
            post(scope, stack ? { type: 'error', jobId: message.jobId, phase: 'running', message: String(error), stack } : { type: 'error', jobId: message.jobId, phase: 'running', message: String(error) });
        });
    });

    async function runJob(scope: OfflineWorkerScope, start: Extract<OfflineCaptureHostMessage, { type: 'start' }>, workerDeps: OfflineWorkerDeps): Promise<void> {
        const startedAt = workerDeps.now?.() ?? performance.now();
        let input: { getPrimaryVideoTrack(): Promise<unknown>; dispose?: () => void } | null = null;
        let pipeline: ReturnType<typeof createBlurPipeline> | null = null;
        let done = 0;
        let terminal: OfflineCaptureWorkerMessage | null = null;
        try {
            validateConfig(start.config);
            if (!(workerDeps.hasVideoDecoder?.() ?? typeof VideoDecoder !== 'undefined') || !(workerDeps.hasOffscreenCanvas?.() ?? typeof OffscreenCanvas !== 'undefined')) {
                terminal = { type: 'fallback', jobId: start.jobId, target: 'main-thread', reason: 'worker-capability-unavailable' };
                return;
            }
            const mb = await (workerDeps.loadMediaBunny?.() ?? import('mediabunny'));
            input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(start.file) });
            const track = await input.getPrimaryVideoTrack() as { canDecode(): Promise<boolean>; computePacketStats(): Promise<{ packetCount: number; averagePacketRate: number }> } | null;
            if (!track) { terminal = { type: 'fallback', jobId: start.jobId, target: 'realtime', reason: 'no-video-track' }; return; }
            if (!(await track.canDecode())) { terminal = { type: 'fallback', jobId: start.jobId, target: 'realtime', reason: 'codec-not-decodable' }; return; }
            const stats = await track.computePacketStats();
            const total = stats.packetCount;
            const fps = snapFps(stats.averagePacketRate);
            pipeline = workerDeps.createPipeline?.(start.config) ?? createBlurPipeline({ canvas: new OffscreenCanvas(start.config.width, start.config.height), initialUniforms: { blurRadius: start.config.blurRadius, sigma: start.config.sigma } });
            pipeline.setupForResolution(start.config.width, start.config.height);
            const pointData = new Float32Array(start.config.pointsBuffer);
            const points: number[][] = [];
            for (let i = 0; i < start.config.pointCount; i++) points.push([pointData[i * 2] ?? 0, pointData[i * 2 + 1] ?? 0]);
            pipeline.setSamplePoints(points, start.config.width, start.config.height);
            pipeline.setSampleTransform(start.config.rotateDeg, start.config.zoom, start.config.translateX, start.config.translateY);
            post(scope, { type: 'started', jobId: start.jobId, total, fps });
            const payload = new Uint8Array(total * start.config.pointCount * 3);
            const channelMap = start.config.channelMapBuffer ? new Int32Array(start.config.channelMapBuffer) : null;
            const sink = new mb.VideoSampleSink(track as never);
            let lastProgress = 0;
            for await (const sample of sink.samples()) {
                let frame: VideoFrame | null = null;
                try {
                    if (cancelJob === start.jobId) break;
                    frame = sample.toVideoFrame();
                    const gather = await pipeline.captureFrameSample(frame);
                    if (!gather) throw new Error('offline worker readback unavailable');
                    const extracted = extractGatherToRgb(gather, channelMap);
                    appendPayload(payload, extracted.rgbPts, done, start.config.pointCount * 3);
                    done++;
                    const now = workerDeps.now?.() ?? performance.now();
                    if (now - lastProgress >= Math.max(100, start.config.previewIntervalMs)) {
                        const preview = extracted.rgbPts.slice();
                        post(scope, { type: 'progress', jobId: start.jobId, done, total, previewBuffer: preview.buffer, avgBrightness: extracted.avgBri, oobCount: extracted.oobCount }, [preview.buffer]);
                        lastProgress = now;
                    }
                } finally {
                    frame?.close();
                    sample.close();
                }
            }
            if (cancelJob === start.jobId) {
                terminal = { type: 'cancelled', jobId: start.jobId, done, total, elapsedMs: Math.round((workerDeps.now?.() ?? performance.now()) - startedAt) };
            } else if (done !== total) {
                throw new Error(`offline-capture-incomplete:${String(done)}:${String(total)}`);
            } else {
                terminal = { type: 'complete', jobId: start.jobId, payloadBuffer: payload.buffer, fps, total, elapsedMs: Math.round((workerDeps.now?.() ?? performance.now()) - startedAt) };
            }
        } finally {
            try { pipeline?.dispose(); } finally { input?.dispose?.(); }
            if (terminal) {
                const transfer = terminal.type === 'complete' ? [terminal.payloadBuffer] : [];
                post(scope, terminal, transfer);
            }
            log.info('offline-worker-cleanup', { jobId: start.jobId, done });
        }
    }
}
