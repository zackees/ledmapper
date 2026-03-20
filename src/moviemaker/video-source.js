/**
 * Video source management: file loading and webcam capture.
 */

/**
 * Create a video source manager.
 *
 * @param {Object} opts
 * @param {HTMLVideoElement} opts.videoPlayer - The shared video element.
 * @param {function(string): {width:number, height:number}} opts.parseResolution
 * @param {function(number, number, string): void} opts.onSourceReady - Called with (width, height, sourceType) when source is ready.
 * @param {function(string): Promise<void>} opts.onError - Called with error message.
 * @returns {Object} Video source API
 */
export function createVideoSource({ videoPlayer, parseResolution, onSourceReady, onError }) {
    let webcamStream = null;
    let sourceType = null;
    let isPlaying = false;

    function stopWebcam() {
        if (webcamStream) {
            webcamStream.getTracks().forEach(t => t.stop());
            webcamStream = null;
        }
        videoPlayer.srcObject = null;
    }

    /**
     * Load a video file from a file input event.
     *
     * @param {File} file
     */
    function loadVideoFile(file) {
        if (!file) return;
        stopWebcam();
        if (videoPlayer.src && videoPlayer.src.startsWith('blob:')) {
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

    /**
     * Start webcam capture with given constraints.
     *
     * @param {string} resolutionStr - e.g. "640x480"
     * @param {number} frameRate
     */
    function startWebcam(resolutionStr, frameRate) {
        stopWebcam();
        const res = parseResolution(resolutionStr);
        const constraints = {
            video: { width: res.width, height: res.height, frameRate },
            audio: false,
        };
        navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            webcamStream = stream;
            videoPlayer.srcObject = stream;
            videoPlayer.play();
            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings();
            sourceType = 'webcam';
            isPlaying = true;
            onSourceReady(settings.width || res.width, settings.height || res.height, 'webcam');
        }).catch(async err => {
            console.error('Webcam error:', err);
            onError(err.message);
        });
    }

    function playPause() {
        if (isPlaying) {
            videoPlayer.pause();
        } else {
            videoPlayer.play();
        }
        isPlaying = !isPlaying;
        return isPlaying;
    }

    function dispose() {
        stopWebcam();
        if (videoPlayer.src && videoPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoPlayer.src);
        }
        videoPlayer.src = '';
        videoPlayer.srcObject = null;
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
