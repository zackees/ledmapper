import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';

/**
 * Issue #248: the screenmap band collapses to a compact summary row (active
 * layout name + LED count + "Change layout") once a layout is active.
 * Issue #273: "Change layout" opens the picker as a select-to-dismiss
 * popover that floats OVER the canvas (never reflowing it below the fold);
 * picking a preset auto-closes it, as do Esc and click-outside; and before
 * a source loads only the gate hint speaks (no contradictory messaging).
 * #273 follow-up: the summary row + "Change layout" affordance live in a
 * compact bar directly above the canvas (next to the shape they map), and
 * the full-width top band collapses away on source load — so the control is
 * no longer stranded in the far corners of a top band.
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

        // #273 follow-up: once a source loads, the layout control moves out
        // of the full-width top band (which then collapses away) and sits
        // directly above the render canvas — next to the shape it maps.
        await expect(page.locator('#sidebar')).toBeHidden();

        // Render canvas + preview panel fully above the fold.
        const canvasBox = await page.locator('#renderCanvas').boundingBox();
        expect(canvasBox).not.toBeNull();
        expect((canvasBox?.y ?? 0) + (canvasBox?.height ?? 0)).toBeLessThanOrEqual(768);

        // The layout bar sits above the canvas (not stranded in a top band).
        expect((collapsedBox?.y ?? 0) + (collapsedBox?.height ?? 0)).toBeLessThanOrEqual((canvasBox?.y ?? 0) + 1);

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
        await expect(page.locator('#txt_active_layout')).toHaveText('64x64 Quad Serpentine');
        await expect(page.locator('#txt_active_led_count')).toHaveText('4096 LEDs');
    });

    test('"Change layout" opens a popover over the canvas; picking a preset auto-dismisses it (#273)', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        const panel = page.locator('#screenmap_expanded_panel');
        const changeBtn = page.locator('#btn_change_layout');
        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        await expect(panel).toHaveClass(/screenmap-offscreen/);

        // The button advertises itself as a menu expander (#273 follow-up):
        // a popup trigger whose aria-expanded reflects the open state (and
        // drives the caret's flip).
        await expect(changeBtn).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(changeBtn).toHaveAttribute('aria-expanded', 'false');

        // Open: the popover floats over the canvas. The summary row stays as
        // its anchor, and — the whole point of #273 — the canvas is NOT
        // pushed below the fold.
        await changeBtn.click();
        await expect(panel).not.toHaveClass(/screenmap-offscreen/);
        await expect(changeBtn).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#screenmap_collapsed_row')).toBeVisible();
        const canvasBox = await page.locator('#renderCanvas').boundingBox();
        expect((canvasBox?.y ?? 0) + (canvasBox?.height ?? 0)).toBeLessThanOrEqual(768);

        // The menu drops directly under the button (a dropdown belonging to
        // it), not from the far edge of the bar: their left edges align.
        const btnBox = await changeBtn.boundingBox();
        const panelBox = await panel.boundingBox();
        expect(Math.abs((panelBox?.x ?? 0) - (btnBox?.x ?? 0))).toBeLessThanOrEqual(4);
        expect(panelBox?.y ?? 0).toBeGreaterThanOrEqual((btnBox?.y ?? 0) + (btnBox?.height ?? 0));

        // Select-to-dismiss: clicking a preset applies it AND closes the
        // popover — no separate "Done" step. The summary label updates.
        await page.locator('.preset-btn[data-preset-file="8x8_grid.json"]').click();
        await expect(panel).toHaveClass(/screenmap-offscreen/);
        await expect(changeBtn).toHaveAttribute('aria-expanded', 'false');
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
