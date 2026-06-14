import { test, expect } from './fixtures.ts';

test.describe('Shapeeditor panel palette', () => {

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
        });
    });

    async function gotoEditor(page) {
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        // Wait for the debug hook to be installed
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    }

    async function freshEditor(page) {
        await gotoEditor(page);
        // Reset to an empty editor regardless of any preset that auto-loaded.
        // The toolbar New button is CSS-hidden on desktop, so click it directly.
        await page.locator('#btn_new').evaluate((el) => el.click());
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(0);
    }

    test('panel palette is visible with catalog buttons', async ({ page }) => {
        await gotoEditor(page);
        const palette = page.locator('#panel_palette');
        await expect(palette).toBeVisible();
        await palette.evaluate((el) => { el.open = true; });
        const buttons = page.locator('#panel_catalog_buttons .panel-btn');
        await expect(buttons).not.toHaveCount(0);
        // Spot-check expected catalog entries
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: '8×8 Matrix' })).toBeVisible();
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: 'Ring 16' })).toBeVisible();
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: 'Strip 60' })).toBeVisible();
    });

    test('placing an 8x8 via debug hook adds a panel strip with 64 LEDs', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        expect(typeof name).toBe('string');
        expect(name.startsWith('panel')).toBeTruthy();

        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).toContain(name);

        // Save As → JSON should contain the new strip with 64 LEDs
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        expect(json.map[name]).toBeTruthy();
        expect(json.map[name].x.length).toBe(64);
        expect(json.map[name].y.length).toBe(64);
    });

    test('undo removes the placed panel', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        await page.locator('#btn_undo').click();
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before);
        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).not.toContain(name);
    });

    test('placing onto an empty editor initializes a fresh map', async ({ page }) => {
        await freshEditor(page);

        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(1);
        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).toEqual([name]);
    });
});
