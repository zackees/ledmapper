import { expect, test, type Page } from '@playwright/test';

// Regression coverage for issue #411's mobile scroll/reachability contract.
test.use({
    hasTouch: true,
    isMobile: true,
});

interface MobileViewport {
    width: number;
    height: number;
    label: string;
}

const VIEWPORTS: MobileViewport[] = [
    { width: 390, height: 664, label: 'phone portrait' },
    { width: 750, height: 342, label: 'phone landscape' },
];

const ROUTES = [
    { path: '/play', target: '.lm-canvas-wrapper' },
    { path: '/create', target: '#main' },
    { path: '/record', target: '[data-trigger="btn_start_webcam"]' },
];

async function swipeUp(page: Page): Promise<void> {
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('mobile viewport is required');
    const session = await page.context().newCDPSession(page);
    const x = Math.max(8, viewport.width - 12);
    // Start on route chrome rather than an editing canvas. Canvas gestures may
    // intentionally use touch-action:none; the contract is that the rest of
    // the page remains natively scrollable.
    const startY = Math.max(80, Math.min(300, viewport.height - 48));
    const endY = Math.min(startY - 80, 72);
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y: startY }],
    });
    for (let step = 1; step <= 5; step++) {
        const y = startY + ((endY - startY) * step) / 5;
        await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y }],
        });
    }
    await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
    await expect.poll(() => page.locator('#app-content').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
}

for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
        test(`${route.path} is touch-scrollable and reachable on ${viewport.label}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto(route.path, { waitUntil: 'domcontentloaded' });
            await expect(page.locator(route.target).first()).toBeAttached();

            const scrollContract = await page.locator('#app-content').evaluate((el) => {
                const style = getComputedStyle(el);
                return {
                    clientHeight: el.clientHeight,
                    scrollHeight: el.scrollHeight,
                    overflowY: style.overflowY,
                };
            });
            expect(scrollContract.overflowY).toMatch(/^(auto|scroll)$/);
            expect(scrollContract.scrollHeight).toBeGreaterThanOrEqual(scrollContract.clientHeight);

            // Progressive mobile layouts may fit every required control in
            // the viewport (Create's canvas-first state and Record's compact
            // source setup). Scroll only when content actually overflows;
            // otherwise direct reachability is the stronger assertion.
            if (scrollContract.scrollHeight > scrollContract.clientHeight) {
                await swipeUp(page);
            }
            await page.locator(route.target).first().scrollIntoViewIfNeeded();

            const targetBox = await page.locator(route.target).first().boundingBox();
            expect(targetBox).not.toBeNull();
            expect(targetBox!.y).toBeGreaterThanOrEqual(0);
            expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(viewport.height + 1);
            expect(targetBox!.x).toBeGreaterThanOrEqual(0);
            expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(viewport.width + 1);

            if (route.path === '/record') {
                for (const card of await page.locator('.source-card').all()) {
                    await card.scrollIntoViewIfNeeded();
                    const box = await card.boundingBox();
                    expect(box).not.toBeNull();
                    expect(box!.x).toBeGreaterThanOrEqual(0);
                    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
                }
            }
        });
    }
}

test('same-shell mode navigation resets the mobile scroll owner', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.lm-canvas-wrapper')).toBeAttached();
    await page.locator('#app-content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => page.locator('#app-content').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    await page.locator('.app-mode-link[data-mode="create"]').click();
    await expect(page.locator('#main')).toBeAttached();
    await expect.poll(() => page.locator('#app-content').evaluate((el) => el.scrollTop)).toBe(0);
});
