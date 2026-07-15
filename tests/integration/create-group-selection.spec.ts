import { expect, test, type Page } from './fixtures.ts';

const KEYS = ['lm:screenmap', 'lm:screenmap-meta', 'lm:shapeeditor-helpDismissed', 'shapeeditor.overlayCollapsed'];

function map() {
    return JSON.stringify({ map: {
        stripA: { x: [0, 20, 20, 0], y: [0, 0, 20, 20], diameter: 0.5 },
        stripB: { x: [0, 20, 20, 0], y: [60, 60, 80, 80], diameter: 0.5 },
        stripC: { x: [140, 160], y: [0, 0], diameter: 0.5 },
    } });
}

async function open(page: Page, width = 1280) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await page.evaluate((json) => {
        localStorage.setItem('lm:screenmap', json);
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 10, stripCount: 3 }));
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
        localStorage.removeItem('shapeeditor.overlayCollapsed');
    }, map());
    await page.goto('/create');
    await page.waitForFunction(() => !!window.__shapeeditorDebug);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null)).toBe(true);
}

async function led(page: Page, index: number) {
    const pos = await page.evaluate((flatIndex) => window.__shapeeditorDebug.getLedCanvasPos(flatIndex), index);
    expect(pos).not.toBeNull();
    const targetIsCanvas = await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.classList.contains('shapeeditor-overlay-canvas') ?? false
    ), { x: pos!.clientX, y: pos!.clientY });
    expect(targetIsCanvas, `LED ${String(index)} must receive real canvas pointer input`).toBe(true);
    return pos!;
}

async function expectCanvasTarget(page: Page, point: { clientX: number; clientY: number }) {
    const targetIsCanvas = await page.evaluate(({ clientX, clientY }) => (
        document.elementFromPoint(clientX, clientY)?.classList.contains('shapeeditor-overlay-canvas') ?? false
    ), point);
    expect(targetIsCanvas, `(${String(point.clientX)}, ${String(point.clientY)}) must target the canvas`).toBe(true);
}

async function drag(page: Page, start: { clientX: number; clientY: number }, dx: number, dy: number, button: 'left' | 'right' | 'middle' = 'left') {
    await expectCanvasTarget(page, start);
    await expectCanvasTarget(page, { clientX: start.clientX + dx, clientY: start.clientY + dy });
    await page.mouse.move(start.clientX, start.clientY);
    await page.mouse.down({ button });
    await page.mouse.move(start.clientX + dx, start.clientY + dy, { steps: 4 });
    await page.mouse.up({ button });
}

async function resetScreenmapWriteProbe(page: Page) {
    await page.evaluate(() => {
        const target = window as typeof window & { __screenmapWriteCount?: number; __screenmapWriteProbeInstalled?: boolean };
        target.__screenmapWriteCount = 0;
        if (target.__screenmapWriteProbeInstalled) return;
        target.__screenmapWriteProbeInstalled = true;
        const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
        const original = Object.getOwnPropertyDescriptor(storagePrototype, 'setItem')?.value as (this: Storage, key: string, value: string) => void;
        storagePrototype.setItem = function (key: string, value: string) {
            if (this === localStorage && key === 'lm:screenmap') target.__screenmapWriteCount = (target.__screenmapWriteCount ?? 0) + 1;
            Reflect.apply(original, this, [key, value]);
        };
    });
}

function screenmapWriteCount(page: Page) {
    return page.evaluate(() => (window as typeof window & { __screenmapWriteCount?: number }).__screenmapWriteCount ?? 0);
}

test.afterEach(async ({ page }) => {
    try {
        await page.evaluate((keys) => {
            for (const key of keys) localStorage.removeItem(key);
        }, KEYS);
    } catch { /* page may already be closed */ }
});

