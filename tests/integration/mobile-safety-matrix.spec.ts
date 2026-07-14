import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');
const MIN_TOUCH_TARGET = 44;

const VIEWPORTS = [
    { width: 320, height: 568, label: 'small phone portrait' },
    { width: 360, height: 800, label: 'Android phone portrait' },
    { width: 390, height: 844, label: 'iPhone portrait' },
    { width: 430, height: 932, label: 'large phone portrait' },
    { width: 750, height: 342, label: 'phone landscape' },
] as const;

interface ElementGeometry {
    selector: string;
    display: string;
    visibility: string;
    width: number;
    height: number;
    left: number;
    right: number;
    topInContent: number;
    bottomInContent: number;
}

async function expectMobileLayout(page: Page, selectors: string[]): Promise<void> {
    const layout = await page.evaluate((requiredSelectors): {
        viewport: { left: number; right: number; width: number; scale: number };
        document: { clientWidth: number; scrollWidth: number };
        content: { clientWidth: number; scrollWidth: number; scrollHeight: number };
        modeBar: { left: number; right: number };
        links: { label: string; width: number; height: number; left: number; right: number }[];
        elements: ElementGeometry[];
    } => {
        const content = document.querySelector<HTMLElement>('#app-content');
        const modeBar = document.querySelector<HTMLElement>('#app-mode-bar');
        if (!content || !modeBar) throw new Error('application shell is incomplete');

        const visual = window.visualViewport;
        // WebKit's headless visual viewport excludes its scrollbar while the
        // layout viewport (and fixed shell) correctly spans the client width.
        const viewportLeft = 0;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportRight = viewportLeft + viewportWidth;
        const contentRect = content.getBoundingClientRect();
        const modeBarRect = modeBar.getBoundingClientRect();

        const elements = requiredSelectors.map((selector) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) throw new Error(`missing required mobile control: ${selector}`);
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                selector,
                display: style.display,
                visibility: style.visibility,
                width: rect.width,
                height: rect.height,
                left: rect.left,
                right: rect.right,
                topInContent: rect.top - contentRect.top + content.scrollTop,
                bottomInContent: rect.bottom - contentRect.top + content.scrollTop,
            };
        });

        return {
            viewport: {
                left: viewportLeft,
                right: viewportRight,
                width: viewportWidth,
                scale: visual?.scale ?? 1,
            },
            document: {
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
            },
            content: {
                clientWidth: content.clientWidth,
                scrollWidth: content.scrollWidth,
                scrollHeight: content.scrollHeight,
            },
            modeBar: { left: modeBarRect.left, right: modeBarRect.right },
            links: Array.from(modeBar.querySelectorAll<HTMLElement>('.app-mode-link')).map((link) => {
                const rect = link.getBoundingClientRect();
                return {
                    label: link.textContent.trim(),
                    width: rect.width,
                    height: rect.height,
                    left: rect.left,
                    right: rect.right,
                };
            }),
            elements,
        };
    }, selectors);

    expect.soft(layout.viewport.scale, 'browser zoom').toBe(1);
    expect.soft(layout.document.scrollWidth, 'document horizontal overflow')
        .toBeLessThanOrEqual(layout.document.clientWidth + 1);
    expect.soft(layout.content.scrollWidth, 'app-content horizontal overflow')
        .toBeLessThanOrEqual(layout.content.clientWidth + 1);
    expect.soft(layout.modeBar.left, 'mode bar left edge').toBeGreaterThanOrEqual(layout.viewport.left - 1);
    expect.soft(layout.modeBar.right, 'mode bar right edge').toBeLessThanOrEqual(layout.viewport.right + 1);

    expect(layout.links).toHaveLength(3);
    for (const link of layout.links) {
        expect.soft(link.width, `${link.label} touch width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect.soft(link.height, `${link.label} touch height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
        expect.soft(link.left, `${link.label} left edge`).toBeGreaterThanOrEqual(layout.viewport.left - 1);
        expect.soft(link.right, `${link.label} right edge`).toBeLessThanOrEqual(layout.viewport.right + 1);
    }

    for (const element of layout.elements) {
        expect.soft(element.display, `${element.selector} display`).not.toBe('none');
        expect.soft(element.visibility, `${element.selector} visibility`).not.toBe('hidden');
        expect.soft(element.width, `${element.selector} width`).toBeGreaterThan(0);
        expect.soft(element.height, `${element.selector} height`).toBeGreaterThan(0);
        expect.soft(element.left, `${element.selector} left edge`).toBeGreaterThanOrEqual(layout.viewport.left - 1);
        expect.soft(element.right, `${element.selector} right edge`).toBeLessThanOrEqual(layout.viewport.right + 1);
        expect.soft(element.topInContent, `${element.selector} top reachability`).toBeGreaterThanOrEqual(-1);
        expect.soft(element.bottomInContent, `${element.selector} bottom reachability`)
            .toBeLessThanOrEqual(layout.content.scrollHeight + 1);
    }
}

