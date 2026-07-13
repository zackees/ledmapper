import { test, expect } from './fixtures.ts';

test.describe('legacy navigation retirement (#384)', () => {
    test('Hub deep links redirect to the canonical Play mode', async ({ page }) => {
        await page.goto('/hub/');
        await expect(page).toHaveURL(/\/play$/);
        await expect(page.locator('#app-mode-bar')).toBeVisible();
        await expect(page.locator('a.app-mode-link[data-mode]')).toHaveCount(3);
    });

    test('legacy top navigation exposes only Play, Create, and Record', async ({ page }) => {
        await page.goto('/demo/');
        const links = page.locator('.nav-links a');
        await expect(links).toHaveCount(3);
        await expect(links).toHaveText(['Play', 'Create', 'Record']);
        await expect(page.locator('.nav-links a', { hasText: 'Hub' })).toHaveCount(0);
        await expect(page.locator('.nav-links a', { hasText: 'Screenmap Maker' })).toHaveCount(0);
        await expect(page.locator('.nav-links a', { hasText: 'Video Player' })).toHaveCount(0);
    });

    test('legacy tool routes keep canonical mode navigation available', async ({ page }) => {
        await page.goto('/screenmap/');
        await expect(page.locator('.nav-links a[href="/create"]')).toHaveClass(/active/);

        await page.goto('/movieplayer/');
        await expect(page.locator('.nav-links a[href="/play"]')).toHaveClass(/active/);
    });
});
