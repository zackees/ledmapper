import { test, expect } from './fixtures.ts';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';
import { expandScreenmapBand } from '../helpers/screenmap-band.ts';

// Executable spec of the #493 bright-region merge regression ("the forehead
// case"): a region of near-full-drive LEDs must bloom out so the black
// between pixels is luma-bloomed to near nothing — the frosted-acrylic
// white-out that the naive clamping bloom produced as (1,1,1). A composite
// that renders such a region as discrete bright dots over dark gaps has lost
// the white-out.
//
// The committed fixture is one second of the portrait test video whose first
// frames hold a brightly lit forehead (upper right). The gate mirrors
// scripts/whiteout_gate.py: on the preview canvas, find each LED cell's core
// luma and its mid-gap band luma; over "driven interior" dots (bright core,
// bright neighbors), the mean gap/core merge ratio must clear the bar.
//
// Measured state at introduction (2026-08-23): the INTERACTIVE preview is
// healthy (mean merge 0.978 at 1:1 pixels — this spec guards that it stays
// so), while the PRODUCTION render of the identical strategy measures ~0.39
// on the same content: the regression lives in the production path, whose
// bloom profile caps dense-grid strength at 1.0 vs the preview's 4.0. The
// production-side guard is scripts/whiteout_gate.py, wired into
// scripts/bloom_metrics.py as gate G4 (validated: legacy-additive at full
// strength ~0.96 PASS, current production default ~0.39 FAIL).
const FIXTURE = 'tests/fixtures/whiteout-head.mp4';
const MIN_MERGE = 0.55;
const MIN_QUALIFYING_DOTS = 12;

interface MergeStats {
    top50Core?: number;
    top500Core?: number;
    qualifyingDots: number;
    meanMerge: number | null;
    canvasSide: number;
}

async function measureMerge(page: import('@playwright/test').Page): Promise<MergeStats> {
    // Screenshot the visible preview canvas: WebGL canvases render with
    // preserveDrawingBuffer=false, so drawImage scraping reads black — the
    // compositor screenshot is the only faithful pixel source.
    // Target the LARGEST canvas — the preview render surface. The first
    // .canvas-area canvas is a small 2D overlay (270px), which a previous
    // revision shot by mistake.
    await page.evaluate(() => {
        const canvases = [...document.querySelectorAll('canvas')];
        const biggest = canvases.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
        biggest.setAttribute('data-whiteout-target', '1');
    });
    const canvasLocator = page.locator('canvas[data-whiteout-target]');
    // Pin the canvas CSS size to its backing store for the shot: any browser
    // downscale averages dots into gaps and inflates the merge ratio
    // (measured: 0.98 at 274px CSS, 0.82 at 506px, vs truth at 1:1).
    await canvasLocator.evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.zIndex = '9999';
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;
    });
    const png = (await canvasLocator.screenshot()).toString('base64');
    return page.evaluate(async (pngBase64) => {
        const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const side = Math.min(bitmap.width, bitmap.height);
        const work = document.createElement('canvas');
        work.width = bitmap.width;
        work.height = bitmap.height;
        const ctx = work.getContext('2d');
        if (!ctx) return { qualifyingDots: 0, meanMerge: null, canvasSide: side };
        ctx.drawImage(bitmap, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, work.width, work.height);
        const luma = (x: number, y: number) => {
            const i = (y * width + x) * 4;
            return (data[i] ?? 0) * 0.2126 + (data[i + 1] ?? 0) * 0.7152 + (data[i + 2] ?? 0) * 0.0722;
        };

        const grid = 64;
        const pitch = width / grid;
        const cores: number[][] = [];
        const centers: [number, number][][] = [];
        for (let gy = 0; gy < grid; gy++) {
            cores.push([]);
            centers.push([]);
            const y0 = Math.floor(gy * pitch);
            const y1 = Math.min(Math.floor((gy + 1) * pitch), height);
            for (let gx = 0; gx < grid; gx++) {
                const x0 = Math.floor(gx * pitch);
                const x1 = Math.min(Math.floor((gx + 1) * pitch), width);
                let best = 0;
                let bx = x0;
                let by = y0;
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        const v = luma(x, y);
                        if (v > best) { best = v; bx = x; by = y; }
                    }
                }
                cores[gy]!.push(best);
                centers[gy]!.push([bx, by]);
            }
        }

        const rIn = pitch * 0.35;
        const rOut = pitch * 0.50;
        const ratios: number[] = [];
        for (let gy = 1; gy < grid - 1; gy++) {
            for (let gx = 1; gx < grid - 1; gx++) {
                const core = cores[gy]![gx]!;
                if (core < 200) continue;
                let brightNeighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dy && !dx) continue;
                        if ((cores[gy + dy]![gx + dx] ?? 0) >= 180) brightNeighbors++;
                    }
                }
                if (brightNeighbors < 5) continue;
                const [cx, cy] = centers[gy]![gx]!;
                const band: number[] = [];
                const reach = Math.ceil(rOut) + 1;
                for (let y = cy - reach; y <= cy + reach; y++) {
                    for (let x = cx - reach; x <= cx + reach; x++) {
                        if (x < 0 || y < 0 || x >= width || y >= height) continue;
                        const rr = Math.hypot(x - cx, y - cy);
                        if (rr >= rIn && rr <= rOut) band.push(luma(x, y));
                    }
                }
                if (!band.length) continue;
                band.sort((a, b) => a - b);
                const gap = band[Math.floor(band.length / 2)] ?? 0;
                ratios.push(gap / core);
            }
        }

        const flatCores = cores.flat().sort((a, b) => b - a);
        return {
            top50Core: Math.round(flatCores[49] ?? 0),
            top500Core: Math.round(flatCores[499] ?? 0),
            qualifyingDots: ratios.length,
            meanMerge: ratios.length
                ? ratios.reduce((a, b) => a + b, 0) / ratios.length
                : null,
            canvasSide: side,
        };
    }, png);
}

test.describe('Bright-region white-out merge @gpu', () => {
    test.skip(shouldSkipGpuTest, 'GPU-dependent: preview rendering needs WebGL output worth measuring');
    // The screenshot captures the canvas at CSS size. On a small viewport the
    // browser's downscale averages dots into gaps and fakes a perfect merge
    // (measured: 0.98 at 274px vs the real ~0.4 at backing resolution), so
    // the viewport must be large enough for near-1:1 canvas pixels.
    test.use({ viewport: { width: 1500, height: 1500 } });

    test('driven regions merge instead of rendering as dots over dark gaps (#493)', async ({ page }) => {
        await page.goto('/moviemaker/');

        const fileChooserPromise = page.waitForEvent('filechooser');
        await page.locator('[data-trigger="btn_load_video"]').click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(FIXTURE);
        await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });

        await expandScreenmapBand(page);
        const preset = page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]');
        await preset.click();
        await expect(preset).toHaveClass(/active-preset/);

        await page.locator('#btn_play_pause').click();
        // Let the iris/exposure settle past its attack window before judging.
        await page.waitForTimeout(1500);

        const stats = await measureMerge(page);
        console.log('whiteout-gate stats:', JSON.stringify(stats));
        expect(stats.qualifyingDots, 'fixture must present a driven bright region').toBeGreaterThanOrEqual(MIN_QUALIFYING_DOTS);
        expect(stats.meanMerge, 'gap/core merge ratio in driven regions — see #493; '
            + 'the white-out must bloom the black between pixels to near nothing').not.toBeNull();
        expect(stats.meanMerge ?? 0).toBeGreaterThanOrEqual(MIN_MERGE);
    });
});
