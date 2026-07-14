import { expect, test } from '@playwright/test';

test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 664 },
});

test('global viewport policy permits browser zoom without a scale cap', async ({ page }) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).not.toBeNull();
    expect(content).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(content).not.toMatch(/maximum-scale\s*=/i);
});

test('browser zoom updates the visual viewport while the app remains operable', async ({ page }) => {
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-mode-link[aria-current="page"]')).toHaveText('Play');

    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBeGreaterThanOrEqual(1.9);
    await page.locator('.app-mode-link[aria-current="page"]').evaluate((link) => {
        (window as Window & { __zoomLinkClicked?: boolean }).__zoomLinkClicked = false;
        link.addEventListener('click', () => {
            (window as Window & { __zoomLinkClicked?: boolean }).__zoomLinkClicked = true;
        }, { once: true });
    });

    const zoomedLayout = await page.evaluate(() => {
        const viewport = window.visualViewport;
        const activeMode = document.querySelector<HTMLElement>('.app-mode-link[aria-current="page"]');
        if (!viewport || !activeMode) throw new Error('visual viewport and active mode are required');
        const rect = activeMode.getBoundingClientRect();
        return {
            scale: viewport.scale,
            visualWidth: viewport.width,
            layoutWidth: window.innerWidth,
            activeLeft: rect.left,
            viewportLeft: viewport.offsetLeft,
            visibleActiveWidth: Math.max(0, Math.min(rect.right, viewport.offsetLeft + viewport.width)
                - Math.max(rect.left, viewport.offsetLeft)),
            touchX: Math.max(rect.left, viewport.offsetLeft) + 22,
            touchY: rect.top + (rect.height / 2),
        };
    });
    expect(zoomedLayout.scale).toBeGreaterThanOrEqual(1.9);
    expect(zoomedLayout.visualWidth).toBeLessThan(zoomedLayout.layoutWidth);
    expect(zoomedLayout.activeLeft).toBeGreaterThanOrEqual(zoomedLayout.viewportLeft);
    expect(zoomedLayout.visibleActiveWidth).toBeGreaterThanOrEqual(44);

    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: zoomedLayout.touchX, y: zoomedLayout.touchY }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(
        () => (window as Window & { __zoomLinkClicked?: boolean }).__zoomLinkClicked,
    )).toBe(true);
});

test('gesture suppression is scoped to the interactive Create canvas', async ({ page }) => {
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeAttached();

    const touchActions = await page.evaluate(() => ({
        shell: getComputedStyle(document.querySelector<HTMLElement>('#app-content')!).touchAction,
        modeBar: getComputedStyle(document.querySelector<HTMLElement>('.app-mode-bar')!).touchAction,
        canvas: getComputedStyle(document.querySelector<HTMLElement>('.shapeeditor-overlay-canvas')!).touchAction,
    }));
    expect(touchActions.shell).not.toBe('none');
    expect(touchActions.modeBar).not.toBe('none');
    expect(touchActions.canvas).toBe('none');
});
