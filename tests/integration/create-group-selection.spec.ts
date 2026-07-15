import { expect, test, type Page } from './fixtures.ts';

const KEYS = ['lm:screenmap', 'lm:screenmap-meta', 'lm:shapeeditor-helpDismissed', 'shapeeditor.overlayCollapsed'];

function map() {
    return JSON.stringify({ map: {
        stripA: { x: [0, 20, 20, 0], y: [0, 0, 20, 20], diameter: 0.5 },
        stripB: { x: [0, 20, 20, 0], y: [60, 60, 80, 80], diameter: 0.5 },
        stripC: { x: [140, 160], y: [0, 0], diameter: 0.5 },
    } });
}

async function open(page: Page, width = 1280, height = 720) {
    await page.setViewportSize({ width, height });
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

async function openEmpty(page: Page, width = 1280, height = 720) {
    await open(page, width, height);
    // New is intentionally hidden in the desktop header flow; invoke its real
    // click handler so the rest of the first-panel flow uses visible controls.
    await page.locator('#btn_new').evaluate((element: HTMLElement) => { element.click(); });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(0);
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

async function emptyCanvasPoint(page: Page) {
    const point = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const candidates = [
            { clientX: rect.right - 40, clientY: rect.top + 40 },
            { clientX: rect.right - 40, clientY: rect.bottom - 60 },
            { clientX: rect.left + rect.width * 0.75, clientY: rect.top + 40 },
        ];
        const leds = Array.from({ length: 10 }, (_, idx) => window.__shapeeditorDebug.getLedCanvasPos(idx))
            .filter((pos): pos is NonNullable<typeof pos> => pos !== null);
        return candidates.find((candidate) => {
            const targetsCanvas = document.elementFromPoint(candidate.clientX, candidate.clientY)
                ?.classList.contains('shapeeditor-overlay-canvas') ?? false;
            const clearOfLeds = leds.every((ledPos) => Math.hypot(
                candidate.clientX - ledPos.clientX,
                candidate.clientY - ledPos.clientY,
            ) > 60);
            return targetsCanvas && clearOfLeds;
        }) ?? null;
    });
    expect(point, 'expected an unobstructed empty canvas coordinate').not.toBeNull();
    return point!;
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

test('Select is default and desktop tools float over a full-width stable canvas without hiding fitted controls', async ({ page }) => {
    await open(page);
    const select = page.locator('#strips_btn_select');
    await expect(select).toBeVisible();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(select).toHaveClass(/active/);

    const panel = await page.locator('#transform-overlay').boundingBox();
    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    const workspace = await page.locator('.shapeeditor-main').boundingBox();
    expect(panel).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(workspace).not.toBeNull();
    expect(canvas!.x).toBeCloseTo(workspace!.x, 0);
    expect(canvas!.y).toBeCloseTo(workspace!.y, 0);
    expect(canvas!.width).toBeCloseTo(workspace!.width, 0);
    expect(canvas!.height).toBeCloseTo(workspace!.height, 0);
    const intersects = panel!.x < canvas!.x + canvas!.width
        && panel!.x + panel!.width > canvas!.x
        && panel!.y < canvas!.y + canvas!.height
        && panel!.y + panel!.height > canvas!.y;
    expect(intersects).toBe(true);

    await expect.poll(() => page.locator('#transform-overlay').evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)))
        .toBeLessThan(1);
    await page.locator('#transform-overlay').hover();
    await expect.poll(() => page.locator('#transform-overlay').evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)))
        .toBe(1);
    await page.mouse.move(canvas!.x + canvas!.width - 10, canvas!.y + canvas!.height - 10);
    await page.locator('#btn_overlay_collapse').focus();
    await expect.poll(() => page.locator('#transform-overlay').evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)))
        .toBe(1);

    const fittedPositions = await Promise.all(Array.from({ length: 10 }, (_, idx) => led(page, idx)));
    for (const pos of fittedPositions) {
        const covered = pos.clientX >= panel!.x && pos.clientX <= panel!.x + panel!.width
            && pos.clientY >= panel!.y && pos.clientY <= panel!.y + panel!.height;
        expect(covered, 'initially fitted LED must stay outside the tools overlay').toBe(false);
    }

    await page.mouse.click(fittedPositions[0]!.clientX, fittedPositions[0]!.clientY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripRotateVisualState?.()?.handle ?? null)).not.toBeNull();
    const rotateHandle = await page.evaluate(() => {
        const canvasElement = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
        const handle = window.__shapeeditorDebug.getStripRotateVisualState?.()?.handle;
        if (!canvasElement || !handle) return null;
        const rect = canvasElement.getBoundingClientRect();
        return {
            clientX: rect.left + handle.handleX / (canvasElement.width / devicePixelRatio) * rect.width,
            clientY: rect.top + handle.handleY / (canvasElement.height / devicePixelRatio) * rect.height,
        };
    });
    expect(rotateHandle).not.toBeNull();
    const handleCovered = rotateHandle!.clientX >= panel!.x && rotateHandle!.clientX <= panel!.x + panel!.width
        && rotateHandle!.clientY >= panel!.y && rotateHandle!.clientY <= panel!.y + panel!.height;
    expect(handleCovered, 'initial rotation handle must stay outside the tools overlay').toBe(false);
    await expectCanvasTarget(page, rotateHandle!);

    const pointsBefore = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    const cameraBefore = await page.evaluate(() => ({
        pan: window.__shapeeditorDebug.getCamPan(),
        zoom: window.__shapeeditorDebug.getCamZoom(),
    }));
    await page.locator('#btn_overlay_collapse').click();
    const collapsedCanvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(collapsedCanvas).not.toBeNull();
    expect(collapsedCanvas!.x).toBeCloseTo(canvas!.x, 0);
    expect(collapsedCanvas!.y).toBeCloseTo(canvas!.y, 0);
    expect(collapsedCanvas!.width).toBeCloseTo(canvas!.width, 0);
    expect(collapsedCanvas!.height).toBeCloseTo(canvas!.height, 0);
    const collapsedPositions = await Promise.all(Array.from({ length: 10 }, (_, idx) => led(page, idx)));
    for (let idx = 0; idx < fittedPositions.length; idx++) {
        expect(collapsedPositions[idx]!.clientX).toBeCloseTo(fittedPositions[idx]!.clientX, 0);
        expect(collapsedPositions[idx]!.clientY).toBeCloseTo(fittedPositions[idx]!.clientY, 0);
    }
    await page.locator('#btn_overlay_expand').click();
    const expandedCanvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(expandedCanvas).not.toBeNull();
    expect(expandedCanvas!.x).toBeCloseTo(canvas!.x, 0);
    expect(expandedCanvas!.y).toBeCloseTo(canvas!.y, 0);
    expect(expandedCanvas!.width).toBeCloseTo(canvas!.width, 0);
    expect(expandedCanvas!.height).toBeCloseTo(canvas!.height, 0);
    const expandedPositions = await Promise.all(Array.from({ length: 10 }, (_, idx) => led(page, idx)));
    for (let idx = 0; idx < fittedPositions.length; idx++) {
        expect(expandedPositions[idx]!.clientX).toBeCloseTo(fittedPositions[idx]!.clientX, 0);
        expect(expandedPositions[idx]!.clientY).toBeCloseTo(fittedPositions[idx]!.clientY, 0);
    }
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).toEqual(pointsBefore);
    expect(await page.evaluate(() => ({
        pan: window.__shapeeditorDebug.getCamPan(),
        zoom: window.__shapeeditorDebug.getCamZoom(),
    }))).toEqual(cameraBefore);
});

