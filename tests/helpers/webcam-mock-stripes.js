/**
 * Webcam mock with high-frequency alternating stripes.
 * Every pixel is near a color boundary, making blur always visible.
 */
export async function mockWebcamStripes(page) {
    await page.addInitScript(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');

        // Draw alternating black/white vertical stripes (5px wide)
        // With blur, sampling near stripe edges produces gray
        // Without blur, sampling gives pure black or white
        for (let x = 0; x < 480; x++) {
            ctx.fillStyle = (Math.floor(x / 5) % 2 === 0) ? '#ffffff' : '#000000';
            ctx.fillRect(x, 0, 1, 480);
        }

        const stream = canvas.captureStream(30);
        navigator.mediaDevices.getUserMedia = async () => stream;
    });
}
