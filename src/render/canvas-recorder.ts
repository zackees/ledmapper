/**
 * Native canvas video recorder for the Movie Player.
 *
 * Records H.264/MP4 (falling back to WebM only where H.264 is unavailable) at a
 * fixed 1080x1080 so the output is easy to use downstream. The live WebGL
 * canvas renders at a larger fixed buffer (BLOOM_RENDER_PX), so each recorded
 * frame is a high-quality downscale: the host calls captureFrame() once per
 * render frame — right after the GL draw, while the backbuffer is still intact —
 * which blits the WebGL canvas into a 1080x1080 2D canvas. MediaRecorder then
 * encodes that canvas's stream off the main thread.
 *
 * When not recording, captureFrame() is a no-op and nothing is allocated, so
 * render-loop cost is unchanged whether recording is on or off.
 */

import { download_blob_as_file } from '../common';

// Preferred container/codec order. H.264 first (broadly usable, hardware
// decode everywhere); WebM only as a fallback. The first supported entry wins.
const CANDIDATE_TYPES = [
    'video/mp4;codecs=avc1.640028', // H.264 High@4.0
    'video/mp4;codecs=avc1.42E01E', // H.264 Baseline
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
];

// MediaRecorder has no CRF (constant-quality) mode, only a target bitrate, so
// CRF 18 ("visually lossless") is approximated with a generous bits-per-pixel
// budget. LED footage is mostly dark and compresses far below this under VBR,
// so the real files stay small while detail is preserved.
const TARGET_BPP = 0.4;

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

/**
 * Aspect-ratio presets for social-media exports. Each preset names a
 * width × height in pixels at a target good-quality output size:
 *
 *   square — 1080×1080 — Instagram square posts, generic LED preview.
 *   portrait — 1080×1920 (9:16) — Instagram Reels, TikTok, YouTube Shorts.
 *   landscape — 1920×1080 (16:9) — YouTube, Twitter, generic playback.
 */
export type AspectPreset = 'square' | 'portrait' | 'landscape';

export interface AspectDimensions { width: number; height: number }

const ASPECT_DIMENSIONS: Record<AspectPreset, AspectDimensions> = {
    square:    { width: 1080, height: 1080 },
    portrait:  { width: 1080, height: 1920 },
    landscape: { width: 1920, height: 1080 },
};

/** Look up the pixel dimensions for a named aspect-ratio preset. */
export function dimensionsForAspect(preset: AspectPreset): AspectDimensions {
    return ASPECT_DIMENSIONS[preset];
}

export interface CanvasRecorder {
    /** Toggle recording; returns the new active state. */
    toggle: () => boolean;
    start: () => boolean;
    stop: () => void;
    /**
     * Blit the source canvas into the capture canvas for the current frame.
     * Call once per render frame, immediately after drawing, while recording.
     * No-op when inactive.
     */
    captureFrame: () => void;
    readonly isActive: boolean;
    readonly isSupported: boolean;
}

/**
 * @param canvas  The WebGL canvas to capture.
 * @param width   Output width in pixels (default 1080).
 * @param height  Output height in pixels (default 1080).
 * @param fps     Capture frame rate (default 30, matching the render loop).
 * @param onError Optional callback invoked with a user-facing message on failure.
 */
export function createCanvasRecorder({
    canvas,
    width = 1080,
    height = 1080,
    fps = 30,
    onError,
}: {
    canvas: HTMLCanvasElement;
    width?: number;
    height?: number;
    fps?: number;
    onError?: (message: string) => void;
}): CanvasRecorder {
    const mimeType = pickMimeType();

    // Fixed-resolution intermediate the recorded stream is taken from. Created
    // up front (cheap, idle) so start() has nothing to allocate.
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = width;
    captureCanvas.height = height;
    const cctx = captureCanvas.getContext('2d');
    if (cctx) {
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = 'high';
    }

    const supported = mimeType !== null && cctx !== null
        && typeof captureCanvas.captureStream === 'function';

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

    function captureFrame(): void {
        if (!active || !cctx) return;
        try {
            // Letterbox / pillarbox the (assumed-square) source into the
            // (possibly non-square) output. The LED bloom looks awful when
            // stretched, so paint black bars instead and center the largest
            // square that fits.
            if (width !== height) {
                cctx.fillStyle = 'black';
                cctx.fillRect(0, 0, width, height);
                const side = Math.min(width, height);
                const dx = Math.round((width - side) / 2);
                const dy = Math.round((height - side) / 2);
                cctx.drawImage(canvas, dx, dy, side, side);
            } else {
                cctx.drawImage(canvas, 0, 0, width, height);
            }
        } catch { /* transient draw failure — skip this frame */ }
    }

    function start(): boolean {
        if (active) return true;
        if (mimeType === null || cctx === null || typeof captureCanvas.captureStream !== 'function') {
            if (onError) onError('Canvas recording is not supported in this browser.');
            return false;
        }
        try {
            stream = captureCanvas.captureStream(fps);
        } catch {
            fail('Failed to capture the canvas stream.');
            return false;
        }
        chunks = [];
        const videoBitsPerSecond = Math.round(width * height * fps * TARGET_BPP);
        try {
            recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
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
        active = true;
        // Seed the capture canvas with the current frame before the first sample.
        captureFrame();
        // Timeslice keeps memory bounded by flushing chunks periodically.
        recorder.start(1000);
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
        captureFrame,
        get isActive() { return active; },
        get isSupported() { return supported; },
    };
}
