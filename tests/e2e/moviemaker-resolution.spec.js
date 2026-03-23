import { test, expect } from './fixtures.js';
import path from 'path';
import { mockWebcam } from '../helpers/webcam-mock.js';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

/**
 * Wait for the moviemaker's Three.js renderer to be active.
 */
async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
}

function getCanvasSize(page) {
    return page.locator('#renderCanvas').evaluate(c => ({ w: c.width, h: c.height }));
}

test.describe('Moviemaker Resolution Control', () => {
    test.skip(!!process.env.CI, 'WebGL tests require GPU, skipped in CI');

    test('resolution select exists with expected options', async ({ page }) => {
        await page.goto('/moviemaker/');
        const sel = page.locator('#sel_max_resolution');
        // Toolbar is hidden until a source is loaded; check element is attached
        await expect(sel).toBeAttached();
        // Default should be 480p
        await expect(sel).toHaveValue('480');
        // Check all options exist
        const options = sel.locator('option');
        await expect(options).toHaveCount(6);
    });

    test('video file canvas scales down when resolution is reduced', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video file via the welcome overlay button
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        // Set resolution to native after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('0');

        // Read native dimensions
        const native = await getCanvasSize(page);
        expect(native.w).toBeGreaterThan(0);
        expect(native.h).toBeGreaterThan(0);

        // Switch to 240p — should be smaller than native
        await page.locator('#sel_max_resolution').selectOption('240');
        const scaled = await getCanvasSize(page);
        const maxDim = Math.max(scaled.w, scaled.h);
        expect(maxDim).toBeLessThanOrEqual(240);
        expect(scaled.w).toBeLessThanOrEqual(native.w);
        expect(scaled.h).toBeLessThanOrEqual(native.h);

        // Aspect ratio should be preserved (within rounding)
        const nativeAspect = native.w / native.h;
        const scaledAspect = scaled.w / scaled.h;
        expect(Math.abs(nativeAspect - scaledAspect)).toBeLessThan(0.1);

        // Switch back to native — should restore original dimensions
        await page.locator('#sel_max_resolution').selectOption('0');
        const restored = await getCanvasSize(page);
        expect(restored.w).toBe(native.w);
        expect(restored.h).toBe(native.h);
    });

    test('resolution label shows current dimensions', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video, then set to native
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);
        await page.locator('#sel_max_resolution').selectOption('0');

        // Label should show dimensions
        const label = page.locator('#txt_curr_resolution');
        const text = await label.textContent();
        expect(text).toMatch(/\d+.*\d+/);

        // Change resolution and verify label updates
        await page.locator('#sel_max_resolution').selectOption('240');
        await expect(label).toContainText('240');
    });

    test('webcam canvas respects max resolution', async ({ page }) => {
        test.setTimeout(60000);
        await mockWebcam(page);
        await page.goto('/moviemaker/');

        // Start webcam first so toolbar becomes visible
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // Set to a small resolution after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('240');

        // Webcam mock is 480x480 — with max 240, should scale to 240x240
        const size = await getCanvasSize(page);
        expect(size.w).toBe(240);
        expect(size.h).toBe(240);
    });

    test('default 480p limits large video canvas', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Default is 480p — load video and verify canvas is constrained
        await expect(page.locator('#sel_max_resolution')).toHaveValue('480');

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        const size = await getCanvasSize(page);
        const maxDim = Math.max(size.w, size.h);
        expect(maxDim).toBeLessThanOrEqual(480);
    });
});
