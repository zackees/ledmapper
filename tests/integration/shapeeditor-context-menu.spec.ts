import { test, expect } from './fixtures.ts';

// Mouse-path coverage for the shapeeditor context menu (shipped in PR #22,
// broken silently until PR #243). The #170 inline-style hoist moved
// `display: none` into .shapeeditor-ctx-menu / -ctx-submenu, and the
// show-paths that cleared the inline style fell back to hidden — for every
// user, mouse and touch alike. Only the touch long-press spec asserted menu
// visibility at all, so the mouse paths regressed unguarded. These tests
// close that hole. All visibility assertions use COMPUTED style on the real
// menu elements — never inline-style heuristics, which is exactly what
// rotted last time.

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
    'lm:shapeeditor-helpDismissed',
    'lm:shapeeditor-gestureNotice',
];

function makeTwoStripMap() {
    return JSON.stringify({
        map: {
            stripA: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.5 },
            stripB: { x: [0, 1, 2], y: [5, 5, 5], diameter: 0.5 },
        },
    });
}

/** Seed a deterministic two-strip map and open the editor (mirrors the
 *  touch spec's seedAndOpen, but on the shared mouse context). */
async function seedAndOpen(page) {
    await page.goto('/');
    await page.evaluate((args) => {
        const [json, meta] = args;
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', meta);
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
        localStorage.setItem('lm:shapeeditor-gestureNotice', '1');
    }, [
        makeTwoStripMap(),
        JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 7, stripCount: 2 }),
    ]);
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
        { timeout: 10000 },
    ).toBe(2);
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null),
        { timeout: 5000 },
    ).toBe(true);
}

function menuVisible(page) {
    return page.evaluate(() => {
        const menu = document.querySelector('.shapeeditor-ctx-menu');
        return menu !== null && getComputedStyle(menu).display !== 'none';
    });
}

/** Client coords of an empty canvas spot: top-right of the overlay canvas —
 *  clear of the transform-overlay panels (top-left), the hint strip
 *  (bottom), and the centered fitted map. Raw page.mouse is used for all
 *  canvas clicks: locator.click's actionability check refuses positions
 *  under the floating panels even though the canvas handler would fire. */
async function emptyCanvasPoint(page) {
    const box = await page.locator('canvas').last().boundingBox();
    return { x: box.x + box.width - 40, y: box.y + 40 };
}

test.describe('Shapeeditor context menu (mouse)', () => {

    test.afterEach(async ({ page }) => {
        try {
            await page.evaluate((keys) => {
                for (const k of keys) localStorage.removeItem(k);
            }, KEYS);
        } catch { /* page never navigated */ }
    });

    test('right-click on empty canvas opens the context menu with file ops', async ({ page }) => {
        await seedAndOpen(page);
        expect(await menuVisible(page)).toBe(false);

        const pt = await emptyCanvasPoint(page);
        await page.mouse.click(pt.x, pt.y, { button: 'right' });

        await expect.poll(() => menuVisible(page), { timeout: 2000 }).toBe(true);
        // Empty-space menus include file ops (Save / Load) and the insert /
        // paste / help entries; point-scoped entries stay hidden.
        const menu = page.locator('.shapeeditor-ctx-menu');
        await expect(menu.getByText(/paste/i).first()).toBeVisible();
        await expect(menu.getByText(/help/i).first()).toBeVisible();
    });

    test('right-click on an LED shows the point-scoped Delete entry', async ({ page }) => {
        await seedAndOpen(page);
        const pos = await page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0));
        await page.mouse.click(pos.clientX, pos.clientY, { button: 'right' });

        await expect.poll(() => menuVisible(page), { timeout: 2000 }).toBe(true);
        const menu = page.locator('.shapeeditor-ctx-menu');
        await expect(menu.getByText(/delete point/i).or(menu.getByText(/^delete/i)).first())
            .toBeVisible();
    });

    test('hovering the Load entry reveals the submenu', async ({ page }) => {
        await seedAndOpen(page);
        const pt = await emptyCanvasPoint(page);
        await page.mouse.click(pt.x, pt.y, { button: 'right' });
        await expect.poll(() => menuVisible(page), { timeout: 2000 }).toBe(true);

        // The Load entry's wrapper shows .shapeeditor-ctx-submenu on
        // mouseenter — the second show-path fixed in PR #243.
        await page.locator('.shapeeditor-ctx-menu').getByText(/load screenmap|^load\b/i).first().hover();
        await expect.poll(() => page.evaluate(() => {
            const sub = document.querySelector('.shapeeditor-ctx-submenu');
            return sub !== null && getComputedStyle(sub).display !== 'none';
        }), { timeout: 2000 }).toBe(true);
        // Submenu always carries the "Upload file…" entry.
        await expect(page.locator('.shapeeditor-ctx-submenu').getByText(/upload file/i)).toBeVisible();
    });

    test('mousedown outside the menu dismisses it', async ({ page }) => {
        await seedAndOpen(page);
        const pt = await emptyCanvasPoint(page);
        await page.mouse.click(pt.x, pt.y, { button: 'right' });
        await expect.poll(() => menuVisible(page), { timeout: 2000 }).toBe(true);

        // Dismissal is wired to window mousedown outside the menu
        // (shapeeditor-methods-03.ts). The menu opened at the top-right
        // click point — mousedown far away, bottom-left of the canvas
        // (above the hint strip, clear of the top-left panels' extent).
        const box = await page.locator('canvas').last().boundingBox();
        await page.mouse.click(box.x + 60, box.y + box.height - 80);
        await expect.poll(() => menuVisible(page), { timeout: 2000 }).toBe(false);
    });
});
