


class GaussianBlur {
    constructor(radius, sigma) {
        this.radius = radius;
        this.sigma = sigma;
        this.kernel = this.generateKernel(radius, sigma);
    }

    set(radius, sigma) {
        if (this.radius === radius && this.sigma === sigma) {
            return;
        }
        this.radius = radius;
        this.sigma = sigma;
        this.kernel = this.generateKernel(radius, sigma);
    }

    generateKernel(radius, sigma) {
        const kernelSize = 2 * radius + 1;
        let kernel = new Array(kernelSize).fill().map(() => new Array(kernelSize).fill(0));
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

    applyBlur(pixels, x, y, width, height) {
        if (this.radius === 0 || this.sigma === 0) {
            return [
                pixels[(x + y * width) * 4 + 0],
                pixels[(x + y * width) * 4 + 1],
                pixels[(x + y * width) * 4 + 2]
            ];
        }

        let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
        for (let yy = -this.radius; yy <= this.radius; yy++) {
            for (let xx = -this.radius; xx <= this.radius; xx++) {
                const xi = x + xx;
                const yi = y + yy;

                if (xi >= 0 && yi >= 0 && xi < width && yi < height) {
                    const idx = (xi + yi * width) * 4;
                    const r = pixels[idx + 0];
                    const g = pixels[idx + 1];
                    const b = pixels[idx + 2];

                    const weight = this.kernel[yy + this.radius][xx + this.radius];

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

// Assume Blur is some class that performs the blur operation
class BlurContext {
    // data only
    constructor(frame_id, gaussianBlur) {
        this.frame_id = frame_id;
        this.gaussianBlur = gaussianBlur;
    }
}
