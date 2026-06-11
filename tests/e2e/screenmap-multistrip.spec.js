import { test, expect } from './fixtures.js';
import { mockWebcam } from '../helpers/webcam-mock.js';

test.describe('Screenmap Maker Multi-Strip', () => {

    test.beforeEach(async ({ page }) => {
        await mockWebcam(page);
        await page.goto('/screenmap/');
        // Start webcam mapping
        await page.locator('#btn_webcam').click();
        // Wait for mapping UI to be visible
        await expect(page.locator('#mappingUI')).toBeVisible({ timeout: 10000 });
    });

    test.afterEach(async ({ page }) => {
        // The worker shares one browser context, so clear persisted
        // screenmap state to avoid leaking into other specs.
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
        });
    });

    test('"Add Strip" button exists', async ({ page }) => {
        await expect(page.locator('#btn_add_strip')).toBeVisible();
    });

    test('default state has "strip1" selected', async ({ page }) => {
        const selector = page.locator('#sel_strip');
        await expect(selector).toBeVisible();
        await expect(selector).toHaveValue('strip1');
    });

    test('clicking "Add Strip" creates "strip2" and selects it', async ({ page }) => {
        await page.locator('#btn_add_strip').click();
        const selector = page.locator('#sel_strip');
        await expect(selector).toHaveValue('strip2');
        // Dropdown should now have 2 options
        const options = await selector.locator('option').count();
        expect(options).toBe(2);
    });

    test('strip selector lists all strips', async ({ page }) => {
        await page.locator('#btn_add_strip').click();
        await page.locator('#btn_add_strip').click();
        const selector = page.locator('#sel_strip');
        const options = await selector.locator('option').count();
        expect(options).toBe(3);
    });

    test('switching strips preserves points in previous strip', async ({ page }) => {
        // Take snapshot first so we can add points
        await page.locator('#btn_snapshot').click();
        await page.waitForTimeout(500);

        // Add a point to strip1 by clicking on the canvas
        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(200);

        // Switch to strip2
        await page.locator('#btn_add_strip').click();
        await expect(page.locator('#sel_strip')).toHaveValue('strip2');

        // Switch back to strip1
        await page.locator('#sel_strip').selectOption('strip1');

        // Download and verify strip1 has 1 point
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_download').click();
        const download = await downloadPromise;
        const text = await (await download.createReadStream()).toArray().then(bufs => Buffer.concat(bufs).toString('utf-8'));
        const json = JSON.parse(text);
        expect(json.map.strip1.x.length).toBe(1);
    });

    test('download JSON contains all strips', async ({ page }) => {
        // Take snapshot
        await page.locator('#btn_snapshot').click();
        await page.waitForTimeout(500);

        // Add point to strip1
        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 100, y: 100 } });
        await page.waitForTimeout(200);

        // Add strip2 and add a point
        await page.locator('#btn_add_strip').click();
        await canvas.click({ position: { x: 200, y: 200 } });
        await page.waitForTimeout(200);

        // Download
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_download').click();
        const download = await downloadPromise;
        const text = await (await download.createReadStream()).toArray().then(bufs => Buffer.concat(bufs).toString('utf-8'));
        const json = JSON.parse(text);

        expect(Object.keys(json.map).length).toBe(2);
        expect(json.map.strip1).toBeTruthy();
        expect(json.map.strip2).toBeTruthy();
        expect(json.map.strip1.x.length).toBe(1);
        expect(json.map.strip2.x.length).toBe(1);
    });

    test('single strip download matches existing format', async ({ page }) => {
        // Take snapshot
        await page.locator('#btn_snapshot').click();
        await page.waitForTimeout(500);

        // Add point to strip1
        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 150, y: 150 } });
        await page.waitForTimeout(200);

        // Download
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_download').click();
        const download = await downloadPromise;
        const text = await (await download.createReadStream()).toArray().then(bufs => Buffer.concat(bufs).toString('utf-8'));
        const json = JSON.parse(text);

        // Should have standard format: map.strip1 with x, y, diameter
        expect(json.map).toBeTruthy();
        expect(json.map.strip1).toBeTruthy();
        expect(json.map.strip1.x).toBeInstanceOf(Array);
        expect(json.map.strip1.y).toBeInstanceOf(Array);
        expect(typeof json.map.strip1.diameter).toBe('number');
    });

    test('cannot delete last remaining strip', async ({ page }) => {
        const deleteBtn = page.locator('#btn_delete_strip');
        await expect(deleteBtn).toBeDisabled();
    });

    test('renaming a strip updates exported JSON and localStorage key', async ({ page }) => {
        // Take snapshot and add a point to strip1
        await page.locator('#btn_snapshot').click();
        await page.waitForTimeout(500);
        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 120, y: 120 } });
        await page.waitForTimeout(200);

        // Rename strip1 -> left_panel via the Rename button (SweetAlert2 prompt)
        await page.locator('#btn_rename_strip').click();
        const input = page.locator('.swal2-input');
        await expect(input).toBeVisible();
        await input.fill('left_panel');
        await page.locator('.swal2-confirm').click();
        await expect(page.locator('.swal2-input')).toBeHidden();

        // Strip selector now shows the new name
        await expect(page.locator('#sel_strip')).toHaveValue('left_panel');

        // Exported JSON uses the renamed key
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_download').click();
        const download = await downloadPromise;
        const text = await (await download.createReadStream()).toArray().then(bufs => Buffer.concat(bufs).toString('utf-8'));
        const json = JSON.parse(text);
        expect(json.map.left_panel).toBeTruthy();
        expect(json.map.strip1).toBeUndefined();
        expect(json.map.left_panel.x.length).toBe(1);

        // Persisted localStorage screenmap also uses the renamed key
        const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(stored).toBeTruthy();
        const storedJson = JSON.parse(stored);
        expect(storedJson.map.left_panel).toBeTruthy();
        expect(storedJson.map.strip1).toBeUndefined();
    });

    test('rename rejects empty and duplicate names', async ({ page }) => {
        // Create a second strip so a duplicate-name collision is possible
        await page.locator('#btn_add_strip').click();
        await expect(page.locator('#sel_strip')).toHaveValue('strip2');

        await page.locator('#btn_rename_strip').click();
        const input = page.locator('.swal2-input');
        await expect(input).toBeVisible();

        // Empty name is rejected with a validation message
        await input.fill('   ');
        await page.locator('.swal2-confirm').click();
        await expect(page.locator('.swal2-validation-message')).toContainText('cannot be empty');

        // Duplicate name is rejected with a validation message
        await input.fill('strip1');
        await page.locator('.swal2-confirm').click();
        await expect(page.locator('.swal2-validation-message')).toContainText('already exists');

        // Cancel — strip names are unchanged
        await page.locator('.swal2-cancel').click();
        await expect(page.locator('.swal2-input')).toBeHidden();
        await expect(page.locator('#sel_strip')).toHaveValue('strip2');
        const options = await page.locator('#sel_strip option').allTextContents();
        expect(options).toEqual(['strip1', 'strip2']);
    });

    test('renamed strip drives Start/End labels; single strip yields one pair', async ({ page }) => {
        // Unit-level assertion against the shared helper, exercised in-page
        const labels = await page.evaluate(async () => {
            const { stripStartEndLabels } = await import('/common.js');
            return {
                autoIndexed: stripStartEndLabels({ name: 'strip1', count: 5 }, 0),
                named: stripStartEndLabels({ name: 'left_panel', count: 5 }, 0),
                single: stripStartEndLabels({ name: 'strip1', count: 1 }, 0),
            };
        });
        // Single strip => exactly one Start/End pair, indexed as 0
        expect(labels.autoIndexed).toEqual({ start: 'Start0', end: 'End0' });
        // Renamed strip => labels use the custom name
        expect(labels.named).toEqual({ start: 'Startleft_panel', end: 'Endleft_panel' });
        // Single-LED strip collapses to one combined label
        expect(labels.single).toEqual({ start: 'Start/End0', end: null });
    });
});
