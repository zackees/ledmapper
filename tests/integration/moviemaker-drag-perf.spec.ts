import { test, expect } from './fixtures.ts';
import { mockWebcam } from '../helpers/webcam-mock.ts';
import { shouldSkipGpuTest } from '../helpers/gpu-gate.ts';

// Regression guard for issue #26: dragging the shape used to rebuild the
// transformed points array every frame, defeating the position-texture and
// ring-layer identity caches (full GPU re-upload + 4096 arc strokes per
// mousemove). With the transform applied as gather-shader uniforms and the
// ring layer blitted at a translation offset, a drag must not trigger any
// per-frame geometry rebuilds. Counters (?perfdebug=1) are the deterministic
// signal — raw FPS is too flaky for CI.

async function waitForSourceActive(page) {
    await expect(page.locator('#welcome-overlay')).toHaveClass(/hidden/, { timeout: 15000 });
}

function resetPerf(page) {
    return page.evaluate(() => {
        window.__perf = { transformRebuilds: 0, positionUploads: 0, ringLayerRebuilds: 0 };
    });
}

test.describe('Moviemaker drag performance (issue #26) @gpu @gpu-perf', () => {
    test.skip(shouldSkipGpuTest(), 'WebGL pipeline requires GPU, skipped in CI (set GPU_CI=1 to run)');

    test.beforeEach(async ({ page }) => {
        await mockWebcam(page);
    });

    test('dragging the shape does not rebuild geometry per frame', async ({ page }) => {
        test.setTimeout(90000);

        await page.goto('/moviemaker/?perfdebug=1');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        await page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="64x64_serpentine.json"]')).toHaveClass(/active-preset/);

        // Let the animation loop reach steady state after the preset switch.
        await page.waitForTimeout(500);

        // Idle baseline: nothing should rebuild while at rest.
        await resetPerf(page);
        await page.waitForTimeout(500);
        const idle = await page.evaluate(() => ({ ...window.__perf }));
        expect(idle.positionUploads).toBeLessThanOrEqual(1);
        expect(idle.ringLayerRebuilds).toBeLessThanOrEqual(1);

        // Continuous left-drag: ~60 mousemoves over ~1s.
        const box = await page.locator('#overlayCanvas').boundingBox();
        await page.mouse.move(box.x + 100, box.y + 100);
        await page.mouse.down();
        await resetPerf(page);
        for (let i = 0; i < 60; i++) {
            await page.mouse.move(box.x + 100 + i, box.y + 100 + (i % 20));
            await page.waitForTimeout(50);
        }
        const drag = await page.evaluate(() => ({ ...window.__perf }));
        await page.mouse.up();

        // Before the fix these were ~60 (one per mousemove frame).
        expect(drag.ringLayerRebuilds).toBeLessThanOrEqual(1);
        expect(drag.positionUploads).toBeLessThanOrEqual(1);
        expect(drag.transformRebuilds).toBe(0);
    });

    test('GPU uniform transform matches the CPU reference math', async ({ page }) => {
        test.setTimeout(90000);

        await page.goto('/moviemaker/?perfdebug=1');
        await page.locator('[data-trigger="btn_start_webcam"]').click();
        await waitForSourceActive(page);

        // Select the 16x16 preset explicitly (the worker-shared context may
        // hold a restored screenmap from an earlier spec) and disable blur so
        // the sampled colors come straight from the mock-webcam test pattern.
        await page.locator('.preset-btn[data-preset-file="16x16_grid.json"]').click();
        await expect(page.locator('.preset-btn[data-preset-file="16x16_grid.json"]')).toHaveClass(/active-preset/);
        const blur = page.locator('#rng_blur');
        await blur.fill('0');
        await blur.dispatchEvent('input');

        await verifyTransform(page, { rotate: 0, zoom: 1 });

        // Rotation exercises the shader's rotation center/direction and
        // Y-axis orientation; zoom exercises the scale uniform.
        await page.locator('#rng_rotation').fill('90');
        await page.locator('#rng_rotation').dispatchEvent('input');
        await page.locator('#rng_zoom').fill('1.5');
        await page.locator('#rng_zoom').dispatchEvent('input');
        await verifyTransform(page, { rotate: 90, zoom: 1.5 });
    });
});

/**
 * Wait for the smoothed transform to converge to the target, then compare
 * the GPU-gathered LED colors against the mock-webcam pattern sampled at
 * CPU-computed transformed positions (the exact math the old baked path
 * used). Any mismatch in rotation center, order of operations, or Y-axis
 * orientation between the shader and the CPU reference shows up here.
 */
async function verifyTransform(page, { rotate, zoom }) {
    await page.waitForFunction(([r, z]) => {
        const dbg = window.__mmDebug;
        if (!dbg) return false;
        const s = dbg.getState();
        return s.rotate === r && s.zoom === z && s.sample && s.localPts.length > 0;
    }, [rotate, zoom], { timeout: 30000 });
    // The gather readback lags the transform by 1-2 frames — let it settle.
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => window.__mmDebug.getState());

    expect(state.sample.length).toBe(state.localPts.length * 3);

    // Mock webcam pattern (tests/helpers/webcam-mock.js): 480x480, #333
    // background with 80px red/green/blue squares.
    const squares = [
        { x: 100, y: 100, name: 'red',   check: (r, g, b) => r > 150 && g < 80 && b < 80 },
        { x: 200, y: 200, name: 'green', check: (r, g, b) => g > 150 && r < 80 && b < 80 },
        { x: 300, y: 300, name: 'blue',  check: (r, g, b) => b > 150 && r < 80 && g < 80 },
    ];
    const SIZE = 80;
    const MARGIN = 6;
    const bgCheck = (r, g, b) =>
        r > 20 && r < 110 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20;

    const rad = state.rotate * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    let checked = 0;
    const hits = { red: 0, green: 0, blue: 0 };

    for (let i = 0; i < state.localPts.length; i++) {
        const [lx, ly] = state.localPts[i];
        const x = Math.round((lx * c - ly * s) * state.zoom + state.translate[0]);
        const y = Math.round((lx * s + ly * c) * state.zoom + state.translate[1]);
        if (x < MARGIN || y < MARGIN ||
            x >= state.videoWidth - MARGIN || y >= state.videoHeight - MARGIN) continue;

        let expected = bgCheck;
        let expectedName = 'background';
        let nearEdge = false;
        for (const sq of squares) {
            const wellIn = x >= sq.x + MARGIN && x < sq.x + SIZE - MARGIN &&
                           y >= sq.y + MARGIN && y < sq.y + SIZE - MARGIN;
            const near = x >= sq.x - MARGIN && x < sq.x + SIZE + MARGIN &&
                         y >= sq.y - MARGIN && y < sq.y + SIZE + MARGIN;
            if (wellIn) {
                expected = sq.check;
                expectedName = sq.name;
            } else if (near) {
                nearEdge = true;
            }
        }
        if (nearEdge) continue;

        const r = state.sample[i * 3];
        const g = state.sample[i * 3 + 1];
        const b = state.sample[i * 3 + 2];
        expect(expected(r, g, b),
            `LED ${i} at (${x},${y}) expected ${expectedName}, sampled rgb(${r},${g},${b})`
        ).toBe(true);
        checked++;
        if (expectedName !== 'background') hits[expectedName]++;
    }

    // Sanity: the comparison must have covered background AND each square.
    expect(checked).toBeGreaterThan(50);
    expect(hits.red).toBeGreaterThan(0);
    expect(hits.green).toBeGreaterThan(0);
    expect(hits.blue).toBeGreaterThan(0);
}
