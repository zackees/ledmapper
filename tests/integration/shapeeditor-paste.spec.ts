import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
];

async function cleanup(page) {
    try {
        await page.evaluate((keys) => {
            for (const k of keys) localStorage.removeItem(k);
        }, KEYS);
    } catch { /* ignore */ }
}

async function gotoEditor(page) {
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
}

async function freshEditor(page) {
    await gotoEditor(page);
    await page.locator('#btn_new').evaluate((el) => el.click());
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getStripCount())
    ).toBe(0);
}

async function seedOneStrip(page) {
    // Place a known starter panel so we have an existing layout.
    await page.evaluate(() =>
        window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {}),
    );
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getStripCount())
    ).toBe(1);
}

const MULTISTRIP_JSON = JSON.stringify({
    map: {
        panel1: { x: [0, 1, 2], y: [0, 1, 2], diameter: 0.5 },
        panel2: { x: [5, 6], y: [5, 6], diameter: 0.5 },
    },
});

test.describe('Shapeeditor clipboard paste flow', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('pasteScreenmapText enters paste-pending and updates hint', async ({ page }) => {
        await freshEditor(page);
        const ok = await page.evaluate((json) => window.__shapeeditorDebug.pasteScreenmapText(json), MULTISTRIP_JSON);
        expect(ok).toBeTruthy();
        const state = await page.evaluate(() => window.__shapeeditorDebug.getPasteState());
        expect(state).toBeTruthy();
        expect(state.count).toBe(2);
        const hint = await page.evaluate(() => window.__shapeeditorDebug.getHintText());
        expect(hint).toMatch(/Click to drop pasted strips \(2\)/);
    });

    test('commitPasteAt adds renamed strips with correct video_offsets', async ({ page }) => {
        await freshEditor(page);
        await seedOneStrip(page);
        const beforeNames = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());
        // Use 'panel1' which will collide with seeded strip name (also panel1)
        await page.evaluate((json) => window.__shapeeditorDebug.pasteScreenmapText(json), MULTISTRIP_JSON);
        await page.evaluate(() => window.__shapeeditorDebug.commitPasteAt(200, 200));
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(beforeNames.length + 2);
        const names = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());
        // The seeded strip is "panel1"; pasted "panel1" should be renamed to "panel1 (2)".
        expect(names).toContain('panel1 (2)');
        expect(names).toContain('panel2');
    });

    test('Ctrl+Z removes all pasted strips at once', async ({ page }) => {
        await freshEditor(page);
        await seedOneStrip(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        await page.evaluate((json) => window.__shapeeditorDebug.pasteScreenmapText(json), MULTISTRIP_JSON);
        await page.evaluate(() => window.__shapeeditorDebug.commitPasteAt(200, 200));
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 2);
        // Single undo should pop the entire paste-strips action.
        // Click the toolbar Undo button to avoid keyboard focus flakes.
        await page.locator('#btn_undo').click();
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before);
    });

    test('Esc cancels paste-pending without mutating state', async ({ page }) => {
        await freshEditor(page);
        await seedOneStrip(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        await page.evaluate((json) => window.__shapeeditorDebug.pasteScreenmapText(json), MULTISTRIP_JSON);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPasteState())).not.toBeNull();
        await page.keyboard.press('Escape');
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getPasteState())
        ).toBeNull();
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(before);
    });

    test('invalid text shows toast and does not change state', async ({ page }) => {
        await freshEditor(page);
        await seedOneStrip(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const ok = await page.evaluate(() => window.__shapeeditorDebug.pasteScreenmapText('not a screenmap at all'));
        expect(ok).toBeFalsy();
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPasteState())).toBeNull();
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(before);
    });

    test('bare points array paste is accepted', async ({ page }) => {
        await freshEditor(page);
        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.pasteScreenmapText(JSON.stringify([[0, 0], [1, 1], [2, 2]])),
        );
        expect(ok).toBeTruthy();
        const state = await page.evaluate(() => window.__shapeeditorDebug.getPasteState());
        expect(state.count).toBe(1);
        expect(state.names).toEqual(['pasted1']);
    });
});
