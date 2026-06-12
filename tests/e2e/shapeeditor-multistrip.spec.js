import { test, expect } from './fixtures.js';
import path from 'path';

const MULTI_SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap-multi.json');
const SINGLE_SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap.json');

test.describe('Shapeeditor per-strip Start/End labels', () => {

    // The shared worker context persists localStorage between tests —
    // clean up the screenmap keys so other specs aren't polluted.
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
        });
    });

    test('multi-strip screenmap computes per-strip labels without errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });

        // Strip count is reflected in app state (labels are canvas-drawn,
        // so assert via the debug hook exposed for tests).
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);

        const labels = await page.evaluate(() => window.__shapeeditorDebug.getStripLabels());
        // "strip1"/"strip2" are auto-indexed names -> zero-based index labels
        expect(labels).toEqual([
            { start: 'Start0', end: 'End0' },
            { start: 'Start1', end: 'End1' },
        ]);

        expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('single-strip screenmap regression: one pair of labels, no errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(SINGLE_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });

        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(1);

        const labels = await page.evaluate(() => window.__shapeeditorDebug.getStripLabels());
        expect(labels).toEqual([
            { start: 'Start0', end: 'End0' },
        ]);

        expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
    });
});
