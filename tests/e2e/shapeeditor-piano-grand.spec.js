import { test, expect } from './fixtures.js';

test.describe('Piano Grand preset and staggered TCL panel', () => {

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
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    }

    test('Piano Grand preset loads staggered hex layout with 0.75 cm LEDs', async ({ page }) => {
        await gotoEditor(page);

        // #sel_preset may sit inside a collapsed accordion â€” drive it directly.
        await page.evaluate(() => {
            const sel = document.querySelector('#sel_preset');
            sel.value = 'piano_grand.json';
            sel.dispatchEvent(new Event('change'));
        });

        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getTotalLedCount())
        , { timeout: 10000 }).toBe(1744);

        await expect(page.locator('#txt_diameter')).toHaveValue('0.75');
    });

    test('inserting a Staggered grid (TCL) panel staggers odd columns and sets diameter 0.75', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        const name = await page.evaluate(() =>
            window.__shapeeditorDebug.placePanel('staggered-tcl', 0, 0, {})
        );
        expect(typeof name).toBe('string');
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        const result = await page.evaluate((stripName) => {
            const dbg = window.__shapeeditorDebug;
            const idx = dbg.getStripNames().indexOf(stripName);
            return { points: dbg.getStripPoints(idx), diameter: dbg.getStripDiameter(idx) };
        }, name);

        expect(result.diameter).toBe(0.75);
        expect(result.points.length).toBe(64);

        // Group points into columns by x; odd columns must be offset from
        // even columns by half the in-strand spacing = lateralPitch/sqrt(3).
        const cols = new Map();
        for (const [x, y] of result.points) {
            const key = x.toFixed(4);
            if (!cols.has(key)) cols.set(key, []);
            cols.get(key).push(y);
        }
        const xs = [...cols.keys()].map(Number).sort((a, b) => a - b);
        expect(xs.length).toBe(8);
        const lateral = xs[1] - xs[0];
        const expectedOffset = lateral / Math.sqrt(3);
        for (let c = 0; c < xs.length; c++) {
            const minY = Math.min(...cols.get(xs[c].toFixed(4)));
            const baseY = Math.min(...cols.get(xs[0].toFixed(4)));
            const offset = minY - baseY;
            const expected = c % 2 === 1 ? expectedOffset : 0;
            expect(Math.abs(offset - expected)).toBeLessThan(expectedOffset * 0.01 + 1e-6);
        }
    });

    test('Insert dialog path places a staggered grid via shared #pp_* controls', async ({ page }) => {
        await gotoEditor(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripCount());
        await page.evaluate(() => {
            window.__shapeeditorDebug.submitInsertDialog({
                catalogId: 'staggered-tcl',
                wiring: 'serpentine',
                corner: 'TL',
                rotation: 0,
                flipH: false,
                flipV: false,
                spacing: 2.54,
                cols: 6,
                rows: 5,
                stagger: true,
                snap: false,
                grid: 1,
                place: 'center',
            });
        });

        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(before + 1);

        const result = await page.evaluate(() => {
            const dbg = window.__shapeeditorDebug;
            const idx = dbg.getStripCount() - 1;
            return { points: dbg.getStripPoints(idx), diameter: dbg.getStripDiameter(idx) };
        });
        expect(result.points.length).toBe(30);
        expect(result.diameter).toBe(0.75);

        // Dialog wrote back to the accordion controls (single source of truth)
        await expect(page.locator('#pp_cols')).toHaveValue('6');
        await expect(page.locator('#pp_rows')).toHaveValue('5');
        await expect(page.locator('#pp_stagger')).toBeChecked();
    });
});
