import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');
const MIN_TARGET = 44;

interface TargetContract {
    label: string;
    selector: string;
    width?: boolean;
}

async function expectTouchTargets(page: Page, targets: TargetContract[]): Promise<void> {
    const measurements = await page.evaluate((contracts) => contracts.map(({ label, selector, width }) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`missing touch target: ${label} (${selector})`);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { label, width, rect: { width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility };
    }), targets);

    for (const target of measurements) {
        expect.soft(target.display, `${target.label} display`).not.toBe('none');
        expect.soft(target.visibility, `${target.label} visibility`).not.toBe('hidden');
        expect.soft(target.rect.height, `${target.label} height`).toBeGreaterThanOrEqual(MIN_TARGET);
        if (target.width !== false) {
            expect.soft(target.rect.width, `${target.label} width`).toBeGreaterThanOrEqual(MIN_TARGET);
        }
    }
}

test.describe('shared coarse-pointer touch targets', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 664 } });

    test('Play actions, select, slider, checkbox, and navigation meet the target', async ({ page }) => {
        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#btn_play')).toBeVisible();
        await expectTouchTargets(page, [
            { label: 'Play navigation', selector: '.app-mode-link[data-mode="play"]' },
            { label: 'Play action', selector: '#btn_play' },
            { label: 'Open FLED action', selector: '#btn_choose_fled' },
            { label: 'FPS select', selector: '#sel_framerate' },
            { label: 'LED size slider', selector: '#rng_diameter' },
            { label: 'Smooth checkbox label', selector: '.checkbox-row:has(#chk_interpolation)' },
            { label: 'More disclosure', selector: '.demo-more > summary' },
        ]);
    });

    test('Create mobile actions, preset, file, icon, and form controls meet the target', async ({ page }) => {
        await page.goto('/create', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
        await expectTouchTargets(page, [
            { label: 'Create navigation', selector: '.app-mode-link[data-mode="create"]' },
            { label: 'Map action', selector: '#btn_mobile_map' },
            { label: 'Tools action', selector: '#btn_mobile_tools' },
            { label: 'Help action', selector: '#btn_mobile_help' },
        ]);

        await page.locator('#btn_mobile_map').click();
        await expect(page.locator('#controls')).toBeVisible();
        await expect(page.locator('#sel_preset_mount .preset-btn').first()).toBeVisible();
        await expectTouchTargets(page, [
            { label: 'Map close icon', selector: '#btn_mobile_map_close' },
            { label: 'New map action', selector: '#btn_new' },
            { label: 'Preset chip', selector: '#sel_preset_mount .preset-btn' },
            { label: 'Screenmap file input', selector: '#btn_upload_screenmap' },
        ]);
        await page.locator('#btn_mobile_map_close').click();

        await page.locator('#btn_mobile_tools').click();
        await expect(page.locator('#transform-overlay')).toBeVisible();
        await expectTouchTargets(page, [
            { label: 'Tools collapse icon', selector: '#btn_overlay_collapse' },
            { label: 'Scale number input', selector: '#txt_scale' },
            { label: 'Snap slider', selector: '#rng_snap_back_px' },
            { label: 'Magnetic snap checkbox label', selector: 'label:has(#chk_snap_back)' },
        ]);
    });

    test('Record source and loaded-workspace controls meet the target', async ({ page }) => {
        await page.goto('/record', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
        await expectTouchTargets(page, [
            { label: 'Record navigation', selector: '.app-mode-link[data-mode="record"]' },
            { label: 'Video source card', selector: '[data-trigger="btn_load_video"]' },
            { label: 'Camera source card', selector: '[data-trigger="btn_start_webcam"]' },
        ]);

        await page.locator('#video_file_input').setInputFiles(VIDEO_PATH);
        await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe('video');
        await expect(page.locator('.app-layout')).toHaveAttribute('data-phase', 'workspace');
        await expectTouchTargets(page, [
            { label: 'Record action', selector: '#btn_toggle_record' },
            { label: 'Format select', selector: '#sel_record_format' },
            { label: 'Resolution select', selector: '#sel_max_resolution' },
            { label: 'Blur slider', selector: '#rng_blur' },
            { label: 'Auto bloom checkbox label', selector: '.checkbox-inline:has(#chk_auto_bloom)' },
            { label: 'Unload source icon', selector: '#btn_unload_source' },
        ]);
    });
});
