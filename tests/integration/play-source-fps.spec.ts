import { test, expect } from './fixtures.ts';
import { prependFledHeader, PixelFormat } from '../../src/render/rgb-video';
import fs from 'node:fs';
import path from 'node:path';

const SCREENMAP_PATH = path.resolve('tests/fixtures/test-screenmap.json');
const SCREENMAP_JSON = fs.readFileSync(SCREENMAP_PATH, 'utf8');

function testFled(fps: number): Buffer {
    const screenmap = JSON.parse(SCREENMAP_JSON) as Record<string, unknown>;
    const embedded = JSON.stringify({ ...screenmap, video: { fps } });
    const twoFrames = new Uint8Array(4 * 3 * 2).fill(0x40);
    return Buffer.from(prependFledHeader(twoFrames, embedded, PixelFormat.rgb8));
}

test('play Source row uses stable native and override rates', async ({ page }) => {
    await page.addInitScript(() => { localStorage.removeItem('ledmapper.demo.fps'); });
    await page.goto('/play');
    await expect(page.locator('#btn_play')).toBeEnabled({ timeout: 15_000 });

    await page.locator('#btn_upload_screenmap').setInputFiles(SCREENMAP_PATH);
    await page.locator('#btn_load_movie').setInputFiles({
        name: 'fractional.fled',
        mimeType: 'application/octet-stream',
        buffer: testFled(29.97),
    });

    const stats = page.locator('[data-gfx-fps]');
    await expect(stats).toContainText('Source:  29.97');
    await page.waitForTimeout(750);
    await expect(stats).toContainText('Source:  29.97');

    await page.locator('#sel_framerate').selectOption('15');
    await expect(stats).toContainText('Source:  15');

    await page.locator('#sel_framerate').selectOption('native');
    await expect(stats).toContainText('Source:  29.97');
});
