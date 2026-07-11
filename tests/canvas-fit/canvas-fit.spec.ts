/**
 * Canvas-fit snapshot harness with self-correcting failure reports.
 *
 * For each (route, viewport) pair:
 *   - Loads the page from the production preview server.
 *   - Snapshots the viewport to tests/canvas-fit/output/.
 *   - Measures: viewport, mode bar, canvas wrapper, controls panel.
 *   - Asserts: canvas fits entirely inside the viewport AND below
 *     the top mode bar. No clipping on any side. Aspect ratio = 1.
 *   - On failure: reports the exact overlap/clip in CSS px AND
 *     computes `maxSideThatWouldFit` so the developer (or an
 *     automated loop) knows exactly what to change.
 *
 * Viewports include both standard desktop sizes AND short-height
 * laptop sizes so the fit logic is exercised when height is the
 * binding dimension, not width.
 *
 * Run loop:
 *   1. tweak demo.css / global.css / template / fit helper
 *   2. npm run test:canvas-fit       (builds + runs this file)
 *   3. read tests/canvas-fit/output/_report.md — the per-test
 *      `suggestion` line tells you what to fix
 *   4. open tests/canvas-fit/output/*.png to eyeball
 *   5. repeat
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join('tests', 'canvas-fit', 'output');
mkdirSync(OUT_DIR, { recursive: true });

interface Viewport { width: number; height: number; label: string }
const VIEWPORTS: Viewport[] = [
    // Standard desktop sizes.
    { width: 1280, height: 720,  label: '1280x720'  },
    { width: 1440, height: 900,  label: '1440x900'  },
    { width: 1920, height: 1080, label: '1920x1080' },
    // Common laptop / chrome-eaten sizes — height is the binding
    // dimension here, exercising the path where wireResponsiveCanvas
    // must clamp to height not width.
    { width: 1366, height: 768,  label: '1366x768'   },
    { width: 1920, height: 720,  label: '1920x720_short' },
    { width: 1920, height: 600,  label: '1920x600_xshort' },
    // Phone widths exercise equal-width top tabs and touch targets.
    { width: 390, height: 844, label: '390x844_mobile' },
    { width: 320, height: 568, label: '320x568_mobile' },
];

const ROUTES = ['/play', '/create', '/record'];

interface Rect { top: number; bottom: number; left: number; right: number; width: number; height: number }

interface FitDiagnosis {
    fits: boolean;
    clipTop: number;
    clipBottom: number;
    clipLeft: number;
    clipRight: number;
    overlapsModeBar: number;
    /** The largest square side that WOULD fit cleanly within the
     *  available vertical (between controls and mode bar) and
     *  horizontal (viewport width minus margins) bounds. */
    maxSideThatWouldFit: number;
    /** Human-readable next step. */
    suggestion: string;
}

interface BoxReport {
    route: string;
    viewport: string;
    viewportWidth: number;
    viewportHeight: number;
    modeBar: Rect | null;
    modeBarVisible: boolean;
    canvas: Rect | null;
    canvasAspectError: number | null;
    controlsHeight: number | null;
    fit: FitDiagnosis | null;
}

const reports: BoxReport[] = [];

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
    const loc = page.locator(selector).first();
    if (await loc.count() === 0) return null;
    const box = await loc.boundingBox();
    if (!box) return null;
    return {
        top: box.y,
        bottom: box.y + box.height,
        left: box.x,
        right: box.x + box.width,
        width: box.width,
        height: box.height,
    };
}

function diagnose(vp: Viewport, canvas: Rect | null, modeBar: Rect | null): FitDiagnosis | null {
    if (!canvas) return null;
    const clipTop    = Math.max(0, 0 - canvas.top);
    const clipBottom = Math.max(0, canvas.bottom - vp.height);
    const clipLeft   = Math.max(0, 0 - canvas.left);
    const clipRight  = Math.max(0, canvas.right - vp.width);
    const overlapsModeBar = modeBar ? Math.max(0, modeBar.bottom - canvas.top) : 0;
    const fits = clipTop + clipBottom + clipLeft + clipRight + overlapsModeBar < 2;

    // Compute the largest square that would fit cleanly:
    //   - vertical:   viewport below the top mode bar, minus a safety margin
    //   - horizontal: viewport.width - 2 * sideMargin
    const SAFETY = 8;
    const availV = vp.height - (modeBar?.bottom ?? 0) - SAFETY;
    const availH = vp.width - 2 * SAFETY;
    const maxSideThatWouldFit = Math.max(0, Math.floor(Math.min(availV, availH)));

    let suggestion: string;
    if (fits) {
        suggestion = 'OK';
    } else if (overlapsModeBar > 2 || clipBottom > 2) {
        suggestion = `canvas extends ${Math.max(overlapsModeBar, clipBottom).toFixed(1)}px below its bound — wireResponsiveCanvas should clamp side to ${String(maxSideThatWouldFit)}px (currently ${String(Math.floor(canvas.height))}px)`;
    } else if (clipRight > 2) {
        suggestion = `canvas extends ${clipRight.toFixed(1)}px past viewport right — clamp width`;
    } else {
        suggestion = `clip top=${String(clipTop)} left=${String(clipLeft)} right=${String(clipRight)} bottom=${String(clipBottom)} overlapsBar=${String(overlapsModeBar)}`;
    }

    return {
        fits,
        clipTop, clipBottom, clipLeft, clipRight,
        overlapsModeBar,
        maxSideThatWouldFit,
        suggestion,
    };
}

