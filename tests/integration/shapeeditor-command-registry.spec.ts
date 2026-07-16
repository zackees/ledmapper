import { test, expect } from './fixtures.ts';

// Coverage for issue #445 — the command registry that unifies New / Load… /
// Save As… / Undo / Redo / Reset transforms / Load background image across
// the header, the "Choose a map" popover, the mobile action row + tools
// sheet, and the right-click context menu.

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
            stripB: { x: [0, 1, 2], y: [5, 5, 5], diameter: 0.5 },
        },
    });
}

async function seedAndOpen(page, viewport) {
    if (viewport) await page.setViewportSize(viewport);
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
    await page.goto('/create');
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
    } catch { /* ignore — page may not have navigated */ }
}

async function emptyCanvasPoint(page) {
    const box = await page.locator('canvas').last().boundingBox();
    return { x: box.x + box.width - 40, y: box.y + 40 };
}

test.describe('Command registry — desktop', () => {
    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('header composition: icon undo/redo, New, Load…, Save As… — no Reset', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });

        const historyGroup = page.locator('.shapeeditor-header .header-history-group');
        await expect(historyGroup).toBeVisible();
        const undoBtn = page.locator('.shapeeditor-header #btn_undo');
        const redoBtn = page.locator('.shapeeditor-header #btn_redo');
        await expect(undoBtn).toBeVisible();
        await expect(redoBtn).toBeVisible();
        await expect(undoBtn.locator('svg')).toHaveCount(1);
        await expect(redoBtn.locator('svg')).toHaveCount(1);
        // Icon-only now — no visible text label (aria-label carries the name).
        expect((await undoBtn.innerText()).trim()).toBe('');
        expect((await redoBtn.innerText()).trim()).toBe('');
        await expect(undoBtn).toHaveAttribute('aria-label', 'Undo');
        await expect(redoBtn).toHaveAttribute('aria-label', 'Redo');

        await expect(page.locator('.shapeeditor-header #btn_header_new')).toHaveText('New');
        await expect(page.locator('.shapeeditor-header #btn_load_screenmap')).toBeVisible();
        await expect(page.locator('.shapeeditor-header #btn_save_as')).toBeVisible();

        // No Reset in the header — it relocated to the Screenmap accordion.
        await expect(page.locator('.shapeeditor-header #btn_reset')).toHaveCount(0);
        await expect(page.locator('#overlay_content #btn_reset')).toHaveCount(1);
    });

    test('Ctrl+S triggers a Save As… download without navigating away', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });
        await expect(page.locator('#btn_save_as')).toBeEnabled();

        let dialogFired = false;
        page.on('dialog', () => { dialogFired = true; });

        const downloadPromise = page.waitForEvent('download');
        await page.keyboard.press('Control+s');
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.json$/);
        expect(dialogFired).toBe(false);
        expect(page.url()).toContain('/create');
    });

    test('Ctrl+S is a no-op (but still suppressed) when Save As… is disabled', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });
        await page.evaluate(() => window.__shapeeditorDebug.forceEmptyDocumentForTest());
        await expect(page.locator('#btn_save_as')).toBeDisabled();

        let downloadFired = false;
        page.on('download', () => { downloadFired = true; });
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(300);
        expect(downloadFired).toBe(false);
    });

    test('"Reset transforms" lives in the Screenmap accordion and clears a transform edit', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });
        const resetBtn = page.locator('#btn_reset');
        await expect(resetBtn).toBeDisabled();

        const rotate = page.locator('#txt_rotate');
        await rotate.fill('45');
        await rotate.dispatchEvent('change');
        await expect(resetBtn).toBeEnabled();
        await expect(rotate).toHaveValue('45');

        await resetBtn.click();
        await expect(rotate).toHaveValue('0');
        await expect(resetBtn).toBeDisabled();
    });

    test('command-enablement parity: context-menu Save As… tracks the header button', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });
        const pt = await emptyCanvasPoint(page);

        await page.mouse.click(pt.x, pt.y, { button: 'right' });
        const ctxSave = page.locator('.shapeeditor-ctx-menu button[data-action="save-as"]');
        await expect(ctxSave).toBeVisible();
        await expect(ctxSave).toBeEnabled();
        await expect(page.locator('#btn_save_as')).toBeEnabled();

        // Clear the document to an empty state WITHOUT closing the menu —
        // the right-click context menu only opens over a non-empty document
        // (onContextMenu bails when screenmap_pts is empty), so this proves
        // the "one refresh updates every bound control" contract live on an
        // already-open surface rather than trying to reopen it empty.
        await page.evaluate(() => window.__shapeeditorDebug.forceEmptyDocumentForTest());
        await expect(page.locator('#btn_save_as')).toBeDisabled();
        await expect(ctxSave).toBeDisabled();
    });

    test('context-menu New / Load ▸ / Load background image… mirror the header commands', async ({ page }) => {
        await seedAndOpen(page, { width: 1280, height: 720 });
        const pt = await emptyCanvasPoint(page);
        await page.mouse.click(pt.x, pt.y, { button: 'right' });

        const menu = page.locator('.shapeeditor-ctx-menu');
        await expect(menu.locator('button[data-action="new"]')).toHaveText('New');
        await expect(menu.getByText('Load ▸')).toBeVisible();
        await expect(menu.locator('button[data-action="load-image"]')).toContainText('Load background image');
    });

    test('context-menu New actually runs the command and closes the menu', async ({ page }) => {
        // The ctx-menu "New" button now has TWO click listeners on it: its own
        // bindCommand-attached listener (runs the command) plus the menu
        // container's delegated listener (unconditionally hides the menu
        // afterward, #445). Exercise both ends of that coexistence.
        await seedAndOpen(page, { width: 1280, height: 720 });
        const before = await page.evaluate(() => window.__lmDebug.shapeeditor.getState());
        expect(before.totalPoints).toBeGreaterThan(0);
        expect(before.stripCount).toBe(2);

        const pt = await emptyCanvasPoint(page);
        await page.mouse.click(pt.x, pt.y, { button: 'right' });
        const menu = page.locator('.shapeeditor-ctx-menu');
        await menu.locator('button[data-action="new"]').click();

        await expect(menu).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.__lmDebug.shapeeditor.getState().totalPoints))
            .toBe(1);
        const after = await page.evaluate(() => window.__lmDebug.shapeeditor.getState());
        expect(after.stripCount).toBe(0);
    });
});

