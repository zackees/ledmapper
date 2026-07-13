export type OfflineCaptureBackend = 'auto' | 'worker' | 'main';

export interface OfflineRenderConfig {
    width: number;
    height: number;
    pointCount: number;
    pointsBuffer: ArrayBuffer;
    channelMapBuffer: ArrayBuffer | null;
    blurRadius: number;
    sigma: number;
    brightness: number;
    maxBrightness: number;
    gamma: number;
    rotateDeg: number;
    zoom: number;
    translateX: number;
    translateY: number;
    previewIntervalMs: number;
}

export type OfflineCaptureHostMessage =
    | { type: 'start'; jobId: string; file: File; config: OfflineRenderConfig }
    | { type: 'cancel'; jobId: string };

export type OfflineCaptureWorkerMessage =
    | { type: 'started'; jobId: string; total: number; fps: number }
    | { type: 'progress'; jobId: string; done: number; total: number; previewBuffer?: ArrayBuffer; avgBrightness?: number; oobCount?: number }
    | { type: 'fallback'; jobId: string; target: 'main-thread' | 'realtime'; reason: string }
    | { type: 'complete'; jobId: string; payloadBuffer: ArrayBuffer; fps: number; total: number; elapsedMs: number }
    | { type: 'cancelled'; jobId: string; done: number; total: number; elapsedMs: number }
    | { type: 'error'; jobId: string; phase: 'startup' | 'running' | 'cleanup'; message: string; stack?: string };

export function isOfflineCaptureWorkerMessage(value: unknown): value is OfflineCaptureWorkerMessage {
    if (!value || typeof value !== 'object') return false;
    const type = (value as { type?: unknown }).type;
    return type === 'started' || type === 'progress' || type === 'fallback' || type === 'complete' || type === 'cancelled' || type === 'error';
}
