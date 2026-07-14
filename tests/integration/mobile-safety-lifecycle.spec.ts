import { expect, test, type Page } from '@playwright/test';
import path from 'path';

const VIDEO_PATH = path.resolve('tests/fixtures/test-video.mp4');
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    });
});

async function expectCreateState(page: Page, expectedPoints: number[][], expectedStored: string): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().totalPoints)).toBeGreaterThan(0);
    const state = await page.evaluate(() => ({
        points: window.__shapeeditorDebug.getStripPoints(0),
        stored: localStorage.getItem('lm:screenmap'),
        content: (() => {
            const content = document.querySelector<HTMLElement>('#app-content');
            if (!content) throw new Error('missing app content');
            return { clientWidth: content.clientWidth, scrollWidth: content.scrollWidth };
        })(),
        visual: {
            width: window.visualViewport?.width ?? window.innerWidth,
            height: window.visualViewport?.height ?? window.innerHeight,
        },
    }));

    expect(state.points).toEqual(expectedPoints);
    expect(state.stored).toBe(expectedStored);
    expect(state.content.scrollWidth).toBeLessThanOrEqual(state.content.clientWidth + 1);
    expect(state.visual.width).toBeGreaterThan(0);
    expect(state.visual.height).toBeGreaterThan(0);
}

test('Create preserves edited work across rotation, visual-viewport resize, backgrounding, and mode navigation', async ({ page }, testInfo) => {
    const initialMap = JSON.stringify({
        map: { strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.5 } },
    });
    await page.addInitScript((screenmap) => {
        localStorage.setItem('lm:screenmap', screenmap);
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({
            savedAt: Date.now(), source: 'save', ledCount: 4, stripCount: 1,
        }));
    }, initialMap);
    await page.setViewportSize(PORTRAIT);
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4);
    await page.evaluate(() => window.__shapeeditorDebug.reverseStrip(0));
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().dirty)).toBe(true);
    const edited = await page.evaluate(() => ({
        points: window.__shapeeditorDebug.getStripPoints(0),
        stored: localStorage.getItem('lm:screenmap'),
    }));
    expect(edited.stored).not.toBeNull();

    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(LANDSCAPE.width);
    await expectCreateState(page, edited.points, edited.stored!);

    await page.setViewportSize(PORTRAIT);
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(PORTRAIT.height);
    await expectCreateState(page, edited.points, edited.stored!);

    if (testInfo.project.name === 'mobile-chromium') {
        const session = await page.context().newCDPSession(page);
        await session.send('Page.setWebLifecycleState', { state: 'frozen' });
        await session.send('Page.setWebLifecycleState', { state: 'active' });
        await expectCreateState(page, edited.points, edited.stored!);
    }

    await page.locator('.app-mode-link[data-mode="play"]').click();
    await expect(page).toHaveURL(/\/play$/);
    await page.locator('.app-mode-link[data-mode="create"]').click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
    await expectCreateState(page, edited.points, edited.stored!);
});

test('Record preserves source state across rotation/backgrounding and guards active capture from silent loss', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'The bundled WebKit runtime has no decodable test media or camera API');

    await page.setViewportSize(PORTRAIT);
    await page.goto('/record?forceRealtimeCapture', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-trigger="btn_load_video"]')).toBeVisible();
    await page.locator('#video_file_input').setInputFiles(VIDEO_PATH);
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().sourceType)).toBe('video');
    await page.locator('#sel_record_format').selectOption('fled');

    await page.setViewportSize(LANDSCAPE);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(LANDSCAPE.width);
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState())).toMatchObject({
        sourceType: 'video',
        sourceName: 'test-video.mp4',
        recordFormat: 'fled',
    });

    const session = await page.context().newCDPSession(page);
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await page.setViewportSize(PORTRAIT);
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState())).toMatchObject({
        sourceType: 'video',
        sourceName: 'test-video.mp4',
        recordFormat: 'fled',
    });

    await page.locator('#btn_toggle_record').click();
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().recordingActive)).toBe(true);

    const beforeUnload = await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        const dispatched = window.dispatchEvent(event);
        return { defaultPrevented: event.defaultPrevented, dispatched };
    });
    expect(beforeUnload).toEqual({ defaultPrevented: true, dispatched: false });

    const createLink = page.locator('.app-mode-link[data-mode="create"]');
    const dismissedDialog = page.waitForEvent('dialog');
    await Promise.all([
        dismissedDialog.then((dialog) => dialog.dismiss()),
        createLink.click(),
    ]);
    expect((await dismissedDialog).message()).toContain('recording');
    await expect(page).toHaveURL(/\/record/);
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.moviemaker?.getState().recordingActive)).toBe(true);

    const acceptedDialog = page.waitForEvent('dialog');
    await Promise.all([
        acceptedDialog.then((dialog) => dialog.accept()),
        createLink.click(),
    ]);
    expect((await acceptedDialog).message()).toContain('discard');
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible();
});
