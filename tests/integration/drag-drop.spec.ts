import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import path from 'path';
import { dropFile, dropFixture } from '../helpers/drag-drop.ts';

const SCREENMAP_FIXTURE = path.resolve('tests/fixtures/test-screenmap.json');
const VIDEO_RGB_FIXTURE = path.resolve('tests/fixtures/test-video.rgb');
const VIDEO_MP4_FIXTURE = path.resolve('tests/fixtures/test-video.mp4');

// 1x1 transparent PNG
const PNG_BYTES = Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
));

// The browser context is shared per worker; dropping screenmaps persists
// them via screenmap-store, which would leak into later specs that expect
// default preset state.
test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
        localStorage.removeItem('lm:screenmap');
        localStorage.removeItem('lm:screenmap-preset');
        localStorage.removeItem('lm:screenmap-meta');
        localStorage.removeItem('lm:screenmap-backup');
        localStorage.removeItem('lm:screenmap-backup-meta');
    });
});

test.describe('Demo drag-and-drop', () => {
    test('dropping screenmap then video onto the canvas plays them', async ({ page }) => {
        await page.goto('/demo/');
        await expect(page.locator('#btn_play')).toBeEnabled({ timeout: 15000 });

        await dropFixture(page, 'main.drop-zone', SCREENMAP_FIXTURE, 'test-screenmap.json', 'application/json');
        await expect(page.locator('#btn_play')).toHaveValue('Play');

        await dropFixture(page, 'main.drop-zone', VIDEO_RGB_FIXTURE, 'test-video.rgb', 'application/octet-stream');
        await expect(page.locator('#btn_play')).toHaveValue('Pause');
    });

    test('dropping an unsupported file shows an error', async ({ page }) => {
        await page.goto('/demo/');
        await expect(page.locator('#btn_play')).toBeEnabled({ timeout: 15000 });

        let dialogMessage = null;
        page.once('dialog', (dialog) => {
            dialogMessage = dialog.message();
            return dialog.dismiss();
        });
        await dropFile(page, 'main.drop-zone', { name: 'bad.txt', mimeType: 'text/plain', bytes: [1, 2, 3] });
        await expect.poll(() => dialogMessage).toContain('.json screenmap or .rgb video');
    });
});

test.describe('Moviemaker drag-and-drop', () => {
    test('dropping a screenmap onto the upload row clears the active preset', async ({ page }) => {
        // Screenmap controls are gated until a source is loaded (issue #58).
        await mockWebcam(page);
        await page.goto('/moviemaker/');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
        // Activate a preset first so we can observe the drop clearing it.
        // The preset accordion (issue #206) groups buttons by category; the
        // 8x8 Grid lives in the "Grids" category which is open by default
        // because the autoload picks 16x16_grid as the initial selection.
        const presetBtn = page.locator('button[data-preset-file="8x8_grid.json"]');
        await presetBtn.click();
        await expect(presetBtn).toHaveClass(/active-preset/);

        await dropFixture(page, '#screenmap_drop_target', SCREENMAP_FIXTURE, 'test-screenmap.json', 'application/json');
        await expect(page.locator('.preset-btn.active-preset')).toHaveCount(0);
    });

    test('drag-over toggles the affordance class on the screenmap row', async ({ page }) => {
        await page.goto('/moviemaker/');
        const target = page.locator('#screenmap_drop_target');

        const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
        await page.dispatchEvent('#screenmap_drop_target', 'dragover', { dataTransfer });
        await expect(target).toHaveClass(/drag-over/);
        await page.dispatchEvent('#screenmap_drop_target', 'dragleave', { dataTransfer });
        await expect(target).not.toHaveClass(/drag-over/);
        await dataTransfer.dispose();
    });

    test('dropping a video onto the canvas area starts the source', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#welcome-overlay')).toBeVisible();

        await dropFixture(page, '.canvas-area', VIDEO_MP4_FIXTURE, 'test-video.mp4', 'video/mp4');
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
    });

    test('dropping a non-video file onto the canvas area shows an error', async ({ page }) => {
        await page.goto('/moviemaker/');

        let dialogMessage = null;
        page.once('dialog', (dialog) => {
            dialogMessage = dialog.message();
            return dialog.dismiss();
        });
        await dropFile(page, '.canvas-area', { name: 'bad.txt', mimeType: 'text/plain', bytes: [1, 2, 3] });
        await expect.poll(() => dialogMessage).toContain('video file');
    });
});

test.describe('Shape editor drag-and-drop', () => {
    test('dropping a screenmap onto the load row loads it', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await expect(page.locator('#txt_diameter')).toBeVisible();

        await dropFixture(page, '#screenmap_drop_target', SCREENMAP_FIXTURE, 'test-screenmap.json', 'application/json');
        // Fixture has diameter 0.25; load populates the diameter field from the file
        await expect(page.locator('#txt_diameter')).toHaveValue('0.25');
        await expect(page.locator('#sel_preset_mount .preset-btn.active-preset')).toHaveCount(0);
    });

    test('dropping an image onto the image row enables background controls', async ({ page }) => {
        await page.goto('/shapeeditor/');

        await dropFile(page, '#image_drop_target', { name: 'bg.png', mimeType: 'image/png', bytes: PNG_BYTES });
        await expect(page.locator('#txt_image_opacity')).toBeEnabled({ timeout: 10000 });
        await expect(page.locator('#bg_image_accordion')).toHaveAttribute('open', '');
    });

    test('dropping a non-json file onto the load row shows an error', async ({ page }) => {
        await page.goto('/shapeeditor/');

        let dialogMessage = null;
        page.once('dialog', (dialog) => {
            dialogMessage = dialog.message();
            return dialog.dismiss();
        });
        await dropFile(page, '#screenmap_drop_target', { name: 'bad.csv', mimeType: 'text/csv', bytes: [1, 2, 3] });
        await expect.poll(() => dialogMessage).toContain('.json screenmap');
    });
});
