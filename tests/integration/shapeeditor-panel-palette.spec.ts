import { test, expect } from './fixtures.ts';

test.describe('Shapeeditor panel palette', () => {

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
        });
    });

    async function gotoEditor(page) {
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        // Wait for the debug hook to be installed
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    }

    async function freshEditor(page) {
        await gotoEditor(page);
        // Reset to an empty editor regardless of any preset that auto-loaded.
        // The toolbar New button is CSS-hidden on desktop, so click it directly.
        await page.locator('#btn_new').evaluate((el) => el.click());
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(0);
    }

    async function dragSegmentMidpoint(page, firstIdx, secondIdx, dx = 40, dy = 25) {
        const start = await page.evaluate(([aIdx, bIdx]) => {
            const a = window.__shapeeditorDebug.getLedCanvasPos(aIdx);
            const b = window.__shapeeditorDebug.getLedCanvasPos(bIdx);
            if (!a || !b) return null;
            const x = (a.clientX + b.clientX) / 2;
            const y = (a.clientY + b.clientY) / 2;
            const endpointDistance = Math.hypot(a.clientX - x, a.clientY - y);
            return { x, y, endpointDistance };
        }, [firstIdx, secondIdx]);
        if (!start) return null;
        await page.mouse.move(start.x, start.y);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
        await page.mouse.up({ button: 'right' });
        return { endpointDistance: start.endpointDistance };
    }

    test('panel palette is visible with catalog buttons', async ({ page }) => {
        await gotoEditor(page);
        const palette = page.locator('#panel_palette');
        await expect(palette).toBeVisible();
        await palette.evaluate((el) => { el.open = true; });
        const buttons = page.locator('#panel_catalog_buttons .panel-btn');
        await expect(buttons).not.toHaveCount(0);
        // Spot-check expected catalog entries
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: '8×8 Matrix' })).toBeVisible();
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: 'Ring 16' })).toBeVisible();
        await expect(page.locator('#panel_catalog_buttons .panel-btn', { hasText: 'Strip 60' })).toBeVisible();
    });

    test('placing an 8x8 via debug hook adds a panel strip with 64 LEDs', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        expect(typeof name).toBe('string');
        expect(name.startsWith('panel')).toBeTruthy();

        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).toContain(name);

        // Save As → JSON should contain the new strip with 64 LEDs
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#btn_save_as').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        expect(json.map[name]).toBeTruthy();
        expect(json.map[name].x.length).toBe(64);
        expect(json.map[name].y.length).toBe(64);
    });

    test('undo removes the placed panel', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        await page.locator('#btn_undo').click();
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before);
        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).not.toContain(name);
    });

    test('placing onto an empty editor initializes a fresh map', async ({ page }) => {
        await freshEditor(page);

        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {})
        );
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(1);
        const names = await page.evaluate(() =>
            window.__shapeeditorDebug.getStripNames()
        );
        expect(names).toEqual([name]);
    });

    test('placing a ring exits Chain mode so the new strip can be dragged', async ({ page }) => {
        await freshEditor(page);
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', -20, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.setMode('chain'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('chain');

        await page.locator('#panel_palette').evaluate((el) => { el.open = true; });
        await page.locator('#panel_catalog_buttons [data-catalog-id="ring-24"]').click();

        // Panel placement and chain rewiring are mutually exclusive canvas modes.
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('select');

        const overlay = page.locator('canvas').last();
        const box = await overlay.boundingBox();
        if (!box) throw new Error('expected visible shapeeditor overlay canvas');
        await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(2);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        const moved = await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(64, 30, 20, { button: 2 }));
        expect(moved).toBe(true);
        const after = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(after[0][0]).not.toBeCloseTo(before[0][0], 6);
        expect(after[0][1]).not.toBeCloseTo(before[0][1], 6);
    });

    test('dragging a visible ring arc moves only that strip, not the global bounding box', async ({ page }) => {
        await freshEditor(page);
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', -150, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('ring-24', 150, 0, { spacing: 4 }));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(65) !== null)).toBe(true);

        const beforeMatrix = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeRing = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        const drag = await dragSegmentMidpoint(page, 64, 65);
        if (!drag) throw new Error('expected a visible ring segment');
        expect(drag.endpointDistance).toBeGreaterThan(10);

        const afterMatrix = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterRing = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(afterMatrix).toEqual(beforeMatrix);
        const dx = afterRing[0][0] - beforeRing[0][0];
        const dy = afterRing[0][1] - beforeRing[0][1];
        expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
        for (let i = 1; i < beforeRing.length; i++) {
            expect(afterRing[i][0] - beforeRing[i][0]).toBeCloseTo(dx, 6);
            expect(afterRing[i][1] - beforeRing[i][1]).toBeCloseTo(dy, 6);
        }

        await page.keyboard.press('Control+z');
        const restoredRing = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        for (let i = 0; i < beforeRing.length; i++) {
            expect(restoredRing[i][0]).toBeCloseTo(beforeRing[i][0], 6);
            expect(restoredRing[i][1]).toBeCloseTo(beforeRing[i][1], 6);
        }
    });

    test('overlapping geometry prefers the topmost strip, then the selected underlying strip', async ({ page }) => {
        await freshEditor(page);
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('ring-24', 0, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('ring-24', 0, 0, {}));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(25) !== null)).toBe(true);

        const originalLower = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const originalUpper = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        // Panel placement selects the newest strip; clear that preference so
        // this first phase specifically proves the topmost fallback.
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(-1));
        expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrip())).toBe(null);
        const topmostDrag = await dragSegmentMidpoint(page, 0, 1);
        if (!topmostDrag) throw new Error('expected an overlapping ring segment');
        // This midpoint is inside both coincident LED hit areas, exercising
        // deterministic LED tie-breaking rather than the stroke resolver.
        expect(topmostDrag.endpointDistance).toBeLessThan(10);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(originalLower);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1))).toEqual(originalUpper);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([1]);

        await dragSegmentMidpoint(page, 0, 1);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1))).not.toEqual(originalUpper);

        await page.keyboard.press('Control+z');
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        const selectedDrag = await dragSegmentMidpoint(page, 0, 1, -40, -25);
        if (!selectedDrag) throw new Error('expected a selected underlying ring segment');
        expect(selectedDrag.endpointDistance).toBeLessThan(10);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).not.toEqual(originalLower);
        const untouchedUpper = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        for (let i = 0; i < originalUpper.length; i++) {
            expect(untouchedUpper[i][0]).toBeCloseTo(originalUpper[i][0], 6);
            expect(untouchedUpper[i][1]).toBeCloseTo(originalUpper[i][1], 6);
        }
    });
});
