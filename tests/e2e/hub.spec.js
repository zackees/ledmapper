import { test, expect } from '@playwright/test';

test.describe('Hub Page', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/hub/index.html');
        await expect(page.locator('h1')).toContainText('FastLED Video Mapper');
    });

    test('has all tool cards', async ({ page }) => {
        await page.goto('/hub/index.html');
        const cards = page.locator('.tool-card');
        await expect(cards).toHaveCount(5);
    });

    test('has navigation bar', async ({ page }) => {
        await page.goto('/hub/index.html');
        await expect(page.locator('.nav-bar')).toBeVisible();
    });

    test('tool card links navigate correctly', async ({ page }) => {
        await page.goto('/hub/index.html');
        const demoLink = page.locator('.tool-card', { hasText: 'Demo' });
        await demoLink.click();
        await expect(page).toHaveURL(/\/demo\//);
    });
});
