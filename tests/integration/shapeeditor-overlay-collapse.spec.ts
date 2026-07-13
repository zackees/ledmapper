import { test, expect } from './fixtures.ts';

const OVERLAY_KEY = 'shapeeditor.overlayCollapsed';

async function prepareOverlay(page, collapsed?: boolean) {
    await page.addInitScript((initialState) => {
        if (initialState !== undefined) {
            localStorage.setItem('shapeeditor.overlayCollapsed', initialState ? '1' : '0');
        }
    }, collapsed);
    await page.goto('/create');
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
}

test.describe('Screenmap overlay collapse bar', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate((key) => { localStorage.removeItem(key); }, OVERLAY_KEY);
    });

    test('collapses to a labeled bar and restores with keyboard focus', async ({ page }) => {
        await prepareOverlay(page);

        const overlay = page.locator('#transform-overlay');
        const collapse = page.getByRole('button', { name: 'Collapse Screenmap panel' });
        const expand = page.getByRole('button', { name: 'Expand Screenmap panel' });
        await expect(collapse).toBeVisible();
        await expect(expand).toBeHidden();
        await expect(page.locator('#overlay_content')).toBeVisible();
        await expect(collapse).toHaveAttribute('aria-expanded', 'true');

        await collapse.click();
        await expect(overlay).toHaveClass(/collapsed/);
        await expect(page.locator('#overlay_content')).toBeHidden();
        await expect(expand).toBeVisible();
        await expect(expand).toContainText('Screenmap');
        await expect(expand.locator('svg[data-icon="chevron-down"]')).toBeVisible();
        await expect(page.locator('#btn_overlay_collapse')).toBeHidden();
        await expect(expand).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#btn_overlay_expand')).toBeFocused();

        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(overlay).not.toHaveClass(/collapsed/);
        await expect(page.locator('#overlay_content')).toBeVisible();
        await expect(collapse).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#btn_overlay_expand')).toHaveAttribute('aria-expanded', 'true');
        await expect(collapse).toBeFocused();
    });

    test('preserves accordion state and collapsed state across reload', async ({ page }) => {
        await prepareOverlay(page);

        const palette = page.locator('#panel_palette');
        await palette.locator('summary').click();
        await expect(palette).toHaveAttribute('open', '');
        await page.locator('#btn_overlay_collapse').click();
        await expect(page.locator('#transform-overlay')).toHaveClass(/collapsed/);
        await expect(palette).toHaveAttribute('open', '');

        await page.locator('#btn_overlay_expand').click();
        await expect(page.locator('#panel_palette')).toHaveAttribute('open', '');
        await page.locator('#btn_overlay_collapse').click();

        await page.reload();
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await expect(page.locator('#transform-overlay')).toHaveClass(/collapsed/);
        await expect(page.getByRole('button', { name: 'Expand Screenmap panel' })).toBeVisible();
    });

    test('has a usable in-viewport touch target on narrow screens', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await prepareOverlay(page);
        await page.locator('#btn_overlay_collapse').click();

        const bar = page.locator('#btn_overlay_expand');
        const box = await bar.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    });
});