test.describe('Command registry — mobile', () => {
    test.use({ hasTouch: true, isMobile: true });
    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('mobile action row undo/redo work and satisfy the touch-target floor', async ({ page }) => {
        await seedAndOpen(page, { width: 390, height: 664 });

        const mobileUndo = page.locator('#btn_mobile_undo');
        const mobileRedo = page.locator('#btn_mobile_redo');
        await expect(mobileUndo).toBeVisible();
        await expect(mobileRedo).toBeVisible();
        await expect(mobileUndo).toBeDisabled();
        await expect(mobileRedo).toBeDisabled();

        const undoBox = await mobileUndo.boundingBox();
        expect(undoBox).not.toBeNull();
        expect(undoBox.width).toBeGreaterThanOrEqual(44);
        expect(undoBox.height).toBeGreaterThanOrEqual(44);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const ok = await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(0, 30, 20, {}));
        expect(ok).toBe(true);
        const dragged = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        expect(dragged).not.toEqual(before);

        await expect(mobileUndo).toBeEnabled();
        await mobileUndo.click();

        const restored = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        for (let i = 0; i < before.length; i++) {
            expect(restored[i][0]).toBeCloseTo(before[i][0], 6);
            expect(restored[i][1]).toBeCloseTo(before[i][1], 6);
        }
        await expect(mobileUndo).toBeDisabled();
        await expect(mobileRedo).toBeEnabled();

        await mobileRedo.click();
        const redone = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        expect(redone).toEqual(dragged);
    });
});