test('Select is the default explicit editor mode and desktop tools do not cover the canvas', async ({ page }) => {
    await open(page);
    const select = page.locator('#strips_btn_select');
    await expect(select).toBeVisible();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(select).toHaveClass(/active/);

    const panel = await page.locator('#transform-overlay').boundingBox();
    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(panel).not.toBeNull();
    expect(canvas).not.toBeNull();
    const intersects = panel!.x < canvas!.x + canvas!.width
        && panel!.x + panel!.width > canvas!.x
        && panel!.y < canvas!.y + canvas!.height
        && panel!.y + panel!.height > canvas!.y;
    expect(intersects).toBe(false);
    await led(page, 0);
    await led(page, 4);
    await led(page, 8);

    const pointsBefore = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    await page.locator('#btn_overlay_collapse').click();
    await expect.poll(async () => (await page.locator('.shapeeditor-overlay-canvas').boundingBox())?.width ?? 0)
        .toBeGreaterThan(canvas!.width);
    await page.locator('#btn_overlay_expand').click();
    await expect.poll(async () => (await page.locator('.shapeeditor-overlay-canvas').boundingBox())?.width ?? 0)
        .toBeLessThan(canvas!.width + 5);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(pointsBefore);
});

test('real left click selects and plain left drag performs group marquee without panning', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0]);

    const beforePan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
    const positions = await Promise.all(Array.from({ length: 8 }, (_, idx) => led(page, idx)));
    const minX = Math.min(...positions.map((pos) => pos.clientX)) - 10;
    const minY = Math.min(...positions.map((pos) => pos.clientY)) - 10;
    const maxX = Math.max(...positions.map((pos) => pos.clientX)) + 30;
    const maxY = Math.max(...positions.map((pos) => pos.clientY)) + 30;
    // Start away from the selected layout's resize handles, then sweep back.
    await drag(page, { clientX: maxX, clientY: maxY }, minX - maxX, minY - maxY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0, 1]);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(beforePan);
});

test('right drag translates selected groups without zooming and Shift-left drag is free translation', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    const beforeZoom = await page.evaluate(() => window.__shapeeditorDebug.getCamZoom());
    const undoBefore = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length);
    await resetScreenmapWriteProbe(page);

    await drag(page, a, 36, 18, 'right');
    const afterRight = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    expect(afterRight).not.toEqual(before);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamZoom())).toBe(beforeZoom);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore + 1);
    expect(await screenmapWriteCount(page)).toBe(1);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
    await page.keyboard.press('Control+z');
    const roundedBefore = before.map((point: number[]) => point.map((value) => Math.round(value * 1e6) / 1e6));
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0)
        .map((point: number[]) => point.map((value: number) => Math.round(value * 1e6) / 1e6)))).toEqual(roundedBefore);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(afterRight);
    await page.keyboard.press('Control+z');

    const refreshed = await led(page, 0);
    await page.keyboard.down('Shift');
    await drag(page, refreshed, 24, -16);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).not.toEqual(before);
});

test('selection modifiers toggle groups and an unselected right drag remains selection-only', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    const b = await led(page, 4);
    const beforeB = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1));
    const undoBefore = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length);
    const dirtyBefore = await page.evaluate(() => window.__lmDebug.shapeeditor.getState().dirty);
    await resetScreenmapWriteProbe(page);

    await drag(page, b, 30, 12, 'right');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(1))).toEqual(beforeB);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([1]);

    await page.mouse.click(b.clientX, b.clientY, { button: 'right' });
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.mouse.click(a.clientX, a.clientY);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.clientX, b.clientY);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0, 1]);

    await page.keyboard.down('Shift');
    await page.mouse.click(b.clientX, b.clientY);
    await page.keyboard.up('Shift');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0]);

    const stripB = await Promise.all(Array.from({ length: 4 }, (_, idx) => led(page, idx + 4)));
    const minX = Math.min(...stripB.map((pos) => pos.clientX)) - 10;
    const minY = Math.min(...stripB.map((pos) => pos.clientY)) - 10;
    const maxX = Math.max(...stripB.map((pos) => pos.clientX)) + 30;
    const maxY = Math.max(...stripB.map((pos) => pos.clientY)) + 30;
    await page.keyboard.down('Control');
    await drag(page, { clientX: maxX, clientY: maxY }, minX - maxX, minY - maxY);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0, 1]);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore);
    expect(await page.evaluate(() => window.__lmDebug.shapeeditor.getState().dirty)).toBe(dirtyBefore);
    expect(await screenmapWriteCount(page)).toBe(0);
});

