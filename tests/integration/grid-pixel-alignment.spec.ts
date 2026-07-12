import { test, expect } from './fixtures.ts';

const STORAGE_KEYS = ['lm:screenmap', 'lm:screenmap-meta', 'lm:screenmap-preset'];

async function clearStoredLayout(page): Promise<void> {
    await page.goto('/');
    await page.evaluate((keys) => {
        for (const key of keys) localStorage.removeItem(key);
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    }, STORAGE_KEYS);
}

function expectUniformAxisLevels(levels: number[], expectedCount: number): void {
    expect(levels).toHaveLength(expectedCount);
    const gaps = levels.slice(1).map((value, index) => value - (levels[index] ?? value));
    expect(new Set(gaps).size, `raster gaps: ${gaps.join(',')}`).toBe(1);
}

test.afterEach(async ({ page }) => {
    await page.evaluate((keys) => {
        for (const key of keys) localStorage.removeItem(key);
    }, STORAGE_KEYS).catch(() => undefined);
});

test('Create pixel-aligns every row and column of the default 64x64 Quad Serpentine', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await clearStoredLayout(page);
    await page.goto('/create');
    await page.waitForFunction(() => Boolean(window.__shapeeditorDebug?.getLedCanvasPos?.(4095)));

    const axes = await page.evaluate(() => {
        const xs = new Set<number>();
        const ys = new Set<number>();
        for (let index = 0; index < 4096; index++) {
            const point = window.__shapeeditorDebug?.getLedCanvasPos?.(index);
            if (!point) continue;
            xs.add(Math.round(point.canvasX));
            ys.add(Math.round(point.canvasY));
        }
        return {
            xs: [...xs].sort((a, b) => a - b),
            ys: [...ys].sort((a, b) => a - b),
        };
    });

    expectUniformAxisLevels(axes.xs, 64);
    expectUniformAxisLevels(axes.ys, 64);
});

test('Record pixel-aligns every row and column of the default 64x64 Quad Serpentine', async ({ page }) => {
    await clearStoredLayout(page);
    await page.goto('/record?perfdebug=1');
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 4096);

    const axes = await page.evaluate(() => {
        const points = window.__mmDebug?.getState?.().localPts ?? [];
        return {
            xs: [...new Set(points.map((point) => Math.round(point[0])))].sort((a, b) => a - b),
            ys: [...new Set(points.map((point) => Math.round(point[1])))].sort((a, b) => a - b),
        };
    });

    expectUniformAxisLevels(axes.xs, 64);
    expectUniformAxisLevels(axes.ys, 64);
});
