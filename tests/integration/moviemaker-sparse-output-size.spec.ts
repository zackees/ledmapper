import { test, expect } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';
import { expandScreenmapBand } from '../helpers/screenmap-band.ts';

async function mockWhiteWebcam(page: Page) {
    await page.addInitScript(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 480, 480);
        const stream = canvas.captureStream(30);
        navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
    });
}

async function samplePreviewRgb(page: Page) {
    return page.evaluate(() => new Promise<{ r: number; g: number; b: number } | null>((resolve) => {
        requestAnimationFrame(() => {
            const canvas = document.querySelector('#previewPanel canvas');
            if (!(canvas instanceof HTMLCanvasElement)) { resolve(null); return; }
            const sample = document.createElement('canvas');
            sample.width = 32;
            sample.height = 32;
            const ctx = sample.getContext('2d');
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(canvas, 0, 0, 32, 32);
            const pixels = ctx.getImageData(0, 0, 32, 32).data;
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                r += pixels[i] ?? 0;
                g += pixels[i + 1] ?? 0;
                b += pixels[i + 2] ?? 0;
            }
            const count = pixels.length / 4;
            resolve({ r: r / count, g: g / count, b: b / count });
        });
    }));
}

async function loadWebcam(page: Page) {
    await page.goto('/record');
    await page.locator('[data-trigger="btn_start_webcam"]').click();
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15_000 });
}

test.describe('Moviemaker sparse output sizing @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL sizing tests require GPU, skipped in CI (set GPU_CI=1 to run)');

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('lm:')) localStorage.removeItem(key);
            }
        });
    });

    test('renders HydroPack shapes without synthetic anchor points', async ({ page }) => {
        test.setTimeout(60_000);
        await mockWhiteWebcam(page);
        await loadWebcam(page);
        await expandScreenmapBand(page);
        await page.locator('.preset-btn[data-preset-file="hydropack_el_shapes.json"]').evaluate((el: HTMLElement) => { el.click(); });

        await expect.poll(async () => page.evaluate(() => window.__lmDebug?.moviemaker?.getState())).toMatchObject({
            screenmapValid: true,
            ledCount: 0,
            stripCount: 3,
        });
        await expect.poll(async () => {
            const sample = await samplePreviewRgb(page);
            return sample ? Math.max(sample.r, sample.g, sample.b) : 0;
        }, { timeout: 15_000 }).toBeGreaterThan(3);

        const overlayPixels = await page.evaluate(() => {
            const canvas = document.querySelector('#overlayCanvas');
            if (!(canvas instanceof HTMLCanvasElement)) return 0;
            const ctx = canvas.getContext('2d');
            if (!ctx) return 0;
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let nonTransparent = 0;
            for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) nonTransparent++;
            return nonTransparent;
        });
        expect(overlayPixels).toBeGreaterThan(0);
    });

    test('keeps an undeclared three-point layout visible without spacing-sized dots', async ({ page }) => {
        test.setTimeout(60_000);
        await mockWhiteWebcam(page);
        await loadWebcam(page);
        await page.locator('#btn_upload_screenmap').setInputFiles({
            name: 'sparse.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ map: { sparse: { x: [-100, 0, 100], y: [0, 0, 0] } } })),
        });
        await expect.poll(async () => page.evaluate(() => window.__lmDebug?.moviemaker?.getState())).toMatchObject({
            screenmapValid: true,
            ledCount: 3,
            stripCount: 1,
        });
        await expect.poll(async () => {
            const sample = await samplePreviewRgb(page);
            return sample ? Math.max(sample.r, sample.g, sample.b) : 0;
        }, { timeout: 15_000 }).toBeGreaterThan(3);
    });
});
