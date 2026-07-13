import { test, expect } from './fixtures.ts';

test.describe('app shell mode navigation', () => {
    test('uses persistent top links with route-aware active state', async ({ page }) => {
        await page.goto('/play');

        const nav = page.locator('#app-mode-bar');
        const links = nav.locator('a.app-mode-link[data-mode]');
        const modeGroup = nav.locator('.app-mode-links');
        await expect(nav).toBeVisible();
        await expect(nav.locator('a.app-brand')).toHaveText('FastLED Video Mapper');
        await expect(nav.locator('a.app-brand')).toHaveAttribute('href', '/play');
        await expect(modeGroup).toBeVisible();
        await expect(links).toHaveCount(3);
        await expect(nav.locator('a.app-home-link')).toHaveCount(0);
        await expect(links.nth(0)).toHaveAttribute('href', '/play');
        await expect(links.nth(1)).toHaveAttribute('href', '/create');
        await expect(links.nth(2)).toHaveAttribute('href', '/record');
        await expect(links.nth(0)).toHaveAttribute('aria-current', 'page');
        await expect(nav.locator('button, .app-mode-icon')).toHaveCount(0);

        const initial = await nav.evaluate((el) => {
            el.setAttribute('data-instance', 'preserved');
            const content = document.querySelector('#app-content');
            return {
                beforeContent: content ? Boolean(el.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
                position: getComputedStyle(el).position,
                top: el.getBoundingClientRect().top,
            };
        });
        expect(initial.beforeContent).toBe(true);
        expect(initial.position).toBe('sticky');
        await expect.poll(() => nav.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThanOrEqual(1);

        const popupPromise = page.context().waitForEvent('page');
        await links.nth(1).click({ modifiers: ['ControlOrMeta'] });
        const popup = await popupPromise;
        await expect(page).toHaveURL(/\/play$/);
        await popup.close();

        await links.nth(1).click();
        await expect(page).toHaveURL(/\/create$/);
        await expect(page.locator('#app-content')).toHaveAttribute('data-tool', 'shapeeditor');
        await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints !== undefined);
        await expect(page.locator('#app-mode-bar')).toHaveAttribute('data-instance', 'preserved');
        await expect(page.locator('a.app-mode-link[href="/create"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('a.app-mode-link[href="/play"]')).not.toHaveAttribute('aria-current', 'page');

        const nestedHeights = await page.evaluate(() => {
            const content = document.querySelector<HTMLElement>('#app-content');
            return {
                content: content?.getBoundingClientRect().height ?? 0,
                editor: content?.classList.contains('shapeeditor-root') ? content.getBoundingClientRect().height : 0,
            };
        });
        expect(nestedHeights.editor).toBeLessThanOrEqual(nestedHeights.content + 1);

        await page.goBack();
        await expect(page).toHaveURL(/\/play$/);
        await expect(page.locator('#app-mode-bar')).toHaveAttribute('data-instance', 'preserved');
        await expect(page.locator('a.app-mode-link[href="/play"]')).toHaveAttribute('aria-current', 'page');

        await links.nth(2).click();
        await expect(page).toHaveURL(/\/record$/);
        await expect(page.locator('#app-content')).toHaveAttribute('data-tool', 'moviemaker');
        await page.waitForFunction(() => (window.__lmDebug?.moviemaker?.getState().ledCount ?? 0) > 0);
        await expect(page.locator('a.app-mode-link[href="/record"]')).toHaveAttribute('aria-current', 'page');
    });

    test('keeps the brand left while centering the mode group on desktop', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/play');

        const metrics = await page.locator('#app-mode-bar').evaluate((nav) => {
            const brand = nav.querySelector<HTMLElement>('.app-brand')?.getBoundingClientRect();
            const group = nav.querySelector<HTMLElement>('.app-mode-links')?.getBoundingClientRect();
            const bar = nav.getBoundingClientRect();
            if (!brand || !group) throw new Error('navigation geometry missing');
            return {
                brandLeft: brand.left,
                brandRight: brand.right,
                modeCenter: (group.left + group.right) / 2,
                barCenter: (bar.left + bar.right) / 2,
            };
        });

        expect(metrics.brandLeft).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.modeCenter - metrics.barCenter)).toBeLessThanOrEqual(1);
        expect(metrics.brandRight).toBeLessThan(metrics.modeCenter);
    });

    test('fits three equal touch targets at 320px', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.goto('/record');
        await expect(page.locator('a.app-mode-link[href="/record"]')).toHaveAttribute('aria-current', 'page');

        const metrics = await page.locator('#app-mode-bar').evaluate((nav) => {
            const boxes = Array.from(nav.querySelectorAll<HTMLElement>('a.app-mode-link[data-mode]'))
                .map((el) => el.getBoundingClientRect());
            return {
                clientWidth: nav.clientWidth,
                scrollWidth: nav.scrollWidth,
                brandRight: nav.querySelector<HTMLElement>('.app-brand')?.getBoundingClientRect().right ?? 0,
                modeGroupLeft: nav.querySelector<HTMLElement>('.app-mode-links')?.getBoundingClientRect().left ?? 0,
                widths: boxes.map((box) => box.width),
                heights: boxes.map((box) => box.height),
                top: nav.getBoundingClientRect().top,
            };
        });

        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
        expect(metrics.modeGroupLeft).toBeGreaterThanOrEqual(metrics.brandRight - 1);
        expect(Math.max(...metrics.widths) - Math.min(...metrics.widths)).toBeLessThanOrEqual(1);
        expect(Math.min(...metrics.heights)).toBeGreaterThanOrEqual(44);
        await expect.poll(() => page.locator('#app-mode-bar').evaluate((nav) => nav.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    });
});
