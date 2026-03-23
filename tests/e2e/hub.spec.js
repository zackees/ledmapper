import { test, expect } from './fixtures.js';

test.describe('Hub Page', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1')).toContainText('FastLED Video Mapper');
    });

    test('has all tool cards', async ({ page }) => {
        await page.goto('/');
        const cards = page.locator('.tool-card');
        await expect(cards).toHaveCount(4);
    });

    test('has navigation bar', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.nav-bar')).toBeVisible();
    });

    test('tool card links navigate correctly', async ({ page }) => {
        await page.goto('/');
        const demoLink = page.locator('.tool-card', { hasText: 'Demo' });
        await demoLink.click();
        await expect(page).toHaveURL(/\/demo\//);
    });

    test('back button navigates between tools', async ({ page }) => {
        await page.goto('/');
        await page.click('.tool-card:has-text("Demo")');
        await expect(page).toHaveURL(/\/demo/);
        await page.goBack();
        await expect(page).toHaveURL('/');
        await expect(page.locator('.tool-grid')).toBeVisible({ timeout: 10000 });
    });
});
