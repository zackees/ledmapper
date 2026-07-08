import { test, expect } from './fixtures.ts';

/**
 * Issue #226: WebGL context-loss handling had zero coverage before this.
 * Movie Player builds its `createGfx` renderer unconditionally at init
 * (see src/movieplayer/movieplayer.ts) against a placeholder screenmap, so
 * navigating to /movieplayer/ always has a real `<canvas>` with a live
 * WebGL context — no .fled upload, and no real GPU, required. Headless
 * Chromium's SwiftShader software WebGL fallback is enough to create a
 * context and exercise `WEBGL_lose_context`, so this spec is NOT tagged
 * @gpu (unlike the recording/resolution specs that need real rendering
 * fidelity).
 *
 * Approach: grab the WebGL context Three.js already created on the canvas
 * (`canvas.getContext('webgl2'|'webgl')` returns the *existing* context per
 * spec — a canvas can only ever have one), then drive the standard
 * `WEBGL_lose_context` extension's `loseContext()`/`restoreContext()` from
 * `page.evaluate`. This directly exercises the `webglcontextlost` /
 * `webglcontextrestored` listeners wired in `src/three-utils.ts`
 * (`createRendererCore`, used by `createGfxCore` -> `createGfx` -> Movie
 * Player) via `attachContextLossWatchdog` in `src/watchdogs.ts`.
 */
test.describe('Rendering watchdogs: WebGL context loss', () => {
    test('losing and restoring the WebGL context logs context-lost / context-restored', async ({ page }) => {
        await page.goto('/movieplayer/');
        await expect(page.locator('canvas.gfx-render-canvas')).toBeVisible();

        const result = await page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('canvas.gfx-render-canvas');
            if (!canvas) return { error: 'no canvas found' };
            const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
            if (!gl) return { error: 'no WebGL context on canvas' };
            const ext = gl.getExtension('WEBGL_lose_context');
            if (!ext) return { error: 'WEBGL_lose_context unavailable' };
            // Stash the extension handle on `window` so the restore step
            // below reuses the exact same object instead of re-querying
            // getContext()/getExtension() on a canvas whose context is now
            // lost (re-querying is spec-legal, but stashing removes any
            // doubt about getting back the same extension instance).
            (window as unknown as { __wdLoseCtxExt?: WEBGL_lose_context }).__wdLoseCtxExt = ext;
            ext.loseContext();
            return { error: null };
        });
        expect(result.error).toBeNull();

        // webglcontextlost fires asynchronously (spec: "at the next
        // available opportunity"); poll __lmLog rather than assuming a
        // single microtask/animation-frame turn is enough.
        await expect.poll(() =>
            page.evaluate(() => window.__lmLog?.entries.some(
                (e) => e.event === 'context-lost' && e.scope === 'watchdog',
            ) ?? false)
        ).toBe(true);

        const lostEntry = await page.evaluate(() =>
            window.__lmLog?.entries.find((e) => e.event === 'context-lost' && e.scope === 'watchdog'));
        expect(lostEntry).toBeTruthy();
        expect(lostEntry?.data).toMatchObject({ tool: 'gfx-core' });

        // Restore, and confirm the companion event lands too.
        await page.evaluate(() => {
            (window as unknown as { __wdLoseCtxExt?: WEBGL_lose_context }).__wdLoseCtxExt?.restoreContext();
        });

        await expect.poll(() =>
            page.evaluate(() => window.__lmLog?.entries.some(
                (e) => e.event === 'context-restored' && e.scope === 'watchdog',
            ) ?? false)
        ).toBe(true);
    });
});
