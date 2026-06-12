import { test, expect } from './fixtures.js';
import path from 'path';

test.describe('Video Maker', () => {
    test('loads page with upload prompt', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#btn_upload_screenmap')).toBeVisible();
    });

    test('has readme button', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#btn_how_to')).toBeVisible();
    });

    test('has video source buttons', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
        await expect(page.locator('[data-trigger="btn_start_webcam"]')).toBeVisible();
    });

    test('play button starts hidden (no video loaded)', async ({ page }) => {
        await page.goto('/moviemaker/');
        // Video progress bar (containing play button) is hidden until a video is loaded
        await expect(page.locator('#video-progress')).not.toHaveClass(/visible/);
    });

    test('has blur slider controls', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#rng_blur')).toBeVisible();
        await expect(page.locator('#rng_blur_sigma')).toBeVisible();
    });

    test('blur slider is interactive', async ({ page }) => {
        await page.goto('/moviemaker/');
        const slider = page.locator('#rng_blur');
        await expect(slider).toBeVisible();
        await expect(page.locator('#txt_curr_blur')).toBeVisible();
    });

    test('has brightness and gamma controls', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#rng_brightness')).toBeVisible();
        await expect(page.locator('#rng_gamma')).toBeVisible();
    });

    test('has recording button', async ({ page }) => {
        await page.goto('/moviemaker/');
        const recordBtn = page.locator('#btn_toggle_record');
        // Toolbar is hidden until a video source is loaded
        await expect(recordBtn).toBeAttached();
        await expect(recordBtn).toHaveValue('Start Recording');
    });

    test('preview panel hosts a WebGL renderer canvas', async ({ page }) => {
        await page.goto('/moviemaker/');
        // The preview is now a Three.js points-mesh render; its WebGL canvas
        // is created at init inside the preview panel (panel stays hidden
        // until a source loads).
        const canvas = page.locator('#previewPanel canvas');
        await expect(canvas).toBeAttached();
        const isWebgl = await canvas.evaluate((el) =>
            !!(el.getContext('webgl2') || el.getContext('webgl')));
        expect(isWebgl).toBe(true);
    });

    test('screenmap upload activates controls', async ({ page }) => {
        await page.goto('/moviemaker/');
        const fileInput = page.locator('#btn_upload_screenmap');
        const fixturePath = path.resolve('tests/fixtures/test-screenmap.json');
        await fileInput.setInputFiles(fixturePath);
        // After uploading, controls should be enabled
        await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 });
    });
});
