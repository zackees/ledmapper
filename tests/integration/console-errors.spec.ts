import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';

const allPages = [
    { name: 'app-root', url: '/', needsWebcam: false },
    { name: 'demo', url: '/demo/', needsWebcam: false },
    { name: 'moviemaker', url: '/moviemaker/', needsWebcam: false },
    { name: 'movieplayer', url: '/movieplayer/', needsWebcam: false },
    { name: 'shapeeditor', url: '/shapeeditor/', needsWebcam: false },
];

for (const { name, url, needsWebcam } of allPages) {
    test(`${name} page has no JS errors`, async ({ page }) => {
        if (needsWebcam) {
            await mockWebcam(page);
        }
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1000);
        expect(errors, `JS errors on ${url}: ${errors.join('; ')}`).toHaveLength(0);
    });
}
