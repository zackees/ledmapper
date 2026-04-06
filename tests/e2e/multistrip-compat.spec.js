import { test, expect } from './fixtures.js';
import path from 'path';
import fs from 'fs';

const MULTI_SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap-multi.json');
const MULTI_SCREENMAP_JSON = fs.readFileSync(MULTI_SCREENMAP_PATH, 'utf-8');

// Total LEDs across all strips in the multi-strip fixture
const multiScreenmap = JSON.parse(MULTI_SCREENMAP_JSON);
const TOTAL_LEDS = Object.values(multiScreenmap.map)
    .reduce((sum, strip) => sum + strip.x.length, 0);

test.describe('Multi-strip screenmap compatibility', () => {

    test('moviemaker: upload multi-strip screenmap enables controls', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.goto('/moviemaker/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        // After uploading, controls should become enabled (no error dialog)
        await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 });
        expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('movieplayer: upload multi-strip screenmap renders canvas', async ({ page }) => {
        await page.goto('/movieplayer/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('shapeeditor: upload multi-strip screenmap renders canvas', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('no JS errors on any page with multi-strip screenmap in localStorage', async ({ page }) => {
        // First, store the multi-strip screenmap in localStorage via movieplayer
        await page.goto('/movieplayer/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        // Wait for the canvas to appear — proves the screenmap was parsed and saved
        await expect(page.locator('canvas')).toBeVisible({ timeout: 10000 });
        // Verify localStorage was actually populated
        const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(stored, 'localStorage should contain screenmap after upload').toBeTruthy();
        const parsed = JSON.parse(stored);
        expect(Object.keys(parsed.map).length).toBe(2); // 2 strips

        // Now visit each tool page and check for JS errors
        const toolPages = ['/demo/', '/moviemaker/', '/movieplayer/', '/shapeeditor/'];
        for (const url of toolPages) {
            const errors = [];
            const handler = err => errors.push(err.message);
            page.on('pageerror', handler);
            await page.goto(url, { waitUntil: 'load' });
            // Allow async init (p5/Three.js setup) to settle after page load
            await page.waitForTimeout(2000);
            page.removeListener('pageerror', handler);
            expect(errors, `JS errors on ${url}: ${errors.join('; ')}`).toHaveLength(0);
        }
    });

    test('multi-strip fixture has expected total LED count', () => {
        // Sanity check the fixture itself
        expect(TOTAL_LEDS).toBe(7); // strip1: 4 + strip2: 3
    });

    test('shapeeditor: save preserves multi-strip structure', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        // Wait for canvas to render
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        // Make a small change to enable Save
        await page.locator('#txt_scale').fill('1.5');
        await page.waitForTimeout(500);

        // Click save and capture download
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const buf = await (await download.createReadStream()).toArray();
        const text = Buffer.concat(buf).toString('utf-8');
        const json = JSON.parse(text);

        // Should have both strips preserved
        expect(Object.keys(json.map).length).toBe(2);
        expect(json.map.strip1).toBeTruthy();
        expect(json.map.strip2).toBeTruthy();
        expect(json.map.strip1.x.length).toBe(4);
        expect(json.map.strip2.x.length).toBe(3);
    });

    test('shapeeditor: save preserves per-strip diameter', async ({ page }) => {
        await page.goto('/shapeeditor/');
        const fileInput = page.locator('#btn_upload_screenmap');
        await fileInput.setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.locator('#txt_scale').fill('1.1');
        await page.waitForTimeout(500);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const buf = await (await download.createReadStream()).toArray();
        const text = Buffer.concat(buf).toString('utf-8');
        const json = JSON.parse(text);

        // Original fixture has strip1.diameter=0.25, strip2.diameter=0.5
        expect(json.map.strip1.diameter).toBe(0.25);
        expect(json.map.strip2.diameter).toBe(0.5);
    });
});
