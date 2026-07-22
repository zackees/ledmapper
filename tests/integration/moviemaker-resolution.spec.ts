import { test, expect } from './fixtures.ts';
import path from 'path';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { shouldSkipGpuTest, GPU_WAIT_SCALE } from '../helpers/gpu-gate.ts';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

/**
 * Wait for the moviemaker's Three.js renderer to be active.
 */
async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 * GPU_WAIT_SCALE });
}

function getCanvasSize(page) {
    return page.locator('#renderCanvas').evaluate(c => ({ w: c.width, h: c.height }));
}

test.describe('Moviemaker Resolution Control @gpu', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL tests require GPU, skipped in CI (set GPU_CI=1 to run)');

    test('resolution select exists with expected options', async ({ page }) => {
        await page.goto('/moviemaker/');
        const sel = page.locator('#sel_max_resolution');
        // Toolbar is hidden until a source is loaded; check element is attached
        await expect(sel).toBeAttached();
        // Default should be 480p
        await expect(sel).toHaveValue('480');
        // Check all options exist
        const options = sel.locator('option');
        await expect(options).toHaveCount(6);
    });

    test('video file canvas scales down when resolution is reduced', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video file via the welcome overlay button
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        // Set resolution to native after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('0');

        // Read native dimensions
        const native = await getCanvasSize(page);
        expect(native.w).toBeGreaterThan(0);
        expect(native.h).toBeGreaterThan(0);

        // Switch to 240p — should be smaller than native
        await page.locator('#sel_max_resolution').selectOption('240');
        const scaled = await getCanvasSize(page);
        const maxDim = Math.max(scaled.w, scaled.h);
        expect(maxDim).toBeLessThanOrEqual(240);
        expect(scaled.w).toBeLessThanOrEqual(native.w);
        expect(scaled.h).toBeLessThanOrEqual(native.h);

        // Aspect ratio should be preserved (within rounding)
        const nativeAspect = native.w / native.h;
        const scaledAspect = scaled.w / scaled.h;
        expect(Math.abs(nativeAspect - scaledAspect)).toBeLessThan(0.1);

        // Switch back to native — should restore original dimensions
        await page.locator('#sel_max_resolution').selectOption('0');
        const restored = await getCanvasSize(page);
        expect(restored.w).toBe(native.w);
        expect(restored.h).toBe(native.h);
    });

    test('resolution label shows current dimensions', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Load video, then set to native
        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);
        await page.locator('#sel_max_resolution').selectOption('0');

        // Label should show dimensions
        const label = page.locator('#txt_curr_resolution');
        const text = await label.textContent();
        expect(text).toMatch(/\d+.*\d+/);

        // Change resolution and verify label updates
        await page.locator('#sel_max_resolution').selectOption('240');
        await expect(label).toContainText('240');
    });

    test('webcam canvas respects max resolution', async ({ page }) => {
        test.setTimeout(60000);
        await mockWebcam(page);
        await page.goto('/moviemaker/');

        // Start webcam first so toolbar becomes visible
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // Set to a small resolution after toolbar is visible
        await page.locator('#sel_max_resolution').selectOption('240');

        // Webcam mock is 480x480 — with max 240, should scale to 240x240
        const size = await getCanvasSize(page);
        expect(size.w).toBe(240);
        expect(size.h).toBe(240);
    });

    test('canvas display fits the fold and preserves the source aspect ratio (#278)', async ({ page }) => {
        test.setTimeout(60000);
        await page.setViewportSize({ width: 1366, height: 768 });
        await mockWebcam(page);
        // A 16:9 source so a per-axis-clamped (squished) display would be
        // visibly wrong — the exact regression #278's first fix introduced,
        // now sized in JS (fitCanvasDisplay) to preserve the ratio. Kept light
        // (default 480p → 480x270 backing) so the headless nightly run isn't
        // saturated by a live 4K render; the fit math is identical at Native.
        await page.addInitScript(() => {
            // video-source reads the webcam's native size from the track's
            // getSettings() (video-source.ts) — report 16:9 (1280x720).
            MediaStreamTrack.prototype.getSettings = function getSettings(this: MediaStreamTrack): MediaTrackSettings {
                return { width: 1280, height: 720 };
            };
        });
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);
        await page.waitForTimeout(300 * GPU_WAIT_SCALE);

        const boxes = () => page.evaluate(() => {
            const rc = document.querySelector<HTMLCanvasElement>('#renderCanvas');
            const oc = document.querySelector<HTMLCanvasElement>('#overlayCanvas');
            if (!rc || !oc) return null;
            const r = rc.getBoundingClientRect();
            const o = oc.getBoundingClientRect();
            return {
                r: { w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom },
                o: { w: o.width, h: o.height, top: o.top, left: o.left },
            };
        });

        const vw = 1366, vh = 768;
        let b = await boxes();
        expect(b).not.toBeNull();
        // Aspect ratio preserved (16:9 ≈ 1.778), not squished/stretched.
        expect(Math.abs((b?.r.w ?? 0) / (b?.r.h ?? 1) - 16 / 9)).toBeLessThan(0.05);
        // Fits within the fold — no wedge (pre-fix the box overflowed and the
        // toolbar was shoved to a negative offset, unreachable).
        expect(b?.r.top ?? -1).toBeGreaterThanOrEqual(0);
        expect(b?.r.left ?? -1).toBeGreaterThanOrEqual(0);
        expect(b?.r.right ?? Infinity).toBeLessThanOrEqual(vw);
        expect(b?.r.bottom ?? Infinity).toBeLessThanOrEqual(vh);
        // Overlay tracks the render canvas 1:1 (LED overlay stays aligned).
        expect(Math.abs((b?.r.w ?? 0) - (b?.o.w ?? 0))).toBeLessThanOrEqual(2);
        expect(Math.abs((b?.r.h ?? 0) - (b?.o.h ?? 0))).toBeLessThanOrEqual(2);
        expect(Math.abs((b?.r.top ?? 0) - (b?.o.top ?? 0))).toBeLessThanOrEqual(2);
        expect(Math.abs((b?.r.left ?? 0) - (b?.o.left ?? 0))).toBeLessThanOrEqual(2);

        // The backing store is untouched (recording quality); only the display
        // box is fitted.
        const backing = await getCanvasSize(page);
        expect(backing.w / backing.h).toBeCloseTo(16 / 9, 1);

        // Changing resolution re-fits while keeping the ratio + fit.
        await page.locator('#sel_max_resolution').selectOption('240');
        await page.waitForTimeout(300 * GPU_WAIT_SCALE);
        b = await boxes();
        expect(Math.abs((b?.r.w ?? 0) / (b?.r.h ?? 1) - 16 / 9)).toBeLessThan(0.05);
        expect(b?.r.bottom ?? Infinity).toBeLessThanOrEqual(vh);
    });

    test('HUD text stays a constant display size when backing resolution changes', async ({ page }) => {
        test.setTimeout(60000);
        await page.setViewportSize({ width: 1366, height: 768 });
        await mockWebcam(page);
        await page.addInitScript(() => {
            MediaStreamTrack.prototype.getSettings = function getSettings(this: MediaStreamTrack): MediaTrackSettings {
                return { width: 1080, height: 1080 };
            };

            interface HudRecord { font: string; transformX: number; transformY: number }
            const records: HudRecord[] = [];
            (window as Window & { __hudFillTextRecords?: HudRecord[] }).__hudFillTextRecords = records;
            // Preserve the original dynamic canvas context receiver.
            // eslint-disable-next-line @typescript-eslint/unbound-method
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function patchedFillText(
                this: CanvasRenderingContext2D,
                text: string,
                x: number,
                y: number,
                maxWidth?: number,
            ): void {
                if (/^(render:|Avg Brightness:|REC )/.test(text)) {
                    const transform = this.getTransform();
                    records.push({ font: this.font, transformX: transform.a, transformY: transform.d });
                    if (records.length > 200) records.shift();
                }
                if (maxWidth === undefined) original.call(this, text, x, y);
                else original.call(this, text, x, y, maxWidth);
            };
        });
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        const readHudMeasurement = () => page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('#overlayCanvas');
            const records = (window as Window & { __hudFillTextRecords?: { font: string; transformX: number; transformY: number }[] }).__hudFillTextRecords ?? [];
            const record = records.at(-1);
            if (!canvas || !record) return null;
            const rect = canvas.getBoundingClientRect();
            const fontPx = Number.parseFloat(record.font);
            return {
                backingWidth: canvas.width,
                displayWidth: rect.width,
                effectiveFontPx: fontPx * record.transformX * rect.width / canvas.width,
            };
        });

        await expect.poll(readHudMeasurement).toMatchObject({ backingWidth: 480 });
        const scaled = await readHudMeasurement();
        expect(scaled).not.toBeNull();
        expect(scaled?.effectiveFontPx ?? 0).toBeGreaterThan(11);
        expect(scaled?.effectiveFontPx ?? 0).toBeLessThan(13);

        await page.evaluate(() => {
            const records = (window as Window & { __hudFillTextRecords?: unknown[] }).__hudFillTextRecords;
            if (records) records.length = 0;
        });
        await page.locator('#sel_max_resolution').selectOption('0');
        await expect.poll(readHudMeasurement).toMatchObject({ backingWidth: 1080 });
        const native = await readHudMeasurement();
        expect(native).not.toBeNull();
        expect(native?.effectiveFontPx ?? 0).toBeGreaterThan(11);
        expect(native?.effectiveFontPx ?? 0).toBeLessThan(13);
        expect(Math.abs((native?.effectiveFontPx ?? 0) - (scaled?.effectiveFontPx ?? 0))).toBeLessThan(1);
    });

    test('Native left-drag maps the displayed pointer into backing-store coordinates (#441)', async ({ page }) => {
        test.setTimeout(45_000);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await mockWebcam(page);
        await page.addInitScript(() => {
            MediaStreamTrack.prototype.getSettings = function getSettings(this: MediaStreamTrack): MediaTrackSettings {
                return { width: 720, height: 1280 };
            };
        });
        await page.goto('/record?perfdebug=1');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);
        await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().screenmapValid)).toBe(true);
        await page.locator('#sel_max_resolution').selectOption('0');

        const overlay = page.locator<HTMLCanvasElement>('#overlayCanvas');
        await expect.poll(() => overlay.evaluate((canvas) => ({ width: canvas.width, height: canvas.height })))
            .toEqual({ width: 720, height: 1280 });
        const box = await overlay.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThan(720);
        expect(box!.height).toBeLessThan(1280);

        const targetRatio = { x: 0.75, y: 0.60 };
        const targetClient = {
            x: box!.x + box!.width * targetRatio.x,
            y: box!.y + box!.height * targetRatio.y,
        };
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetClient.x, targetClient.y, { steps: 5 });
        await page.mouse.up();

        const expected = { x: 720 * targetRatio.x, y: 1280 * targetRatio.y };
        const targetTranslate = await page.evaluate(() => {
            const state = window.__mmDebug?.getState?.() as { targetTranslate?: [number, number] } | undefined;
            return state?.targetTranslate ?? null;
        });
        expect(targetTranslate).not.toBeNull();
        expect(Math.abs(targetTranslate![0] - expected.x)).toBeLessThan(0.01);
        expect(Math.abs(targetTranslate![1] - expected.y)).toBeLessThan(0.01);
    });

    test('default 480p limits large video canvas', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/moviemaker/');

        // Default is 480p — load video and verify canvas is constrained
        await expect(page.locator('#sel_max_resolution')).toHaveValue('480');

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(VIDEO_PATH);
        await waitForSourceActive(page);

        const size = await getCanvasSize(page);
        const maxDim = Math.max(size.w, size.h);
        expect(maxDim).toBeLessThanOrEqual(480);
    });
});
