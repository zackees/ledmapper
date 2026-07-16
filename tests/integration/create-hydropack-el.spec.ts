import { expect, test } from './fixtures.ts';

const STORAGE_KEYS = [
    'lm:screenmap',
    'lm:screenmap-meta',
    'lm:screenmap-preset',
    'lm:screenmap-backup',
    'lm:shapeeditor-helpDismissed',
    'shapeeditor.overlayCollapsed',
];

test.describe('Create HydroPack EL preset', () => {
    test('loads two triangular EL panels and the center EL wire from Load', async ({ page }) => {
        await page.addInitScript((keys) => {
            for (const key of keys) localStorage.removeItem(key);
            localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
        }, STORAGE_KEYS);
        await page.goto('/create', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible({ timeout: 10000 });

        await page.locator('#btn_load_screenmap').click();
        const elTab = page.locator('#sel_preset_mount .preset-picker-tab[data-category="el"]');
        await expect(elTab).toBeVisible();
        await elTab.click();

        const hydropack = page.locator('#sel_preset_mount .preset-btn[data-preset-file="hydropack_el_shapes.json"]');
        await expect(hydropack).toHaveText('HydroPack EL < | >');
        await hydropack.click();
        await expect(page.locator('#controls')).toBeHidden();
        await expect(page.locator('.shapeeditor-placeholder')).toBeHidden();
        await expect.poll(() => page.evaluate(() => {
            const state = window.__lmDebug?.shapeeditor?.getState?.() as { shapeCount?: number; shapeTypes?: string[] } | undefined;
            return state ? { shapeCount: state.shapeCount, shapeTypes: state.shapeTypes } : null;
        })).toEqual({ shapeCount: 3, shapeTypes: ['el_panel', 'el_panel', 'el_panel'] });
        const linkedSelection = await page.evaluate(() => {
            window.__shapeeditorDebug?.selectStrip?.(0);
            return window.__shapeeditorDebug?.getSelectedStrips?.();
        });
        expect(linkedSelection).toEqual([0, 2]);

        const loaded = await page.evaluate(() => JSON.parse(localStorage.getItem('lm:screenmap') ?? '{}'));
        expect(loaded.segments.map((segment: { type: string }) => segment.type)).toEqual([
            'el_panel', 'el_panel', 'el_panel',
        ]);
        expect(loaded.segments[0].x).toEqual([-5, -2, -2]);
        expect(loaded.segments[0].y).toEqual([0, -1.5, 1.5]);
        expect(loaded.segments[2].x).toEqual([5, 2, 2]);
        expect(loaded.segments[2].y).toEqual([0, 1.5, -1.5]);
        expect(loaded.segments[1].x).toEqual([-0.5, 0.5, 0.5, -0.5]);
        expect(loaded.segments[1].y).toEqual([-3, -3, 3, 3]);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset')))
            .toBe('hydropack_el_shapes.json');
    });
});
