import { test, expect } from './fixtures.js';

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

async function dismissFirstRunModalIfOpen(page) {
    // SweetAlert2 close button (×) is reliable across versions
    const closeBtn = page.locator('.swal2-close');
    if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
        await expect(closeBtn).toBeHidden({ timeout: 5000 });
    }
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
        const modal = page.locator('.swal2-popup');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal).toContainText(/Keyboard help/i);
        await expect(modal.locator('#help_dont_show')).toBeVisible();
    });

    test('? key opens the help overlay', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        await page.keyboard.press('?');
        await expect(page.locator('.swal2-popup')).toBeVisible({ timeout: 5000 });
    });

    test('first-run auto-opens the help overlay when no dismissal key', async ({ page }) => {
        // Explicitly clear any prior dismissal seed
        await page.addInitScript(() => {
            try { localStorage.removeItem('lm:shapeeditor-helpDismissed'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        // Modal should auto-open within ~1s of presets loading
        await expect(page.locator('.swal2-popup')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#help_dont_show')).toBeVisible();
        await dismissFirstRunModalIfOpen(page);
    });

    test('first-run does NOT auto-open when dismissal key is set', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        await gotoEditor(page);
        // Wait a bit for any potential auto-open to fire
        await page.waitForTimeout(800);
        await expect(page.locator('.swal2-popup')).toBeHidden();
    });
});
