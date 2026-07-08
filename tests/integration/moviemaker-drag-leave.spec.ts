/**
 * E2E regression tests for issue #31: stale drag state after off-canvas release.
 *
 * These tests verify the Pointer-Events + setPointerCapture fix:
 *   1. Right-press → drag off-canvas → release outside → next left-drag must only translate.
 *   2. Window blur mid-hold cancels the active drag (drag state clears).
 *
 * Skipped in CI (headless Chromium / no GPU) because the moviemaker WebGL
 * pipeline requires a real GPU context. Run locally with:
 *   npx playwright test tests/integration/moviemaker-drag-leave.spec.ts
 */
import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15_000 });
}

function getDragState(page) {
    // Returns the drag state object ({ kind }) or null when idle.
    // Uses a sentinel string to distinguish "debug hook not installed" from "idle (null)".
    return page.evaluate(() => {
        if (!window.__mmDebug || typeof window.__mmDebug.getDragState !== 'function') return 'missing';
        return window.__mmDebug.getDragState();
    });
}

function getZoom(page) {
    return page.evaluate(() => {
        const txt = document.querySelector('#txt_curr_zoom');
        return txt ? parseFloat(txt.textContent) : null;
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Moviemaker overlay drag — off-canvas release (issue #31)', () => {
    test.skip(!!process.env.CI, 'WebGL pipeline requires GPU, skipped in CI');

    test.beforeEach(async ({ page }) => {
        await mockWebcam(page);
        // Clear any stored screenmap so the default 16x16 preset is active.
        await page.addInitScript(() => {
            try {
                localStorage.removeItem('lm:screenmap');
                localStorage.removeItem('lm:screenmap-preset');
                localStorage.removeItem('lm:screenmap-meta');
            } catch { /* ignore */ }
        });
    });

    test('right-drag released outside canvas does not contaminate next left-drag', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // Load a screenmap so drag gestures are active.
        await page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]')).toHaveClass(/active-preset/);
        await page.waitForTimeout(250);

        const box = await page.locator('#overlayCanvas').boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Snapshot zoom before the test sequence.
        const _zoomBefore = await getZoom(page);

        // ── Step 1: right-press on canvas, drag downward (zooms in), drag off-canvas,
        //    release outside.  With the old code `isDraggingRight` stays true here.
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'right' });

        // Drag inside the canvas for a moment (zoom changes expected here).
        await page.mouse.move(cx, cy + 30);

        // Move pointer well outside the canvas bounds while still holding right button.
        await page.mouse.move(box.x - 150, box.y - 150);

        // Release outside the canvas.
        await page.mouse.up({ button: 'right' });

        // After release, drag state must be null.
        const stateAfterOutsideRelease = await getDragState(page);
        expect(stateAfterOutsideRelease).toBeNull();

        // ── Step 2: now perform a left-drag — must ONLY translate, NOT zoom.
        const zoomAtStart = await getZoom(page);
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'left' });

        // Move downward — previously this would fire the stale right-drag zoom branch.
        for (let dy = 0; dy < 80; dy += 8) {
            await page.mouse.move(cx, cy + dy);
        }

        const zoomDuringLeftDrag = await getZoom(page);
        await page.mouse.up({ button: 'left' });

        // Zoom must not have changed during the left-drag (tolerance for float display).
        expect(Math.abs(zoomDuringLeftDrag - zoomAtStart)).toBeLessThan(0.05);

        // Drag state is idle again.
        expect(await getDragState(page)).toBeNull();
    });

    test('window blur mid-hold clears drag state', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        await page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]')).toHaveClass(/active-preset/);
        await page.waitForTimeout(250);

        const box = await page.locator('#overlayCanvas').boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Start a right-drag.
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(cx, cy + 20);

        const stateMidDrag = await getDragState(page);
        expect(stateMidDrag).not.toBeNull();
        expect(stateMidDrag?.kind).toBe('zoom');

        // Simulate window blur (Alt-Tab / focus loss).
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));

        // Drag state must clear.
        const stateAfterBlur = await getDragState(page);
        expect(stateAfterBlur).toBeNull();

        // Pointer is still pressed in the browser, but drag was cleared.
        // Release to clean up.
        await page.mouse.up({ button: 'right' });
    });

    test('left-drag released outside canvas stops translate cleanly on re-entry', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        await page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]')).toHaveClass(/active-preset/);
        await page.waitForTimeout(250);

        const box = await page.locator('#overlayCanvas').boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Left-press on canvas, drag off, release outside.
        await page.mouse.move(cx, cy);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(box.x - 100, cy);
        await page.mouse.up({ button: 'left' });

        // State must be idle.
        expect(await getDragState(page)).toBeNull();

        // Move back into canvas without button held — no drag.
        await page.mouse.move(cx, cy);
        expect(await getDragState(page)).toBeNull();
    });
});
