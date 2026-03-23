import { test, expect } from './fixtures.js';
import path from 'path';

test.describe('Video Player', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('h1')).toContainText('Video Player');
    });

    test('has screenmap upload input', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_upload_screenmap')).toBeVisible();
    });

    test('has movie upload input', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toBeVisible();
    });

    test('has LED diameter slider', async ({ page }) => {
        await page.goto('/movieplayer/');
        const slider = page.locator('#rng_diameter');
        await expect(slider).toBeVisible();
        await expect(slider).toHaveValue('6');
    });

    test('screenmap upload enables movie upload flow', async ({ page }) => {
        await page.goto('/movieplayer/');
        const fileInput = page.locator('#btn_upload_screenmap');
        const fixturePath = path.resolve('tests/fixtures/test-screenmap.json');
        await fileInput.setInputFiles(fixturePath);
        // Canvas should render after screenmap upload
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('play button exists', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_play')).toBeVisible();
    });

    test('LED diameter slider updates display', async ({ page }) => {
        await page.goto('/movieplayer/');
        const slider = page.locator('#rng_diameter');
        await slider.fill('15');
        await expect(page.locator('#txt_curr_diameter')).toHaveText('15');
    });
});
