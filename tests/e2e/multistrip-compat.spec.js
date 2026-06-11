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

    // The worker shares one browser context; screenmap uploads persist via
    // screenmap-store ('lm:screenmap' / 'lm:screenmap-preset'), which would
    // leak into later specs that expect default preset state.
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
        }).catch(() => { /* page never navigated (no localStorage access) */ });
    });

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
        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('moviemaker: multi-strip screenmap loads with no console errors and persists', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        const consoleHandler = msg => { if (msg.type() === 'error') errors.push(msg.text()); };
        page.on('console', consoleHandler);

        await page.goto('/moviemaker/');
        await page.locator('#btn_upload_screenmap').setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('#rng_blur')).toBeEnabled({ timeout: 10000 });

        // Persisted screenmap should round-trip the multi-strip structure
        const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(stored).toBeTruthy();
        const storedJson = JSON.parse(stored);
        const storedLeds = Object.values(storedJson.map)
            .reduce((sum, strip) => sum + strip.x.length, 0);
        expect(storedLeds).toBe(TOTAL_LEDS);

        // Let a couple of animation frames run so overlay/strip drawing executes
        await page.waitForTimeout(1000);
        page.removeListener('console', consoleHandler);
        expect(errors, `Unexpected errors: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('movieplayer: multi-strip screenmap accepts .rgb sized to total LED count', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        const consoleHandler = msg => { if (msg.type() === 'error') errors.push(msg.text()); };
        page.on('console', consoleHandler);

        await page.goto('/movieplayer/');
        await page.locator('#btn_upload_screenmap').setInputFiles(MULTI_SCREENMAP_PATH);
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });

        // The movie input is only enabled once the screenmap parsed successfully
        const movieInput = page.locator('#btn_load_movie');
        await expect(movieInput).toBeEnabled({ timeout: 10000 });

        // Synthetic 2-frame .rgb: frame size must equal TOTAL_LEDS * 3 bytes,
        // proving playback uses the flat multi-strip LED count.
        const frames = 2;
        const rgbBytes = Buffer.alloc(TOTAL_LEDS * 3 * frames, 0x40);
        await movieInput.setInputFiles({
            name: 'multi.rgb',
            mimeType: 'application/octet-stream',
            buffer: rgbBytes,
        });

        // Accepted movie auto-plays (button flips to "Pause"); a count mismatch
        // would have alerted and left the play button disabled.
        const playBtn = page.locator('#btn_play');
        await expect(playBtn).toBeEnabled({ timeout: 10000 });
        await expect(playBtn).toHaveValue('Pause');

        await page.waitForTimeout(500);
        page.removeListener('console', consoleHandler);
        expect(errors, `Unexpected errors: ${errors.join('; ')}`).toHaveLength(0);
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
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
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