test('overlay-aware initial fit remains unobstructed at a compact desktop viewport', async ({ page }) => {
    await open(page, 1024, 768);
    const panel = await page.locator('#transform-overlay').boundingBox();
    expect(panel).not.toBeNull();
    const fittedPositions = await Promise.all(Array.from({ length: 10 }, (_, idx) => led(page, idx)));
    for (const pos of fittedPositions) {
        const covered = pos.clientX >= panel!.x && pos.clientX <= panel!.x + panel!.width
            && pos.clientY >= panel!.y && pos.clientY <= panel!.y + panel!.height;
        expect(covered).toBe(false);
    }
});

test('the first panel created through visible controls stays in the usable canvas beside the overlay', async ({ page }) => {
    await openEmpty(page);
    await page.locator('#panel_palette').evaluate((element: HTMLDetailsElement) => { element.open = true; });
    const ringButton = page.locator('#panel_catalog_buttons [data-catalog-id="ring-16"]');
    await ringButton.scrollIntoViewIfNeeded();
    await ringButton.click();
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getPlacingMode())).toBe('ring-16');

    const panel = await page.locator('#transform-overlay').boundingBox();
    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(panel).not.toBeNull();
    expect(canvas).not.toBeNull();
    const placement = {
        clientX: Math.min(canvas!.x + canvas!.width - 120, panel!.x + panel!.width + 180),
        clientY: canvas!.y + canvas!.height * 0.55,
    };
    await expectCanvasTarget(page, placement);
    await page.mouse.click(placement.clientX, placement.clientY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripCount())).toBe(1);

    const positions = await Promise.all(Array.from({ length: 16 }, (_, idx) => led(page, idx)));
    for (const pos of positions) {
        const covered = pos.clientX >= panel!.x && pos.clientX <= panel!.x + panel!.width
            && pos.clientY >= panel!.y && pos.clientY <= panel!.y + panel!.height;
        expect(covered, 'newly created LED must stay outside the tools overlay').toBe(false);
    }
    const rotation = await page.evaluate(() => window.__shapeeditorDebug.getStripRotateVisualState?.()?.handle ?? null);
    expect(rotation).not.toBeNull();
    const rotationTarget = { clientX: rotation!.clientHandleX, clientY: rotation!.clientHandleY };
    const handleCovered = rotationTarget.clientX >= panel!.x && rotationTarget.clientX <= panel!.x + panel!.width
        && rotationTarget.clientY >= panel!.y && rotationTarget.clientY <= panel!.y + panel!.height;
    expect(handleCovered, 'newly created rotation handle must stay outside the tools overlay').toBe(false);
    await expectCanvasTarget(page, rotationTarget);
});

