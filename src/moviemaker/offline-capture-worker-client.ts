import type { OfflineCaptureWorkerMessage, OfflineRenderConfig } from './offline-capture-protocol';

export type OfflineWorkerResult =
    | { type: 'complete'; payload: Uint8Array; fps: number; total: number; elapsedMs: number }
    | { type: 'cancelled'; done: number; total: number; elapsedMs: number }
    | { type: 'fallback'; target: 'main-thread' | 'realtime'; reason: string };

export function runOfflineCaptureWorkerClient({ file, config, onProgress, workerFactory = () => new Worker(new URL('./offline-capture-worker.ts', import.meta.url), { type: 'module', name: 'ledmapper-offline-capture' }) }: {
    file: File;
    config: OfflineRenderConfig;
    onProgress?: (message: Extract<OfflineCaptureWorkerMessage, { type: 'progress' }>) => void;
    workerFactory?: () => Worker;
}): { promise: Promise<OfflineWorkerResult>; cancel: () => void } {
    const jobId = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const worker = workerFactory();
    let settled = false;
    let cancelSent = false;
    let resolveResult!: (result: OfflineWorkerResult) => void;
    let rejectResult!: (error: Error) => void;
    const promise = new Promise<OfflineWorkerResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const cleanup = () => { worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); worker.removeEventListener('messageerror', onMessageError); worker.terminate(); };
    const finish = (result: OfflineWorkerResult) => { if (settled) return; settled = true; cleanup(); resolveResult(result); };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); rejectResult(error); };
    const onMessage = (event: MessageEvent<OfflineCaptureWorkerMessage>) => {
        const message = event.data;
        if (message.jobId !== jobId) return;
        if (message.type === 'progress') { onProgress?.(message); return; }
        if (message.type === 'complete') { finish({ type: 'complete', payload: new Uint8Array(message.payloadBuffer), fps: message.fps, total: message.total, elapsedMs: message.elapsedMs }); return; }
        if (message.type === 'cancelled') { finish({ type: 'cancelled', done: message.done, total: message.total, elapsedMs: message.elapsedMs }); return; }
        if (message.type === 'fallback') { finish({ type: 'fallback', target: message.target, reason: message.reason }); return; }
        if (message.type === 'error') fail(new Error(`${message.phase}: ${message.message}`));
    };
    const onError = (event: ErrorEvent) => { fail(new Error(event.message || 'offline worker failed')); };
    const onMessageError = () => { fail(new Error('offline worker message could not be deserialized')); };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    const points = config.pointsBuffer;
    const channelMap = config.channelMapBuffer;
    worker.postMessage({ type: 'start', jobId, file, config }, [points, ...(channelMap ? [channelMap] : [])]);
    return {
        promise,
        cancel: () => {
            if (settled || cancelSent) return;
            cancelSent = true;
            worker.postMessage({ type: 'cancel', jobId });
            setTimeout(() => { if (!settled) fail(new Error('offline worker cancellation timed out')); }, 2000);
        },
    };
}
