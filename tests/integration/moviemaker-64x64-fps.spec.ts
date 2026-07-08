import { test, expect } from './fixtures.ts';
import fs from 'fs';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';

// Regression guard for issue #8: recording through a 64x64 screenmap used to
// drop the render loop to ~43fps (synchronous full-res gl.readPixels each
// frame). Fixed via a GPU gather pass + async readback; recording must now
// hold ~60fps regardless of LED count. Uses a real video file (not committed
// to the repo), so the test skips when the file is absent (e.g. CI).
const VIDEO_PATH = process.env.FPS_REPRO_VIDEO ?? 'E:\\video\\color_bubble_swirl.mp4';

async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
}

/**
 * Measure the page's requestAnimationFrame rate over a window.
 * The moviemaker render loop is rAF-driven, so main-thread saturation
 * from readback/sampling/overlay drawing shows up directly here.
 */
function measureFps(page, windowMs = 4000) {
    return page.evaluate((ms) => new Promise((resolve) => {
        let count = 0;
        const start = performance.now();
        function tick() {
            count++;
            const elapsed = performance.now() - start;
            if (elapsed < ms) {
                requestAnimationFrame(tick);
            } else {
                resolve(count / (elapsed / 1000));
            }
        }
        requestAnimationFrame(tick);
    }), windowMs);
}

async function loadVideoAndPreset(page, presetSelector) {
    await page.goto('/moviemaker/');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[data-trigger="btn_load_video"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(VIDEO_PATH);
    await waitForSourceActive(page);

    await page.locator(presetSelector).click();
    await expect(page.locator(presetSelector)).toHaveClass(/active-preset/);

    // Start playback so frames flow continuously
    await page.locator('#btn_play_pause').click();
}

async function measureRecordingFps(page, presetSelector) {
    await loadVideoAndPreset(page, presetSelector);

    const recordBtn = page.locator('#btn_toggle_record');
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Stop Recording');

    // Let the pipeline reach steady state before measuring
    await page.waitForTimeout(500);
    const fps = await measureFps(page, 4000);

    await recordBtn.click();
    await downloadPromise;
    return fps;
}

test.describe('Moviemaker 64x64 recording framerate @gpu @gpu-perf', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL recording requires GPU, skipped in CI (set GPU_CI=1 to run)');
    test.skip(!fs.existsSync(VIDEO_PATH), `repro video not found: ${VIDEO_PATH}`);

    test('recording through 64x64 screenmap holds 60fps (within jitter)', async ({ page }) => {
        test.setTimeout(120000);

        // Headless SwiftShader caps at ~6fps regardless of LED count, which
        // would mask the regression â€” only meaningful headed with a real GPU.
        await page.goto('/moviemaker/');
        const ua = await page.evaluate(() => navigator.userAgent);
        test.skip(/headless/i.test(ua), 'requires headed browser with real GPU (run with --headed)');

        const fps8 = await measureRecordingFps(page, '.preset-btn[data-preset-file="8x8_grid.json"]');
        const fps64 = await measureRecordingFps(page, '.preset-btn[data-preset-file="64x64_serpentine.json"]');

        console.log(`Recording FPS â€” 8x8 (64 LEDs): ${fps8.toFixed(1)}, 64x64 (4096 LEDs): ${fps64.toFixed(1)}`);

        // Issue #8 fixed: 64x64 recording holds 60fps within measurement jitter
        expect(fps64).toBeGreaterThanOrEqual(55);
        expect(fps8).toBeGreaterThanOrEqual(55);
    });
});
