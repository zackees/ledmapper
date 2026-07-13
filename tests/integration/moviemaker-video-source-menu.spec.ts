import { test, expect } from './fixtures.ts';
import path from 'path';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

async function loadVideo(page, trigger: string, name = 'first.mp4') {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(trigger).click();
    await (await chooser).setFiles({ name, mimeType: 'video/mp4', buffer: await import('fs/promises').then(fs => fs.readFile(VIDEO_PATH)) });
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceName)).toBe(name);
}

test.describe('Moviemaker video source replacement', () => {
    test('replaces video from toolbar and exposes canvas source menu', async ({ page }) => {
        await page.goto('/moviemaker/');
        await loadVideo(page, '[data-trigger="btn_load_video"]');

        await expect(page.locator('#btn_change_video')).toBeVisible();
        await loadVideo(page, '#btn_change_video', 'second.mp4');

        const canvas = page.locator('#overlayCanvas');
        await canvas.click({ button: 'right' });
        const menu = page.getByRole('menu', { name: 'Video source options' });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem')).toHaveText(['Change Video…', 'Use Webcam', 'Unload Source']);

        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await canvas.click({ button: 'right' });
        await page.mouse.click(5, 5);
        await expect(menu).toBeHidden();
    });

    test('right-drag keeps zoom behavior without opening the menu', async ({ page }) => {
        await page.goto('/moviemaker/');
        await loadVideo(page, '[data-trigger="btn_load_video"]');
        const canvas = page.locator('#overlayCanvas');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        const before = await page.locator('#rng_zoom').inputValue();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 30);
        await page.mouse.up({ button: 'right' });
        await expect(page.locator('#rng_zoom')).not.toHaveValue(before);
        await expect(page.getByRole('menu', { name: 'Video source options' })).toBeHidden();
    });
});