test('right-click still cancels panel placement and paste without opening the canvas menu', async ({ page }) => {
    await open(page);
    const target = await emptyCanvasPoint(page);

    await page.locator('#panel_palette').evaluate((element: HTMLDetailsElement) => { element.open = true; });
    await page.locator('#panel_catalog_buttons [data-catalog-id="ring-16"]').click();
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getPlacingMode())).toBe('ring-16');
    await page.mouse.click(target.clientX, target.clientY, { button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getPlacingMode())).toBeNull();
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();

    await page.evaluate((json) => { window.__shapeeditorDebug.pasteScreenmapText(json); }, map());
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getPasteState())).not.toBeNull();
    await page.mouse.click(target.clientX, target.clientY, { button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getPasteState())).toBeNull();
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
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

test('right drag translates selected groups without zooming', async ({ page }) => {
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
});

test('Shift-left drag is free translation for a selected group', async ({ page }) => {
    await open(page);
    const refreshed = await led(page, 0);
    await page.mouse.click(refreshed.clientX, refreshed.clientY);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0]);
    const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
    await page.keyboard.down('Shift');
    await expectCanvasTarget(page, refreshed);
    await expectCanvasTarget(page, { clientX: refreshed.clientX + 24, clientY: refreshed.clientY - 16 });
    await page.mouse.move(refreshed.clientX, refreshed.clientY);
    await expect(page.locator('.shapeeditor-overlay-canvas')).toHaveCSS('cursor', 'grab');
    await page.mouse.down();
    expect(await page.evaluate(() => window.__shapeeditorDebug.getPointerGestureState())).toMatchObject({
        pending: { kind: 'translate', freeTranslate: true },
        stripDragActive: false,
    });
    await page.mouse.move(refreshed.clientX + 24, refreshed.clientY - 16, { steps: 4 });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().stripDragActive)).toBe(true);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0))).not.toEqual(before);
    await page.mouse.up();
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

test('right-dragging empty canvas pans without mutating the selected layout', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getSelectedStrips())).toEqual([0]);
    const start = await emptyCanvasPoint(page);
    const before = await page.evaluate(() => ({
        pan: window.__shapeeditorDebug.getCamPan(),
        zoom: window.__shapeeditorDebug.getCamZoom(),
        selected: window.__shapeeditorDebug.getSelectedStrips(),
        points: window.__shapeeditorDebug.getStripPoints(0),
        undo: window.__shapeeditorDebug.getUndoStack(),
        dirty: window.__lmDebug.shapeeditor.getState().dirty,
    }));
    await resetScreenmapWriteProbe(page);

    await page.mouse.move(start.clientX, start.clientY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.clientX - 70, start.clientY + 35, { steps: 4 });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().isPanning)).toBe(true);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).not.toEqual(before.pan);
    await page.mouse.up({ button: 'right' });

    const after = await page.evaluate(() => ({
        pan: window.__shapeeditorDebug.getCamPan(),
        zoom: window.__shapeeditorDebug.getCamZoom(),
        selected: window.__shapeeditorDebug.getSelectedStrips(),
        points: window.__shapeeditorDebug.getStripPoints(0),
        undo: window.__shapeeditorDebug.getUndoStack(),
        dirty: window.__lmDebug.shapeeditor.getState().dirty,
    }));
    expect(after.pan).not.toEqual(before.pan);
    expect(after.zoom).toBe(before.zoom);
    expect(after.selected).toEqual(before.selected);
    expect(after.points).toEqual(before.points);
    expect(after.undo).toEqual(before.undo);
    expect(after.dirty).toBe(before.dirty);
    expect(await screenmapWriteCount(page)).toBe(0);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
});

test('empty right-pan uses a greater-than-3-CSS-pixel threshold and preserves stationary context clicks', async ({ page }) => {
    await open(page, 1279);
    const start = await emptyCanvasPoint(page);
    const initialPan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());

    await page.mouse.click(start.clientX, start.clientY, { button: 'right' });
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeVisible();
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(initialPan);
    await page.keyboard.press('Escape');

    await drag(page, start, -3, 0, 'right');
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeVisible();
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(initialPan);
    await page.keyboard.press('Escape');

    await page.mouse.move(start.clientX, start.clientY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.clientX - 4, start.clientY);
    expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().isPanning)).toBe(true);
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).not.toEqual(initialPan);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
});

