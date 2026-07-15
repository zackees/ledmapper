import { expect, test } from './fixtures.ts';

const KEYS = ['lm:screenmap', 'lm:screenmap-meta', 'lm:shapeeditor-helpDismissed'];

function map() {
    return JSON.stringify({ map: {
        stripA: { x: [0, 1, 2], y: [0, 0, 0], diameter: 0.5 },
        stripB: { x: [0, 1, 2], y: [40, 40, 40], diameter: 0.5 },
        stripC: { x: [80, 81], y: [0, 0], diameter: 0.5 },
    } });
}

async function open(page) {
    await page.goto('/');
    await page.evaluate((json) => {
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 8, stripCount: 3 }));
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    }, map());
    await page.goto('/create');
    await page.waitForFunction(() => !!window.__shapeeditorDebug);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null)).toBe(true);
}

test.afterEach(async ({ page }) => {
    try {
        await page.evaluate((keys) => {
            for (const key of keys) localStorage.removeItem(key);
        }, KEYS);
    } catch { /* page may already be closed */ }
});

test('Shift-click selects groups and dragging either selected group moves the complete selection', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(0, 32, 16, {}))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0]);
    expect(await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(3, 32, 16, { shiftKey: true }))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0, 1]);

    const before = await page.evaluate(() => [0, 1, 2].map((idx) => window.__shapeeditorDebug.getStripPoints(idx)));
    expect(await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(3, 32, 16, {}))).toBe(true);
    const after = await page.evaluate(() => [0, 1, 2].map((idx) => window.__shapeeditorDebug.getStripPoints(idx)));
    for (const stripIdx of [0, 1]) {
        const dx = after[stripIdx][0][0] - before[stripIdx][0][0];
        const dy = after[stripIdx][0][1] - before[stripIdx][0][1];
        expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
        for (let pointIdx = 1; pointIdx < before[stripIdx].length; pointIdx++) {
            expect(after[stripIdx][pointIdx][0] - before[stripIdx][pointIdx][0]).toBeCloseTo(dx, 6);
            expect(after[stripIdx][pointIdx][1] - before[stripIdx][pointIdx][1]).toBeCloseTo(dy, 6);
        }
    }
    expect(after[2]).toEqual(before[2]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(before[0]);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1))).toEqual(before[1]);
});
