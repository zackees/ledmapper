import { test, expect } from './fixtures.js';
import path from 'path';
import { readFileSync } from 'fs';

async function dropFixture(page, selector, fixturePath, fileName, mimeType) {
    const bytes = Array.from(readFileSync(fixturePath));
    const dataTransfer = await page.evaluateHandle(({ fileName, mimeType, bytes }) => {
        const transfer = new DataTransfer();
        const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType });
        transfer.items.add(file);
        return transfer;
    }, { fileName, mimeType, bytes });

    await page.dispatchEvent(selector, 'dragover', { dataTransfer });
    await page.dispatchEvent(selector, 'drop', { dataTransfer });
    await dataTransfer.dispose();
}

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

    test('screenmap can be dragged onto upload screenmap row', async ({ page }) => {
        await page.goto('/movieplayer/');
        await dropFixture(
            page,
            '#screenmap_drop_target',
            path.resolve('tests/fixtures/test-screenmap.json'),
            'test-screenmap.json',
            'application/json',
        );

        await expect(page.locator('#btn_load_movie')).toBeEnabled();
    });

    test('movie can be dragged onto upload video row after screenmap load', async ({ page }) => {
        await page.goto('/movieplayer/');
        await dropFixture(
            page,
            '#screenmap_drop_target',
            path.resolve('tests/fixtures/test-screenmap.json'),
            'test-screenmap.json',
            'application/json',
        );
        await expect(page.locator('#btn_load_movie')).toBeEnabled();

        await dropFixture(
            page,
            '#movie_drop_target',
            path.resolve('tests/fixtures/test-video.rgb'),
            'test-video.rgb',
            'application/octet-stream',
        );

        await expect(page.locator('#btn_play')).toBeEnabled();
        await expect(page.locator('#btn_play')).toHaveValue('Pause');
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

test.describe('Video Player screenmap presets', () => {
    test('renders preset buttons from manifest', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#preset_buttons [data-preset-file="16x16_grid.json"]')).toBeVisible();
        await expect(page.locator('#preset_buttons [data-preset-file="64x64_serpentine.json"]')).toBeVisible();
    });

    test('clicking a preset loads screenmap and enables movie upload', async ({ page }) => {
        await page.goto('/movieplayer/');
        const btn = page.locator('#preset_buttons [data-preset-file="16x16_grid.json"]');
        await btn.click();
        await expect(btn).toHaveClass(/active-preset/);
        await expect(page.locator('#btn_load_movie')).toBeEnabled();
    });

    test('preset selection persists across reload', async ({ page }) => {
        await page.goto('/movieplayer/');
        const btn = page.locator('#preset_buttons [data-preset-file="8x8_grid.json"]');
        await btn.click();
        await expect(btn).toHaveClass(/active-preset/);

        await page.reload();
        const btnAfter = page.locator('#preset_buttons [data-preset-file="8x8_grid.json"]');
        await expect(btnAfter).toHaveClass(/active-preset/);
        await expect(page.locator('#btn_load_movie')).toBeEnabled();
    });

    test('custom screenmap upload clears active preset', async ({ page }) => {
        await page.goto('/movieplayer/');
        const btn = page.locator('#preset_buttons [data-preset-file="16x16_grid.json"]');
        await btn.click();
        await expect(btn).toHaveClass(/active-preset/);

        await page.locator('#btn_upload_screenmap')
            .setInputFiles(path.resolve('tests/fixtures/test-screenmap.json'));
        await expect(btn).not.toHaveClass(/active-preset/);
    });
});
