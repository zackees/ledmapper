import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.ts';

const PRESET_FILE = '64x64_quad_serpentine.json';
const canonicalText = readFileSync('public/screenmaps/64x64_quad_serpentine.json', 'utf8');

function corruptedReproduction(): string {
    const doc = JSON.parse(canonicalText);
    const translate = (index: number, dx: number, dy: number) => {
        const segment = doc.segments[index];
        segment.x = segment.x.map((x: number) => x + dx);
        segment.y = segment.y.map((y: number) => y + dy);
    };
    translate(5, 0.4971, 0.5062);
    translate(7, 0.4906, 0);
    translate(13, 0.4893, -0.248);
    translate(15, 0.4906, 0);
    doc.segments[7].x.splice(86, 0, 57.6806);
    doc.segments[7].y.splice(86, 0, 21);
    doc.segments[13].x.splice(88, 0, 56.3167);
    doc.segments[13].y.splice(88, 0, 36.752);
    return JSON.stringify(doc);
}

async function clearLayout(page): Promise<void> {
    await page.goto('/');
    await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('lm:')) localStorage.removeItem(key);
        }
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    });
}

test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('lm:')) localStorage.removeItem(key);
        }
    }).catch(() => undefined);
});

test('clean Create and Record startup share the canonical 4096-LED default', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await clearLayout(page);
    await page.goto('/create');
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4096);
    await expect(page.locator(`.preset-btn[data-preset-file="${PRESET_FILE}"]`)).toHaveClass(/active-preset/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBe(PRESET_FILE);
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap'))).toBe(canonicalText);
    const createAudit = await page.evaluate(() => {
        const xs = new Set<number>();
        const ys = new Set<number>();
        for (let index = 0; index < 4096; index++) {
            const point = window.__shapeeditorDebug?.getLedCanvasPos?.(index);
            if (point) { xs.add(Math.round(point.canvasX)); ys.add(Math.round(point.canvasY)); }
        }
        const stored = JSON.parse(localStorage.getItem('lm:screenmap') ?? '{}');
        return {
            xs: [...xs].sort((a, b) => a - b),
            ys: [...ys].sort((a, b) => a - b),
            stripCounts: stored.segments.map((segment) => segment.x.length),
        };
    });
    expect(createAudit.xs).toHaveLength(64);
    expect(createAudit.ys).toHaveLength(64);
    expect(new Set(createAudit.xs.slice(1).map((x, i) => x - createAudit.xs[i])).size).toBe(1);
    expect(new Set(createAudit.ys.slice(1).map((y, i) => y - createAudit.ys[i])).size).toBe(1);
    expect(createAudit.stripCounts).toEqual(Array(16).fill(256));

    await page.goto('/record?perfdebug=1');
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 4096);
    await expect(page.locator('#txt_active_layout')).toHaveText('64x64 Quad Serpentine');
    await expect(page.locator('#txt_active_led_count')).toHaveText('4096 LEDs');
});

test('genuine custom layouts remain custom and are not offered a canonical reset', async ({ page }) => {
    const custom = JSON.stringify({ map: { art: { x: [0, 3, 2, 8], y: [0, 1, 7, 4] } } });
    await clearLayout(page);
    await page.evaluate(({ json }) => { localStorage.setItem('lm:screenmap', json); }, { json: custom });
    await page.goto('/create');
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4);
    await expect(page.getByRole('heading', { name: 'Stored 64x64 layout differs from the built-in preset' }))
        .toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap'))).toBe(custom);
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBeNull();
});

test('editing the canonical preset becomes Custom and reselecting restores canonical provenance', async ({ page }) => {
    await clearLayout(page);
    await page.goto('/create');
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4096);
    await page.evaluate(() => window.__shapeeditorDebug?.simulateLedDrag?.(0, 20, 0));
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBeNull();

    await page.goto('/record?perfdebug=1');
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 4096);
    await expect(page.locator('#txt_active_layout')).toHaveText('Custom layout');
    await page.locator(`.preset-btn[data-preset-file="${PRESET_FILE}"]`)
        .evaluate((button: HTMLButtonElement) => { button.click(); });
    await expect(page.locator('#txt_active_layout')).toHaveText('64x64 Quad Serpentine');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBe(PRESET_FILE);
});

