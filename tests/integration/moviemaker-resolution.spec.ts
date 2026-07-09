import { test, expect } from './fixtures.ts';
import path from 'path';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { shouldSkipGpuTest, GPU_WAIT_SCALE } from '../helpers/gpu-gate.ts';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

/**
 * Wait for the moviemaker's Three.js renderer to be active.
 */
async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 * GPU_WAIT_SCALE });
}

function getCanvasSize(page) {
    return page.locator('#renderCanvas').evaluate(c => ({ w: c.width, h: c.height }));
}

test.describe('Moviemaker Resolution Control @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL tests require GPU, skipped in CI (set GPU_CI=1 to run)');

    test('resolution select exists with expected options', async ({ page }) => {
        await page.goto('/moviemaker/');
        const sel = page.locator('#sel_max_resolution');
        // Toolbar is hidden until a source is loaded; check element is attached
        await expect(sel).toBeAttached();
        // Default should be 480p
        await expect(sel).toHaveValue('480');
        // Check all options exist
        const options = sel.locator('option');
        await expect(options).toHaveCount(6);
    });

    test('video file canvas scales down when resolution is reduced', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video file via the welcome overlay button
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        // Set resolution to native after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('0');

        // Read native dimensions
        const native = await getCanvasSize(page);
        expect(native.w).toBeGreaterThan(0);
        expect(native.h).toBeGreaterThan(0);

        // Switch to 240p — should be smaller than native
        await page.locator('#sel_max_resolution').selectOption('240');
        const scaled = await getCanvasSize(page);
        const maxDim = Math.max(scaled.w, scaled.h);
        expect(maxDim).toBeLessThanOrEqual(240);
        expect(scaled.w).toBeLessThanOrEqual(native.w);
        expect(scaled.h).toBeLessThanOrEqual(native.h);

        // Aspect ratio should be preserved (within rounding)
        const nativeAspect = native.w / native.h;
        const scaledAspect = scaled.w / scaled.h;
        expect(Math.abs(nativeAspect - scaledAspect)).toBeLessThan(0.1);

        // Switch back to native — should restore original dimensions
        await page.locator('#sel_max_resolution').selectOption('0');
        const restored = await getCanvasSize(page);
        expect(restored.w).toBe(native.w);
        expect(restored.h).toBe(native.h);
    });

    test('resolution label shows current dimensions', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video, then set to native
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);
        await page.locator('#sel_max_resolution').selectOption('0');

        // Label should show dimensions
        const label = page.locator('#txt_curr_resolution');
        const text = await label.textContent();
        expect(text).toMatch(/\d+.*\d+/);

        // Change resolution and verify label updates
        await page.locator('#sel_max_resolution').selectOption('240');
        await expect(label).toContainText('240');
    });

    test('webcam canvas respects max resolution', async ({ page }) => {
        test.setTimeout(60000);
        await mockWebcam(page);
        await page.goto('/moviemaker/');

        // Start webcam first so toolbar becomes visible
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // Set to a small resolution after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('240');

        // Webcam mock is 480x480 — with max 240, should scale to 240x240
        const size = await getCanvasSize(page);
        expect(size.w).toBe(240);
        expect(size.h).toBe(240);
    });

    test('a full-resolution (Native) backing store cannot overflow and wedge the UI (#278)', async ({ page }) => {
        test.setTimeout(60000);
        await page.setViewportSize({ width: 1366, height: 768 });
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // The render canvas carries a DISPLAY-size cap (the #278 fix): its
        // rendered box is bounded even though the backing store may be full
        // native resolution. (Kept as a light source so the headless
        // SwiftShader nightly run isn't saturated by a live 4K render.)
        const css = await page.locator('#renderCanvas').evaluate((c) => {
            const s = getComputedStyle(c);
            return { maxWidth: s.maxWidth, maxHeight: s.maxHeight };
        });
        expect(css.maxWidth).not.toBe('none');
        expect(css.maxHeight).not.toBe('none');

        // Simulate a "Native" full-res backing store on a 4K source and confirm
        // the DISPLAYED box stays clamped within the viewport — pre-#278 it
        // rendered at full pixel size (3840x2160), overflowed `.app-layout`
        // (overflow:hidden), and the `items-center` centering shoved the
        // toolbar + resolution dropdown to negative offsets, unreachable.
        const measured = await page.locator('#renderCanvas').evaluate((c) => {
            const canvas = c as HTMLCanvasElement;
            canvas.width = 3840;
            canvas.height = 2160; // full native backing store (recording quality)
            const r = canvas.getBoundingClientRect();
            return { backW: canvas.width, backH: canvas.height, dispW: Math.round(r.width), dispH: Math.round(r.height) };
        });
        // Backing store is full native — recording quality is untouched.
        expect(measured.backW).toBe(3840);
        expect(measured.backH).toBe(2160);
        // Display is clamped to fit: width within the viewport, height within
        // the fold cap. A 3840-wide box would otherwise overflow 1366.
        expect(measured.dispW).toBeLessThanOrEqual(1366);
        expect(measured.dispH).toBeLessThanOrEqual(768);
        // And it actually scaled down (didn't stay at native pixel size).
        expect(measured.dispW).toBeLessThan(3840);
        expect(measured.dispH).toBeLessThan(2160);
    });

    test('default 480p limits large video canvas', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Default is 480p — load video and verify canvas is constrained
        await expect(page.locator('#sel_max_resolution')).toHaveValue('480');

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        const size = await getCanvasSize(page);
        const maxDim = Math.max(size.w, size.h);
        expect(maxDim).toBeLessThanOrEqual(480);
    });
});
