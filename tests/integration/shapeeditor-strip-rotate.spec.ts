/**
 * Per-strip (sub-group) rotation handle.
 *
 * Selecting a strip surfaces a dedicated rotation handle. Dragging it
 * rotates ONLY that strip's points around the strip's bbox center —
 * other strips are not touched. Ctrl+Z restores the original points.
 */

import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
    'lm:shapeeditor-helpDismissed',
];

function makeTwoStripMap() {
    return JSON.stringify({
        map: {
            stripA: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.5 },
            stripB: { x: [0, 1, 2],    y: [5, 5, 5],    diameter: 0.5 },
        },
    });
}

async function seedAndOpen(page) {
    await page.goto('/');
    await page.evaluate((args) => {
        const [json, meta] = args;
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', meta);
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    }, [
        makeTwoStripMap(),
        JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 7, stripCount: 2 }),
    ]);
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(
        () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
        { timeout: 10000 },
    ).toBe(2);
    await expect.poll(
        () => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null),
        { timeout: 5000 },
    ).toBe(true);
}

async function cleanup(page) {
    try {
        await page.evaluate((keys) => {
            for (const k of keys) localStorage.removeItem(k);
        }, KEYS);
    } catch { /* ignore */ }
}

test.describe('Shapeeditor per-strip rotation handle', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('drags the rotate handle to rotate stripA; stripB untouched; Ctrl+Z restores', async ({ page }) => {
        await seedAndOpen(page);

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(beforeA.length).toBe(4);
        expect(beforeB.length).toBe(3);

        // Rotate stripA by 90°. The strip starts as a horizontal line of
        // 4 LEDs along Y=0 — after a 90° rotation around its bbox center
        // it becomes a vertical line, so the X coordinates of all LEDs
        // should be (approximately) equal and the Y coordinates should
        // span the same width the X coordinates spanned before.
        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateStripRotateDrag(0, 90)
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // stripB unchanged
        expect(afterB).toEqual(beforeB);

        // stripA actually rotated (some point moved by more than 0.5 px)
        const moved = afterA.some((p, i) => Math.hypot(p[0] - beforeA[i][0], p[1] - beforeA[i][1]) > 0.5);
        expect(moved).toBe(true);

        // After a 90° turn, the X-span before should match the Y-span after.
        const spanX = (pts) => Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
        const spanY = (pts) => Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
        expect(spanY(afterA)).toBeGreaterThan(spanX(beforeA) - 1);

        // Ctrl+Z restores stripA
        await page.evaluate(() => {
            const evt = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
            window.dispatchEvent(evt);
        });
        await expect.poll(async () => {
            const a = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
            return a.every((p, i) => Math.abs(p[0] - beforeA[i][0]) < 0.5 && Math.abs(p[1] - beforeA[i][1]) < 0.5);
        }, { timeout: 2000 }).toBe(true);
    });
});
