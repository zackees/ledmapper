import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Shape Viewer', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/shapeviewer/');
        await expect(page.locator('h1')).toContainText('Shape Viewer');
    });

    test('has screenmap upload input', async ({ page }) => {
        await page.goto('/shapeviewer/');
        await expect(page.locator('#btn_upload_shape')).toBeVisible();
    });

    test('has zoom controls', async ({ page }) => {
        await page.goto('/shapeviewer/');
        await expect(page.locator('#txt_zoom')).toBeVisible();
        await expect(page.locator('#slider_zoom')).toBeVisible();
    });

    test('upload renders shape on canvas', async ({ page }) => {
        await page.goto('/shapeviewer/');
        const fileInput = page.locator('#btn_upload_shape');
        const fixturePath = path.resolve('tests/fixtures/test-screenmap.json');
        await fileInput.setInputFiles(fixturePath);
        // Canvas should render after shape upload
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('zoom slider syncs with text input', async ({ page }) => {
        await page.goto('/shapeviewer/');
        const slider = page.locator('#slider_zoom');
        const input = page.locator('#txt_zoom');
        await slider.fill('3');
        await slider.dispatchEvent('input');
        await expect(input).toHaveValue(/^3(\.0)?$/);
    });

    test('canvas renders on page load', async ({ page }) => {
        await page.goto('/shapeviewer/');
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });
});
