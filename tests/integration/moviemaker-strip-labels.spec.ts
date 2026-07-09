import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { shouldSkipGpuTest, GPU_WAIT_SCALE } from '../helpers/gpu-gate.ts';

/**
 * Issue #280: the per-strip Start/End labels (Startq0, Endq1, …) clutter the
 * /record preview on dense multi-strip maps, so the moviemaker overlay draws
 * them OFF by default, toggleable via a toolbar "Labels" checkbox. The other
 * tools draw their own labels and are unaffected.
 *
 * @gpu: needs a live source (WebGL pipeline) so the overlay actually renders.
 */
test.describe('Moviemaker strip-label toggle (#280) @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL tests require GPU, skipped in CI (set GPU_CI=1 to run)');

    // Count non-transparent overlay pixels OUTSIDE the top-left HUD box (which
    // carries the render/fps text that changes every frame). The LED rings are
    // rendered from a cached layer and are pixel-stable frame to frame, so the
    // only thing that moves this number is the Start/End label text.
    function overlayLabelPixels(page) {
        return page.evaluate(() => {
            const c = document.querySelector<HTMLCanvasElement>('#overlayCanvas');
            const g = c?.getContext('2d');
            if (!c || !g) return -1;
            const w = c.width, h = c.height;
            const data = g.getImageData(0, 0, w, h).data;
            const hudW = Math.min(260, w), hudH = Math.min(70, h);
            let n = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (x < hudW && y < hudH) continue;
                    if ((data[(y * w + x) * 4 + 3] ?? 0) > 10) n++;
                }
            }
            return n;
        });
    }

    test('Start/End labels are off by default and toggle via the "Labels" checkbox', async ({ page }) => {
        test.setTimeout(60000);
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 * GPU_WAIT_SCALE });

        const labels = page.locator('#chk_show_labels');
        // Off by default — the record preview is uncluttered (#280).
        await expect(labels).not.toBeChecked();

        await page.waitForTimeout(300);
        const off = await overlayLabelPixels(page);
        expect(off).toBeGreaterThan(0); // rings are drawn

        // Turning labels on adds label-text pixels to the overlay.
        await labels.check();
        await page.waitForTimeout(400);
        const on = await overlayLabelPixels(page);
        expect(on).toBeGreaterThan(off);

        // Turning them back off removes the label pixels again (the cached
        // ring layer rebuilds because the flag is part of its cache key).
        await labels.uncheck();
        await page.waitForTimeout(400);
        const offAgain = await overlayLabelPixels(page);
        expect(offAgain).toBeLessThan(on);
        expect(offAgain).toBe(off);
    });
});
