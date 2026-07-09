import { test, expect } from './fixtures.ts';

// Covers issue #225: window.__lmDebug is a per-tool debug-state registry.
// Each mounted tool registers a live getState() at init and the router's
// teardown (currentDestroy()) must remove it on navigation. No GPU/WebGL
// readback is required — these assertions only touch state visible on
// freshly-loaded pages, before any source/video/screenmap is loaded.
test.describe('window.__lmDebug registry (#225)', () => {
    // The worker shares one browser context across specs. Earlier specs can
    // leave (a) a stored screenmap in localStorage (console-errors.spec's
    // shapeeditor visit autosaves one), which would suppress moviemaker's
    // default 16x16 preset, and (b) a recorded video in IndexedDB, which
    // movieplayer auto-restores on load. Both would break the exact-state
    // assertions below, so start every test from a clean slate.
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                for (const k of Object.keys(localStorage)) {
                    if (k.startsWith('lm:')) localStorage.removeItem(k);
                }
                // Keep the shapeeditor first-run help suppressed — its modal
                // would otherwise intercept the nav clicks below.
                localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
            } catch { /* ignore */ }
            try { indexedDB.deleteDatabase('ledmapper'); } catch { /* ignore */ }
        });
    });

    test('moviemaker registers getState() and it disappears after navigating away', async ({ page }) => {
        await page.goto('/moviemaker/');
        await expect(page.locator('#btn_upload_screenmap')).toBeVisible();
        // moviemaker autoloads the "16x16 grid" default preset on launch
        // (see the welcome-overlay copy), so screenmap-derived fields are
        // already populated even though no video/webcam source is active.
        await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState()?.screenmapValid))
            .toBe(true);

        const state = await page.evaluate(() => window.__lmDebug?.moviemaker?.getState());
        expect(state).toEqual({
            screenmapValid: true,
            ledCount: 256,
            stripCount: 1,
            sourceActive: false,
            sourceType: null,
            playing: false,
            recordingActive: false,
            recordFormat: 'fled',
            oobLeds: 0,
            detectedFps: 30,
            captureStats: { captured: 0, skipped: 0, duplicatesDropped: 0 },
        });

        await page.click('.nav-links a[href="/movieplayer/"]');
        await expect(page).toHaveURL(/\/movieplayer\//);
        const afterNav = await page.evaluate(() => window.__lmDebug?.moviemaker);
        expect(afterNav).toBeUndefined();
    });

    test('movieplayer registers getState() and it disappears after navigating away', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('#btn_load_movie')).toBeVisible();

        const state = await page.evaluate(() => window.__lmDebug?.movieplayer?.getState());
        expect(state).toEqual({
            frameCount: 0,
            ledCount: 0,
            playing: false,
            loaded: false,
        });

        await page.click('.nav-links a[href="/shapeeditor/"]');
        await expect(page).toHaveURL(/\/shapeeditor\//);
        const afterNav = await page.evaluate(() => window.__lmDebug?.movieplayer);
        expect(afterNav).toBeUndefined();
    });

    test('shapeeditor registers getState() alongside the existing __shapeeditorDebug alias, and both disappear after navigating away', async ({ page }) => {
        await page.goto('/shapeeditor/');
        // __shapeeditorDebug is installed synchronously during construction,
        // but wait for it defensively — matches the pattern used by the
        // existing shapeeditor specs that depend on it.
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });

        const state = await page.evaluate(() => window.__lmDebug?.shapeeditor?.getState());
        expect(state).not.toBeUndefined();
        expect(typeof state?.stripCount).toBe('number');
        expect(typeof state?.totalPoints).toBe('number');
        expect(typeof state?.dirty).toBe('boolean');

        // The pre-existing __shapeeditorDebug alias is untouched (16 specs
        // depend on it) and is also reachable via the registry entry's
        // `debug` reference — same object, not a re-migrated copy. Read
        // both in one evaluate() so an in-flight preset load can't change
        // the strip count between the two reads.
        const { viaAlias, viaRegistry } = await page.evaluate(() => ({
            viaAlias: window.__shapeeditorDebug?.getStripCount?.(),
            viaRegistry: window.__lmDebug?.shapeeditor?.debug.getStripCount?.(),
        }));
        expect(viaRegistry).toBe(viaAlias);

        await page.click('.nav-links a[href="/moviemaker/"]');
        await expect(page).toHaveURL(/\/moviemaker\//);
        const afterNav = await page.evaluate(() => window.__lmDebug?.shapeeditor);
        expect(afterNav).toBeUndefined();
    });
});