async function capture(page: Page, route: string, vp: Viewport): Promise<BoxReport> {
    const fileName = `${route.replace(/\//g, '_')}_${vp.label}.png`;
    await page.screenshot({ path: join(OUT_DIR, fileName), fullPage: false });

    const modeBar = await rectOf(page, '#app-mode-bar');
    const canvas  = await rectOf(page, '.lm-canvas-wrapper');
    const controls = await rectOf(page, '.controls');
    const modeBarVisible = modeBar !== null && modeBar.bottom <= vp.height + 2;
    const fit = diagnose(vp, canvas, modeBar);

    const report: BoxReport = {
        route,
        viewport: vp.label,
        viewportWidth: vp.width,
        viewportHeight: vp.height,
        modeBar,
        modeBarVisible,
        canvas,
        canvasAspectError: canvas ? Math.abs(canvas.width - canvas.height) : null,
        controlsHeight: controls ? controls.height : null,
        fit,
    };
    reports.push(report);
    return report;
}

for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
        test(`${route} @ ${vp.label}`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            // Two RAFs of settle time: layout reflow + canvas pipeline.
            await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => { r(); }))));
            await page.waitForTimeout(800);

            const r = await capture(page, route, vp);

            // Mode bar must be in the viewport on every route.
            expect(r.modeBarVisible, `mode bar must be inside the viewport — got bottom=${String(r.modeBar?.bottom)} > vp.height=${String(vp.height)}`).toBe(true);

            // /play hosts the canvas. Enforce a strict fit.
            if (route === '/play') {
                expect(r.canvas, 'canvas wrapper must exist on /play').not.toBeNull();
                expect(r.canvasAspectError ?? 99, 'canvas must be square').toBeLessThanOrEqual(2);
                expect(r.fit?.fits, `canvas does not fit at ${vp.label} — ${String(r.fit?.suggestion)}`).toBe(true);
            }
        });
    }
}

test.afterAll(() => {
    writeFileSync(join(OUT_DIR, '_report.json'), JSON.stringify(reports, null, 2) + '\n');
    const lines = [
        '# Canvas-fit snapshot report',
        '',
        'Each test (route, viewport) writes a row. `fit.fits=true` means the',
        'canvas is fully inside the viewport AND below the mode bar.',
        'On failure, `suggestion` reports the next step.',
        '',
    ];
    let failures = 0;
    for (const r of reports) {
        const status = r.fit?.fits ? '✓' : (r.canvas ? '✗' : '—');
        lines.push(`## ${status} ${r.route} @ ${r.viewport}`);
        lines.push(`- viewport:  ${String(r.viewportWidth)}×${String(r.viewportHeight)}`);
        if (r.modeBar) {
            lines.push(`- mode bar:  top=${r.modeBar.top.toFixed(1)}  bottom=${r.modeBar.bottom.toFixed(1)}  visible=${String(r.modeBarVisible)}`);
        } else {
            lines.push('- mode bar:  (missing)');
        }
        if (r.canvas) {
            lines.push(`- canvas:    ${String(Math.round(r.canvas.width))}×${String(Math.round(r.canvas.height))}  top=${r.canvas.top.toFixed(1)}  bottom=${r.canvas.bottom.toFixed(1)}  |w-h|=${r.canvasAspectError?.toFixed(1) ?? '?'}`);
        } else {
            lines.push('- canvas:    (none on this route — not /play)');
        }
        if (r.controlsHeight !== null) {
            lines.push(`- controls:  height=${r.controlsHeight.toFixed(1)}`);
        }
        if (r.fit && !r.fit.fits) {
            failures++;
            lines.push(`- ✗ fit:    clip top=${String(r.fit.clipTop)} bottom=${String(r.fit.clipBottom)} left=${String(r.fit.clipLeft)} right=${String(r.fit.clipRight)} overlapsBar=${r.fit.overlapsModeBar.toFixed(1)}`);
            lines.push(`- suggest: ${r.fit.suggestion}`);
            lines.push(`- maxFit:  ${String(r.fit.maxSideThatWouldFit)}px (target size for the helper)`);
        } else if (r.fit) {
            lines.push(`- ✓ fit:    canvas fully inside viewport below the mode bar`);
        }
        lines.push('');
    }
    if (failures > 0) {
        lines.unshift(`**${String(failures)} failure(s)**`, '');
    }
    writeFileSync(join(OUT_DIR, '_report.md'), lines.join('\n'));
});
