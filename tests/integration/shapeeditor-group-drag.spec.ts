import { test, expect } from './fixtures.ts';

const KEYS = [
    'lm:screenmap',
    'lm:screenmap-preset',
    'lm:screenmap-meta',
    'lm:screenmap-backup',
    'lm:screenmap-backup-meta',
    'lm:shapeeditor-helpDismissed',
];

interface OverlayOperation { kind: string; style?: string; dash?: number[]; width?: number; text?: string; x?: number; y?: number }
interface OverlayCapture { operations: OverlayOperation[]; width: number; height: number }

function makeTwoStripMap() {
    return JSON.stringify({
        map: {
            stripA: {
                x: [0, 1, 2, 3],
                y: [0, 0, 0, 0],
                diameter: 0.5,
            },
            stripB: {
                x: [0, 1, 2],
                y: [5, 5, 5],
                diameter: 0.5,
            },
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
    }, [
        makeTwoStripMap(),
        JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 7, stripCount: 2 }),
    ]);
    await page.goto('/shapeeditor/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
    await expect.poll(
        () => page.evaluate(() => window.__shapeeditorDebug.getStripCount()),
        { timeout: 10000 },
    ).toBe(2);
    // Wait for renderer to populate lastTransformedPts (needed by getLedCanvasPos)
    await expect.poll(
        () => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null),
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

async function beginOverlayCapture(page) {
    await page.evaluate(() => {
        const recorder: OverlayCapture = { operations: [], width: 0, height: 0 };
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.shapeeditor-overlay-canvas');
        if (!canvas) throw new Error('shapeeditor overlay canvas missing');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('shapeeditor overlay context missing');
        recorder.width = canvas.width / window.devicePixelRatio;
        recorder.height = canvas.height / window.devicePixelRatio;
        const originalStroke = ctx.stroke.bind(ctx);
        const originalFillText = ctx.fillText.bind(ctx);
        ctx.stroke = (...args: Parameters<CanvasRenderingContext2D['stroke']>) => {
            recorder.operations.push({ kind: 'stroke', style: ctx.strokeStyle, dash: ctx.getLineDash(), width: ctx.lineWidth });
            originalStroke(...args);
        };
        ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
            recorder.operations.push({ kind: 'text', text, x, y });
            if (maxWidth === undefined) originalFillText(text, x, y);
            else originalFillText(text, x, y, maxWidth);
        };
        (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture }).__shapeeditorOverlayCapture = recorder;
    });
}

async function clearOverlayCapture(page) {
    await page.evaluate(() => {
        (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture }).__shapeeditorOverlayCapture.operations = [];
    });
}

