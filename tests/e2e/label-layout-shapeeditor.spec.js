import { test, expect } from './fixtures.js';

// 16 serpentine 16x16 panels in a 4x4 grid — the 64x64 layout from issue #28
// where the old fixed-offset labels piled up unreadably at panel corners.
function sixteenPanelScreenmap() {
    const map = {};
    for (let q = 0; q < 4; q++) {
        for (let p = 0; p < 4; p++) {
            const xs = [], ys = [];
            for (let row = 0; row < 16; row++) {
                for (let col = 0; col < 16; col++) {
                    const c = row % 2 === 0 ? col : 15 - col;
                    xs.push(p * 16 + c);
                    ys.push(q * 16 + row);
                }
            }
            map[`q${q}_p${p}`] = { x: xs, y: ys, diameter: 0.25 };
        }
    }
    return JSON.stringify({ map });
}

function boxesOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test.describe('Shapeeditor label-layout engine (issue #28)', () => {

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
        });
    });

    test('16-strip 64x64 serpentine map places non-overlapping Start/End labels', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await page.goto('/shapeeditor/');
        await page.locator('#btn_upload_screenmap').setInputFiles({
            name: 'sixteen-panel.json',
            mimeType: 'application/json',
            buffer: Buffer.from(sixteenPanelScreenmap()),
        });
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });

        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(16);

        // Wait until the overlay has painted labels through the engine.
        await expect.poll(
            () => page.evaluate(() => window.__labelLayoutDebug().placements.length),
            { timeout: 10000 },
        ).toBe(32);

        const dump = await page.evaluate(() => window.__labelLayoutDebug());

        // Every strip got a Start and an End placement.
        const ids = dump.placements.map((p) => p.id).sort();
        expect(ids.filter((id) => id.startsWith('start:'))).toHaveLength(16);
        expect(ids.filter((id) => id.startsWith('end:'))).toHaveLength(16);

        // Core invariant: no two non-degraded label boxes overlap.
        const visible = dump.placements.filter((p) => !p.hidden && !p.demoted);
        expect(visible.length).toBeGreaterThan(0);
        for (let i = 0; i < visible.length; i++) {
            for (let j = i + 1; j < visible.length; j++) {
                const a = { x: visible[i].labelX, y: visible[i].labelY, w: visible[i].w, h: visible[i].h };
                const b = { x: visible[j].labelX, y: visible[j].labelY, w: visible[j].w, h: visible[j].h };
                expect(boxesOverlap(a, b), `${visible[i].id} overlaps ${visible[j].id}`).toBe(false);
            }
        }

        expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
    });

    test('steady-state redraws hit the layout cache instead of re-running', async ({ page }) => {
        await page.goto('/shapeeditor/');
        await page.locator('#btn_upload_screenmap').setInputFiles({
            name: 'sixteen-panel.json',
            mimeType: 'application/json',
            buffer: Buffer.from(sixteenPanelScreenmap()),
        });
        await expect.poll(
            () => page.evaluate(() => window.__labelLayoutDebug().placements.length),
            { timeout: 10000 },
        ).toBe(32);

        const before = await page.evaluate(() => window.__labelLayoutDebug().counters);
        await page.waitForTimeout(500); // many animation frames
        const after = await page.evaluate(() => window.__labelLayoutDebug().counters);

        // Idle/steady-state frames must never re-run the placement engine.
        expect(after.layoutRuns).toBe(before.layoutRuns);
    });
});
