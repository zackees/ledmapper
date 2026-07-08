import { test, expect } from './fixtures.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Copy-diagnostics button on errorDialog() (issue #230). Reuses the
// easiest existing real-error path — movieplayer rejecting a bogus .fled
// (same trigger as the "non-FLED bytes" test in movieplayer.spec.ts) — so
// this exercises the actual production errorDialog() call, not a
// synthetic one. No GPU/WebGL rendering is required to reach this error
// path, so this spec is not tagged @gpu.
test.describe('Copy diagnostics button', () => {
    test('copies a diagnostics payload to the clipboard without closing the dialog', async ({ page }) => {
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        const bogus = new Uint8Array(120).fill(0xab);
        const tmpPath = path.join(os.tmpdir(), `diag-bogus-${String(Date.now())}.fled`);
        fs.writeFileSync(tmpPath, bogus);
        try {
            await page.goto('/movieplayer/');
            await page.locator('#btn_load_movie').setInputFiles(tmpPath);

            const popup = page.locator('.swal2-popup');
            await expect(popup).toContainText(/no embedded screenmap/i, { timeout: 5000 });

            const copyBtn = page.locator('.diagnostics-copy-btn');
            await expect(copyBtn).toBeVisible();
            await expect(copyBtn).toHaveText('Copy diagnostics');

            await copyBtn.click();

            // Label flips in place; the dialog must still be open.
            await expect(copyBtn).toHaveText('Copied ✓');
            await expect(popup).toBeVisible();

            const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

            // Shape assertions per issue #230's spec: markdown wrapper,
            // fenced block, the triggering error, no query/hash in the
            // route, and no raw localStorage values.
            expect(clipboardText).toMatch(/^<details><summary>Diagnostics<\/summary>/);
            expect(clipboardText).toMatch(/```text/);
            expect(clipboardText).toMatch(/no embedded screenmap/i);
            expect(clipboardText).toMatch(/Route: \/movieplayer\//);
            expect(clipboardText).not.toMatch(/[?&]lmlog=/);
            expect(clipboardText.length).toBeLessThan(17 * 1024);
        } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    });
});
