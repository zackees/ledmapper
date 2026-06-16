/**
 * Video source management: file loading and webcam capture.
 */

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
            console.error('Webcam error:', err);
            onError(err instanceof Error ? err.message : String(err));
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