test('right-dragging empty canvas pans in Select, Chain, and Reorder modes', async ({ page }) => {
    await open(page);
    for (const mode of ['select', 'chain', 'reorder']) {
        await page.evaluate((nextMode) => { window.__shapeeditorDebug.setMode(nextMode); }, mode);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe(mode);
        const start = await emptyCanvasPoint(page);
        const beforePan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
        await drag(page, start, -24, 14, 'right');
        expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).not.toEqual(beforePan);
        await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
    }
});

test('selected rotation handles and Chain connectors are not empty right-pan targets', async ({ page }) => {
    await open(page);
    const a = await led(page, 0);
    await page.mouse.click(a.clientX, a.clientY);
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripRotateVisualState?.()?.handle ?? null)).not.toBeNull();
    const rotation = await page.evaluate(() => window.__shapeeditorDebug.getStripRotateVisualState?.()?.handle ?? null);
    expect(rotation).not.toBeNull();
    const rotationTarget = { clientX: rotation!.clientHandleX, clientY: rotation!.clientHandleY };
    await expectCanvasTarget(page, rotationTarget);
    const beforeRotationPan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
    await drag(page, rotationTarget, 16, 8, 'right');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(beforeRotationPan);

    await page.evaluate(() => { window.__shapeeditorDebug.setMode('chain'); });
    await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainGeom().connectors.length)).toBeGreaterThan(0);
    const connectorTarget = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
        const connector = window.__shapeeditorDebug.getChainGeom().connectors[0];
        if (!canvas || !connector) return null;
        const rect = canvas.getBoundingClientRect();
        const canvasCssWidth = canvas.width / devicePixelRatio;
        const canvasCssHeight = canvas.height / devicePixelRatio;
        return {
            clientX: rect.left + ((connector.x1 + connector.x2) / 2 / canvasCssWidth) * rect.width,
            clientY: rect.top + ((connector.y1 + connector.y2) / 2 / canvasCssHeight) * rect.height,
        };
    });
    expect(connectorTarget).not.toBeNull();
    await expectCanvasTarget(page, connectorTarget!);
    const beforeConnectorPan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());
    await drag(page, connectorTarget!, 16, 8, 'right');
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(beforeConnectorPan);
});

test('Escape, pointercancel, and lost capture restore right-pan; capture permits an outside release', async ({ page }) => {
    await open(page);
    const start = await emptyCanvasPoint(page);
    const originalPan = await page.evaluate(() => window.__shapeeditorDebug.getCamPan());

    const beginPan = async () => {
        await page.evaluate(() => {
            const target = window as typeof window & { __activeRightPanPointerId?: number };
            document.querySelector('.shapeeditor-overlay-canvas')?.addEventListener('pointerdown', (event) => {
                target.__activeRightPanPointerId = (event as PointerEvent).pointerId;
            }, { once: true });
        });
        await page.mouse.move(start.clientX, start.clientY);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(start.clientX - 36, start.clientY + 20, { steps: 3 });
        expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().isPanning)).toBe(true);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).not.toEqual(originalPan);
    };
    const releaseAndExpectRestored = async () => {
        await page.mouse.up({ button: 'right' });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getCamPan())).toEqual(originalPan);
        await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
    };

    await beginPan();
    await page.keyboard.press('Escape');
    await releaseAndExpectRestored();

    await beginPan();
    await page.evaluate(() => {
        const target = window as typeof window & { __activeRightPanPointerId?: number };
        const canvas = document.querySelector('.shapeeditor-overlay-canvas');
        canvas?.dispatchEvent(new PointerEvent('pointercancel', {
            pointerId: target.__activeRightPanPointerId ?? 1,
            pointerType: 'mouse',
            bubbles: true,
        }));
    });
    await releaseAndExpectRestored();

    await beginPan();
    await page.evaluate(() => {
        const target = window as typeof window & { __activeRightPanPointerId?: number };
        const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
        const pointerId = target.__activeRightPanPointerId;
        if (canvas && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    });
    await releaseAndExpectRestored();

    const canvas = await page.locator('.shapeeditor-overlay-canvas').boundingBox();
    expect(canvas).not.toBeNull();
    await page.mouse.move(start.clientX, start.clientY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.clientX - 80, canvas!.y - 8, { steps: 4 });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getInteractionState().isPanning)).toBe(true);
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => window.__shapeeditorDebug.getCamPan())).not.toEqual(originalPan);
    await expect(page.locator('.shapeeditor-ctx-menu')).toBeHidden();
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
