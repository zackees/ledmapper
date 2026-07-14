import { expect, test } from '@playwright/test';
import path from 'path';
import { mockWebcam } from '../helpers/webcam-mock.ts';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

test.describe('mobile Record source setup', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const viewport of [
        { width: 390, height: 664, label: 'portrait' },
        { width: 750, height: 342, label: 'landscape' },
    ]) {
        test(`puts source actions first in ${viewport.label}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('/record', { waitUntil: 'domcontentloaded' });

            const layout = page.locator('.app-layout');
            await expect(layout).toHaveClass(/source-setup/);
            await expect(page.locator('#sidebar')).toBeHidden();
            await expect(page.locator('#canvas-controls')).toBeHidden();

            for (const card of await page.locator('.source-card').all()) {
                await expect(card).toBeVisible();
                const box = await card.boundingBox();
                expect(box).not.toBeNull();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
                expect(box!.y).toBeGreaterThanOrEqual(0);
                expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
                expect(box!.height).toBeGreaterThanOrEqual(44);
            }

            const scrollContract = await page.locator('#app-content').evaluate((el) => ({
                overflowY: getComputedStyle(el).overflowY,
                nestedScrollers: [...el.querySelectorAll('.app-layout *')].filter((child) => {
                    const style = getComputedStyle(child);
                    return /^(auto|scroll)$/.test(style.overflowY) && child.scrollHeight > child.clientHeight;
                }).length,
            }));
            expect(scrollContract.overflowY).toMatch(/^(auto|scroll)$/);
            expect(scrollContract.nestedScrollers).toBe(0);
        });
    }

    test('video selection transitions from setup to the loaded workspace', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 664 });
        await page.goto('/record', { waitUntil: 'domcontentloaded' });

        const chooser = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        await (await chooser).setFiles(VIDEO_PATH);

        await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe('video');
        await expect(page.locator('.app-layout')).not.toHaveClass(/source-setup/);
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/);
        await expect(page.locator('#canvas-controls')).toBeVisible();
    });

    test('webcam selection transitions from setup to the loaded workspace', async ({ page }) => {
        await mockWebcam(page);
        await page.setViewportSize({ width: 390, height: 664 });
        await page.goto('/record', { waitUntil: 'domcontentloaded' });

        await page.locator('[data-trigger="btn_start_webcam"]').click();

        await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe('webcam');
        await expect(page.locator('.app-layout')).not.toHaveClass(/source-setup/);
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/);
    });

    test('camera denial stays in setup with an actionable error', async ({ page }) => {
        await page.addInitScript(() => {
            navigator.mediaDevices.getUserMedia = () => Promise.reject(
                new DOMException('Camera permission denied', 'NotAllowedError'),
            );
        });
        await page.setViewportSize({ width: 390, height: 664 });
        await page.goto('/record', { waitUntil: 'domcontentloaded' });

        await page.locator('[data-trigger="btn_start_webcam"]').click();

        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText(/permission|denied|upload a video/i);
        await expect(page.locator('.app-layout')).toHaveClass(/source-setup/);
        await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
    });

    test('unreadable video stays in setup with an actionable error', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 664 });
        await page.goto('/record', { waitUntil: 'domcontentloaded' });

        const chooser = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        await (await chooser).setFiles({
            name: 'broken.mp4',
            mimeType: 'video/mp4',
            buffer: Buffer.from('not a video'),
        });

        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText(/could not be loaded|another mp4|webm/i);
        await expect(page.locator('.app-layout')).toHaveClass(/source-setup/);
        await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
    });
});
