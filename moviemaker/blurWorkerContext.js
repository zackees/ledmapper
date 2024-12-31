


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


function processPixels(pixels, gamm_val, bri_bias, shape_pts, width, height, gausianBlur) {
    const rgbPts = [];
    let avg_brightness = 0;
    const gamma = (v_u8) => { return Math.pow(v_u8/255., gamm_val) * 255; };
    shape_pts.forEach(([x, y]) => {
        x = Number.parseInt(x);
        y = Number.parseInt(y);
        const idx = (x + y * width) * 4;
        if (idx >= 0 && idx < pixels.length) {
            let [r, g, b] = gausianBlur.applyBlur(pixels, x, y, width, height);
            r = Number.parseInt(gamma(r) * bri_bias);
            g = Number.parseInt(gamma(g) * bri_bias);
            b = Number.parseInt(gamma(b) * bri_bias);
            rgbPts.push(r);
            rgbPts.push(g);
            rgbPts.push(b);
            const bri = r + b + g;
            // if not nan
            if (bri === bri) {
                avg_brightness += bri;
            }
        } else {
            rgbPts.push(0);
            rgbPts.push(0);
            rgbPts.push(0);
        }
    });
    return [rgbPts, avg_brightness];
}

// Assume Blur is some class that performs the blur operation
class BlurContext {
    // data only
    constructor(
        frameId, nowMicros, pixels, brightnessBias, gammaVal,
        width, height, pts, blurRadius, blurSigma
    ) {
        this.frameId = frameId;
        this.nowMicros = nowMicros;
        this.pixels = pixels;
        this.brightnessBias = brightnessBias;
        this.gammaVal = gammaVal;
        this.width = width;
        this.height = height;
        this.pts = pts;
        this.blurRadius = blurRadius;
        this.blurSigma = blurSigma;
    }
}

class OutputFrame {
    constructor(frameId, frameTime, rgbPts, pts, averageBrightness) {
        this.frameId = frameId;
        this.frameTime = frameTime;
        this.rgbPts = rgbPts;
        this.pts = pts;
        this.averageBrightness = averageBrightness;
    }
}