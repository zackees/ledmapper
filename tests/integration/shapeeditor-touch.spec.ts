import { test as base, expect } from '@playwright/test';

// Touch specs need their own context with hasTouch:true. We bypass the
// shared worker context from fixtures.js and mirror its helpDismissed
// init script so the first-run modal stays suppressed.
const test = base.extend({
    touchPage: async ({ browser }, use) => {
        const ctx = await browser.newContext({
            ignoreHTTPSErrors: true,
            hasTouch: true,
        });
        await ctx.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
        });
        const page = await ctx.newPage();
        await use(page);
        await page.close();
        await ctx.close();
    },
});

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
    'lm:shapeeditor-helpDismissed',
    'lm:shapeeditor-gestureNotice',
];

function makeTwoStripMap() {
    return JSON.stringify({
        map: {
            stripA: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.5 },
            stripB: { x: [0, 1, 2], y: [5, 5, 5], diameter: 0.5 },
        },
    });
}

async function seedAndOpen(page) {
    await page.goto('/');
    await page.evaluate((args) => {
        const [json, meta] = args;
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', meta);
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
        localStorage.setItem('lm:shapeeditor-gestureNotice', '1');
    }, [
        makeTwoStripMap(),
        JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 7, stripCount: 2 }),
    ]);
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
        { timeout: 10000 },
    ).toBe(2);
    await expect.poll(() =>
        page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null),
        { timeout: 5000 },
    ).toBe(true);
}

async function cleanup(page) {
    try {
        await page.evaluate((keys) => {
            for (const k of keys) localStorage.removeItem(k);
        }, KEYS);
    } catch { /* ignore */ }
}

test.describe('Shapeeditor touch gestures', () => {

    test.afterEach(async ({ touchPage }) => { await cleanup(touchPage); });

    test('tap-drag on an LED moves the whole strip', async ({ touchPage: page }) => {
        await seedAndOpen(page);
        const pos = await page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0));
        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // Synthesize a touch tap-drag using touchscreen API
        await page.touchscreen.tap(pos.clientX, pos.clientY);
        // The tap API just taps; we need a true drag, so use dispatched touch events.
        await page.evaluate(({ x, y }) => {
            const c = document.querySelector('canvas');
            // Find the OVERLAY canvas (last canvas inside the wrapper)
            const canvases = document.querySelectorAll('canvas');
            const overlay = canvases[canvases.length - 1] ?? c;
            function touch(id, cx, cy) {
                return new Touch({ identifier: id, target: overlay, clientX: cx, clientY: cy, pageX: cx, pageY: cy });
            }
            function tev(type, touches) {
                return new TouchEvent(type, { cancelable: true, bubbles: true, touches, targetTouches: touches, changedTouches: touches });
            }
            overlay.dispatchEvent(tev('touchstart', [touch(1, x, y)]));
            overlay.dispatchEvent(tev('touchmove', [touch(1, x + 30, y + 20)]));
            overlay.dispatchEvent(tev('touchend', []));
        }, { x: pos.clientX, y: pos.clientY });

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // All 4 LEDs in strip A moved by same non-zero delta
        const dx0 = afterA[0][0] - beforeA[0][0];
        const dy0 = afterA[0][1] - beforeA[0][1];
        expect(Math.abs(dx0) + Math.abs(dy0)).toBeGreaterThan(0);
        for (let i = 1; i < beforeA.length; i++) {
            expect(afterA[i][0] - beforeA[i][0]).toBeCloseTo(dx0, 6);
            expect(afterA[i][1] - beforeA[i][1]).toBeCloseTo(dy0, 6);
        }
        // Strip B unchanged
        for (let i = 0; i < beforeB.length; i++) {
            expect(afterB[i][0]).toBeCloseTo(beforeB[i][0], 6);
            expect(afterB[i][1]).toBeCloseTo(beforeB[i][1], 6);
        }
    });

    test('simulateLongPress on an LED enters point-edit mode', async ({ touchPage: page }) => {
        await seedAndOpen(page);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);

        await page.evaluate(() => {
            const pos = window.__shapeeditorDebug.getLedCanvasPos(0);
            return window.__shapeeditorDebug.simulateLongPress(pos.canvasX, pos.canvasY);
        });

        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(0);
        const hint = await page.evaluate(() => window.__shapeeditorDebug.getHintText());
        expect(hint).toMatch(/Editing points/);
    });

    test('simulateLongPress on empty space opens the context menu', async ({ touchPage: page }) => {
        await seedAndOpen(page);
        // (10, 10) is far from any LED — empty canvas region near top-left
        await page.evaluate(() => window.__shapeeditorDebug.simulateLongPress(10, 10));
        // Wait for context menu to become visible (its style.display is toggled)
        await expect.poll(() => page.evaluate(() => {
            // Find a context menu div — search by content for "Insert" or "Paste"
            const all = Array.from(document.body.querySelectorAll('div'));
            return all.some((d) => d.style.display !== 'none'
                && d.style.position === 'fixed'
                && /Insert|Paste|Help/i.test(d.textContent || ''));
        }), { timeout: 2000 }).toBe(true);
    });

    test('pinch gesture changes camera zoom', async ({ touchPage: page }) => {
        await seedAndOpen(page);
        const z0 = await page.evaluate(() => window.__shapeeditorDebug.getCamZoom());
        // Dispatch two-finger pinch via raw TouchEvents (most reliable cross-platform)
        await page.evaluate(() => {
            const canvases = document.querySelectorAll('canvas');
            const overlay = canvases[canvases.length - 1];
            const rect = overlay.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            function touch(id, x, y) {
                return new Touch({ identifier: id, target: overlay, clientX: x, clientY: y, pageX: x, pageY: y });
            }
            function tev(type, touches) {
                return new TouchEvent(type, { cancelable: true, bubbles: true, touches, targetTouches: touches, changedTouches: touches });
            }
            // Start: fingers 50px apart
            overlay.dispatchEvent(tev('touchstart', [touch(1, cx - 25, cy), touch(2, cx + 25, cy)]));
            // Spread to 200px apart -> zoom *= 4
            overlay.dispatchEvent(tev('touchmove', [touch(1, cx - 100, cy), touch(2, cx + 100, cy)]));
            overlay.dispatchEvent(tev('touchend', []));
        });
        const z1 = await page.evaluate(() => window.__shapeeditorDebug.getCamZoom());
        expect(z1).toBeGreaterThan(z0 * 1.5);
    });

    test('two-finger drag pans the camera', async ({ touchPage: page }) => {
        await seedAndOpen(page);
        const p0 = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
        await page.evaluate(() => {
            const canvases = document.querySelectorAll('canvas');
            const overlay = canvases[canvases.length - 1];
            const rect = overlay.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            function touch(id, x, y) {
                return new Touch({ identifier: id, target: overlay, clientX: x, clientY: y, pageX: x, pageY: y });
            }
            function tev(type, touches) {
                return new TouchEvent(type, { cancelable: true, bubbles: true, touches, targetTouches: touches, changedTouches: touches });
            }
            overlay.dispatchEvent(tev('touchstart', [touch(1, cx - 20, cy), touch(2, cx + 20, cy)]));
            overlay.dispatchEvent(tev('touchmove', [touch(1, cx - 20 + 60, cy + 40), touch(2, cx + 20 + 60, cy + 40)]));
            overlay.dispatchEvent(tev('touchend', []));
        });
        const p1 = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
        expect(Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y)).toBeGreaterThan(0);
    });
});

