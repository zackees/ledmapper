import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
];

function makeMap(stripLeds) {
    const map = {};
    for (const [name, count] of Object.entries(stripLeds)) {
        const x = [], y = [];
        for (let i = 0; i < count; i++) { x.push(i); y.push(0); }
        map[name] = { x, y, diameter: 0.5 };
    }
    return JSON.stringify({ map });
}

function makeMultiPinMap(stripSpecs) {
    const map = {};
    for (const [name, spec] of Object.entries(stripSpecs)) {
        const x = [], y = [];
        for (let i = 0; i < spec.count; i++) { x.push(i); y.push(0); }
        map[name] = { x, y, diameter: 0.5, pin: spec.pin };
    }
    return JSON.stringify({ map });
}

const GOOD_MAP_16 = makeMap({ strip1: 16 });
const GOOD_BACKUP_64 = makeMap({ strip1: 32, strip2: 32 });
const DEGENERATE_1 = makeMap({ strip1: 1 });

async function seed(page, items) {
    await page.goto('/');
    await page.evaluate((kv) => {
        for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]);
    }, items);
}

async function cleanup(page) {
    try {
        await page.evaluate((keys) => {
            for (const k of keys) localStorage.removeItem(k);
        }, KEYS);
    } catch { /* ignore — page may not have navigated */ }
}

test.describe('Shapeeditor autosave + backup restore', () => {
    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('good non-degenerate working copy loads normally (no toast/banner)', async ({ page }) => {
        await seed(page, {
            'lm:screenmap': GOOD_MAP_16,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: Date.now(),
                source: 'save',
                ledCount: 16,
                stripCount: 1,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        // No backup row should appear (no backup seeded).
        await expect(page.locator('#strips_backup_row')).toBeHidden();
    });

    test('stale degenerate + backup → silent restore', async ({ page }) => {
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
        await seed(page, {
            'lm:screenmap': DEGENERATE_1,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: twoHoursAgo,
                source: 'save',
                ledCount: 1,
                stripCount: 1,
            }),
            'lm:screenmap-backup': GOOD_BACKUP_64,
            'lm:screenmap-backup-meta': JSON.stringify({
                savedAt: dayAgo,
                source: 'save',
                ledCount: 64,
                stripCount: 2,
                presetFile: null,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        // Backup was restored → working copy now equals the good 64-LED backup.
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);
        const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(stored).toBe(GOOD_BACKUP_64);
    });

    test('fresh degenerate + backup → banner toast with Restore button', async ({ page }) => {
        const fiveMinAgo = Date.now() - (5 * 60 * 1000);
        await seed(page, {
            'lm:screenmap': DEGENERATE_1,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: fiveMinAgo,
                source: 'save',
                ledCount: 1,
                stripCount: 1,
            }),
            'lm:screenmap-backup': GOOD_BACKUP_64,
            'lm:screenmap-backup-meta': JSON.stringify({
                savedAt: fiveMinAgo - 60000,
                source: 'save',
                ledCount: 64,
                stripCount: 2,
                presetFile: null,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        // Working copy stays degenerate (1 LED → stripInfo null → strip count 0).
        // Click the "Restore previous layout" button in the SweetAlert2 toast.
        const restoreBtn = page.locator('.swal2-confirm', { hasText: /Restore previous layout/i });
        await expect(restoreBtn).toBeVisible({ timeout: 10000 });
        await restoreBtn.click();
        await expect.poll(
            () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
            { timeout: 10000 },
        ).toBe(2);
    });

    test('multi-pin map autosaves with pins preserved across mutation + reload', async ({ page }) => {
        const MULTI_PIN = makeMultiPinMap({
            strip1: { count: 8, pin: 'pin1' },
            strip2: { count: 8, pin: 'pin2' },
        });
        await seed(page, {
            'lm:screenmap': MULTI_PIN,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: Date.now(),
                source: 'save',
                ledCount: 16,
                stripCount: 2,
                pinCount: 2,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);

        // Mutate NON-pin state: drag strip1 — triggers autosave through the
        // same buildScreenmapMultiStripJson path that used to drop `pin`.
        await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(0, 40, 40));
        await expect.poll(async () => {
            const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
            const parsed = JSON.parse(stored);
            return [parsed.map.strip1.pin, parsed.map.strip2.pin];
        }).toEqual(['pin1', 'pin2']);
        const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('lm:screenmap-meta')));
        expect(meta.pinCount).toBe(2);

        // Pins survive a full reload.
        await page.reload();
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);
    });

    test('intentional repin (pin merge) writes through the pin-count guard', async ({ page }) => {
        const MULTI_PIN = makeMultiPinMap({
            strip1: { count: 8, pin: 'pin1' },
            strip2: { count: 8, pin: 'pin2' },
        });
        await seed(page, {
            'lm:screenmap': MULTI_PIN,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: Date.now(),
                source: 'save',
                ledCount: 16,
                stripCount: 2,
                pinCount: 2,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2']);

        // User-initiated merge pin2 → pin1: the pin count drops 2 → 1, and the
        // repin path calls notePinMutation() so the guard lets the write through.
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(1, 'pin1'));
        await expect.poll(async () => {
            const meta = await page.evaluate(() => JSON.parse(localStorage.getItem('lm:screenmap-meta')));
            return meta.pinCount;
        }).toBe(1);
        // All-pin1 maps omit the pin field entirely (§1.3).
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lm:screenmap')));
        expect(stored.map.strip1.pin).toBeUndefined();
        expect(stored.map.strip2.pin).toBeUndefined();
    });

    test('New button does not persist [[0,0]] and backup row restores', async ({ page }) => {
        await seed(page, {
            'lm:screenmap': GOOD_MAP_16,
            'lm:screenmap-meta': JSON.stringify({
                savedAt: Date.now(),
                source: 'save',
                ledCount: 16,
                stripCount: 1,
            }),
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });

        // Click New — should promote current map to backup, then clear it.
        // Dispatch via DOM in case a SweetAlert2 toast from an earlier test
        // is animating out and overlapping the button visually.
        await page.evaluate(() => {
            const btn = document.querySelector('#btn_new');
            if (btn) btn.click();
        });
        // Dismiss any toast that might be visible.
        await page.waitForTimeout(300);
        const stored = await page.evaluate(() => localStorage.getItem('lm:screenmap'));
        expect(stored).toBeNull();
        const backup = await page.evaluate(() => localStorage.getItem('lm:screenmap-backup'));
        expect(backup).toBe(GOOD_MAP_16);

        // Open Strips accordion if needed and verify backup row is visible.
        // The accordion is a <details> element — force-open it.
        await page.evaluate(() => {
            const det = document.querySelector('#strips_panel');
            if (det) det.open = true;
        });
        const backupRow = page.locator('#strips_backup_row');
        await expect(backupRow).toBeVisible({ timeout: 5000 });
        await page.evaluate(() => {
            const btn = document.querySelector('#strips_btn_restore_backup');
            if (btn) btn.click();
        });
        // After restore, working copy equals the GOOD_MAP_16 backup.
        await expect.poll(
            () => page.evaluate(() => localStorage.getItem('lm:screenmap')),
            { timeout: 10000 },
        ).toBe(GOOD_MAP_16);
    });
});
