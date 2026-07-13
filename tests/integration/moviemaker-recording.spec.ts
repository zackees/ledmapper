import { test, expect } from './fixtures.ts';
import path from 'path';
import fs from 'fs';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { mockWebcamStripes } from '../helpers/webcam-mock-stripes.ts';
import { shouldSkipGpuTest, GPU_WAIT_SCALE } from '../helpers/gpu-gate.ts';
import { countScreenmapLeds } from '../helpers/screenmap-count.ts';
import { expandScreenmapBand } from '../helpers/screenmap-band.ts';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');
const SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap.json');

// Read the screenmap to know LED count for validation. Fixtures are v2
// (top-level `segments` array, issue #144); the shared helper also counts
// v1 `map` objects from third-party files.
const SCREENMAP_LED_COUNT = countScreenmapLeds(JSON.parse(fs.readFileSync(SCREENMAP_PATH, 'utf-8')));

/**
 * Strip the FLED v1 header from a recorded buffer, returning just the
 * frame payload. See docs/fled-format.md for the layout.
 */
function fledPayload(data) {
    expect(data.length).toBeGreaterThan(12);
    expect(String.fromCharCode(data[0], data[1], data[2], data[3])).toBe('FLED');
    expect(data[4]).toBe(1); // version
    const jsonLength = data.readUInt32LE(8);
    return data.subarray(12 + jsonLength);
}

/**
 * Wait for the moviemaker's Three.js renderer to be active.
 * The welcome overlay hides once a source is loaded.
 */
async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 * GPU_WAIT_SCALE });
}

/**
 * Record for a given duration, then stop and return the downloaded file buffer.
 */
