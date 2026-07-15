import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
    'lm:shapeeditor-helpDismissed',
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

test.describe('Shapeeditor discoverability (hint strip + help overlay)', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('hint strip is visible on load', async ({ page }) => {
        // Suppress first-run modal for this assertion
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        const strip = page.locator('#hint_strip');
        await expect(strip).toBeVisible();
        await expect(page.locator('#hint_strip_help')).toBeVisible();
        const text = await page.evaluate(() => window.__shapeeditorDebug.getHintText());
        expect(text).toMatch(/Drag canvas: pan|Right-click for menu/);
    });

    test('hint strip updates when an LED is selected', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        // Select a strip via debug hook (works regardless of preset auto-load)
        await page.waitForFunction(() => {
            const dbg = window.__shapeeditorDebug;
            return dbg && dbg.getStripCount() > 0;
        }, null, { timeout: 10000 });
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getHintText()))
            .toMatch(/move group|edit point/);
    });

    test('F1 opens the help overlay', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('F1');
        const modal = page.locator('.swal2-popup:not(.swal2-toast)');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal).toContainText(/Keyboard help/i);
        await expect(modal.locator('#help_dont_show')).toBeVisible();
    });

    test('Got it button dismisses help with checkbox unchecked', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('F1');
        const modal = page.locator('.swal2-popup:not(.swal2-toast)');
        await expect(modal).toBeVisible({ timeout: 5000 });
        // Uncheck "Don't show on launch" — confirm must still close the modal
        await modal.locator('#help_dont_show').uncheck();
        await page.locator('.swal2-confirm').click();
        await expect(modal).toBeHidden({ timeout: 5000 });
        const dismissed = await page.evaluate(() => localStorage.getItem('lm:shapeeditor-helpDismissed'));
        expect(dismissed).toBeNull();
    });

    test('Got it button persists dismissal when checkbox checked', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('F1');
        const modal = page.locator('.swal2-popup:not(.swal2-toast)');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('#help_dont_show').check();
        await page.locator('.swal2-confirm').click();
        await expect(modal).toBeHidden({ timeout: 5000 });
        const dismissed = await page.evaluate(() => localStorage.getItem('lm:shapeeditor-helpDismissed'));
        expect(dismissed).toBe('1');
    });

    test('? key opens the help overlay', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('?');
        await expect(page.locator('.swal2-popup:not(.swal2-toast)')).toBeVisible({ timeout: 5000 });
    });

    test('first-run shows a one-line hint toast, NOT the full help modal', async ({ page }) => {
        // Explicitly clear any prior dismissal seed
        await page.addInitScript(() => {
            try { localStorage.removeItem('lm:shapeeditor-helpDismissed'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        // A lightweight toast nudges the first-time user (#290)...
        await expect(page.locator('.swal2-toast')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.swal2-toast')).toContainText(/press \? for all shortcuts/i);
        // ...but the full ~30-shortcut reference must NOT auto-open over the canvas.
        await expect(page.locator('.swal2-popup:not(.swal2-toast)')).toBeHidden();
    });

    test('first-run toast does not occlude app-shell navigation or editor controls', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('lm:shapeeditor-helpDismissed'); } catch { /* ignore */ }
        });
        await page.goto('/create');
        await expect(page.locator('#app-mode-bar')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#main')).toBeVisible({ timeout: 10000 });

        const toast = page.locator('.swal2-toast');
        await expect(toast).toBeVisible({ timeout: 5000 });

        const [toastBox, modeBarBox, mainBox] = await Promise.all([
            toast.boundingBox(),
            page.locator('#app-mode-bar').boundingBox(),
            page.locator('#main').boundingBox(),
        ]);
        if (!toastBox || !modeBarBox || !mainBox) throw new Error('expected visible toast and app-shell chrome');

        // The canvas starts below both the product mode bar and the editor's
        // own toolbar. Keeping the toast at or below this boundary guarantees
        // that Play/Create/Record and Undo/Redo/Reset/Save remain clickable.
        expect(toastBox.y).toBeGreaterThanOrEqual(mainBox.y);
        expect(toastBox.y).toBeGreaterThanOrEqual(modeBarBox.y + modeBarBox.height);
    });

    test('hint strip reflects Chain and Reorder modes', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);

        await page.evaluate(() => window.__shapeeditorDebug.setMode('chain'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getHintText()))
            .toMatch(/Chain edit: drag an arrowhead to rewire/);

        await page.evaluate(() => window.__shapeeditorDebug.setMode('reorder'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getHintText()))
            .toMatch(/Reorder: .* move strips within a pin/);

        // Esc exits the mode and restores the idle hint.
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode()))
            .toBe('select');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getHintText()))
            .not.toMatch(/Reorder:/);
    });

    test('help overlay contains a Chains and Pins section', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('F1');
        const modal = page.locator('.swal2-popup:not(.swal2-toast)');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.locator('#help_chains_pins')).toBeVisible();
        await expect(modal).toContainText('Chains and Pins');
        await expect(modal).toContainText(/Chain.*mode/);
        await expect(modal).toContainText(/Reorder.*mode/);
        await expect(modal).toContainText('LOCK');
    });

    test('Chain button is hidden on touch-only devices (hover: none)', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
            const orig = window.matchMedia.bind(window);
            window.matchMedia = (q) => (q === '(hover: none)'
                ? { matches: true, media: q, addEventListener() { /* stub */ }, removeEventListener() { /* stub */ } }
                : orig(q));
        });
        await gotoEditor(page);
        await expect(page.locator('#strips_btn_chain')).toBeHidden();
        // Reorder remains available everywhere (panel-driven, touch-safe).
        await expect(page.locator('#strips_btn_reorder')).toBeAttached();
    });

    test('first-run does NOT auto-open when dismissal key is set', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        // Wait a bit for any potential auto-open to fire
        await page.waitForTimeout(400);
        await expect(page.locator('.swal2-popup:not(.swal2-toast)')).toBeHidden();
    });
});
