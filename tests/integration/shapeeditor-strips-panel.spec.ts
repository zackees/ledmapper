import { test, expect } from './fixtures.ts';
import path from 'path';

const MULTI_SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap-multi.json');

test.describe('Shapeeditor strips inspector panel', () => {

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
        });
    });

    async function loadMulti(page) {
        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);
    }

    async function downloadJson(page) {
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }

    test('strips panel lists strips from a multi-strip upload', async ({ page }) => {
        await loadMulti(page);
        const panel = page.locator('#strips_panel');
        await expect(panel).toBeVisible();
        // Open the accordion if not open
        await panel.evaluate((el) => { el.open = true; });
        const rows = page.locator('#strips_list .strip-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText('strip1');
        await expect(rows.nth(0)).toContainText('4');
        await expect(rows.nth(1)).toContainText('strip2');
        await expect(rows.nth(1)).toContainText('3');
    });

    test('Move Down changes exported JSON key order', async ({ page }) => {
        await loadMulti(page);
        const panel = page.locator('#strips_panel');
        await panel.evaluate((el) => { el.open = true; });

        // Click "Move Down" on the first row
        await page.locator('#strips_list .strip-row').nth(0).locator('button[data-action="down"]').click();

        // Selected strip should still follow the moved strip (strip1 -> idx 1)
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames())).toEqual(['strip2', 'strip1']);

        const json = await downloadJson(page);
        const keys = Object.keys(json.map);
        expect(keys).toEqual(['strip2', 'strip1']);
    });

    test('rename updates exported JSON', async ({ page }) => {
        await loadMulti(page);
        const panel = page.locator('#strips_panel');
        await panel.evaluate((el) => { el.open = true; });

        await page.locator('#strips_list .strip-row').nth(0).locator('button[data-action="rename"]').click();
        const input = page.locator('.swal2-input');
        await expect(input).toBeVisible();
        await input.fill('left_panel');
        await page.locator('.swal2-confirm').click();
        await expect(input).toBeHidden();

        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames())).toEqual(['left_panel', 'strip2']);

        const json = await downloadJson(page);
        expect(json.map.left_panel).toBeTruthy();
        expect(json.map.strip1).toBeUndefined();
        expect(json.map.left_panel.x.length).toBe(4);
    });

    test('delete removes strip', async ({ page }) => {
        await loadMulti(page);
        const panel = page.locator('#strips_panel');
        await panel.evaluate((el) => { el.open = true; });

        await page.locator('#strips_list .strip-row').nth(1).locator('button[data-action="delete"]').click();
        await expect(page.locator('.swal2-confirm')).toBeVisible();
        await page.locator('.swal2-confirm').click();
        await expect(page.locator('.swal2-confirm')).toBeHidden();

        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(1);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames())).toEqual(['strip1']);

        const rows = page.locator('#strips_list .strip-row');
        await expect(rows).toHaveCount(1);
    });

    test('last strip cannot be deleted', async ({ page }) => {
        await loadMulti(page);
        const panel = page.locator('#strips_panel');
        await panel.evaluate((el) => { el.open = true; });

        // Delete strip2 first
        await page.locator('#strips_list .strip-row').nth(1).locator('button[data-action="delete"]').click();
        await page.locator('.swal2-confirm').click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(1);

        // The remaining strip's delete button must be disabled
        const deleteBtn = page.locator('#strips_list .strip-row').nth(0).locator('button[data-action="delete"]');
        await expect(deleteBtn).toBeDisabled();
    });
});
