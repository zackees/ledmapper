import { expect, test, type Page } from '@playwright/test';
import path from 'path';
import { mockWebcam } from '../helpers/webcam-mock.ts';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');

async function loadSource(page: Page, source: 'video' | 'webcam'): Promise<void> {
    if (source === 'video') {
        await page.locator('#video_file_input').setInputFiles(VIDEO_PATH);
    } else {
        await page.locator('[data-trigger="btn_start_webcam"]').click();
    }
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe(source);
    await expect(page.locator('.app-layout')).toHaveAttribute('data-phase', 'workspace');
}

test.describe('mobile loaded Record workspace', () => {
    test.use({ hasTouch: true, isMobile: true });

    for (const source of ['video', 'webcam'] as const) {
        for (const viewport of [
            { width: 390, height: 664, label: 'portrait' },
            { width: 750, height: 342, label: 'landscape' },
        ]) {
            test(`${source} workspace reflows in ${viewport.label}`, async ({ page }) => {
                if (source === 'webcam') await mockWebcam(page);
                await page.setViewportSize(viewport);
                await page.goto('/record', { waitUntil: 'domcontentloaded' });
                await loadSource(page, source);

                const selectors = [
                    '#renderCanvas',
                    '#previewPanel',
                    '#sel_record_format',
                    '#sel_record_aspect',
                    '#sel_max_resolution',
                    '#rng_blur',
                    '#rng_brightness',
                    '#rng_gamma',
                    '#btn_change_video',
                ];
                const layout = await page.evaluate((requiredSelectors) => {
                    const app = document.querySelector<HTMLElement>('#app-content');
                    const record = document.querySelector<HTMLInputElement>('#btn_toggle_record');
                    const previews = document.querySelector<HTMLElement>('.canvas-with-preview');
                    if (!app || !record || !previews) throw new Error('loaded workspace is incomplete');

                    const appRect = app.getBoundingClientRect();
                    const recordRect = record.getBoundingClientRect();
                    const controls = requiredSelectors.map((selector) => {
                        const element = document.querySelector<HTMLElement>(selector);
                        if (!element) throw new Error(`missing ${selector}`);
                        const rect = element.getBoundingClientRect();
                        return {
                            selector,
                            x: rect.x,
                            right: rect.right,
                            topInScrollArea: rect.top - appRect.top + app.scrollTop,
                            bottomInScrollArea: rect.bottom - appRect.top + app.scrollTop,
                        };
                    });

                    app.scrollTop = app.scrollHeight;
                    const scrolledRecordRect = record.getBoundingClientRect();
                    return {
                        app: { clientWidth: app.clientWidth, scrollWidth: app.scrollWidth, scrollHeight: app.scrollHeight },
                        record: {
                            disabled: record.disabled,
                            display: getComputedStyle(record).display,
                            visibility: getComputedStyle(record).visibility,
                            x: recordRect.x,
                            right: recordRect.right,
                            top: recordRect.top,
                            bottom: recordRect.bottom,
                            height: recordRect.height,
                            scrolledTop: scrolledRecordRect.top,
                            scrolledBottom: scrolledRecordRect.bottom,
                        },
                        previewDirection: getComputedStyle(previews).flexDirection,
                        controls,
                    };
                }, selectors);

                expect(layout.app.scrollWidth).toBeLessThanOrEqual(layout.app.clientWidth + 1);
                expect(layout.record.disabled).toBe(false);
                expect(layout.record.display).not.toBe('none');
                expect(layout.record.visibility).not.toBe('hidden');
                expect(layout.record.x).toBeGreaterThanOrEqual(0);
                expect(layout.record.right).toBeLessThanOrEqual(viewport.width + 1);
                expect(layout.record.top).toBeGreaterThanOrEqual(0);
                expect(layout.record.bottom).toBeLessThanOrEqual(viewport.height + 1);
                expect(layout.record.height).toBeGreaterThanOrEqual(44);
                expect(layout.previewDirection).toBe('column');

                for (const control of layout.controls) {
                    expect(control.x, control.selector).toBeGreaterThanOrEqual(0);
                    expect(control.right, control.selector).toBeLessThanOrEqual(viewport.width + 1);
                    expect(control.topInScrollArea, control.selector).toBeGreaterThanOrEqual(0);
                    expect(control.bottomInScrollArea, control.selector).toBeLessThanOrEqual(layout.app.scrollHeight + 1);
                }
                expect(layout.record.scrolledTop).toBeGreaterThanOrEqual(0);
                expect(layout.record.scrolledBottom).toBeLessThanOrEqual(viewport.height + 1);
            });
        }
    }
});
