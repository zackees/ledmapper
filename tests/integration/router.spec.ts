import { test, expect } from './fixtures.ts';

test.describe('SPA router history', () => {
    test('multi-step back/forward across tools', async ({ page }) => {
        await page.goto('/hub/');
        await page.click('.nav-links a[href="/movieplayer/"]');
        await expect(page).toHaveURL(/\/movieplayer\//);
        await page.click('.nav-links a[href="/demo/"]');
        await expect(page).toHaveURL(/\/demo\//);

        await page.goBack();
        await expect(page).toHaveURL(/\/movieplayer\//);
        expect(await page.evaluate(() => document.getElementById('app')?.dataset.tool)).toBe('movieplayer');

        await page.goBack();
        await expect(page).toHaveURL('/hub/');
        expect(await page.evaluate(() => document.getElementById('app')?.dataset.tool)).toBe('hub');

        await page.goForward();
        await expect(page).toHaveURL(/\/movieplayer\//);
        expect(await page.evaluate(() => document.getElementById('app')?.dataset.tool)).toBe('movieplayer');
    });

    test('modifier-click is not soft-navigated', async ({ page }) => {
        await page.goto('/hub/');
        // Ctrl/Cmd-click must fall through to the browser (new tab) rather than
        // the router's soft-navigation, so the main page must NOT change route.
        await page.click('.nav-links a[href="/demo/"]', { modifiers: ['ControlOrMeta'] });
        await page.waitForTimeout(100);
        await expect(page).toHaveURL('/hub/');
        expect(await page.evaluate(() => document.getElementById('app')?.dataset.tool)).toBe('hub');
    });

    test('pushView/onPopView simulates in-SPA back without leaving the route', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page).toHaveURL(/\/movieplayer\//);

        const result = await page.evaluate(async () => {
            const h = window.spaHistory;
            if (!h) return { ok: false };
            const events: { view: string | null; data: unknown }[] = [];
            const off = h.onPopView((view, data) => { events.push({ view, data }); });
            const p0 = window.location.pathname;
            h.pushView('panel', { id: 7 });
            const p1 = window.location.pathname;
            await new Promise<void>((resolve) => {
                window.addEventListener('popstate', () => { resolve(); }, { once: true });
                h.back();
            });
            // Allow the router's popstate handler to run.
            await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
            off();
            return { ok: true, p0, p1, samePath: p0 === p1, events };
        });

        expect(result.ok).toBe(true);
        expect(result.samePath).toBe(true);
        expect(result.events.length).toBeGreaterThanOrEqual(1);
    });
});
