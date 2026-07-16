import { test, expect } from './fixtures.ts';

/**
 * Stale-chunk auto-reload (issue #447): a synthetic `vite:preloadError`
 * (the event Vite dispatches when a built dynamic import 404s after a
 * redeploy) must trigger exactly one automatic reload; a second one within
 * the guard window must be suppressed and left un-preventDefault'ed so it
 * surfaces through the existing route-error paths.
 */

const STAMP_KEY = 'lm:stale-reload-at';
const RESULT_KEY = 'test:first-prevented';

/** Window-marker cast: `__testMarker` is scribbled onto the live window so a
 *  reload (which wipes it) is observable. */
type MarkedWindow = Window & { __testMarker?: number };

test.describe('stale-chunk auto-reload', () => {
    test('first vite:preloadError reloads once; second within the window is suppressed', async ({ page }) => {
        // The pre-reload page's in-memory __lmLog is lost on navigation; its
        // console mirror ([lm:boot] …) is how the first event is asserted.
        const t0 = Date.now();
        const consoleLines: string[] = [];
        page.on('console', (msg) => { consoleLines.push(`${Date.now() - t0}ms ${msg.text()}`); });
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) consoleLines.push(`${Date.now() - t0}ms >>> NAVIGATED ${frame.url()}`);
        });
        page.on('pageerror', (err) => { consoleLines.push(`${Date.now() - t0}ms !!! pageerror ${err.message}`); });

        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        // `window.spaHistory` is assigned in the same synchronous main.ts boot
        // task as installStaleChunkReload(), so its presence guarantees the
        // vite:preloadError listener is armed. (`__lmLog` alone is NOT enough:
        // in dev, debug-log.ts evaluates while the rest of the module graph is
        // still loading, well before main.ts's body runs.)
        await page.waitForFunction(() => !!window.__lmLog && !!window.spaHistory, null, { timeout: 10000 });

        // Fresh tab: no guard stamp; mark the live window.
        await page.evaluate((key) => {
            sessionStorage.removeItem(key);
            (window as MarkedWindow).__testMarker = 1;
        }, STAMP_KEY);

        // Dispatch the event shaped as Vite does (cancelable + Error payload).
        // The handler calls location.reload() synchronously, so persist
        // defaultPrevented in sessionStorage (survives the reload) rather than
        // racing the evaluate return against the navigation.
        await page.evaluate((resultKey) => {
            const e = new Event('vite:preloadError', { cancelable: true });
            (e as Event & { payload: Error }).payload = new Error('test stale chunk');
            window.dispatchEvent(e);
            sessionStorage.setItem(resultKey, String(e.defaultPrevented));
        }, RESULT_KEY).catch(() => { /* context may be torn down by the reload mid-evaluate */ });

        // Reload happened and the app re-booted: marker gone, boot complete
        // (reload/resync pattern from shapeeditor-autosave-restore.spec.ts).
        // Waiting on spaHistory again ensures the preloadError listener is
        // re-armed before the second dispatch below.
        await page.waitForFunction(
            () => (window as MarkedWindow).__testMarker === undefined && !!window.__lmLog && !!window.spaHistory,
            null,
            { timeout: 10000 },
        );

        expect(await page.evaluate((k) => sessionStorage.getItem(k), RESULT_KEY)).toBe('true');
        // Guard stamp was recorded for the post-reload page to see.
        expect(await page.evaluate((k) => sessionStorage.getItem(k), STAMP_KEY)).not.toBeNull();
        expect(consoleLines.some((l) => l.includes('[lm:boot] stale-deploy-reload'))).toBe(true);

        // Second dispatch within the guard window: suppressed — event NOT
        // defaultPrevented, and no reload (the fresh marker survives).
        await page.evaluate(() => { (window as MarkedWindow).__testMarker = 2; });
        const secondPrevented = await page.evaluate(() => {
            const e = new Event('vite:preloadError', { cancelable: true });
            (e as Event & { payload: Error }).payload = new Error('test stale chunk again');
            window.dispatchEvent(e);
            return e.defaultPrevented;
        });
        expect(secondPrevented).toBe(false);

        // Give a would-be reload time to start, then confirm the page survived.
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => (window as MarkedWindow).__testMarker)).toBe(2);
        // The in-memory event ring is recreated by the reload; the console
        // mirror is the durable observation across both page lifetimes.
        expect(consoleLines.some((l) => l.includes('[lm:boot] stale-deploy-reload-suppressed'))).toBe(true);
    });
});
