
// Assume Blur is some class that performs the blur operation
class BlurContext {
    // data only
    constructor(gaussionSigma, gaussionRadius) {
        this.gaussionSigma = gaussionSigma;
        this.gaussionRadius = gaussionRadius;
        this.kernel = gaussianKernel(radius, sigma);
    }

}

function gaussianKernel(radius, sigma) {
    const kernelSize = 2 * radius + 1;
    let kernel = Array(kernelSize).fill().map(() => Array(kernelSize).fill(0));
    let sum = 0;

    for (let y = -radius; y <= radius; y++) {
        for (let x = -radius; x <= radius; x++) {
            const value = (1 / (2 * Math.PI * sigma * sigma)) * Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
            kernel[y + radius][x + radius] = value;
            sum += value;
        }
    }
    // Normalize the kernel
    for (let y = 0; y < kernelSize; y++) {
        for (let x = 0; x < kernelSize; x++) {
            kernel[y][x] /= sum;
        }
    }
    return kernel;
}