test('translation starts only after more than 3 CSS pixels and stationary right click opens context', async ({ page }) => {
    // Fractional grid sizing makes canvas units differ from CSS pixels. The
    // threshold must still be measured in browser client coordinates.
    await open(page, 1279);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    const undoBefore = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length);
    await resetScreenmapWriteProbe(page);

    await drag(page, a, 3, 0, 'right');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(before);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore);
    expect(await screenmapWriteCount(page)).toBe(0);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.mouse.move(a.clientX, a.clientY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(a.clientX + 4, a.clientY);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().stripDragActive)).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(before);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore);
    expect(await screenmapWriteCount(page)).toBe(0);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
});

test('Escape, pointercancel, and lost capture restore active translation without history or persistence', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    const undoBefore = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length);
    await resetScreenmapWriteProbe(page);

    const beginTranslation = async () => {
        await page.evaluate(() => {
            const target = window as typeof window & { __activeTestPointerId?: number };
            document.querySelector('.shapeeditor-overlay-canvas')?.addEventListener('pointerdown', (event) => {
                target.__activeTestPointerId = (event as PointerEvent).pointerId;
            }, { once: true });
        });
        await page.mouse.move(a.clientX, a.clientY);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(a.clientX + 30, a.clientY + 16, { steps: 3 });
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).not.toEqual(before);
    };
    const expectRestored = async () => {
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(before);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore);
        expect(await screenmapWriteCount(page)).toBe(0);
    };

    await beginTranslation();
    await page.keyboard.press('Escape');
    await page.mouse.up({ button: 'right' });
    await expectRestored();

    await beginTranslation();
    await page.evaluate(() => {
        const target = window as typeof window & { __activeTestPointerId?: number };
        const canvas = document.querySelector('.shapeeditor-overlay-canvas');
        canvas?.dispatchEvent(new PointerEvent('pointercancel', {
            pointerId: target.__activeTestPointerId,
            pointerType: 'mouse',
            bubbles: true,
        }));
    });
    await page.mouse.up({ button: 'right' });
    await expectRestored();

    await beginTranslation();
    await page.evaluate(() => {
        const target = window as typeof window & { __activeTestPointerId?: number };
        const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
        if (canvas && target.__activeTestPointerId !== undefined) canvas.releasePointerCapture(target.__activeTestPointerId);
    });
    await page.mouse.up({ button: 'right' });
    await expectRestored();
});

test('Space-left and middle drag pan while wheel zooms', async ({ page }) => {
    await open(page);
    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(canvas).not.toBeNull();
    const start = { clientX: canvas!.x + canvas!.width - 50, clientY: canvas!.y + canvas!.height - 60 };
    const before = await page.evaluate(() => ({ pan: window.__shapeeditorDebug.getCamPan(), zoom: window.__shapeeditorDebug.getCamZoom() }));

    await page.keyboard.down('Space');
    await drag(page, start, -40, -20);
    await page.keyboard.up('Space');
    const afterSpace = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
    expect(afterSpace).not.toEqual(before.pan);

    await drag(page, start, -20, 30, 'middle');
    const afterMiddle = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
    expect(afterMiddle).not.toEqual(afterSpace);

    await page.mouse.move(start.clientX, start.clientY);
    await page.mouse.wheel(0, -240);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getCamZoom())).not.toBe(before.zoom);
});
