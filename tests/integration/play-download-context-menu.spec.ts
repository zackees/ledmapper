import { test, expect } from './fixtures.ts';
import type { Download, Page } from '@playwright/test';
import { prependFledHeader, PixelFormat } from '../../src/render/rgb-video';

const SCREENMAP = {
    version: 2,
    groups: { strip1: { color: '#3b82f6' } },
    segments: [{
        id: 'strip1', pin: 'pin1', group: 'strip1',
        x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25,
    }],
};
const SCREENMAP_JSON = JSON.stringify(SCREENMAP);
const RGB_PAYLOAD = new Uint8Array([
    0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0x20, 0x20, 0x20,
    0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0,
]);
const FLED_BYTES = prependFledHeader(RGB_PAYLOAD, SCREENMAP_JSON, PixelFormat.rgb8);

async function readDownload(download: Download): Promise<Buffer> {
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function openMenu(page: Page): Promise<void> {
    const box = await page.locator('.lm-canvas-wrapper').boundingBox();
    if (!box) throw new Error('expected visible player surface');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(page.locator('#demo_context_menu')).toHaveClass(/is-visible/);
}

async function openDownloadSubmenu(page: Page): Promise<void> {
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'Download', exact: true }).hover();
    await expect(page.locator('#demo_download_submenu')).toBeVisible();
}

async function loadCustomMovie(page: Page): Promise<void> {
    await page.goto('/play');
    await expect(page.locator('#btn_play')).toBeEnabled({ timeout: 15_000 });

    await page.locator('#btn_upload_screenmap').setInputFiles({
        name: 'screenmap.json', mimeType: 'application/json', buffer: Buffer.from(SCREENMAP_JSON),
    });
    await expect(page.locator('#demo_download_fled')).toBeDisabled();
    await page.locator('#btn_load_movie').setInputFiles({
        name: 'custom-animation.fled', mimeType: 'application/vnd.fastled.video', buffer: Buffer.from(FLED_BYTES),
    });
    await expect(page.locator('#demo_download_fled')).toBeEnabled();
}

test('play right-click menu exposes downloads in a submenu', async ({ page }) => {
    await loadCustomMovie(page);
    await openMenu(page);
    await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible();
    await expect(page.locator('#demo_download_submenu')).toBeHidden();

    await page.getByRole('menuitem', { name: 'Download', exact: true }).press('ArrowRight');
    await expect(page.locator('#demo_download_submenu')).toBeVisible();
    await expect(page.locator('#demo_download_submenu').getByRole('menuitem')).toHaveText([
        'FLED',
        'screenmap.json',
        'RGB',
    ]);
    await expect(page.getByRole('menuitem', { name: 'FLED', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'screenmap.json', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'RGB', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('menuitem', { name: 'FLED', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#demo_download_submenu')).toBeHidden();
    await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeFocused();
});

test('play right-click submenu stays inside a narrow player surface', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 720 });
    await loadCustomMovie(page);
    await openDownloadSubmenu(page);

    const wrapper = await page.locator('.lm-canvas-wrapper').boundingBox();
    const submenu = await page.locator('#demo_download_submenu').boundingBox();
    if (!wrapper || !submenu) throw new Error('expected visible narrow context menu');
    expect(submenu.x).toBeGreaterThanOrEqual(wrapper.x);
    expect(submenu.x + submenu.width).toBeLessThanOrEqual(wrapper.x + wrapper.width + 1);
    expect(submenu.y).toBeGreaterThanOrEqual(wrapper.y);
    expect(submenu.y + submenu.height).toBeLessThanOrEqual(wrapper.y + wrapper.height + 1);
});

test('play right-click downloads the original FLED byte-for-byte', async ({ page }) => {
    await loadCustomMovie(page);
    await openDownloadSubmenu(page);
    const fledDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'FLED', exact: true }).click();
    const fledDownload = await fledDownloadPromise;
    expect(fledDownload.suggestedFilename()).toBe('custom-animation.fled');
    expect(await readDownload(fledDownload)).toEqual(Buffer.from(FLED_BYTES));
});

test('play right-click downloads the embedded screenmap JSON', async ({ page }) => {
    await loadCustomMovie(page);
    await openDownloadSubmenu(page);
    const screenmapDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'screenmap.json', exact: true }).click();
    const screenmapDownload = await screenmapDownloadPromise;
    expect(screenmapDownload.suggestedFilename()).toBe('screenmap.json');
    expect(JSON.parse((await readDownload(screenmapDownload)).toString('utf8'))).toEqual(SCREENMAP);
});

test('play right-click downloads the raw RGB payload byte-for-byte', async ({ page }) => {
    await loadCustomMovie(page);
    await openDownloadSubmenu(page);
    const rgbDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'RGB', exact: true }).click();
    const rgbDownload = await rgbDownloadPromise;
    expect(rgbDownload.suggestedFilename()).toBe('custom-animation.rgb');
    expect(await readDownload(rgbDownload)).toEqual(Buffer.from(RGB_PAYLOAD));
});
