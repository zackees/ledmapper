importScripts('blurWorkerContext.js');

let gGaussianBlur = new GaussianBlur(1, 1);


function blur(context) {
    const frameTime = context.nowMicros;
    const pixels = context.pixels;
    const width = context.width;
    const height = context.height;
    const brightnessBias = context.brightnessBias;
    const gammaVal = context.gammaVal;
    const pts = context.pts;
    gGaussianBlur.set(context.blurRadius, context.blurSigma);
    const frameId = context.frameId;
    // NOTE: averageBrightness is misnamed, it is actually the sum of the brightnesses.
    const [rgbPts, averageBrightness] = processPixels(
        pixels,
        gammaVal,
        brightnessBias,
        pts,
        width,
        height,
        gGaussianBlur
    );
    return new OutputFrame(frameId, frameTime, rgbPts, pts, averageBrightness);
}

class WorkerContext {
    postMessage(data, transfer) {
        self.postMessage(data, transfer);
    }
}

class BlurWorkerContext extends WorkerContext {
    constructor() {
        super();
    }

    onmessage(event) {
        const context = event.data.context;
        if (!context instanceof BlurContext) {
            throw new Error('Invalid context');s
        }
        const response = blur(context);
        this.postMessage(response);
    }
}

const worker = new BlurWorkerContext();
self.onmessage = worker.onmessage.bind(worker);