test.describe('Shapeeditor gesture-notice toast', () => {
    const _NOTICE_KEY = 'lm:shapeeditor-gestureNotice';

    test.afterEach(async ({ page }) => {
        try {
            await page.evaluate((keys) => {
                for (const k of keys) localStorage.removeItem(k);
            }, KEYS);
        } catch { /* ignore */ }
    });

    test('shows once on first strip-select; not again', async ({ page }) => {
        // Use the shared fixture page (with help dismissed) but ensure
        // the gestureNotice key is cleared so it can fire.
        await page.addInitScript(() => {
            try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
            try { localStorage.removeItem('lm:shapeeditor-gestureNotice'); } catch { /* ignore */ }
            // Seed a layout so a strip exists to select
            try {
                localStorage.setItem('lm:screenmap', JSON.stringify({
                    map: { s: { x: [0, 1, 2], y: [0, 0, 0], diameter: 0.5 } },
                }));
                localStorage.setItem('lm:screenmap-meta', JSON.stringify({
                    savedAt: Date.now(), source: 'save', ledCount: 3, stripCount: 1,
                }));
            } catch { /* ignore */ }
        });
        await page.goto('/shapeeditor/');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(1);
        // Trigger first strip-select
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        // Toast should appear
        await expect(page.locator('.swal2-toast')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.swal2-toast')).toContainText(/drag moves the strip/i);
        const stored = await page.evaluate(() => localStorage.getItem('lm:shapeeditor-gestureNotice'));
        expect(stored).toBe('1');
        // Dismiss + try again — should not re-show
        await page.evaluate(() => {
            const t = document.querySelector('.swal2-toast');
            if (t) t.remove();
        });
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        await page.waitForTimeout(400);
        await expect(page.locator('.swal2-toast')).toBeHidden();
    });
});
