import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { mockWebcam } from '../helpers/webcam-mock.js';
import { mockWebcamStripes } from '../helpers/webcam-mock-stripes.js';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');
const SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap.json');

// Read the screenmap to know LED count for validation
const screenmap = JSON.parse(fs.readFileSync(SCREENMAP_PATH, 'utf-8'));
const SCREENMAP_LED_COUNT = Object.values(screenmap.map)
    .reduce((sum, strip) => sum + strip.x.length, 0);

/**
 * Wait for the moviemaker's Three.js renderer to be active.
 * The welcome overlay hides once a source is loaded.
 */
async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
}

/**
 * Record for a given duration, then stop and return the downloaded file buffer.
 */
async function recordAndDownload(page, durationMs = 2000) {
    const recordBtn = page.locator('#btn_toggle_record');

    // Start recording
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Stop Recording');
    await expect(recordBtn).toHaveClass(/recording/);

    // Let frames accumulate
    await page.waitForTimeout(durationMs);

    // Stop recording — triggers .rgb file download
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Start Recording');

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^video\d+\.rgb$/);

    // Save to temp path and read bytes
    const savePath = path.join(
        await download.path() ? path.dirname(await download.path()) : '.',
        download.suggestedFilename()
    );
    await download.saveAs(savePath);
    const data = fs.readFileSync(savePath);
    // Clean up temp file
    fs.unlinkSync(savePath);
    return data;
}

// WebGL recording doesn't work in headless CI Chromium (no GPU)
test.describe('Moviemaker Recording Workflow', () => {
    test.skip(!!process.env.CI, 'WebGL recording tests require GPU, skipped in CI');
    test.describe('Video file loading and recording', () => {
        test('loads video via file chooser, records, and downloads .rgb', async ({ page }) => {
            test.setTimeout(60000);

            const errors = [];
            page.on('pageerror', err => errors.push(err.message));

            await page.goto('/moviemaker/');

            // Load video via file chooser (button creates dynamic <input type="file">)
            const fileChooserPromise = page.waitForEvent('filechooser');
            await page.locator('#btn_load_video').click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(VIDEO_PATH);

            // Wait for video source to become active
            await waitForSourceActive(page);

            // Play the video
            await page.locator('#btn_play_pause').click();
            await expect(page.locator('#btn_play_pause')).toContainText('Pause');

            // 16x16 preset is selected by default (256 LEDs)
            await expect(page.locator('#btn_preset_16x16')).toHaveClass(/active-preset/);

            // Controls should be enabled (shape loaded by default)
            await expect(page.locator('#rng_blur')).toBeEnabled();
            await expect(page.locator('#btn_toggle_record')).toBeEnabled();

            // Record for 2 seconds
            const data = await recordAndDownload(page, 2000);

            // Validate .rgb file: must have data, and be a multiple of (ledCount * 3)
            expect(data.length).toBeGreaterThan(0);
            const bytesPerFrame = 256 * 3; // 16x16 grid = 256 LEDs, 3 bytes each
            expect(data.length % bytesPerFrame).toBe(0);

            const frameCount = data.length / bytesPerFrame;
            expect(frameCount).toBeGreaterThanOrEqual(1);

            // No JS errors
            expect(errors).toHaveLength(0);
        });
    });

    test.describe('Webcam recording', () => {
        test.beforeEach(async ({ page }) => {
            await mockWebcam(page);
        });

        test('records webcam feed and downloads valid .rgb file', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');

            // Start webcam
            await page.locator('#btn_start_webcam').click();
            await waitForSourceActive(page);

            // 16x16 preset is active by default
            await expect(page.locator('#btn_preset_16x16')).toHaveClass(/active-preset/);
            await expect(page.locator('#btn_toggle_record')).toBeEnabled();

            // Record
            const data = await recordAndDownload(page, 2000);

            const bytesPerFrame = 256 * 3;
            expect(data.length).toBeGreaterThan(0);
            expect(data.length % bytesPerFrame).toBe(0);
        });

        test('can switch presets and record with each', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('#btn_start_webcam').click();
            await waitForSourceActive(page);

            // Switch to 8x8 preset
            await page.locator('#btn_preset_8x8').click();
            await expect(page.locator('#btn_preset_8x8')).toHaveClass(/active-preset/);

            const data = await recordAndDownload(page, 1500);

            const bytesPerFrame = 64 * 3; // 8x8 = 64 LEDs
            expect(data.length).toBeGreaterThan(0);
            expect(data.length % bytesPerFrame).toBe(0);
        });

        test('records with custom screenmap upload', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('#btn_start_webcam').click();
            await waitForSourceActive(page);

            // Upload custom screenmap (4 LEDs)
            await page.locator('#btn_upload_shape').setInputFiles(SCREENMAP_PATH);
            await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 });

            const data = await recordAndDownload(page, 1500);

            const bytesPerFrame = SCREENMAP_LED_COUNT * 3; // 4 LEDs × 3 bytes
            expect(data.length).toBeGreaterThan(0);
            expect(data.length % bytesPerFrame).toBe(0);
        });
    });

    test.describe('Blur affects recorded output', () => {
        // Use high-frequency stripe pattern so blur always produces visible changes
        test.beforeEach(async ({ page }) => {
            await mockWebcamStripes(page);
        });

        test('recording with blur produces different output than without blur', async ({ page }) => {
            test.setTimeout(90000);

            // Helper to set up a recording session from scratch
            async function setupAndRecord(pg, blurVal, sigmaVal, recordMs) {
                await pg.goto('/moviemaker/');
                await pg.locator('#btn_start_webcam').click();
                await waitForSourceActive(pg);

                await pg.locator('#btn_preset_8x8').click();
                await expect(pg.locator('#btn_preset_8x8')).toHaveClass(/active-preset/);

                const blur = pg.locator('#rng_blur');
                const sigma = pg.locator('#rng_blur_sigma');
                await blur.fill(String(blurVal));
                await blur.dispatchEvent('input');
                await sigma.fill(String(sigmaVal));
                await sigma.dispatchEvent('input');

                // Let settings take effect and a few frames render
                await pg.waitForTimeout(1000);

                return await recordAndDownload(pg, recordMs);
            }

            // Record without blur
            const noBlurData = await setupAndRecord(page, 0, 0.1, 2000);

            // Record with moderate blur (radius=3 is enough for 5px-wide stripes)
            const blurData = await setupAndRecord(page, 3, 2, 3000);

            // Both recordings should have valid data
            const bytesPerFrame = 64 * 3; // 8x8 = 64 LEDs
            expect(noBlurData.length).toBeGreaterThan(0);
            expect(noBlurData.length % bytesPerFrame).toBe(0);
            expect(blurData.length).toBeGreaterThan(0);
            expect(blurData.length % bytesPerFrame).toBe(0);

            // Compare first frame of each recording
            const noBlurFrame = noBlurData.slice(0, bytesPerFrame);
            const blurFrame = blurData.slice(0, bytesPerFrame);

            // Calculate per-pixel average difference across the frame
            let totalDiff = 0;
            for (let i = 0; i < bytesPerFrame; i++) {
                totalDiff += Math.abs(noBlurFrame[i] - blurFrame[i]);
            }
            const avgDiff = totalDiff / bytesPerFrame;

            // With 5px-wide B&W stripes, blur=3 should visibly smear the edges.
            // No-blur samples pure 0 or 255; blur samples a mix → large difference.
            expect(avgDiff).toBeGreaterThan(1.0);
        });
    });
});
