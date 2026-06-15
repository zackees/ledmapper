import { test, expect } from './fixtures.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { dropFixture } from '../helpers/drag-drop.ts';
import { prependFledHeader, PixelFormat } from '../../src/render/rgb-video';

test.describe('Video Player', () => {
    test('loads and shows title', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('h1')).toContainText('Video Player');
    });

    test('has movie upload input', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toBeVisible();
    });

    test('movie upload only accepts .fled', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toHaveAttribute('accept', '.fled');
    });

    test('no separate screenmap upload affordance', async ({ page }) => {
        await page.goto('/movieplayer/');
        // The screenmap arrives embedded in the .fled file; there is no
        // sidecar JSON upload in this player anymore.
        await expect(page.locator('#btn_upload_screenmap')).toHaveCount(0);
        await expect(page.locator('#preset_buttons')).toHaveCount(0);
    });

    test('has LED diameter slider', async ({ page }) => {
        await page.goto('/movieplayer/');
        const slider = page.locator('#rng_diameter');
        await expect(slider).toBeVisible();
        await expect(slider).toHaveValue('6');
    });

    test('loading a .fled file populates the scene from the embedded screenmap', async ({ page }) => {
        await page.goto('/movieplayer/');
        await page.locator('#btn_load_movie')
            .setInputFiles(path.resolve('tests/fixtures/test-video.fled'));
        // Canvas renders once the embedded screenmap is applied + frames sliced.
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#screenmap_status')).toContainText('4 LEDs');
        await expect(page.locator('#btn_play')).toBeEnabled();
    });

    test('round-trip: synthesized .fled loads, autoplays, and frames advance', async ({ page }) => {
        // Issue #132: prove a FLED produced via the production helpers (the
        // same buildFledHeader / prependFledHeader Mapped Video Maker uses)
        // round-trips into Movie Player and actually plays. Each frame is
        // a distinct solid color so canvas sampling can detect frame advance
        // without a GPU — the points mesh draws different RGB values per
        // frame.
        const screenmapJson = JSON.stringify({
            map: { grid: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25 } },
        });
        const N_FRAMES = 24;
        const LED_COUNT = 4;
        const payload = new Uint8Array(N_FRAMES * LED_COUNT * 3);
        for (let f = 0; f < N_FRAMES; f++) {
            // Cycle through a hue ring so adjacent frames differ visibly.
            const t = f / N_FRAMES;
            const r = Math.round(255 * Math.abs(Math.cos(2 * Math.PI * t)));
            const g = Math.round(255 * Math.abs(Math.cos(2 * Math.PI * (t - 1 / 3))));
            const b = Math.round(255 * Math.abs(Math.cos(2 * Math.PI * (t - 2 / 3))));
            for (let i = 0; i < LED_COUNT; i++) {
                const off = (f * LED_COUNT + i) * 3;
                payload[off] = r;
                payload[off + 1] = g;
                payload[off + 2] = b;
            }
        }
        const fled = prependFledHeader(payload, screenmapJson, PixelFormat.rgb8);

        const tmpPath = path.join(os.tmpdir(), `fled-roundtrip-${String(Date.now())}.fled`);
        fs.writeFileSync(tmpPath, fled);

        try {
            await page.goto('/movieplayer/');
            await page.locator('#btn_load_movie').setInputFiles(tmpPath);

            // The embedded screenmap drives LED count + status line.
            await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
            await expect(page.locator('#screenmap_status')).toContainText(`${String(LED_COUNT)} LEDs`);
            await expect(page.locator('#screenmap_status')).toContainText(`${String(N_FRAMES)} frames`);
            // Autoplay flips Play -> Pause once frames are queued.
            await expect(page.locator('#btn_play')).toBeEnabled();
            await expect(page.locator('#btn_play')).toHaveValue('Pause');

            // Sample the WebGL canvas twice with a delay long enough for
            // the 30fps animLoop to advance the LED color. Since the
            // points mesh uses preserveDrawingBuffer + per-vertex colors
            // sourced from the current frame, toDataURL() is a stable
            // proxy for "what the user would see".
            async function sampleCanvas(): Promise<string> {
                return await page.evaluate(() => {
                    const canvas = document.querySelector('canvas');
                    return canvas ? canvas.toDataURL('image/png').slice(0, 256) : '';
                });
            }

            const sample1 = await sampleCanvas();
            expect(sample1, 'first canvas sample must be non-empty').not.toBe('');
            await page.waitForTimeout(600); // ~18 frames at 30fps; well past the wrap point of N_FRAMES=24
            const sample2 = await sampleCanvas();
            expect(sample2, 'second canvas sample must be non-empty').not.toBe('');
            expect(sample1, 'canvas pixels must change between samples while playing').not.toBe(sample2);
        } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    });

    test('.fled can be dropped onto the movie drop target', async ({ page }) => {
        await page.goto('/movieplayer/');
        await dropFixture(
            page,
            '#movie_drop_target',
            path.resolve('tests/fixtures/test-video.fled'),
            'test-video.fled',
            'application/octet-stream',
        );
        await expect(page.locator('#btn_play')).toBeEnabled();
        await expect(page.locator('#btn_play')).toHaveValue('Pause');
    });

    test('non-FLED bytes with a .fled extension are rejected by the magic check', async ({ page }) => {
        // Bypass the input's `accept=".fled"` extension filter by giving the
        // file a `.fled` name with non-FLED content. This exercises the
        // parseRgbFrames magic check + rejection dialog (the path that
        // protects users from a renamed-raw-rgb or otherwise-corrupt file).
        const bogus = new Uint8Array(120).fill(0xab);
        const tmpPath = path.join(os.tmpdir(), `bogus-${String(Date.now())}.fled`);
        fs.writeFileSync(tmpPath, bogus);
        try {
            await page.goto('/movieplayer/');
            await page.locator('#btn_load_movie').setInputFiles(tmpPath);
            // Rejection routes through src/ui/dialogs.errorDialog -> SweetAlert2,
            // not the native window.alert, so assert the Swal modal text.
            await expect(page.locator('.swal2-popup'))
                .toContainText(/no embedded screenmap/i, { timeout: 5000 });
        } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    });

    test('play button exists', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_play')).toBeVisible();
    });

    test('LED diameter slider updates display', async ({ page }) => {
        await page.goto('/movieplayer/');
        const slider = page.locator('#rng_diameter');
        await slider.fill('15');
        await expect(page.locator('#txt_curr_diameter')).toHaveText('15');
    });

    test('record button exists', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_record')).toBeVisible();
        await expect(page.locator('#btn_record')).toHaveValue('Record');
    });

    test('record button toggles and downloads a video', async ({ page }) => {
        await page.goto('/movieplayer/');
        await page.locator('#btn_load_movie')
            .setInputFiles(path.resolve('tests/fixtures/test-video.fled'));
        await expect(page.locator('#btn_play')).toBeEnabled();

        const record = page.locator('#btn_record');
        await record.click();
        await expect(record).toHaveValue('Stop');
        await expect(record).toHaveClass(/recording/);

        // Capture a short clip, then stop — toggling off must fire a download.
        await page.waitForTimeout(400);
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
        await record.click();
        await expect(record).toHaveValue('Record');
        await expect(record).not.toHaveClass(/recording/);
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/ledmapper-recording\d+\.(webm|mp4)/);
    });
});
