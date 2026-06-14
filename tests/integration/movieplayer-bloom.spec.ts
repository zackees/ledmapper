/**
 * E2E tests for the Bloom panel in the Video Player (auto-bloom checkbox + strength slider).
 */
import { test, expect } from './fixtures.ts';

test.describe('Video Player bloom panel', () => {
    test.beforeEach(async ({ page }) => {
        // Clear persisted bloom state so tests start with the default (auto on).
        await page.goto('/movieplayer/');
        await page.evaluate(() => { localStorage.removeItem('ledmapper.movieplayer.autoBloom'); });
        await page.reload();
    });

    test('auto bloom checkbox is present and checked by default', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');
        await expect(checkbox).toBeAttached();
        await expect(checkbox).toBeChecked();
    });

    test('strength slider is disabled while auto bloom is on', async ({ page }) => {
        const slider = page.locator('#rng_bloom_strength');
        await expect(slider).toBeAttached();
        await expect(slider).toBeDisabled();
    });

    test('unchecking auto bloom enables the slider', async ({ page }) => {
        const checkbox  = page.locator('#chk_auto_bloom');
        const slider    = page.locator('#rng_bloom_strength');
        const container = page.locator('#bloom_strength_slider');

        await checkbox.evaluate(el => el.click());
        await expect(slider).toBeEnabled();
        await expect(container).not.toHaveClass(/pointer-events-none/);
    });

    test('slider is seeded with a non-zero value after unchecking auto bloom', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');
        const slider   = page.locator('#rng_bloom_strength');

        await checkbox.evaluate(el => el.click());
        const val = await slider.inputValue();
        expect(parseInt(val)).toBeGreaterThan(0);
    });

    test('driving the slider updates the readout', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');
        await checkbox.evaluate(el => el.click());

        const slider  = page.locator('#rng_bloom_strength');
        const readout = page.locator('#txt_curr_bloom_strength');

        await slider.evaluate(el => { el.value = '75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        const text = await readout.textContent();
        expect(parseFloat(text)).toBeGreaterThan(0);
    });

    test('auto bloom state persists across reload', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');

        await checkbox.evaluate(el => el.click());
        await expect(checkbox).not.toBeChecked();

        await page.reload();
        await expect(page.locator('#chk_auto_bloom')).not.toBeChecked();
    });

    test('no console errors on page load', async ({ page }) => {
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        await page.reload();
        await page.waitForTimeout(500);
        expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
    });
});
