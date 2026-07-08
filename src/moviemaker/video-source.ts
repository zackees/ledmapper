/**
 * Video source management: file loading and webcam capture.
 */

import { createLogger } from '../debug-log';

const log = createLogger('moviemaker');



/**
 * Translate a getUserMedia rejection into an actionable user message.
 * The raw browser message ("Could not start video source",
 * "Permission denied", …) is too generic to act on, so we key off the
 * DOMException `name` and pick a message that tells the user what to do.
 */
function describeWebcamError(err: unknown): string {
    const name = err instanceof DOMException ? err.name : '';
    const raw = err instanceof Error ? err.message : String(err);
    switch (name) {
        case 'NotReadableError':
        case 'TrackStartError':
            return 'The webcam is in use by another application (e.g. Zoom, Teams, Skype, OBS) or blocked by your OS. Close other apps using the camera, then try again.';
        case 'NotAllowedError':
        case 'PermissionDeniedError':
            return 'Camera access was denied. Click the camera icon in the address bar to allow access, then try again.';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
            return 'No camera was detected. Connect a camera and try again, or upload a video file instead.';
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
            return 'Your camera does not support the selected resolution or frame rate. Try a lower resolution.';
        case 'SecurityError':
            return 'Camera access is blocked in this context. This site must be served over HTTPS to use the webcam.';
        case 'AbortError':
            return 'Camera start was aborted. Try again.';
        case 'TypeError':
            return 'Invalid camera request. Try a different resolution or frame rate.';
        default:
            return raw || 'Could not start the webcam.';
    }
}

export function createVideoSource({
    videoPlayer,
    parseResolution,
    onSourceReady,
    onError,
}: {
    videoPlayer: HTMLVideoElement;
    parseResolution: (res: string) => { width: number; height: number };
    onSourceReady: (width: number, height: number, sourceType: string) => void;
    onError: (msg: string) => void;
}) {
    let webcamStream: MediaStream | null = null;
    let sourceType: string | null = null;
    let isPlaying = false;

    function stopWebcam() {
        if (webcamStream) {
            webcamStream.getTracks().forEach((t) => { t.stop(); });
            webcamStream = null;
        }
        videoPlayer.srcObject = null;
    }

    function loadVideoFile(file: File | null | undefined) {
        if (!file) return;
        stopWebcam();
        if (videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        videoPlayer.onloadedmetadata = () => {
            sourceType = 'video';
            isPlaying = false;
            onSourceReady(videoPlayer.videoWidth, videoPlayer.videoHeight, 'video');
        };
    }

    function startWebcam(resolutionStr: string, frameRate: number) {
        stopWebcam();
        // Feature-check before touching the API. `navigator.mediaDevices`
        // is undefined in privacy-restricted contexts (cross-origin iframe
        // without `allow="camera"`) and on insecure-context pages. #183.
        // (TS thinks navigator.mediaDevices is non-null but the DOM lib
        // types are optimistic — `in` check is honest about the runtime
        // reality.)
        if (!('mediaDevices' in navigator) || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            onError('Webcam not available in this browser context. Try uploading a video file instead.');
            return;
        }
        const res = parseResolution(resolutionStr);
        const constraints: MediaStreamConstraints = {
            video: { width: res.width, height: res.height, frameRate },
            audio: false,
        };
        void navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            webcamStream = stream;
            videoPlayer.srcObject = stream;
            void videoPlayer.play();
            const track = stream.getVideoTracks()[0];
            const settings = track?.getSettings() ?? {};
            sourceType = 'webcam';
            isPlaying = true;
            onSourceReady(settings.width ?? res.width, settings.height ?? res.height, 'webcam');
        }).catch((err: unknown) => {
            log.error('webcam-error', { error: err instanceof Error ? err.message : String(err) });
            onError(describeWebcamError(err));
        });
    }

    function playPause(): boolean {
        if (isPlaying) {
            videoPlayer.pause();
        } else {
            void videoPlayer.play();
        }
        isPlaying = !isPlaying;
        return isPlaying;
    }

    function dispose() {
        stopWebcam();
        if (videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        videoPlayer.src = '';
        videoPlayer.srcObject = null;
        // Drop the on-load closure so it doesn't keep references to
        // the tool's state alive across navigation. Issue #180.
        videoPlayer.onloadedmetadata = null;
    }

    return {
        loadVideoFile,
        startWebcam,
        stopWebcam,
        playPause,
        dispose,
        get sourceType() { return sourceType; },
        get isPlaying() { return isPlaying; },
    };
}
