/**
 * E2E tests for the Bloom panel in the Video Maker (auto-bloom checkbox + strength slider).
 */
import { test, expect } from './fixtures.js';

test.describe('Bloom panel', () => {
    test.beforeEach(async ({ page }) => {
        // Clear persisted bloom state so tests start with the default (auto on).
        await page.goto('/moviemaker/');
        await page.evaluate(() => localStorage.removeItem('ledmapper.moviemaker.autoBloom'));
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

    test('strength slider container has disabled class while auto bloom is on', async ({ page }) => {
        const container = page.locator('#bloom_strength_slider');
        await expect(container).toHaveClass(/disabled/);
    });

    test('unchecking auto bloom enables the slider', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');
        const slider   = page.locator('#rng_bloom_strength');
        const container = page.locator('#bloom_strength_slider');

        // Use JS click to avoid the help-fab button intercepting pointer events.
        await checkbox.evaluate(el => el.click());
        await expect(slider).toBeEnabled();
        await expect(container).not.toHaveClass(/disabled/);
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

        // Set slider to 75
        await slider.evaluate(el => { el.value = '75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        const text = await readout.textContent();
        // Should be a non-zero decimal number
        expect(parseFloat(text)).toBeGreaterThan(0);
    });

    test('re-checking auto bloom disables slider again', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');
        const slider   = page.locator('#rng_bloom_strength');
        const container = page.locator('#bloom_strength_slider');

        await checkbox.evaluate(el => el.click()); // uncheck
        await expect(slider).toBeEnabled();
        await checkbox.evaluate(el => el.click()); // re-check
        await expect(slider).toBeDisabled();
        await expect(container).toHaveClass(/disabled/);
    });

    test('auto bloom state persists across reload', async ({ page }) => {
        const checkbox = page.locator('#chk_auto_bloom');

        // Turn off auto bloom
        await checkbox.evaluate(el => el.click());
        await expect(checkbox).not.toBeChecked();

        // Reload and check it stayed off
        await page.reload();
        const checkboxAfter = page.locator('#chk_auto_bloom');
        await expect(checkboxAfter).not.toBeChecked();
        // (beforeEach will clear localStorage before next test)
    });

    test('no console errors on page load', async ({ page }) => {
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push(msg.text());
        });
        await page.reload();
        // Allow a brief moment for any async errors
        await page.waitForTimeout(500);
        expect(errors.filter(e => !e.includes('favicon'))).toHaveLength(0);
    });
});
