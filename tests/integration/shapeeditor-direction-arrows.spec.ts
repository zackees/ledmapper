import { test, expect } from './fixtures.ts';

function makeSerpentine16x16() {
    const x: number[] = [];
    const y: number[] = [];
    for (let row = 0; row < 16; row++) {
        for (let column = 0; column < 16; column++) {
            x.push(row % 2 === 0 ? column : 15 - column);
            y.push(row);
        }
    }
    return JSON.stringify({ map: { matrix: { x, y, diameter: 0.25 } } });
}

const STORAGE_KEYS = ['lm:screenmap', 'lm:screenmap-meta', 'lm:shapeeditor-helpDismissed'];

test.afterEach(async ({ page }) => {
    await page.evaluate((keys) => {
        for (const key of keys) localStorage.removeItem(key);
    }, STORAGE_KEYS);
});

test('Create reveals adaptively spaced direction arrows only while hovering the map', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.evaluate((screenmap) => {
        localStorage.setItem('lm:screenmap', screenmap);
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({
            savedAt: Date.now(), source: 'save', ledCount: 256, stripCount: 1,
        }));
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    }, makeSerpentine16x16());
    await page.goto('/create');
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().totalPoints)).toBe(256);

    const idleState = await page.evaluate(() => window.__lmDebug?.shapeeditor?.getState());
    expect(idleState?.directionArrowCount).toBeGreaterThan(0);
    expect(idleState?.directionArrowCount).toBeLessThan(40);
    expect(idleState?.directionArrowAlpha).toBe(0);

    const centerLed = await page.evaluate(() => window.__shapeeditorDebug?.getLedCanvasPos?.(128));
    if (!centerLed) throw new Error('expected a center LED position');
    await page.mouse.move(centerLed.clientX, centerLed.clientY);
    await expect.poll(
        () => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().directionArrowAlpha),
    ).toBeGreaterThan(0.95);

    const countBeforeZoom = await page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().directionArrowCount ?? 0);
    await page.locator('.shapeeditor-overlay-canvas').dispatchEvent('wheel', { deltaY: -3000 });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug?.getCamZoom?.())).toBeGreaterThan(1.9);
    await expect.poll(
        () => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().directionArrowCount ?? 0),
    ).toBeGreaterThan(countBeforeZoom);

    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    if (!canvas) throw new Error('expected overlay canvas bounds');
    await page.mouse.move(canvas.x + canvas.width - 4, canvas.y + canvas.height - 4);
    await expect.poll(
        () => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().directionArrowAlpha),
    ).toBeLessThan(0.05);
});
