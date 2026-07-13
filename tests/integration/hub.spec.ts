import { test, expect } from './fixtures.ts';

test.describe('Hub Page', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/hub/');
        await expect(page.locator('h1')).toContainText('FastLED Video Mapper');
    });

    test('has all tool cards', async ({ page }) => {
        await page.goto('/hub/');
        const cards = page.locator('.tool-card');
        await expect(cards).toHaveCount(3);
    });

    test('has navigation bar', async ({ page }) => {
        await page.goto('/hub/');
        await expect(page.locator('.nav-bar')).toBeVisible();
    });

    test('tool card links navigate correctly', async ({ page }) => {
        await page.goto('/hub/');
        const playLink = page.locator('.tool-card', { hasText: 'Play' });
        await playLink.click();
        await expect(page).toHaveURL(/\/play\/?$/);
    });

    test('back button navigates between tools', async ({ page }) => {
        await page.goto('/hub/');
        await page.click('.tool-card:has-text("Play")');
        await expect(page).toHaveURL(/\/play/);
        await page.goBack();
        await expect(page).toHaveURL('/hub/');
        await expect(page.locator('.tool-grid')).toBeVisible({ timeout: 10000 });
    });
});
