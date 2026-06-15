/**
 * Canvas-fit snapshot harness.
 *
 * For each (route, viewport) pair:
 *   - Loads the page from the production preview server.
 *   - Snapshots the viewport to tests/canvas-fit/output/.
 *   - Asserts the mode bar is fully visible (i.e. inside the viewport).
 *   - Asserts the canvas wrapper exists and stays above the mode bar.
 *   - Asserts the wrapper renders ~square (aspect-ratio: 1 from CSS).
 *   - Dumps a JSON report with computed box geometry per route so the
 *     developer can diff "what changed" between iterations without
 *     re-eyeballing pixels.
 *
 * Run loop:
 *   1. tweak demo.css / global.css / template
 *   2. npm run build
 *   3. npm run test:canvas-fit       (this file)
 *   4. open tests/canvas-fit/output/*.png
 *   5. repeat
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join('tests', 'canvas-fit', 'output');
mkdirSync(OUT_DIR, { recursive: true });

interface Viewport { width: number; height: number; label: string }
const VIEWPORTS: Viewport[] = [
    { width: 1280, height: 720,  label: '1280x720'  },
    { width: 1440, height: 900,  label: '1440x900'  },
    { width: 1920, height: 1080, label: '1920x1080' },
];

const ROUTES = ['/play', '/create', '/record'];

interface BoxReport {
    route: string;
    viewport: string;
    modeBarTop: number | null;
    modeBarBottom: number | null;
    modeBarVisible: boolean;
    canvasTop: number | null;
    canvasBottom: number | null;
    canvasWidth: number | null;
    canvasHeight: number | null;
    canvasAspectError: number | null;   // |w - h| in CSS px
    canvasFitsAboveModeBar: boolean;
    controlsHeight: number | null;
}

const reports: BoxReport[] = [];

async function snapshot(page: Page, route: string, vp: Viewport): Promise<BoxReport> {
    const fileName = `${route.replace(/\//g, '_')}_${vp.label}.png`;
    await page.screenshot({ path: join(OUT_DIR, fileName), fullPage: false });

    const report: BoxReport = {
        route,
        viewport: vp.label,
        modeBarTop: null,
        modeBarBottom: null,
        modeBarVisible: false,
        canvasTop: null,
        canvasBottom: null,
        canvasWidth: null,
        canvasHeight: null,
        canvasAspectError: null,
        canvasFitsAboveModeBar: false,
        controlsHeight: null,
    };

    const modeBar = page.locator('#app-mode-bar');
    if (await modeBar.count() > 0) {
        const box = await modeBar.boundingBox();
        if (box) {
            report.modeBarTop = box.y;
            report.modeBarBottom = box.y + box.height;
            // The mode bar is "visible" if its bottom is at or above the
            // viewport bottom (within 2 px tolerance for fractional layout).
            report.modeBarVisible = report.modeBarBottom <= vp.height + 2;
        }
    }

    const wrapper = page.locator('.lm-canvas-wrapper').first();
    if (await wrapper.count() > 0) {
        const box = await wrapper.boundingBox();
        if (box) {
            report.canvasTop = box.y;
            report.canvasBottom = box.y + box.height;
            report.canvasWidth = box.width;
            report.canvasHeight = box.height;
            report.canvasAspectError = Math.abs(box.width - box.height);
            if (report.modeBarTop !== null) {
                // The canvas must not extend below the mode bar's top
                // edge (allow 2 px tolerance for rounding).
                report.canvasFitsAboveModeBar = report.canvasBottom <= report.modeBarTop + 2;
            }
        }
    }

    // The per-tool controls panel above the canvas. Identify the parent
    // of the canvas wrapper and measure the space the wrapper has below.
    // For /play, the demo's controls; for /record, moviemaker's sidebar.
    const controls = page.locator('.controls').first();
    if (await controls.count() > 0) {
        const box = await controls.boundingBox();
        if (box) report.controlsHeight = box.height;
    }

    reports.push(report);
    return report;
}

for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
        test(`${route} @ ${vp.label}`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            // Allow the first render frame to land + any RAF-driven sizing
            // (the CSS fit is synchronous but the canvas pipeline isn't).
            await page.waitForTimeout(1200);

            const r = await snapshot(page, route, vp);

            // Hard expectations — fail the test if these regress.
            expect(r.modeBarVisible, `mode bar must be fully visible (bottom=${String(r.modeBarBottom)} <= ${String(vp.height)})`).toBe(true);
            if (route === '/play') {
                // /play hosts the demo, which has the canvas wrapper.
                expect(r.canvasTop, 'canvas wrapper must exist on /play').not.toBeNull();
                expect(r.canvasFitsAboveModeBar, `canvas bottom (${String(r.canvasBottom)}) must be ≤ mode-bar top (${String(r.modeBarTop)})`).toBe(true);
                expect(r.canvasAspectError ?? 99).toBeLessThanOrEqual(2);
            }
        });
    }
}

test.afterAll(() => {
    const json = JSON.stringify(reports, null, 2);
    writeFileSync(join(OUT_DIR, '_report.json'), json + '\n');
    // Also a human-readable summary.
    const lines = ['# Canvas-fit snapshot report', ''];
    for (const r of reports) {
        lines.push(`## ${r.route} @ ${r.viewport}`);
        lines.push(`- mode bar:       top=${String(r.modeBarTop)}  bottom=${String(r.modeBarBottom)}  visible=${String(r.modeBarVisible)}`);
        lines.push(`- canvas:         top=${String(r.canvasTop)}  bottom=${String(r.canvasBottom)}  w=${String(r.canvasWidth)}  h=${String(r.canvasHeight)}  |w-h|=${String(r.canvasAspectError)}  fitsAbove=${String(r.canvasFitsAboveModeBar)}`);
        lines.push(`- controls h:     ${String(r.controlsHeight)}`);
        lines.push('');
    }
    writeFileSync(join(OUT_DIR, '_report.md'), lines.join('\n'));
});
