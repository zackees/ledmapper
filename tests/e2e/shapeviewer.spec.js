import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Shape Editor', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await expect(page.locator('h1')).toContainText('Shape Editor');
    });

    test('has screenmap upload input', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await expect(page.locator('#btn_upload_shape')).toBeVisible();
    });

    test('has scale and rotate controls', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await expect(page.locator('#rng_scale')).toBeVisible();
        await expect(page.locator('#txt_scale')).toBeVisible();
        await expect(page.locator('#rng_scale_x')).toBeVisible();
        await expect(page.locator('#txt_scale_x')).toBeVisible();
        await expect(page.locator('#rng_scale_y')).toBeVisible();
        await expect(page.locator('#txt_scale_y')).toBeVisible();
        await expect(page.locator('#rng_rotate')).toBeVisible();
        await expect(page.locator('#txt_rotate')).toBeVisible();
    });

    test('upload renders shape on canvas', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_shape');
        const fixturePath = path.resolve('tests/fixtures/test-screenmap.json');
        await fileInput.setInputFiles(fixturePath);
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('canvas renders on page load', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });
});
