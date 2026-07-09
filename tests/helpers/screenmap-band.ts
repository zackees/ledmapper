import type { Page } from '@playwright/test';

/**
 * Expand the collapsed screenmap band so preset chips are actionable via a
 * real Playwright click (issue #248 — the band collapses to a compact
 * summary row once a layout is active, since a default preset always
 * auto-loads). No-op if the band is already expanded or the control isn't
 * present (e.g. tool without the picker mounted).
 */
export async function expandScreenmapBand(page: Page): Promise<void> {
    const changeLayoutBtn = page.locator('#btn_change_layout');
    if (await changeLayoutBtn.count() === 0) return;
    if (await changeLayoutBtn.isVisible()) {
        await changeLayoutBtn.click();
    }
}
