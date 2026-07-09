import { test, expect } from './fixtures.ts';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';

/**
 * #250: at zoom > 1 the outer LED columns fall outside the video frame.
 * The sampling math is CORRECT (verified with a gradient bisect — no
 * duplication/divergence); the defect was that the truncation was silent.
 * This spec pins the surfacing: the out-of-bounds count must reach the
 * debug state, the event log, and (implicitly) the HUD line they drive.
 */

test.describe('Moviemaker out-of-bounds LED surfacing @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL gather requires GPU, skipped in CI (set GPU_CI=1 to run)');

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:')) localStorage.removeItem(k);
                }
            } catch { /* ignore */ }
        });
        // Static bright webcam mock, portrait-ish, so the gather always has
        // a real frame to sample.
        await page.addInitScript(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 480; canvas.height = 854;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            function paint() {
                if (!ctx) return;
                const g = ctx.createLinearGradient(0, 0, 480, 0);
                g.addColorStop(0, '#222'); g.addColorStop(1, '#eee');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, 480, 854);
                requestAnimationFrame(paint);
            }
            paint();
            const stream = canvas.captureStream(30);
            navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
        });
    });

    test('zoom pushing edge columns off-video is counted, logged, and cleared', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        const oob = () => page.evaluate(() => window.__lmDebug?.moviemaker?.getState()?.oobLeds);

        // Default 16x16 grid at zoom 1.0: everything in frame.
        await expect.poll(oob, { timeout: 10000 }).toBe(0);

        // Zoom 1.3: the two outermost columns (16 LEDs each) leave the frame.
        await page.locator('#rng_zoom').fill('1.3');
        await page.locator('#rng_zoom').dispatchEvent('input');
        await expect.poll(oob, { timeout: 10000 }).toBe(32);

        // The transition must land in the event log as a warning.
        const warned = await page.evaluate(() =>
            window.__lmLog?.entries.some((e) =>
                e.scope === 'moviemaker' && e.event === 'leds-out-of-bounds'
                && (e.data as { count?: number } | undefined)?.count === 32));
        expect(warned).toBe(true);

        // Back to 1.0: count clears and the recovery is logged.
        await page.locator('#rng_zoom').fill('1');
        await page.locator('#rng_zoom').dispatchEvent('input');
        await expect.poll(oob, { timeout: 10000 }).toBe(0);
        const recovered = await page.evaluate(() =>
            window.__lmLog?.entries.some((e) => e.event === 'leds-back-in-bounds'));
        expect(recovered).toBe(true);
    });
});
