import { test, expect, type Page } from './fixtures.ts';

function makeFled(filename = 'my-show.fled') {
    const metadata = JSON.stringify({
        map: { strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.25 } },
        video: { fps: 29.97 },
    });
    const json = Buffer.from(metadata);
    const header = Buffer.alloc(12);
    header.write('FLED', 0, 'ascii');
    header[4] = 1;
    header[5] = 0;
    header.writeUInt32LE(json.length, 8);
    const payload = Buffer.from([
        255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
        0, 0, 0, 32, 32, 32, 64, 64, 64, 128, 128, 128,
    ]);
    return { name: filename, mimeType: 'application/vnd.fastled.video', buffer: Buffer.concat([header, json, payload]) };
}

function rawFled(metadata: string, payload: number[], filename: string) {
    const json = Buffer.from(metadata);
    const header = Buffer.alloc(12);
    header.write('FLED', 0, 'ascii');
    header[4] = 1;
    header[5] = 0;
    header.writeUInt32LE(json.length, 8);
    return { name: filename, mimeType: 'application/vnd.fastled.video', buffer: Buffer.concat([header, json, Buffer.from(payload)]) };
}

async function loadFled(page: Page, filename = 'my-show.fled') {
    await page.locator('#btn_load_movie').setInputFiles(makeFled(filename));
    await expect(page.locator('#demo_media_status')).toContainText(filename);
}

const validTwoLedMap = JSON.stringify({ map: { strip1: { x: [0, 1], y: [0, 0] } } });
const invalidFledCases = [
    { label: 'truncated header', file: { name: 'truncated.fled', mimeType: 'application/vnd.fastled.video', buffer: Buffer.from('FLED') }, title: 'Invalid FLED file' },
    { label: 'bad JSON', file: rawFled('{', [], 'bad-json.fled'), title: 'Invalid embedded screenmap' },
    { label: 'empty map', file: rawFled(JSON.stringify({ map: {} }), [], 'empty-map.fled'), title: 'Invalid embedded screenmap' },
    { label: 'zero frames', file: rawFled(validTwoLedMap, [], 'zero-frames.fled'), title: 'Empty FLED file' },
    { label: 'payload mismatch', file: rawFled(validTwoLedMap, [1], 'mismatch.fled'), title: 'Frame size mismatch' },
];

test('Play introduces the sample and makes loading a FLED obvious', async ({ page }) => {
    await page.goto('/play');
    await expect(page.getByRole('heading', { name: 'See your LEDs in motion' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play your FLED' })).toBeVisible();
    await expect(page.getByText('or drop a .fled file anywhere on this player')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create a FLED' })).toHaveAttribute('href', '/record');
    await expect(page.locator('#demo_media_status')).toContainText('Sample FLED');
});

test('visible CTA opens the FLED file picker', async ({ page }) => {
    await page.goto('/play');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Play your FLED' }).click();
    await chooser;
});

test('a self-contained FLED replaces the sample map and starts playing', async ({ page }) => {
    await page.goto('/play');
    await loadFled(page);
    await expect(page.locator('#demo_media_status')).toHaveText('my-show.fled - 4 LEDs - 2 frames - 29.97 fps');
    await expect(page.locator('#sel_framerate option[value="native"]')).toHaveText('Native (29.97)');
    await expect(page.locator('#btn_play')).toHaveValue('Pause');
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.demo?.getState())).toEqual({
        frameCount: 2, ledCount: 4, playing: true, filename: 'my-show.fled', sourceFps: 29.97,
    });
});

test('a delayed sample response cannot overwrite a user-selected FLED', async ({ page }) => {
    let releaseSample: (() => void) | undefined;
    const sampleGate = new Promise<void>((resolve) => { releaseSample = resolve; });
    await page.route('**/demo/video.fled', async (route) => {
        await sampleGate;
        await route.continue();
    });
    await page.goto('/play');
    await loadFled(page, 'user-choice.fled');
    const sampleResponse = page.waitForResponse('**/demo/video.fled');
    releaseSample?.();
    await sampleResponse;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }))));
    await expect(page.locator('#demo_media_status')).toContainText('user-choice.fled');
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.demo?.getState().filename)).toBe('user-choice.fled');
});

test('dropping a FLED uses the same self-contained load path', async ({ page }) => {
    await page.goto('/play');
    const fled = makeFled('dropped-show.fled');
    await page.locator('main').evaluate((target, fileData) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(fileData.bytes)], fileData.name, { type: fileData.type }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { name: fled.name, type: fled.mimeType, bytes: [...fled.buffer] });
    await expect(page.locator('#demo_media_status')).toContainText('dropped-show.fled');
});

for (const invalid of invalidFledCases) {
    test(`a ${invalid.label} replacement preserves the active FLED`, async ({ page }) => {
        await page.goto('/play');
        await loadFled(page, 'keep-playing.fled');
        const before = await page.locator('#demo_media_status').textContent();
        const stateBefore = await page.evaluate(() => window.__lmDebug?.demo?.getState());
        await page.locator('#btn_load_movie').setInputFiles(invalid.file);
        await expect(page.getByRole('heading', { name: invalid.title })).toBeVisible();
        await expect(page.locator('#demo_media_status')).toHaveText(before ?? '');
        await expect(page.locator('#btn_play')).toHaveValue('Pause');
        await expect.poll(() => page.evaluate(() => window.__lmDebug?.demo?.getState())).toEqual(stateBefore);
    });
}

test('mobile onboarding stays above the preview and below navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/play');
    const rect = (selector: string) => page.locator(selector).evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const nav = await rect('.nav-bar');
    const intro = await rect('.demo-intro');
    const stage = await rect('.lm-canvas-wrapper');
    expect(intro.y).toBeGreaterThanOrEqual(nav.y + nav.height - 1);
    expect(stage.y).toBeGreaterThanOrEqual(intro.y + intro.height - 1);
    expect(stage.width).toBeLessThanOrEqual(390);
    expect(stage.width).toBeGreaterThan(300);
    expect(Math.abs(stage.width - stage.height)).toBeLessThan(2);
});

test('desktop preview occupies a meaningful square beside the introduction', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/play');
    const stage = await page.locator('.lm-canvas-wrapper').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
    });
    expect(stage.width).toBeGreaterThan(500);
    expect(Math.abs(stage.width - stage.height)).toBeLessThan(2);
});

test('laptop preview remains square and inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/play');
    const stage = await page.locator('.lm-canvas-wrapper').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { y: box.y, width: box.width, height: box.height, bottom: box.bottom };
    });
    expect(stage.width).toBeGreaterThan(500);
    expect(Math.abs(stage.width - stage.height)).toBeLessThan(2);
    expect(stage.y).toBeGreaterThan(0);
    expect(stage.bottom).toBeLessThanOrEqual(768);
});