test.describe('Shapeeditor group drag + point-edit mode', () => {

    test.afterEach(async ({ page }) => { await cleanup(page); });

    test('plain LED drag moves the whole strip; other strip untouched; Ctrl+Z restores', async ({ page }) => {
        await seedAndOpen(page);

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        expect(beforeA.length).toBe(4);
        expect(beforeB.length).toBe(3);

        // Drag stripA's first LED (flatIdx = 0) by +30,+20 client px
        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 30, 20, {})
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // All LEDs of strip A moved by the same (non-zero) delta
        const dx0 = afterA[0][0] - beforeA[0][0];
        const dy0 = afterA[0][1] - beforeA[0][1];
        expect(Math.abs(dx0) > 0 || Math.abs(dy0) > 0).toBe(true);
        for (let i = 1; i < beforeA.length; i++) {
            expect(afterA[i][0] - beforeA[i][0]).toBeCloseTo(dx0, 6);
            expect(afterA[i][1] - beforeA[i][1]).toBeCloseTo(dy0, 6);
        }
        // Strip B unchanged
        for (let i = 0; i < beforeB.length; i++) {
            expect(afterB[i][0]).toBeCloseTo(beforeB[i][0], 6);
            expect(afterB[i][1]).toBeCloseTo(beforeB[i][1], 6);
        }

        // Ctrl+Z restores
        await page.keyboard.press('Control+z');
        const restoredA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        for (let i = 0; i < beforeA.length; i++) {
            expect(restoredA[i][0]).toBeCloseTo(beforeA[i][0], 6);
            expect(restoredA[i][1]).toBeCloseTo(beforeA[i][1], 6);
        }
    });

    test('plain LED drag within an already selected group still moves the whole group', async ({ page }) => {
        await seedAndOpen(page);
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(1, 25, 15, {})
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
        const dx = afterA[1][0] - beforeA[1][0];
        const dy = afterA[1][1] - beforeA[1][1];
        expect(Math.abs(dx) > 0 || Math.abs(dy) > 0).toBe(true);
        for (let i = 0; i < beforeA.length; i++) {
            expect(afterA[i][0] - beforeA[i][0]).toBeCloseTo(dx, 6);
            expect(afterA[i][1] - beforeA[i][1]).toBeCloseTo(dy, 6);
        }
        expect(afterB).toEqual(beforeB);

        await page.keyboard.press('Control+z');
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(beforeA);
    });

    test('double-click renders the red edit frame and badge; Esc restores the blue dashed frame', async ({ page }) => {
        await seedAndOpen(page);
        await beginOverlayCapture(page);
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        await expect.poll(() => page.evaluate(() => (
            (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                .__shapeeditorOverlayCapture.operations.some((operation) => operation.kind === 'stroke'
                    && /#3b82f6|59,\\s*130,\\s*246/i.test(operation.style ?? '')
                    && operation.dash?.join(',') === '6,4')
        ))).toBe(true);
        await clearOverlayCapture(page);
        const pos = await page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0));
        await page.mouse.dblclick(pos.clientX, pos.clientY);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(0);
        await expect.poll(() => page.evaluate(() => (
            (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                .__shapeeditorOverlayCapture.operations.some((operation) => operation.kind === 'stroke'
                    && /#ef4444|239,\s*68,\s*68/i.test(operation.style ?? '')
                    && operation.dash?.length === 0 && operation.width === 3)
                && (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                    .__shapeeditorOverlayCapture.operations.some((operation) => operation.kind === 'text' && operation.text === 'EDIT LED MODE')
        ))).toBe(true);
        const editOperations = await page.evaluate(() => (
            (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                .__shapeeditorOverlayCapture
        ));
        expect(editOperations.operations.some((operation) => operation.kind === 'stroke'
            && /#ef4444|239,\s*68,\s*68/i.test(operation.style ?? '')
            && operation.dash?.length === 0 && operation.width === 3)).toBe(true);
        const title = editOperations.operations.find((operation) => operation.kind === 'text' && operation.text === 'EDIT LED MODE');
        expect(title).toBeDefined();
        expect(title?.x).toBeGreaterThanOrEqual(0);
        expect(title?.y).toBeGreaterThanOrEqual(0);
        expect(title?.x).toBeLessThan(editOperations.width);
        expect(title?.y).toBeLessThan(editOperations.height);
        expect(editOperations.operations.some((operation) => operation.kind === 'text'
            && operation.text === 'Drag LEDs individually · Esc to exit')).toBe(true);
        const hint = await page.evaluate(() => window.__shapeeditorDebug.getHintText());
        expect(hint).toMatch(/Editing points/);
        await clearOverlayCapture(page);
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);
        await expect.poll(() => page.evaluate(() => (
            (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                .__shapeeditorOverlayCapture.operations.some((operation) => operation.kind === 'stroke'
                    && /#3b82f6|59,\s*130,\s*246/i.test(operation.style ?? '')
                    && operation.dash?.join(',') === '6,4')
        ))).toBe(true);
        const escapedOperations = await page.evaluate(() => (
            (window as unknown as { __shapeeditorOverlayCapture: OverlayCapture })
                .__shapeeditorOverlayCapture.operations
        ));
        expect(escapedOperations.some((operation) => operation.kind === 'text' && operation.text === 'EDIT LED MODE')).toBe(false);
    });

    test('in point-edit mode, dragging an LED moves only that single LED', async ({ page }) => {
        await seedAndOpen(page);
        await page.evaluate(() => window.__shapeeditorDebug.enterPointEditMode(0));

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 25, 15, {})
        );
        expect(ok).toBe(true);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const afterB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));

        // Exactly one LED moved (flatIdx 0 = strip A LED 0)
        let movedA = 0;
        for (let i = 0; i < beforeA.length; i++) {
            const moved = Math.abs(afterA[i][0] - beforeA[i][0]) > 1e-6 || Math.abs(afterA[i][1] - beforeA[i][1]) > 1e-6;
            if (moved) movedA++;
        }
        expect(movedA).toBe(1);

        // Strip B untouched
        for (let i = 0; i < beforeB.length; i++) {
            expect(afterB[i][0]).toBeCloseTo(beforeB[i][0], 6);
            expect(afterB[i][1]).toBeCloseTo(beforeB[i][1], 6);
        }
    });

    test('Alt + drag cannot bypass point-edit mode', async ({ page }) => {
        await seedAndOpen(page);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);

        const beforeA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));

        const ok = await page.evaluate(() =>
            window.__shapeeditorDebug.simulateLedDrag(0, 20, 10, { altKey: true })
        );
        expect(ok).toBe(true);

        // Still not in point-edit mode, so it moves the whole group.
        expect(await page.evaluate(() => window.__shapeeditorDebug.getPointEditMode())).toBe(null);

        const afterA = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        const dx = afterA[0][0] - beforeA[0][0];
        const dy = afterA[0][1] - beforeA[0][1];
        expect(Math.abs(dx) > 0 || Math.abs(dy) > 0).toBe(true);
        for (let i = 1; i < beforeA.length; i++) {
            expect(afterA[i][0] - beforeA[i][0]).toBeCloseTo(dx, 6);
            expect(afterA[i][1] - beforeA[i][1]).toBeCloseTo(dy, 6);
        }
    });
});
