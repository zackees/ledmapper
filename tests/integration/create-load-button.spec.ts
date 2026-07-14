import { expect, test, type Page } from './fixtures.ts';
import path from 'path';

interface TestFilePayload {
    name: string;
    mimeType?: string;
    buffer: Buffer;
}

const MULTI_SCREENMAP = path.resolve('tests/fixtures/test-screenmap-multi.json');
const SINGLE_SCREENMAP = path.resolve('tests/fixtures/test-screenmap.json');
const STORAGE_KEYS = [
    'lm:screenmap',
    'lm:screenmap-meta',
    'lm:screenmap-preset',
    'lm:screenmap-backup',
    'lm:shapeeditor-helpDismissed',
    'shapeeditor.overlayCollapsed',
];

async function clearCreateState(page: Page): Promise<void> {
    await page.evaluate((keys) => {
        for (const key of keys) localStorage.removeItem(key);
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    }, STORAGE_KEYS);
}

async function openCreate(page: Page, viewport?: { width: number; height: number }): Promise<void> {
    if (viewport) await page.setViewportSize(viewport);
    await page.goto('/create', { waitUntil: 'domcontentloaded' });
    await clearCreateState(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.shapeeditor-overlay-canvas')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#btn_load_screenmap')).toBeVisible();
}

async function loadViaHeader(page: Page, files: string | TestFilePayload | string[]): Promise<void> {
    const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('#btn_load_screenmap').click(),
    ]);
    const input = await chooser.element();
    expect(await input.getAttribute('id')).toBe('btn_upload_screenmap');
    expect(await input.getAttribute('accept')).toBe('.json');
    await chooser.setFiles(files);
}

function editorState(page: Page): Promise<{ totalPoints: number; stripCount: number }> {
    return page.evaluate(() => {
        const state = window.__lmDebug?.shapeeditor?.getState();
        return { totalPoints: state?.totalPoints ?? -1, stripCount: state?.stripCount ?? -1 };
    });
}

function documentSnapshot(page: Page): Promise<{
    state: { totalPoints: number; stripCount: number; dirty: boolean };
    screenmap: string | null;
}> {
    return page.evaluate(() => {
        const state = window.__lmDebug?.shapeeditor?.getState();
        return {
            state: {
                totalPoints: state?.totalPoints ?? -1,
                stripCount: state?.stripCount ?? -1,
                dirty: state?.dirty ?? false,
            },
            screenmap: localStorage.getItem('lm:screenmap'),
        };
    });
}

test.describe('Create header screenmap loading', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate((keys) => {
            for (const key of keys) localStorage.removeItem(key);
        }, STORAGE_KEYS).catch(() => { /* page may already be closed */ });
    });

    test('header Load opens the JSON picker and loads a valid screenmap', async ({ page }) => {
        await openCreate(page, { width: 1280, height: 720 });
        const loadButton = page.locator('#btn_load_screenmap');
        await expect(loadButton).toHaveText('Load...');
        await expect(loadButton).toBeEnabled();

        await loadViaHeader(page, MULTI_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 7, stripCount: 2 });
        await expect(page.locator('#btn_save_as')).toBeEnabled();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap')))
            .not.toBeNull();
    });

    test('keyboard activation opens the same picker', async ({ page }) => {
        await openCreate(page, { width: 1280, height: 720 });
        const loadButton = page.locator('#btn_load_screenmap');
        await loadButton.focus();

        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            loadButton.press('Enter'),
        ]);
        await chooser.setFiles(SINGLE_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 4, stripCount: 1 });
    });

    test('the same file can be loaded twice', async ({ page }) => {
        await openCreate(page, { width: 1280, height: 720 });
        await loadViaHeader(page, MULTI_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 7, stripCount: 2 });

        // The desktop layout hides the Map sheet's New button; invoking its
        // existing click handler keeps this test focused on re-opening the
        // same native file input through the header action.
        await page.locator('#btn_new').evaluate((button) => button.click());
        await expect.poll(() => editorState(page)).toMatchObject({ totalPoints: 1 });

        await loadViaHeader(page, MULTI_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 7, stripCount: 2 });
    });

    test('cancel and invalid selection preserve the current document', async ({ page }) => {
        await openCreate(page, { width: 1280, height: 720 });
        await loadViaHeader(page, SINGLE_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 4, stripCount: 1 });
        const before = await documentSnapshot(page);

        const [cancelled] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.locator('#btn_load_screenmap').click(),
        ]);
        await cancelled.setFiles([]);
        await expect.poll(() => documentSnapshot(page)).toEqual(before);

        await loadViaHeader(page, {
            name: 'not-a-screenmap.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('not json'),
        });
        const dialog = page.locator('.swal2-popup:not(.swal2-toast)');
        await expect(dialog).toContainText('Wrong file type');
        await expect(dialog).toContainText('Please choose a .json screenmap file.');
        await page.locator('.swal2-confirm').click();
        await expect.poll(() => documentSnapshot(page)).toEqual(before);
    });
});

test.describe('Create header screenmap loading on mobile', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('Load remains reachable, fits the header, and loads a map', async ({ page }) => {
        await openCreate(page, { width: 390, height: 664 });
        const loadButton = page.locator('#btn_load_screenmap');
        const buttonBox = await loadButton.boundingBox();
        expect(buttonBox).not.toBeNull();
        expect(buttonBox!.width).toBeGreaterThanOrEqual(44);
        expect(buttonBox!.height).toBeGreaterThanOrEqual(44);

        const metrics = await page.locator('.shapeeditor-header').evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            documentWidth: document.documentElement.scrollWidth,
        }));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
        expect(metrics.documentWidth).toBeLessThanOrEqual(391);

        await loadViaHeader(page, SINGLE_SCREENMAP);
        await expect.poll(() => editorState(page)).toEqual({ totalPoints: 4, stripCount: 1 });
    });
});
