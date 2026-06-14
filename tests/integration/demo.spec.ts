import { test, expect } from './fixtures.ts';

test.describe('Demo Page', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/demo/');
        await expect(page.locator('h1')).toContainText('Demo');
    });

    test('has play button', async ({ page }) => {
        await page.goto('/demo/');
        const playBtn = page.locator('#btn_play');
        await expect(playBtn).toBeVisible();
    });

    test('has LED diameter slider', async ({ page }) => {
        await page.goto('/demo/');
        const slider = page.locator('#rng_diameter');
        await expect(slider).toBeVisible();
    });

    test('LED diameter slider updates display', async ({ page }) => {
        await page.goto('/demo/');
        const slider = page.locator('#rng_diameter');
        await slider.fill('12');
        await expect(page.locator('#txt_curr_diameter')).toHaveText('12');
    });

    test('canvas renders', async ({ page }) => {
        await page.goto('/demo/');
        // Wait for Three.js canvas to appear
        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('has download buttons', async ({ page }) => {
        await page.goto('/demo/');
        await expect(page.locator('#btn_download_screenmap')).toBeVisible();
        await expect(page.locator('#btn_download_video')).toBeVisible();
    });

    test('play button has correct initial label', async ({ page }) => {
        await page.goto('/demo/');
        const playBtn = page.locator('#btn_play');
        await expect(playBtn).toBeVisible();
        // Value may change after data loads, just check it exists
        await expect(playBtn).toHaveAttribute('value', /Play|Pause/);
    });
});
