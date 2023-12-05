importScripts('blurWorkerContext.js');


function gaussianBlur(pixels, x, y, width, height) {
    if (radius == 0 || sigma == 0) {
        return [
            pixels[(x + y * width) * 4 + 0],
            pixels[(x + y * width) * 4 + 1],
            pixels[(x + y * width) * 4 + 2]
        ];
    }
    const kernelSize = kernel.length;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let weightSum = 0;

    for (let yy = -radius; yy <= radius; yy++) {
        for (let xx = -radius; xx <= radius; xx++) {
            const xi = x + xx;
            const yi = y + yy;

            if (xi >= 0 && yi >= 0 && xi < width && yi < height) {
                const idx = (xi + yi * width) * 4;
                const r = pixels[idx + 0];
                const g = pixels[idx + 1];
                const b = pixels[idx + 2];

                const weight = kernel[yy + radius][xx + radius];

                rSum += r * weight;
                gSum += g * weight;
                bSum += b * weight;
                weightSum += weight;
            }
        }
    }

    return [
        rSum / weightSum,
        gSum / weightSum,
        bSum / weightSum
    ];
}

function blur(context) {
    const pixels = context.pixels;
    const width = context.width;
    const height = context.height;
    const brightnessBias = context.brightnessBias;
    const gammaVal = context.gammaVal;
    const pts = context.pts;

    // debugger;

    let gb = new GaussianBlur(context.blurRadius, context.blurSigma);
    const [color_pts, ab] = processPixels(
        pixels,
        gammaVal,
        brightnessBias,
        pts,
        width,
        height,
        gb
    );

    return new BlurOutput();
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
