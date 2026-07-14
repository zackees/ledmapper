import { expect, test } from '@playwright/test';

// Regression coverage for issue #412's canvas-first Create mobile layout.

const VIEWPORTS = [
    { width: 390, height: 664, label: 'portrait' },
    { width: 750, height: 342, label: 'landscape' },
];

test.describe('mobile Create', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const viewport of VIEWPORTS) {
        test(`Create is canvas-first in phone ${viewport.label}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('/create', { waitUntil: 'domcontentloaded' });
            await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();

            const main = page.locator('#main');
            const mainBox = await main.boundingBox();
            expect(mainBox).not.toBeNull();
            expect(mainBox!.height).toBeGreaterThanOrEqual(Math.min(260, viewport.height * 0.5));

            await expect(page.locator('.mobile-editor-actions')).toBeVisible();
            await expect(page.locator('.mobile-canvas-gesture-hint')).toBeVisible();
            await expect(page.locator('#controls')).toBeHidden();
            await expect(page.locator('#transform-overlay')).toBeHidden();

            const mapButton = page.locator('#btn_mobile_map');
            await mapButton.click();
            await expect(mapButton).toHaveAttribute('aria-expanded', 'true');
            await expect(page.locator('#controls')).toBeVisible();
            await expect(page.locator('#sel_preset_mount .preset-btn').first()).toBeVisible();
            const mapBox = await page.locator('#controls').boundingBox();
            expect(mapBox).not.toBeNull();
            expect(mapBox!.x).toBeGreaterThanOrEqual(0);
            expect(mapBox!.x + mapBox!.width).toBeLessThanOrEqual(viewport.width + 1);
            expect(mapBox!.y).toBeGreaterThanOrEqual(0);
            expect(mapBox!.y + mapBox!.height).toBeLessThanOrEqual(viewport.height + 1);
            await page.locator('#btn_mobile_map_close').click();
            await expect(page.locator('#controls')).toBeHidden();

            const toolsButton = page.locator('#btn_mobile_tools');
            await toolsButton.click();
            await expect(toolsButton).toHaveAttribute('aria-expanded', 'true');
            await expect(page.locator('#transform-overlay')).toBeVisible();
            const toolsBox = await page.locator('#transform-overlay').boundingBox();
            expect(toolsBox).not.toBeNull();
            expect(toolsBox!.x).toBeGreaterThanOrEqual(0);
            expect(toolsBox!.x + toolsBox!.width).toBeLessThanOrEqual(viewport.width + 1);
            expect(toolsBox!.y).toBeGreaterThan(mainBox!.y + 40);
            expect(toolsBox!.y + toolsBox!.height).toBeLessThanOrEqual(viewport.height + 1);
            await page.locator('#btn_overlay_collapse').click();
            await expect(page.locator('#transform-overlay')).toBeHidden();
        });
    }

    test('mobile Map sheet selects a preset and Save exports it', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 664 });
        await page.goto('/create', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();

        await page.locator('#btn_mobile_map').click();
        const presets = page.locator('#sel_preset_mount .preset-btn');
        await expect(presets.first()).toBeVisible();
        const presetCount = await presets.count();
        const preset = presets.nth(Math.min(1, presetCount - 1));
        await preset.click();
        await expect(preset).toHaveClass(/active-preset/);
        await expect(page.locator('#controls')).toBeHidden();

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.json$/);
    });
});

test('wide desktop retains the existing Create chrome', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
    await expect(page.locator('.mobile-editor-actions')).toBeHidden();
    await expect(page.locator('.mobile-canvas-gesture-hint')).toBeHidden();
    await expect(page.locator('#transform-overlay')).toBeVisible();
});
