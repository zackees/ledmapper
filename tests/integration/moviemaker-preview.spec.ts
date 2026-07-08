import { test, expect } from './fixtures.ts';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';

/**
 * Regression guard for the permanently-black LED preview pane (#221 item 1).
 *
 * Root cause: preview.render() skipped the per-frame color copy whenever the
 * same rgbPts reference arrived twice — but moviemaker reuses ONE sample
 * buffer and rewrites it in place, so the reference never changed and the
 * colors froze at the first sampled frame (video frame 0, typically black).
 *
 * The webcam source injected here deliberately starts BLACK and then cycles
 * solid red → green: under the old bug the preview freezes on the black
 * first frame and never lights up; the fixed preview must go bright and
 * change hue as the source cycles.
 */

async function mockColorCycleWebcam(page) {
    await page.addInitScript(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const t0 = performance.now();
        function paint() {
            const t = (performance.now() - t0) / 1000;
            // 0-1s black (the frame the frozen-copy bug latches onto),
            // then alternate 2s red / 2s green forever.
            let fill = '#000';
            if (t > 1) fill = (Math.floor((t - 1) / 2) % 2 === 0) ? '#f00' : '#0f0';
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, 480, 480);
            requestAnimationFrame(paint);
        }
        paint();
        const stream = canvas.captureStream(30);
        navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
    });
}

/**
 * Mean RGB of the preview canvas, sampled inside a requestAnimationFrame
 * callback. The preview renderer has preserveDrawingBuffer: false, so the
 * WebGL back buffer is only readable in the same task that rendered it —
 * our RAF callback is registered after the app's (the app re-registers at
 * the end of each tick), so it runs post-render within the same frame.
 */
function samplePreviewRgb(page) {
    return page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => {
            const canvas = document.querySelector('#previewPanel canvas');
            if (!(canvas instanceof HTMLCanvasElement)) { resolve(null); return; }
            const t = document.createElement('canvas');
            t.width = 32; t.height = 32;
            const ctx = t.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(canvas, 0, 0, 32, 32);
            const d = ctx.getImageData(0, 0, 32, 32).data;
            let r = 0, g = 0, b = 0;
            const n = d.length / 4;
            for (let i = 0; i < d.length; i += 4) {
                r += d[i]; g += d[i + 1]; b += d[i + 2];
            }
            resolve({ r: r / n, g: g / n, b: b / n });
        });
    }));
}

test.describe('Moviemaker LED preview pane @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL preview requires GPU, skipped in CI (set GPU_CI=1 to run)');

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:')) localStorage.removeItem(k);
                }
            } catch { /* ignore */ }
        });
    });

    test('preview lights up and tracks the source colors (not frozen at first frame)', async ({ page }) => {
        test.setTimeout(60000);
        await mockColorCycleWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        // Source starts black; give the gather pipeline a moment to produce
        // its first (black) sample — the exact frame the old bug froze on.
        await page.waitForTimeout(800);

        // The source then cycles red/green. The preview must go bright...
        await expect.poll(async () => {
            const s = await samplePreviewRgb(page);
            return s ? Math.max(s.r, s.g, s.b) : 0;
        }, { timeout: 15000, intervals: [250] }).toBeGreaterThan(3);

        // ...and its dominant hue must FLIP between the red and green phases
        // — the strongest possible signal that per-frame color updates flow
        // (frozen colors keep one hue forever, whatever the iris does).
        const seen = { red: false, green: false };
        await expect.poll(async () => {
            const s = await samplePreviewRgb(page);
            if (s && Math.max(s.r, s.g, s.b) > 3) {
                if (s.r > s.g * 2) seen.red = true;
                if (s.g > s.r * 2) seen.green = true;
            }
            return seen.red && seen.green;
        }, { timeout: 15000, intervals: [300] }).toBe(true);
    });
});
