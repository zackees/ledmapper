import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';

/**
 * Issue #248: the screenmap band collapses to a compact summary row (active
 * layout name + LED count + "Change layout") once a layout is active.
 * Issue #273: "Change layout" opens the picker as a select-to-dismiss
 * popover that floats OVER the canvas (never reflowing it below the fold);
 * picking a preset auto-closes it, as do Esc and click-outside; and before
 * a source loads only the gate hint speaks (no contradictory messaging).
 *
 * Regression guards: collapsed height stays compact, and the canvas +
 * preview stay above the fold at 1366x768 in BOTH the collapsed and the
 * picker-open states.
 */
test.describe('Moviemaker screenmap band + layout picker (issues #248 / #273)', () => {
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

    test('no source: only the gate hint shows — no contradictory layout row (#273)', async ({ page }) => {
        await page.goto('/moviemaker/');
        // Before a source loads, the summary row is hidden (it used to show a
        // chosen layout while the gate hint said "load a source to choose a
        // layout" — a contradiction). Only the gate hint speaks.
        await expect(page.locator('#screenmap_gate_hint')).toBeVisible();
        await expect(page.locator('#screenmap_collapsed_row')).not.toBeVisible();
    });

    test('collapsed row shows the active layout name and LED count once a source loads', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
        // 16x16 Grid is the manifest's first preset (public/screenmaps/manifest.json).
        await expect(page.locator('#txt_active_layout')).toHaveText('16x16 Grid');
        await expect(page.locator('#txt_active_led_count')).toHaveText('256 LEDs');
    });

    test('"Change layout" opens a popover over the canvas; picking a preset auto-dismisses it (#273)', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        const panel = page.locator('#screenmap_expanded_panel');
        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        await expect(panel).toHaveClass(/screenmap-offscreen/);

        // Open: the popover floats over the canvas. The summary row stays as
        // its anchor, and — the whole point of #273 — the canvas is NOT
        // pushed below the fold.
        await page.locator('#btn_change_layout').click();
        await expect(panel).not.toHaveClass(/screenmap-offscreen/);
        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        const canvasBox = await page.locator('#renderCanvas').boundingBox();
        expect((canvasBox?.y ?? 0) + (canvasBox?.height ?? 0)).toBeLessThanOrEqual(768);

        // Select-to-dismiss: clicking a preset applies it AND closes the
        // popover — no separate "Done" step. The summary label updates.
        await page.locator('.preset-btn[data-preset-file="8x8_grid.json"]').click();
        await expect(panel).toHaveClass(/screenmap-offscreen/);
        await expect(page.locator('#txt_active_layout')).toHaveText('8x8 Grid');
        await expect(page.locator('.preset-btn[data-preset-file="8x8_grid.json"]')).toHaveClass(/active-preset/);
    });

    test('Esc and click-outside dismiss the layout popover (#273)', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
        const panel = page.locator('#screenmap_expanded_panel');

        // Esc
        await page.locator('#btn_change_layout').click();
        await expect(panel).not.toHaveClass(/screenmap-offscreen/);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveClass(/screenmap-offscreen/);

        // Click-outside (over the canvas region)
        await page.locator('#btn_change_layout').click();
        await expect(panel).not.toHaveClass(/screenmap-offscreen/);
        await page.mouse.click(1100, 600);
        await expect(panel).toHaveClass(/screenmap-offscreen/);

        // Header close button also dismisses.
        await page.locator('#btn_change_layout').click();
        await expect(panel).not.toHaveClass(/screenmap-offscreen/);
        await page.locator('#btn_collapse_layout').click();
        await expect(panel).toHaveClass(/screenmap-offscreen/);
    });
});