async function expectFixedSheetInViewport(page: Page, selector: string): Promise<void> {
    const geometry = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const visual = window.visualViewport;
        const left = visual?.offsetLeft ?? 0;
        const top = visual?.offsetTop ?? 0;
        return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            viewport: {
                left,
                right: left + (visual?.width ?? window.innerWidth),
                top,
                bottom: top + (visual?.height ?? window.innerHeight),
            },
        };
    });

    expect.soft(geometry.left).toBeGreaterThanOrEqual(geometry.viewport.left - 1);
    expect.soft(geometry.right).toBeLessThanOrEqual(geometry.viewport.right + 1);
    expect.soft(geometry.top).toBeGreaterThanOrEqual(geometry.viewport.top - 1);
    expect.soft(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + 1);
}

for (const viewport of VIEWPORTS) {
    test(`all routes satisfy the mobile safety contract at ${viewport.width}x${viewport.height} (${viewport.label})`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);

        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.lm-canvas-wrapper')).toBeVisible();
        await expectMobileLayout(page, ['.lm-canvas-wrapper', '#btn_play', '#sel_framerate', '#rng_diameter']);

        await page.goto('/create', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
        await expectMobileLayout(page, [
            '#main',
            '#btn_mobile_map',
            '#btn_mobile_tools',
            '#btn_mobile_help',
        ]);
        await page.locator('#btn_mobile_map').click();
        await expect(page.locator('#controls')).toBeVisible();
        await expectFixedSheetInViewport(page, '#controls');
        await page.locator('#btn_mobile_map_close').click();

        await page.goto('/record', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
        await expectMobileLayout(page, [
            '[data-trigger="btn_load_video"]',
            '[data-trigger="btn_start_webcam"]',
        ]);

        // Playwright WebKit's bundled media stack exposes neither camera APIs
        // nor a decoder for our real MP4 fixture. Keep its route check on the
        // genuine source setup; Chromium exercises the loaded workspace.
        if (testInfo.project.name === 'mobile-chromium') {
            await page.locator('#video_file_input').setInputFiles(VIDEO_PATH);
            await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe('video');
            await expect(page.locator('.app-layout')).toHaveAttribute('data-phase', 'workspace');
            await expectMobileLayout(page, [
                '#renderCanvas',
                '#previewPanel',
                '#btn_toggle_record',
                '#sel_record_format',
                '#sel_max_resolution',
                '#rng_blur',
                '#btn_unload_source',
            ]);
        }
    });
}

test('the mobile shell applies simulated safe-area insets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Chromium CDP provides deterministic safe-area emulation');

    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 20, left: 12, bottom: 24, right: 14 },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/play', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.lm-canvas-wrapper')).toBeVisible();

    const safeArea = await page.evaluate(() => {
        const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
        const modeBar = document.querySelector<HTMLElement>('#app-mode-bar');
        const content = document.querySelector<HTMLElement>('#app-content');
        if (!viewport || !modeBar || !content) throw new Error('mobile shell is incomplete');
        const barStyle = getComputedStyle(modeBar);
        const contentStyle = getComputedStyle(content);
        return {
            viewport: viewport.content,
            bar: {
                top: parseFloat(barStyle.paddingTop),
                left: parseFloat(barStyle.paddingLeft),
                right: parseFloat(barStyle.paddingRight),
            },
            content: {
                left: parseFloat(contentStyle.paddingLeft),
                right: parseFloat(contentStyle.paddingRight),
                bottom: parseFloat(contentStyle.paddingBottom),
                clientWidth: content.clientWidth,
                scrollWidth: content.scrollWidth,
            },
        };
    });

    expect(safeArea.viewport).toContain('viewport-fit=cover');
    expect(safeArea.bar).toEqual({ top: 20, left: 12, right: 14 });
    expect(safeArea.content.left).toBe(12);
    expect(safeArea.content.right).toBe(14);
    expect(safeArea.content.bottom).toBe(24);
    expect(safeArea.content.scrollWidth).toBeLessThanOrEqual(safeArea.content.clientWidth + 1);
});