test('Create detects the 4098-point divergent copy, resets it, and keeps a recoverable backup', async ({ page }) => {
    const corrupted = corruptedReproduction();
    await clearLayout(page);
    await page.evaluate(({ json }) => {
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({
            savedAt: Date.now(), source: 'save', ledCount: 4098, stripCount: 16, pinCount: 4,
        }));
    }, { json: corrupted });
    await page.goto('/create');
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4098);

    await expect(page.getByRole('heading', { name: 'Stored 64x64 layout differs from the built-in preset' }))
        .toBeVisible();
    await page.getByRole('button', { name: 'Reset to built-in' }).click();
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4096);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBe(PRESET_FILE);
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap-backup'))).toBe(corrupted);

    await page.evaluate(() => {
        const panel = document.querySelector<HTMLDetailsElement>('#strips_panel');
        if (panel) panel.open = true;
        document.querySelector<HTMLButtonElement>('#strips_btn_restore_backup')?.click();
    });
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4098);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBeNull();
});

test('Record detects and resets the same divergent stored copy', async ({ page }) => {
    const corrupted = corruptedReproduction();
    await clearLayout(page);
    await page.evaluate(({ json }) => { localStorage.setItem('lm:screenmap', json); }, { json: corrupted });
    await page.goto('/record?perfdebug=1');
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 4098);
    await expect(page.getByRole('heading', { name: 'Stored 64x64 layout differs from the built-in preset' }))
        .toBeVisible();
    await page.getByRole('button', { name: 'Reset to built-in' }).click();
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 4096);
    await expect(page.locator('#txt_active_layout')).toHaveText('64x64 Quad Serpentine');
    await expect(page.locator('#txt_active_led_count')).toHaveText('4096 LEDs');
});

test('a delayed Record default cannot overwrite a newer explicit preset choice', async ({ page }) => {
    await clearLayout(page);
    let releaseDefault: (() => void) | undefined;
    const defaultGate = new Promise<void>((resolve) => { releaseDefault = resolve; });
    let markDefaultFinished: (() => void) | undefined;
    const defaultFinished = new Promise<void>((resolve) => { markDefaultFinished = resolve; });
    await page.route(`**/screenmaps/${PRESET_FILE}`, async (route) => {
        await defaultGate;
        await route.continue();
        markDefaultFinished?.();
    });

    await page.goto('/record?perfdebug=1');
    await page.locator('.preset-btn[data-preset-file="8x8_grid.json"]')
        .evaluate((button: HTMLButtonElement) => { button.click(); });
    await page.waitForFunction(() => window.__mmDebug?.getState?.().localPts?.length === 64);
    releaseDefault?.();
    await defaultFinished;
    await expect.poll(() => page.evaluate(() => window.__mmDebug?.getState?.().localPts?.length)).toBe(64);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBe('8x8_grid.json');
});

test('a delayed Create manifest cannot overwrite a newer uploaded custom layout', async ({ page }) => {
    const custom = JSON.stringify({ map: { art: { x: [0, 3, 2, 8], y: [0, 1, 7, 4] } } });
    await clearLayout(page);
    let releaseManifest: (() => void) | undefined;
    const manifestGate = new Promise<void>((resolve) => { releaseManifest = resolve; });
    let markManifestFinished: (() => void) | undefined;
    const manifestFinished = new Promise<void>((resolve) => { markManifestFinished = resolve; });
    await page.route('**/screenmaps/manifest.json', async (route) => {
        await manifestGate;
        await route.continue();
        markManifestFinished?.();
    });

    await page.goto('/create');
    await page.locator('#btn_upload_screenmap').setInputFiles({
        name: 'custom.json',
        mimeType: 'application/json',
        buffer: Buffer.from(custom),
    });
    await page.waitForFunction(() => window.__lmDebug?.shapeeditor?.getState().totalPoints === 4);
    releaseManifest?.();
    await manifestFinished;
    await expect.poll(() => page.evaluate(() => window.__lmDebug?.shapeeditor?.getState().totalPoints)).toBe(4);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBeNull();
});

test('a delayed Record default does not write after route teardown', async ({ page }) => {
    await clearLayout(page);
    let markRequested: (() => void) | undefined;
    const requested = new Promise<void>((resolve) => { markRequested = resolve; });
    let releaseDefault: (() => void) | undefined;
    const defaultGate = new Promise<void>((resolve) => { releaseDefault = resolve; });
    let markFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => { markFinished = resolve; });
    await page.route(`**/screenmaps/${PRESET_FILE}`, async (route) => {
        markRequested?.();
        await defaultGate;
        try {
            await route.fulfill({ contentType: 'application/json', body: canonicalText });
        } catch {
            // The route is expected to be canceled when Record tears down.
        } finally {
            markFinished?.();
        }
    });

    await page.goto('/record?perfdebug=1');
    await requested;
    await page.goto('/play');
    releaseDefault?.();
    await finished;
    expect(await page.evaluate(() => window.__lmDebug?.moviemaker)).toBeUndefined();
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('lm:screenmap-preset'))).toBeNull();
});
