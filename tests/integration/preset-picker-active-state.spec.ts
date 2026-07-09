import { test as sharedTest, expect } from './fixtures.ts';
import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { expandScreenmapBand } from '../helpers/screenmap-band.ts';

/**
 * Regression guard for issue #247: `.preset-btn.active-preset` used to reuse
 * the exact same subtle-tint styling as `.preset-btn:hover`, so a loaded
 * preset was visually indistinguishable from a merely-hovered (or resting)
 * chip. These specs assert the *computed* style actually differs — not just
 * that the class is present, which existing specs already covered — plus
 * the tab-header "active preset lives here" indicator added alongside it.
 *
 * Non-@gpu: no WebGL rendering or recording is exercised, only the picker's
 * DOM/class/style state.
 */

async function bgColor(locator) {
    return await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

// shapeeditor's file-ops row (which hosts the preset picker's chip mount) is
// hidden on desktop pointer/hover devices — the same presets are reachable
// there via a right-click context-menu submenu instead (see
// shapeeditor-methods-04.ts / shapeeditor.css "Desktop: hide file-ops row").
// The chip picker itself is only shown for touch/coarse-pointer inputs, so
// this needs its own hasTouch context rather than the shared mouse-driven
// fixture, mirroring shapeeditor-touch.spec.ts.
const touchTest = base.extend<{ page: Page }>({
    page: async ({ browser }, use) => {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true, hasTouch: true });
        await ctx.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:') || k.startsWith('lm.')) localStorage.removeItem(k);
                }
                localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
            } catch { /* ignore */ }
        });
        const page = await ctx.newPage();
        await use(page);
        await page.close();
        await ctx.close();
    },
});

touchTest.describe('Preset picker active-chip visibility (#247) — shapeeditor', () => {
    touchTest('exactly one chip is active, its style differs from a resting chip, and the tab hint survives switching tabs', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });

        const mount = page.locator('#sel_preset_mount');
        const shapesTabInit = mount.locator('.preset-picker-tab[data-category="shapes"]');
        await expect(shapesTabInit).toBeVisible({ timeout: 10000 });

        // Switch to the "shapes" tab and pick a chip there.
        await shapesTabInit.click();
        const activeChip = mount.locator('.preset-btn[data-preset-file="spaceface.json"]');
        const restingChip = mount.locator('.preset-btn[data-preset-file="piano_grand.json"]');
        await expect(activeChip).toBeVisible();
        await activeChip.click();

        await expect(activeChip).toHaveClass(/active-preset/);
        await expect(restingChip).not.toHaveClass(/active-preset/);
        // Exactly one chip is active anywhere in this mount.
        await expect(mount.locator('.preset-btn.active-preset')).toHaveCount(1);

        const activeBg = await bgColor(activeChip);
        const restingBg = await bgColor(restingChip);
        expect(activeBg).not.toBe(restingBg);

        // The "shapes" tab (currently open) hints the active chip lives there.
        const shapesTab = mount.locator('.preset-picker-tab[data-category="shapes"]');
        const gridsTab = mount.locator('.preset-picker-tab[data-category="grids"]');
        await expect(shapesTab).toHaveClass(/has-active-preset/);
        await expect(gridsTab).not.toHaveClass(/has-active-preset/);

        // Switch away — the panel with the active chip is now hidden, but the
        // tab hint must survive so the loaded preset stays identifiable.
        await gridsTab.click();
        await expect(gridsTab).toHaveAttribute('aria-selected', 'true');
        await expect(shapesTab).toHaveAttribute('aria-selected', 'false');
        await expect(shapesTab).toHaveClass(/has-active-preset/);
        await expect(gridsTab).not.toHaveClass(/has-active-preset/);
    });
});

sharedTest.describe('Preset picker active-chip visibility (#247) — moviemaker', () => {
    sharedTest.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:') || k.startsWith('lm.')) localStorage.removeItem(k);
                }
            } catch { /* ignore */ }
        });
    });

    sharedTest('exactly one chip is active with a distinct computed style, and the tab hint marks its category', async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        await expandScreenmapBand(page);
        const mount = page.locator('.preset-picker-mount');
        // Default autoload picks the first ("grids") preset; switch to
        // "strips" and pick a chip there instead.
        const stripsTabInit = mount.locator('.preset-picker-tab[data-category="strips"]');
        await expect(stripsTabInit).toBeVisible({ timeout: 10000 });
        await stripsTabInit.click();
        const activeChip = mount.locator('.preset-btn[data-preset-file="strip_60.json"]');
        const restingChip = mount.locator('.preset-btn[data-preset-file="ring_24.json"]');
        await expect(activeChip).toBeVisible();
        await activeChip.click();

        await expect(activeChip).toHaveClass(/active-preset/);
        await expect(restingChip).not.toHaveClass(/active-preset/);
        await expect(mount.locator('.preset-btn.active-preset')).toHaveCount(1);

        const activeBg = await bgColor(activeChip);
        const restingBg = await bgColor(restingChip);
        expect(activeBg).not.toBe(restingBg);

        const stripsTab = mount.locator('.preset-picker-tab[data-category="strips"]');
        const gridsTab = mount.locator('.preset-picker-tab[data-category="grids"]');
        await expect(stripsTab).toHaveClass(/has-active-preset/);
        await expect(gridsTab).not.toHaveClass(/has-active-preset/);
    });
});
