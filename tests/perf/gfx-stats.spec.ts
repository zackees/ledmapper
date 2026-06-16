/**
 * /play renderer perf snapshot.
 *
 * Opens /play with the `?debug=stats` query so demo.ts exposes
 * `window.__gfxStats`, lets the renderer reach steady state, then
 * reads renderFps / pushFps / frameTimeMs over a 10s window.
 *
 * The assertion is conditional: if pushFps is healthy (close to the
 * 60-FPS demo cap), renderFps must keep up. If pushFps is itself
 * limited (slow source, headless GPU throttling), the test reports
 * the measurement and skips the renderer assertion — no false
 * regressions on environments with no GPU.
 *
 * Output: a JSON report at tests/perf/output/_report.json with the
 * full measurement, so the developer can read what actually
 * happened on each run.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join('tests', 'perf', 'output');
mkdirSync(OUT_DIR, { recursive: true });

interface Stats {
    renderFps: number;
    pushFps: number;
    frameTimeMs: number;
    framesRendered: number;
}

declare global {
    interface Window {
        __gfxStats?: () => Stats;
    }
}

async function readStats(page: Page): Promise<Stats> {
    return await page.evaluate(() => {
        if (typeof window.__gfxStats !== 'function') {
            throw new Error('window.__gfxStats not available — is ?debug=stats set?');
        }
        return window.__gfxStats();
    });
}

test('/play renderer keeps up when source is healthy', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/play?debug=stats');
    await page.waitForLoadState('networkidle');

    // Wait for the auto-loaded video to start playing (set_dom_btn_play(true)
    // flips the button to "Pause"). Generous timeout for slow CI.
    await page.waitForFunction(
        () => (document.querySelector<HTMLInputElement>('#btn_play')?.value) === 'Pause',
        null,
        { timeout: 20000 },
    );

    // Force the framerate dropdown to 60 so the demo's pump is asking for
    // the highest source rate.
    await page.evaluate(() => {
        const sel = document.querySelector<HTMLSelectElement>('#sel_framerate');
        if (sel) {
            sel.value = '60';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    // Let the renderer reach steady state (FPS meter EWMA, GPU warm-up).
    await page.waitForTimeout(3000);

    // Sample over a 10-second window. Take a final read; the EWMA in
    // FpsMeter already smooths.
    await page.waitForTimeout(10000);
    const stats = await readStats(page);

    // Persist the full measurement so a human (or the next iteration of
    // this loop) can see what happened.
    writeFileSync(join(OUT_DIR, '_report.json'), JSON.stringify({
        viewport: '1920x1080',
        ...stats,
    }, null, 2) + '\n');

    // Sanity: the renderer actually ran.
    expect(stats.framesRendered, 'no frames rendered — the loop did not start').toBeGreaterThan(0);

    // Conditional assertion: only when pushFps is healthy do we hold the
    // renderer to a high bar. Headless chromium with software WebGL can
    // legitimately throttle pushFps from the demo's RAF pump.
    const PUSH_HEALTHY = 25;
    const RENDER_FLOOR = 55;
    if (stats.pushFps >= PUSH_HEALTHY) {
        expect(stats.renderFps, `renderFps=${stats.renderFps.toFixed(1)} below floor with pushFps=${stats.pushFps.toFixed(1)} (frameTimeMs=${stats.frameTimeMs.toFixed(1)})`).toBeGreaterThanOrEqual(RENDER_FLOOR);
    } else {
        console.warn(`[perf] pushFps=${stats.pushFps.toFixed(1)} below threshold ${PUSH_HEALTHY}; skipping renderer assertion (source-limited, likely headless). renderFps=${stats.renderFps.toFixed(1)}, frameTimeMs=${stats.frameTimeMs.toFixed(1)}.`);
    }
});
