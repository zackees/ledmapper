import { test, expect } from './fixtures.ts';
import path from 'path';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

/**
 * Regression guard for the "No Screenmap" recording failure: preset loads
 * (auto-loaded default and explicit chip clicks) only updated in-memory
 * state and never reached the localStorage store that recording read its
 * screenmap JSON from, so stopping a preset recording raised the error
 * dialog and discarded the captured frames. Uploaded screenmap files
 * worked, which is why the walkthrough only failed on the preset path.
 */

async function loadVideoAndPlay(page) {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-trigger="btn_load_video"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(VIDEO_PATH);
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
    await page.locator('#btn_play_pause').click();
    await page.waitForTimeout(500);
}

/** Record briefly and expect a .fled download (not the error dialog). */
async function recordExpectingDownload(page, durationMs = 1500) {
    const recordBtn = page.locator('#btn_toggle_record');
    await expect(recordBtn).toBeEnabled();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Stop Recording');
    await page.waitForTimeout(durationMs);
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Start Recording');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^video\d+\.fled$/);
    await expect(page.locator('.swal2-popup')).toHaveCount(0);
}

test.describe('Moviemaker preset recording (No Screenmap regression)', () => {
    test.skip(!!process.env.CI, 'WebGL recording tests require GPU, skipped in CI');

    test.beforeEach(async ({ page }) => {
        // Start from a clean slate so the default preset autoload path runs.
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:')) localStorage.removeItem(k);
                }
            } catch { /* ignore */ }
        });
    });

    test('records with the auto-loaded default preset', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');
        await loadVideoAndPlay(page);
        await expect(page.locator('.preset-btn[data-preset-file="16x16_grid.json"]'))
            .toHaveClass(/active-preset/);
        await recordExpectingDownload(page);
    });

    test('records after clicking a preset chip', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');
        await loadVideoAndPlay(page);
        await page.locator('.preset-btn[data-preset-file="8x8_grid.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="8x8_grid.json"]'))
            .toHaveClass(/active-preset/);
        await recordExpectingDownload(page);
    });
});
