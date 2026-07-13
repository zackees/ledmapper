/** Per-strip rotation must use the visible selection bbox and real pointer input. */

import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:shapeeditor-helpDismissed',
    'shapeeditor.freeRotateHintSeen',
];

function makeTwoStripMap() {
    return JSON.stringify({
        map: {
            // Deliberately asymmetric: the bbox center and arithmetic
            // centroid differ, so a centroid pivot cannot pass this spec.
            stripA: { x: [0, 0, 0, 0, 10], y: [0, 1, 2, 3, 0], diameter: 0.5 },
            stripB: { x: [0, 1, 2], y: [5, 5, 5], diameter: 0.5 },
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
        localStorage.removeItem('shapeeditor.overlayCollapsed');
    }, [
        makeTwoStripMap(),
        JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 8, stripCount: 2 }),
    ]);
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(2);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null)).toBe(true);
}

async function cleanup(page) {
    try {
        await page.evaluate((keys) => {
            for (const key of keys) localStorage.removeItem(key);
        }, KEYS);
    } catch { /* page may already be closed */ }
}

async function openStripsPanel(page) {
    const panel = page.locator('#strips_panel');
    if (!await panel.evaluate((el: HTMLDetailsElement) => el.open)) {
        await panel.locator(':scope > summary').click();
    }
}

test.describe('Shapeeditor per-strip rotation', () => {
    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('real pointer drag rotates the selected strip around its visible bbox center; stripB is untouched; Ctrl+Z restores', async ({ page }) => {
        await seedAndOpen(page);
        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        await page.evaluate(() => {
            window.__shapeeditorDebug.selectStrip(1);
            window.__shapeeditorDebug.selectStrip(0);
        });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrip())).toBe(0);
        await openStripsPanel(page);
        await expect(page.locator('#strips_selected_row')).toBeVisible();
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripRotateHandlePos()),
        ).not.toBeNull();
        const handle = await page.evaluate(() => window.__shapeeditorDebug.getStripRotateHandlePos());
        if (!handle) throw new Error('Selected strip rotation handle did not render');
        const visual = await page.evaluate(() => [0, 1, 2, 3, 4].map((i) => window.__shapeeditorDebug.getLedCanvasPos(i)));
        const minX = Math.min(...visual.map((p) => p.clientX));
        const maxX = Math.max(...visual.map((p) => p.clientX));
        const minY = Math.min(...visual.map((p) => p.clientY));
        expect(handle.clientHandleX).toBeCloseTo((minX + maxX) / 2, 1);
        expect(handle.clientHandleY).toBeLessThan(minY);

        // Real browser PointerEvents, not a synthetic debug event. Rotate
        // clockwise by 90 degrees around the handle's visible anchor.
        await page.mouse.move(handle.clientHandleX, handle.clientHandleY);
        await page.mouse.down();
        const lockedHandle = await page.evaluate(() => window.__shapeeditorDebug.getStripRotateHandlePos());
        await page.mouse.move(
            handle.clientAnchorX + (handle.clientAnchorY - handle.clientHandleY),
            handle.clientAnchorY,
            { steps: 5 },
        );
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripRotateHandlePos())).toEqual(lockedHandle);
        await page.mouse.up();

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(afterB).toEqual(beforeB);

        const bboxCenter = (points) => ({
            x: (Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2,
            y: (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2,
        });
        const beforeCenter = bboxCenter(beforeA);
        const afterCenter = bboxCenter(afterA);
        expect(afterCenter.x).toBeCloseTo(beforeCenter.x, 4);
        expect(afterCenter.y).toBeCloseTo(beforeCenter.y, 4);

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(beforeA);
    });

    test('selected-strip controls rotate by presets and a signed custom angle', async ({ page }) => {
        await seedAndOpen(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        await page.evaluate(() => {
            window.__shapeeditorDebug.selectStrip(1);
            window.__shapeeditorDebug.selectStrip(0);
        });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrip())).toBe(0);
        await openStripsPanel(page);
        await expect(page.locator('#strips_selected_row')).toBeVisible();

        await page.locator('#strips_rotate_right').click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).not.toEqual(before);
        const persisted = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(persisted).not.toEqual(makeTwoStripMap());

        await page.locator('#strips_rotate_degrees').fill('-90');
        await page.locator('#strips_rotate_apply').click();
        await expect.poll(() => page.evaluate((expected) => {
            const points = window.__shapeeditorDebug.getStripPoints(0);
            return points.every((point, index) =>
                Math.abs(point[0] - expected[index][0]) < 1e-8
                && Math.abs(point[1] - expected[index][1]) < 1e-8,
            );
        }, before)).toBe(true);
    });

});
