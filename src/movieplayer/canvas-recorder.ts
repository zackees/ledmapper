/**
 * Native canvas video recorder for the Movie Player.
 *
 * Captures the live WebGL canvas with the browser's native MediaRecorder over
 * canvas.captureStream(fps). The browser samples + encodes the canvas off the
 * main thread, so the render loop does zero extra work per frame — recording
 * on vs. off makes no difference to render FPS. When not recording, nothing is
 * allocated and there is no overhead at all.
 *
 * Output is a WebM (or MP4 where WebM is unavailable) downloaded on stop.
 */

import { download_blob_as_file } from '../common';

// Preferred container/codec order. The first supported entry wins.
const CANDIDATE_TYPES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
];

function pickMimeType(): string | null {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const t of CANDIDATE_TYPES) {
        try {
            if (MediaRecorder.isTypeSupported(t)) return t;
        } catch { /* ignore */ }
    }
    return null;
}

function extForMime(mime: string): string {
    return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export interface CanvasRecorder {
    /** Toggle recording; returns the new active state. */
    toggle: () => boolean;
    start: () => boolean;
    stop: () => void;
    readonly isActive: boolean;
    readonly isSupported: boolean;
}

/**
 * @param canvas The WebGL canvas to capture.
 * @param fps    Capture frame rate (default 60).
 * @param onError Optional callback invoked with a user-facing message on failure.
 */
export function createCanvasRecorder({
    canvas,
    fps = 60,
    onError,
}: {
    canvas: HTMLCanvasElement;
    fps?: number;
    onError?: (message: string) => void;
}): CanvasRecorder {
    const mimeType = pickMimeType();
    const supported = mimeType !== null && typeof canvas.captureStream === 'function';

    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let chunks: Blob[] = [];
    let active = false;
    let downloadIndex = 0;

    function fail(message: string) {
        active = false;
        recorder = null;
        if (stream) { stream.getTracks().forEach((t) => { t.stop(); }); stream = null; }
        chunks = [];
        if (onError) onError(message);
    }

    function start(): boolean {
        if (active) return true;
        if (mimeType === null || typeof canvas.captureStream !== 'function') {
            if (onError) onError('Canvas recording is not supported in this browser.');
            return false;
        }
        try {
            stream = canvas.captureStream(fps);
        } catch {
            fail('Failed to capture the canvas stream.');
            return false;
        }
        chunks = [];
        try {
            recorder = new MediaRecorder(stream, { mimeType });
        } catch {
            fail('Failed to start the media recorder.');
            return false;
        }
        recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
            const localStream = stream;
            stream = null;
            recorder = null;
            if (localStream) localStream.getTracks().forEach((t) => { t.stop(); });
            if (chunks.length === 0) {
                if (onError) onError('No video frames were captured.');
                return;
            }
            const blob = new Blob(chunks, { type: mimeType });
            chunks = [];
            download_blob_as_file(blob, `ledmapper-recording${String(downloadIndex)}.${extForMime(mimeType)}`);
            downloadIndex++;
        };
        // Timeslice keeps memory bounded by flushing chunks periodically.
        recorder.start(1000);
        active = true;
        return true;
    }

    function stop(): void {
        if (!active || !recorder) return;
        active = false;
        try {
            recorder.stop();
        } catch {
            fail('Failed to stop the recording.');
        }
    }

    function toggle(): boolean {
        if (active) { stop(); return false; }
        return start();
    }

    return {
        toggle,
        start,
        stop,
        get isActive() { return active; },
        get isSupported() { return supported; },
    };
}
