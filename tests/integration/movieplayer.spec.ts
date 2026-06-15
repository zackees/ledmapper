import { test, expect } from './fixtures.ts';
import path from 'path';
import { dropFixture } from '../helpers/drag-drop.ts';

test.describe('Video Player', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('h1')).toContainText('Video Player');
    });

    test('has movie upload input', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toBeVisible();
    });

    test('movie upload only accepts .fled', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toHaveAttribute('accept', '.fled');
    });

    test('no separate screenmap upload affordance', async ({ page }) => {
        await page.goto('/movieplayer/');
        // The screenmap arrives embedded in the .fled file; there is no
        // sidecar JSON upload in this player anymore.
        await expect(page.locator('#btn_upload_screenmap')).toHaveCount(0);
        await expect(page.locator('#preset_buttons')).toHaveCount(0);
    });

    test('has LED diameter slider', async ({ page }) => {
        await page.goto('/movieplayer/');
        const slider = page.locator('#rng_diameter');
        await expect(slider).toBeVisible();
        await expect(slider).toHaveValue('6');
    });

    test('loading a .fled file populates the scene from the embedded screenmap', async ({ page }) => {
        await page.goto('/movieplayer/');
        await page.locator('#btn_load_movie')
            .setInputFiles(path.resolve('tests/fixtures/test-video.fled'));
        // Canvas renders once the embedded screenmap is applied + frames sliced.
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#screenmap_status')).toContainText('4 LEDs');
        await expect(page.locator('#btn_play')).toBeEnabled();
    });

    test('.fled can be dropped onto the movie drop target', async ({ page }) => {
        await page.goto('/movieplayer/');
        await dropFixture(
            page,
            '#movie_drop_target',
            path.resolve('tests/fixtures/test-video.fled'),
            'test-video.fled',
            'application/octet-stream',
        );
        await expect(page.locator('#btn_play')).toBeEnabled();
        await expect(page.locator('#btn_play')).toHaveValue('Pause');
    });

    test('headerless legacy .rgb files are rejected', async ({ page }) => {
        await page.goto('/movieplayer/');
        // Force-load a pre-FLED file via the (now `.fled`-only) input;
        // movieplayer should alert and refuse to play.
        page.on('dialog', (d) => { void d.accept(); });
        await page.locator('#btn_load_movie')
            .setInputFiles(path.resolve('tests/fixtures/test-video.rgb'));
        // Play button stays disabled because the load was rejected.
        await expect(page.locator('#btn_play')).toBeDisabled();
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

    test('record button exists', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_record')).toBeVisible();
        await expect(page.locator('#btn_record')).toHaveValue('Record');
    });

    test('record button toggles and downloads a video', async ({ page }) => {
        await page.goto('/movieplayer/');
        await page.locator('#btn_load_movie')
            .setInputFiles(path.resolve('tests/fixtures/test-video.fled'));
        await expect(page.locator('#btn_play')).toBeEnabled();

        const record = page.locator('#btn_record');
        await record.click();
        await expect(record).toHaveValue('Stop');
        await expect(record).toHaveClass(/recording/);

        // Capture a short clip, then stop — toggling off must fire a download.
        await page.waitForTimeout(400);
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
        await record.click();
        await expect(record).toHaveValue('Record');
        await expect(record).not.toHaveClass(/recording/);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/ledmapper-recording\d+\.(webm|mp4)/);
    });
});
