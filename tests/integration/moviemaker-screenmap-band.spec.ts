import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';

/**
 * Issue #248: the screenmap band collapses to a compact summary row (active
 * layout name + LED count + "Change layout") once a layout is active, since
 * a default preset always auto-loads. Previously the fully-expanded band
 * (tabs + chips + upload row + edit link, ~250px) pushed the render canvas
 * toward/below the fold at common laptop heights (observed clipped at
 * 1360x850 during the #221 audit). This spec is a regression guard for the
 * acceptance criteria: collapsed height stays compact and the canvas +
 * preview stay above the fold at 1366x768.
 */
test.describe('Moviemaker screenmap band collapse (issue #248)', () => {
    test.use({ viewport: { width: 1366, height: 768 } });

    // The worker shares one browser context across specs; an earlier spec
    // (or an earlier test in this file) may leave a stored screenmap in
    // localStorage, which would restore instead of autoloading the default
    // preset and break the exact-label assertion below. Start every test
    // from a clean slate (same pattern as debug-registry.spec.ts).
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:') || k.startsWith('lm.')) localStorage.removeItem(k);
                }
            } catch { /* ignore */ }
        });
    });

    test('collapses by default, keeping canvas + preview above the fold at 1366x768', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        // A default preset auto-loads (screenmapValid) even before a source
        // is picked, so the band should already be collapsed. The expanded
        // panel stays mounted (never display:none — #btn_upload_screenmap
        // and .preset-btn must keep a non-empty bounding box for other
        // specs' toBeVisible()/setInputFiles() calls) but is moved off
        // canvas, so we assert via the `.screenmap-offscreen` class rather
        // than toBeVisible().
        const collapsedRow = page.locator('#screenmap_collapsed_row');
        await expect(collapsedRow).toBeVisible();
        await expect(page.locator('#screenmap_expanded_panel')).toHaveClass(/screenmap-offscreen/);

        const collapsedBox = await collapsedRow.boundingBox();
        expect(collapsedBox).not.toBeNull();
        expect(collapsedBox?.height ?? Infinity).toBeLessThan(80);

        // Render canvas + preview panel fully above the fold.
        const canvasBox = await page.locator('#renderCanvas').boundingBox();
        expect(canvasBox).not.toBeNull();
        expect((canvasBox?.y ?? 0) + (canvasBox?.height ?? 0)).toBeLessThanOrEqual(768);

        const previewBox = await page.locator('#previewPanel').boundingBox();
        expect(previewBox).not.toBeNull();
        expect((previewBox?.y ?? 0) + (previewBox?.height ?? 0)).toBeLessThanOrEqual(768);
    });

    test('collapsed row shows the active layout name and LED count', async ({ page }) => {
        await page.goto('/moviemaker/');
        // 16x16 Grid is the manifest's first preset (public/screenmaps/manifest.json).
        await expect(page.locator('#txt_active_layout')).toHaveText('16x16 Grid');
        await expect(page.locator('#txt_active_led_count')).toHaveText('256 LEDs');
    });

    test('"Change layout" expands the picker; "Done" collapses it back', async ({ page }) => {
        // The screenmap control-group (collapsed row + expanded panel alike)
        // stays gated (dimmed, pointer-events-none) until a source loads, so
        // start a webcam source first — same precondition as the existing
        // "screenmap presets are gated until a source is loaded" spec.
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        await expect(page.locator('#screenmap_expanded_panel')).toHaveClass(/screenmap-offscreen/);

        await page.locator('#btn_change_layout').click();
        await expect(page.locator('#screenmap_expanded_panel')).not.toHaveClass(/screenmap-offscreen/);
        await expect(page.locator('#screenmap_collapsed_row')).not.toBeVisible();

        await page.locator('#btn_collapse_layout').click();
        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        await expect(page.locator('#screenmap_expanded_panel')).toHaveClass(/screenmap-offscreen/);
    });
});
