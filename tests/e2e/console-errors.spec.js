import { test, expect } from '@playwright/test';
import { mockWebcam } from '../helpers/webcam-mock.js';

const allPages = [
    { name: 'hub', url: '/index.html', needsWebcam: false },
    { name: 'demo', url: '/demo/index.html', needsWebcam: false },
    { name: 'screenmap', url: '/screenmap/index.html', needsWebcam: true },
    { name: 'moviemaker', url: '/moviemaker/index.html', needsWebcam: false },
    { name: 'movieplayer', url: '/movieplayer/index.html', needsWebcam: false },
    { name: 'shapeviewer', url: '/shapeviewer/index.html', needsWebcam: false },
];

for (const { name, url, needsWebcam } of allPages) {
    test(`${name} page has no JS errors`, async ({ page }) => {
        if (needsWebcam) {
            await mockWebcam(page);
        }
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        expect(errors, `JS errors on ${url}: ${errors.join('; ')}`).toHaveLength(0);
    });
}
