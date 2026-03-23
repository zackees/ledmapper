import { test, expect } from './fixtures.js';
import { mockWebcam } from '../helpers/webcam-mock.js';

test.describe('Screenmap Maker', () => {
    test.beforeEach(async ({ page }) => {
        await mockWebcam(page);
    });

    /** Navigate to screenmap and enter webcam mapping mode */
    async function gotoMappingUI(page) {
        await page.goto('/screenmap/');
        // Click "Video Capture" to dismiss source selection and reveal mapping UI
        await page.locator('#btn_webcam').click();
        await expect(page.locator('#mappingUI')).toBeVisible({ timeout: 10000 });
    }

    test('loads page with controls', async ({ page }) => {
        await gotoMappingUI(page);
        await expect(page.locator('#btn_snapshot')).toBeVisible();
        await expect(page.locator('#btn_download')).toBeVisible();
        await expect(page.locator('#btn_clear')).toBeVisible();
        await expect(page.locator('#btn_delete_last')).toBeVisible();
    });

    test('has rotation and zoom controls', async ({ page }) => {
        await gotoMappingUI(page);
        await expect(page.locator('#txt_rotate')).toBeVisible();
        await expect(page.locator('#slider_rotate')).toBeVisible();
        await expect(page.locator('#txt_zoom')).toBeVisible();
        await expect(page.locator('#slider_zoom')).toBeVisible();
    });

    test('canvas renders with webcam mock', async ({ page }) => {
        await gotoMappingUI(page);
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('snapshot button is clickable', async ({ page }) => {
        await gotoMappingUI(page);
        await page.locator('canvas').waitFor({ timeout: 10000 });
        const snapshotBtn = page.locator('#btn_snapshot');
        await expect(snapshotBtn).toBeEnabled();
    });

    test('download button starts disabled', async ({ page }) => {
        await gotoMappingUI(page);
        await page.locator('canvas').waitFor({ timeout: 10000 });
        // Download should be disabled when no points exist
        await expect(page.locator('#btn_download')).toBeDisabled();
    });

    test('rotation slider syncs with text input', async ({ page }) => {
        await gotoMappingUI(page);
        const slider = page.locator('#slider_rotate');
        const input = page.locator('#txt_rotate');
        await slider.fill('45');
        await slider.dispatchEvent('input');
        await expect(input).toHaveValue('45.0');
    });
});
