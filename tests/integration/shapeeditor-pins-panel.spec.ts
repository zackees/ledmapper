import { test, expect } from './fixtures.ts';
import path from 'path';

const MULTI_SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap-multi.json');

test.describe('Shapeeditor pins panel (issue #24)', () => {

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
            localStorage.removeItem('lm:shapeeditor-repinToastShown');
        });
    });

    async function loadMulti(page) {
        await page.goto('/');
        await page.evaluate(() => {
            for (const key of ['lm:screenmap', 'lm:screenmap-preset', 'lm:screenmap-meta', 'lm:screenmap-backup', 'lm:screenmap-backup-meta']) localStorage.removeItem(key);
        });
        await page.goto('/create');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);
        // This regression suite exercises a single-pin starting state even
        // though the generic multi-strip fixture preserves distinct pin IDs.
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(1, 'pin1'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1']);
        await page.locator('#strips_panel').evaluate((el) => { el.open = true; });
    }

    test('single-pin map renders one pin group with all strips', async ({ page }) => {
        await loadMulti(page);
        const groups = page.locator('#strips_list .pin-group');
        await expect(groups).toHaveCount(1);
        await expect(groups.first().locator('.pin-name')).toHaveText('pin1');
        await expect(groups.first().locator('.pin-meta')).toContainText('2 strips');
        await expect(groups.first().locator('.pin-meta')).toContainText('7 LEDs');
        await expect(page.locator('#strips_list .strip-row')).toHaveCount(2);
        const summary = await page.evaluate(() => window.__shapeeditorDebug.getPinSummary());
        expect(summary).toEqual([{ pinId: 'pin1', stripIndices: [0, 1], totalCount: 7 }]);
    });

    test('repin via debug hook creates second pin group and re-derives offsets', async ({ page }) => {
        await loadMulti(page);
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(1, 'pin2'));

        await expect(page.locator('#strips_list .pin-group')).toHaveCount(2);
        const summary = await page.evaluate(() => window.__shapeeditorDebug.getPinSummary());
        expect(summary.map((p) => p.pinId)).toEqual(['pin1', 'pin2']);
        expect(summary[0].totalCount).toBe(4);
        expect(summary[1].totalCount).toBe(3);

        // Derived chain offsets: pin1 strip at 0, pin2 strip at 4.
        const offsets = await page.evaluate(() => window.__shapeeditorDebug.getVideoOffsets());
        expect(offsets).toEqual([
            { video_offset: 0, override: false },
            { video_offset: 4, override: false },
        ]);
    });

    test('Move-to-pin dropdown repins the selected strip to a new pin', async ({ page }) => {
        await loadMulti(page);
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(1));
        const row = page.locator('#strips_selected_row');
        await expect(row).toBeVisible();
        await expect(page.locator('#strips_selected_label')).toContainText('strip2 (pin1)');

        await page.locator('#strips_move_pin').selectOption('__new__');

        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);
        await expect(page.locator('#strips_list .pin-group')).toHaveCount(2);
        await expect(page.locator('#strips_selected_label')).toContainText('strip2 (pin2)');
    });

    test('undo/redo restores pin assignment', async ({ page }) => {
        await loadMulti(page);
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(0, 'pin2'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1']);
        await expect(page.locator('#strips_list .pin-group')).toHaveCount(1);

        await page.keyboard.press('Control+y');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);
        await expect(page.locator('#strips_list .pin-group')).toHaveCount(2);
    });

    test('autosave preserves pin assignments across reload', async ({ page }) => {
        await loadMulti(page);
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(1, 'pin7'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin7']);

        await page.reload();
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug?.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin7']);
        await page.locator('#strips_panel').evaluate((el) => { el.open = true; });
        await expect(page.locator('#strips_list .pin-group')).toHaveCount(2);
    });

    test('LOCK toggle makes video_offset editable; unlock re-derives', async ({ page }) => {
        await loadMulti(page);
        const row2 = page.locator('#strips_list .strip-row[data-strip-idx="1"]');
        const voInput = row2.locator('input[data-role="video-offset"]');
        const lockBtn = row2.locator('button[data-action="lock"]');

        // Derived by default: readonly, value 4 (strip1 has 4 LEDs).
        await expect(voInput).toHaveValue('4');
        await expect(voInput).toHaveJSProperty('readOnly', true);
        await expect(lockBtn).toHaveAttribute('aria-pressed', 'false');

        // Engage LOCK → editable.
        await lockBtn.click();
        const voInput2 = page.locator('#strips_list .strip-row[data-strip-idx="1"] input[data-role="video-offset"]');
        await expect(voInput2).toHaveJSProperty('readOnly', false);
        await expect(page.locator('#strips_list .strip-row[data-strip-idx="1"] button[data-action="lock"]'))
            .toHaveAttribute('aria-pressed', 'true');

        // Edit the manual value.
        await voInput2.fill('99');
        await voInput2.dispatchEvent('change');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getVideoOffsets()))
            .toEqual([
                { video_offset: 0, override: false },
                { video_offset: 99, override: true },
            ]);

        // Unlock → re-derive back to 4.
        await page.locator('#strips_list .strip-row[data-strip-idx="1"] button[data-action="lock"]').click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getVideoOffsets()))
            .toEqual([
                { video_offset: 0, override: false },
                { video_offset: 4, override: false },
            ]);
        await expect(page.locator('#strips_list .strip-row[data-strip-idx="1"] input[data-role="video-offset"]'))
            .toHaveJSProperty('readOnly', true);
    });
});
