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

test.describe('Shapeeditor Insert Panel dialog', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('I key opens the Insert dialog', async ({ page }) => {
        await freshEditor(page);
        await page.keyboard.press('i');
        const modal = page.locator('.swal2-popup');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal).toContainText(/Insert Panel/i);
        await expect(page.locator('#ins_catalog')).toBeVisible();
        await expect(page.locator('#ins_preview')).toBeVisible();
        // Dismiss
        await page.locator('.swal2-cancel').evaluate((el) => el.click());
        await expect(modal).toBeHidden({ timeout: 5000 });
    });

    test('submitInsertDialog place=center adds a strip', async ({ page }) => {
        await freshEditor(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const label = await page.evaluate(() => window.__shapeeditorDebug.submitInsertDialog({
            catalogId: 'matrix-8x8',
            wiring: 'serpentine',
            corner: 'TL',
            rotation: 0,
            flipH: false,
            flipV: false,
            spacing: 1,
            place: 'center',
        }));
        expect(label).toBe('8×8 Matrix');
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);
        // Accordion should reflect the dialog's options
        const accordionVals = await page.evaluate(() => ({
            wiring: document.querySelector('#pp_wiring').value,
            corner: document.querySelector('#pp_corner').value,
            rotation: document.querySelector('#pp_rotation').value,
        }));
        expect(accordionVals.wiring).toBe('serpentine');
        expect(accordionVals.corner).toBe('TL');
        expect(accordionVals.rotation).toBe('0');
    });

    test('submitInsertDialog place=ghost enters placing mode; click adds a strip', async ({ page }) => {
        await freshEditor(page);
        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        await page.evaluate(() => window.__shapeeditorDebug.submitInsertDialog({
            catalogId: 'matrix-8x8',
            wiring: 'progressive',
            corner: 'BR',
            rotation: 90,
            flipH: true,
            flipV: false,
            spacing: 1.5,
            place: 'ghost',
        }));
        // Now in placing mode
        const mode = await page.evaluate(() => window.__shapeeditorDebug.getPlacingMode());
        expect(mode).toBe('matrix-8x8');
        // Accordion was synced
        const accordionVals = await page.evaluate(() => ({
            wiring: document.querySelector('#pp_wiring').value,
            corner: document.querySelector('#pp_corner').value,
            rotation: document.querySelector('#pp_rotation').value,
            flipH: document.querySelector('#pp_flipH').checked,
            spacing: document.querySelector('#pp_spacing').value,
        }));
        expect(accordionVals.wiring).toBe('progressive');
        expect(accordionVals.corner).toBe('BR');
        expect(accordionVals.rotation).toBe('90');
        expect(accordionVals.flipH).toBe(true);
        expect(accordionVals.spacing).toBe('1.5');
        // Click canvas to commit the placement. We dispatch synthetic mouse
        // events on the overlay canvas (the one mousedown is bound to) to
        // avoid pointer-intercept flakes from stacked canvases.
        await page.evaluate(() => {
            const canvases = document.querySelectorAll('canvas');
            const overlay = canvases[canvases.length - 1];
            const rect = overlay.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { clientX: x, clientY: y, button: 0, bubbles: true };
            overlay.dispatchEvent(new MouseEvent('mousedown', opts));
            overlay.dispatchEvent(new MouseEvent('mouseup', opts));
        });
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);
        // Placing mode should be cleared
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPlacingMode())).toBeNull();
    });
});
