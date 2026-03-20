import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Mapped Video Maker', () => {
    test('loads page with upload prompt', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#btn_upload_shape')).toBeVisible();
    });

    test('has readme button', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#btn_how_to')).toBeVisible();
    });

    test('has video source buttons', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#btn_load_video')).toBeVisible();
        await expect(page.locator('#btn_start_webcam')).toBeVisible();
    });

    test('play button starts disabled', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#btn_play_pause')).toBeDisabled();
    });

    test('has blur slider controls', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#rng_blur')).toBeVisible();
        await expect(page.locator('#rng_blur_sigma')).toBeVisible();
    });

    test('blur slider is interactive', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        const slider = page.locator('#rng_blur');
        await expect(slider).toBeVisible();
        await expect(page.locator('#txt_curr_blur')).toBeVisible();
    });

    test('has brightness and gamma controls', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        await expect(page.locator('#rng_brightness')).toBeVisible();
        await expect(page.locator('#rng_gamma')).toBeVisible();
    });

    test('has recording button', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        const recordBtn = page.locator('#btn_toggle_record');
        await expect(recordBtn).toBeVisible();
        await expect(recordBtn).toHaveValue('Start Recording');
    });

    test('screenmap upload activates controls', async ({ page }) => {
        await page.goto('/moviemaker/index.html');
        const fileInput = page.locator('#btn_upload_shape');
        const fixturePath = path.resolve('tests/fixtures/test-screenmap.json');
        await fileInput.setInputFiles(fixturePath);
        // After uploading, controls should be enabled
        await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 });
    });
});
