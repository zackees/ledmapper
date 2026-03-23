import { test, expect } from './fixtures.js';

test.describe('Screenmap Editor canvas size stability', () => {
    test('canvas does not keep expanding', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 5000 });

        // Wait for layout to settle
        await page.waitForTimeout(500);

        // Record the canvas size
        const size1 = await canvas.boundingBox();

        // Wait a short period and check again
        await page.waitForTimeout(1000);
        const size2 = await canvas.boundingBox();

        // Canvas should not have grown
        expect(size2.width).toBeCloseTo(size1.width, 0);
        expect(size2.height).toBeCloseTo(size1.height, 0);
    });
});