async function recordAndDownload(page, durationMs = 2000) {
    const recordBtn = page.locator('#btn_toggle_record');

    // Start recording
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 * GPU_WAIT_SCALE });
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Stop Recording');
    await expect(recordBtn).toHaveClass(/recording/);

    // Let frames accumulate
    await page.waitForTimeout(durationMs);

    // Stop recording â€” triggers .fled file download (FLED container with
    // embedded screenmap; see docs/fled-format.md)
    await recordBtn.click();
    await expect(recordBtn).toHaveValue('Start Recording');

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^video\d+\.fled$/);

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
test.describe('Moviemaker Recording Workflow @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL recording tests require GPU, skipped in CI (set GPU_CI=1 to run)');

    // The worker shares one browser context; earlier specs can leave a stored
    // screenmap via screenmap-store (e.g. the shapeeditor autosaves its default
    // shape when console-errors.spec visits it), which would suppress the
    // canonical default preset these tests assert. Clear it before each load.
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                localStorage.removeItem('lm:screenmap');
                localStorage.removeItem('lm:screenmap-preset');
                localStorage.removeItem('lm:screenmap-meta');
                localStorage.removeItem('lm:screenmap-backup');
                localStorage.removeItem('lm:screenmap-backup-meta');
            } catch { /* ignore */ }
        });
    });
    test.describe('Video file loading and recording', () => {
        test('loads video via file chooser, records, and downloads .fled', async ({ page }) => {
            test.setTimeout(60000);

            const errors = [];
            page.on('pageerror', err => errors.push(err.message));

            await page.goto('/moviemaker/');

            // Load video via file chooser (button creates dynamic <input type="file">)
            const fileChooserPromise = page.waitForEvent('filechooser');
            await page.locator('[data-trigger="btn_load_video"]').click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.setFiles(VIDEO_PATH);

            // Wait for video source to become active
            await waitForSourceActive(page);

            // Play the video
            await page.locator('#btn_play_pause').click();
            await expect(page.locator('#btn_play_pause')).toHaveAttribute('title', 'Pause');

            // Canonical 64x64 quad preset is selected by default (4096 LEDs).
            await expect(page.locator('.preset-btn[data-preset-file="64x64_quad_serpentine.json"]')).toHaveClass(/active-preset/);

            // Controls should be enabled (screenmap loaded by default)
            await expect(page.locator('#rng_blur')).toBeEnabled();
            await expect(page.locator('#btn_toggle_record')).toBeEnabled();

            // File sources take the OFFLINE every-frame path (#257): one
            // click renders the whole file deterministically and the
            // download fires on completion — no stop click.
            const downloadPromise = page.waitForEvent('download', { timeout: 45000 * GPU_WAIT_SCALE });
            await page.locator('#btn_toggle_record').click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toMatch(/^video\d+\.fled$/);
            await expect(page.locator('#btn_toggle_record')).toHaveValue('Start Recording');
            const savePath = path.join(
                await download.path() ? path.dirname(await download.path()) : '.',
                download.suggestedFilename(),
            );
            await download.saveAs(savePath);
            const data = fs.readFileSync(savePath);
            fs.unlinkSync(savePath);

            // Validate .fled: EXACTLY every source frame was captured
            // (test-video.mp4 = 60 frames @ 30 fps), and the detected fps
            // rides in the metadata.
            const payload = fledPayload(data);
            const bytesPerFrame = 4096 * 3;
            expect(payload.length % bytesPerFrame).toBe(0);
            expect(payload.length / bytesPerFrame).toBe(60);
            const jsonLength = data.readUInt32LE(8);
            const meta = JSON.parse(data.subarray(12, 12 + jsonLength).toString('utf-8'));
            expect(meta.video?.fps).toBe(30);

            // No JS errors
            expect(errors).toHaveLength(0);
        });
    });

    test.describe('Webcam recording', () => {
        test.beforeEach(async ({ page }) => {
            await mockWebcam(page);
        });

        test('records webcam feed and downloads valid .fled file', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');

            // Start webcam
            await page.locator('[data-trigger="btn_start_webcam"]').click();
            await waitForSourceActive(page);

            // Canonical 64x64 quad preset is active by default.
            await expect(page.locator('.preset-btn[data-preset-file="64x64_quad_serpentine.json"]')).toHaveClass(/active-preset/);
            await expect(page.locator('#btn_toggle_record')).toBeEnabled();

            // Record
            const data = await recordAndDownload(page, 2000);

            const payload = fledPayload(data);
            const bytesPerFrame = 4096 * 3;
            expect(payload.length).toBeGreaterThan(0);
            expect(payload.length % bytesPerFrame).toBe(0);
        });

        // SwiftShader cannot reliably complete this renderer/readback assertion;
        // keep it in the explicit local-only tier rather than nightly quarantine.
        test('max brightness limit clamps recorded output @gpu-heavy', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('[data-trigger="btn_start_webcam"]').click();
            await waitForSourceActive(page);

            await page.locator('#chk_limit_brightness').check();
            const maxBri = page.locator('#rng_max_brightness');
            await expect(maxBri).toBeEnabled();
            await maxBri.fill('50');
            await maxBri.dispatchEvent('input');
            await expect(page.locator('#txt_curr_max_bri')).toHaveText('50%');

            const data = await recordAndDownload(page, 1500);
            const payload = fledPayload(data);
            expect(payload.length).toBeGreaterThan(0);

            // 50% cap: subtraction clamp guarantees no channel exceeds ~128.
            // Scan the payload only — the JSON header contains '"' etc. and
            // would skew the max check.
            let maxByte = 0;
            for (const b of payload) maxByte = Math.max(maxByte, b);
            expect(maxByte).toBeLessThanOrEqual(130);
        });

        test('can switch presets and record with each @gpu-heavy', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('[data-trigger="btn_start_webcam"]').click();
            await waitForSourceActive(page);

            // Switch to 8x8 preset
            await expandScreenmapBand(page);
            await page.locator('.preset-btn[data-preset-file="8x8_grid.json"]').click();
            await expect(page.locator('.preset-btn[data-preset-file="8x8_grid.json"]')).toHaveClass(/active-preset/);

            const data = await recordAndDownload(page, 1500);

            const payload = fledPayload(data);
            const bytesPerFrame = 64 * 3; // 8x8 = 64 LEDs
            expect(payload.length).toBeGreaterThan(0);
            expect(payload.length % bytesPerFrame).toBe(0);
        });

        test('records with custom screenmap upload', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('[data-trigger="btn_start_webcam"]').click();
            await waitForSourceActive(page);

            // Upload custom screenmap (4 LEDs)
            await page.locator('#btn_upload_screenmap').setInputFiles(SCREENMAP_PATH);
            await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 * GPU_WAIT_SCALE });

            const data = await recordAndDownload(page, 1500);

            const payload = fledPayload(data);
            const bytesPerFrame = SCREENMAP_LED_COUNT * 3; // 4 LEDs Ã— 3 bytes
            expect(payload.length).toBeGreaterThan(0);
            expect(payload.length % bytesPerFrame).toBe(0);
        });

        test('records with multi-strip screenmap (frame size = total LED count)', async ({ page }) => {
            test.setTimeout(60000);

            await page.goto('/moviemaker/');
            await page.locator('[data-trigger="btn_start_webcam"]').click();
            await waitForSourceActive(page);

            // Upload multi-strip screenmap (4 + 3 = 7 LEDs total)
            const MULTI_PATH = path.resolve('tests/fixtures/test-screenmap-multi.json');
            const MULTI_TOTAL = countScreenmapLeds(JSON.parse(fs.readFileSync(MULTI_PATH, 'utf-8')));
            await page.locator('#btn_upload_screenmap').setInputFiles(MULTI_PATH);
            await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 * GPU_WAIT_SCALE });

            const data = await recordAndDownload(page, 1500);

            const payload = fledPayload(data);
            const bytesPerFrame = MULTI_TOTAL * 3; // 7 LEDs Ã— 3 bytes
            expect(payload.length).toBeGreaterThan(0);
            expect(payload.length % bytesPerFrame).toBe(0);
        });
    });

    // @gpu-heavy: two back-to-back recording sessions with a radius-50 GLSL
    // blur — under SwiftShader that's an enormous per-frame CPU convolution
    // and reliably kills the runner's renderer process (gpu-nightly run 3:
    // "GPU stall due to ReadPixels" → browser death). Local-run-only.
    test.describe('Blur affects recorded output @gpu-heavy', () => {
        // Use high-frequency stripe pattern so blur always produces visible changes
        test.beforeEach(async ({ page }) => {
            await mockWebcamStripes(page);
        });

        test('recording with blur produces different output than without blur', async ({ page }) => {
            test.setTimeout(90000);

            // Helper to set up a recording session from scratch
            async function setupAndRecord(pg, blurVal, sigmaVal, recordMs) {
                await pg.goto('/moviemaker/');
                await pg.locator('[data-trigger="btn_start_webcam"]').click();
                await waitForSourceActive(pg);

                await expandScreenmapBand(pg);
                await pg.locator('.preset-btn[data-preset-file="8x8_grid.json"]').click();
                await expect(pg.locator('.preset-btn[data-preset-file="8x8_grid.json"]')).toHaveClass(/active-preset/);

                const blur = pg.locator('#rng_blur');
                const sigma = pg.locator('#rng_blur_sigma');
                await blur.fill(String(blurVal));
                await blur.dispatchEvent('input');
                await sigma.fill(String(sigmaVal));
                await sigma.dispatchEvent('input');

                // Let settings take effect and a few frames render
                await pg.waitForTimeout(500);

                return await recordAndDownload(pg, recordMs);
            }

            // Record without blur
            const noBlurData = await setupAndRecord(page, 0, 0, 2000);

            // Record with heavy blur (high values for range inputs with step=1)
            const blurData = await setupAndRecord(page, 50, 50, 3000);

            // Both recordings should have valid data
            const noBlurPayload = fledPayload(noBlurData);
            const blurPayload = fledPayload(blurData);
            const bytesPerFrame = 64 * 3; // 8x8 = 64 LEDs
            expect(noBlurPayload.length).toBeGreaterThan(0);
            expect(noBlurPayload.length % bytesPerFrame).toBe(0);
            expect(blurPayload.length).toBeGreaterThan(0);
            expect(blurPayload.length % bytesPerFrame).toBe(0);

            // Compare first frame of each recording
            const noBlurFrame = noBlurPayload.subarray(0, bytesPerFrame);
            const blurFrame = blurPayload.subarray(0, bytesPerFrame);

            // Calculate per-pixel average difference across the frame
            let totalDiff = 0;
            for (let i = 0; i < bytesPerFrame; i++) {
                totalDiff += Math.abs(noBlurFrame[i] - blurFrame[i]);
            }
            const avgDiff = totalDiff / bytesPerFrame;

            // With 5px-wide B&W stripes, blur=3 should visibly smear the edges.
            // No-blur samples pure 0 or 255; blur samples a mix â†’ large difference.
            expect(avgDiff).toBeGreaterThan(1.0);
        });
    });
});
