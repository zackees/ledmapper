/**
 * Injects a fake webcam stream via page.addInitScript().
 * Creates a canvas-based MediaStream with a test color pattern.
 */
export async function mockWebcam(page) {
    await page.addInitScript(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');

        // Draw a test pattern
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 480, 480);
        ctx.fillStyle = '#f00';
        ctx.fillRect(100, 100, 80, 80);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(200, 200, 80, 80);
        ctx.fillStyle = '#00f';
        ctx.fillRect(300, 300, 80, 80);

        const stream = canvas.captureStream(30);

        navigator.mediaDevices.getUserMedia = async () => stream;
    });
}
