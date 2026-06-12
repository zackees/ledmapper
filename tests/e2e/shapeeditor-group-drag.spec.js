import { test, expect } from './fixtures.js';

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
            stripA: {
                x: [0, 1, 2, 3],
                y: [0, 0, 0, 0],
                diameter: 0.5,
            },
            stripB: {
                x: [0, 1, 2],
                y: [5, 5, 5],
                diameter: 0.5,
            },
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
    // Wait for renderer to populate lastTransformedPts (needed by getLedCanvasPos)
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

test.describe('Shapeeditor group drag + point-edit mode', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('plain LED drag moves the whole strip; other strip untouched; Ctrl+Z restores', async ({ page }) => {
        await seedAndOpen(page);

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(beforeA.length).toBe(4);
        expect(beforeB.length).toBe(3);

        // Drag stripA's first LED (flatIdx = 0) by +30,+20 client px
        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 30, 20, {})
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // All LEDs of strip A moved by the same (non-zero) delta
        const dx0 = afterA[0][0] - beforeA[0][0];
        const dy0 = afterA[0][1] - beforeA[0][1];
        expect(Math.abs(dx0) > 0 || Math.abs(dy0) > 0).toBe(true);
        for (let i = 1; i < beforeA.length; i++) {
            expect(afterA[i][0] - beforeA[i][0]).toBeCloseTo(dx0, 6);
            expect(afterA[i][1] - beforeA[i][1]).toBeCloseTo(dy0, 6);
        }
        // Strip B unchanged
        for (let i = 0; i < beforeB.length; i++) {
            expect(afterB[i][0]).toBeCloseTo(beforeB[i][0], 6);
            expect(afterB[i][1]).toBeCloseTo(beforeB[i][1], 6);
        }

        // Ctrl+Z restores
        await page.keyboard.press('Control+z');
        const restoredA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        for (let i = 0; i < beforeA.length; i++) {
            expect(restoredA[i][0]).toBeCloseTo(beforeA[i][0], 6);
            expect(restoredA[i][1]).toBeCloseTo(beforeA[i][1], 6);
        }
    });

    test('double-click LED enters point-edit mode; Esc exits', async ({ page }) => {
        await seedAndOpen(page);
        await page.evaluate(() => window.__shapeeditorDebug.enterPointEditMode(0));
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(0);
        const hint = await page.evaluate(() => window.__shapeeditorDebug.getHintText());
        expect(hint).toMatch(/Editing points/);
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);
    });

    test('in point-edit mode, dragging an LED moves only that single LED', async ({ page }) => {
        await seedAndOpen(page);
        await page.evaluate(() => window.__shapeeditorDebug.enterPointEditMode(0));

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 25, 15, {})
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // Exactly one LED moved (flatIdx 0 = strip A LED 0)
        let movedA = 0;
        for (let i = 0; i < beforeA.length; i++) {
            const moved = Math.abs(afterA[i][0] - beforeA[i][0]) > 1e-6 || Math.abs(afterA[i][1] - beforeA[i][1]) > 1e-6;
            if (moved) movedA++;
        }
        expect(movedA).toBe(1);

        // Strip B untouched
        for (let i = 0; i < beforeB.length; i++) {
            expect(afterB[i][0]).toBeCloseTo(beforeB[i][0], 6);
            expect(afterB[i][1]).toBeCloseTo(beforeB[i][1], 6);
        }
    });

    test('Alt + drag moves a single LED without entering point-edit mode', async ({ page }) => {
        await seedAndOpen(page);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));

        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 20, 10, { altKey: true })
        );
        expect(ok).toBe(true);

        // Still not in point-edit mode
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));

        // Exactly one LED moved in strip A
        let moved = 0;
        for (let i = 0; i < beforeA.length; i++) {
            if (Math.abs(afterA[i][0] - beforeA[i][0]) > 1e-6 || Math.abs(afterA[i][1] - beforeA[i][1]) > 1e-6) moved++;
        }
        expect(moved).toBe(1);
    });
});
