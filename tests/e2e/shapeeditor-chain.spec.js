import { test, expect } from './fixtures.js';

test.describe('Shapeeditor chain assembly', () => {
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
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    }

    async function freshEditor(page) {
        await gotoEditor(page);
        await page.locator('#btn_new').evaluate((el) => el.click());
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(0);
    }

    async function placeTwo(page) {
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', 20, 0, {}));
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(2);
    }

    async function downloadSavedJson(page) {
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }

    test('two placed panels yield 1 chain arrow; toggle hides them', async ({ page }) => {
        await freshEditor(page);
        await placeTwo(page);

        // Strips panel auto-shows; expand to expose the checkbox.
        await page.locator('#strips_panel').evaluate((el) => { el.open = true; });
        await expect(page.locator('#strips_show_chain')).toBeVisible();

        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getChainArrowCount())
        ).toBe(1);

        await page.locator('#strips_show_chain').uncheck();
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getChainArrowCount())
        ).toBe(0);

        await page.locator('#strips_show_chain').check();
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getChainArrowCount())
        ).toBe(1);
    });

    test('reverse flips first/last LED of a strip in exported JSON; undo restores', async ({ page }) => {
        await freshEditor(page);
        await placeTwo(page);

        const names = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());
        const first = names[0];

        const before = await downloadSavedJson(page);
        const x0 = before.map[first].x[0];
        const y0 = before.map[first].y[0];
        const xN = before.map[first].x.at(-1);
        const yN = before.map[first].y.at(-1);
        expect(x0 !== xN || y0 !== yN).toBeTruthy();

        await page.evaluate(() => window.__shapeeditorDebug.reverseStrip(0));

        const after = await downloadSavedJson(page);
        expect(after.map[first].x[0]).toBeCloseTo(xN, 3);
        expect(after.map[first].y[0]).toBeCloseTo(yN, 3);
        expect(after.map[first].x.at(-1)).toBeCloseTo(x0, 3);
        expect(after.map[first].y.at(-1)).toBeCloseTo(y0, 3);

        // Undo restores original order
        await page.locator('#btn_undo').click();
        const restored = await downloadSavedJson(page);
        expect(restored.map[first].x[0]).toBeCloseTo(x0, 3);
        expect(restored.map[first].y[0]).toBeCloseTo(y0, 3);
        expect(restored.map[first].x.at(-1)).toBeCloseTo(xN, 3);
        expect(restored.map[first].y.at(-1)).toBeCloseTo(yN, 3);
    });

    test('editing video_offset persists in exported JSON', async ({ page }) => {
        await freshEditor(page);
        await placeTwo(page);

        await page.locator('#strips_panel').evaluate((el) => { el.open = true; });

        // Default sequential offsets ⇒ omitted from JSON.
        const baseline = await downloadSavedJson(page);
        const names = Object.keys(baseline.map);
        expect(names.length).toBe(2);
        expect(baseline.map[names[0]].video_offset).toBeUndefined();
        expect(baseline.map[names[1]].video_offset).toBeUndefined();

        // Engage LOCK (videoOffsetOverride) so vo: becomes editable, then
        // edit the second strip's video_offset to a non-sequential value.
        await page.locator('#strips_list .strip-row[data-strip-idx="1"] button[data-action="lock"]').click();
        const input = page.locator('#strips_list input[data-role="video-offset"][data-strip-idx="1"]');
        await expect(input).toHaveJSProperty('readOnly', false);
        await input.fill('999');
        await input.dispatchEvent('change');

        const edited = await downloadSavedJson(page);
        expect(edited.map[names[1]].video_offset).toBe(999);
        expect(edited.map[names[1]].video_offset_override).toBe(true);

        // Undo the edit, then undo the lock — omission restored.
        await page.locator('#btn_undo').click();
        await page.locator('#btn_undo').click();
        const undone = await downloadSavedJson(page);
        expect(undone.map[names[1]].video_offset).toBeUndefined();
    });
});
