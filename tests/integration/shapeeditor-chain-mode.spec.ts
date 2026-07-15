import { test, expect } from './fixtures.ts';

test.describe('Shapeeditor chain/reorder canvas modes (issue #24, Phase 3)', () => {
    test.afterEach(async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('lm:screenmap');
            localStorage.removeItem('lm:screenmap-preset');
            localStorage.removeItem('lm:screenmap-meta');
            localStorage.removeItem('lm:screenmap-backup');
            localStorage.removeItem('lm:screenmap-backup-meta');
            localStorage.removeItem('lm:shapeeditor-repinToastShown');
        });
    });

    async function freshEditor(page) {
        await page.goto('/create');
        await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 });
        await page.waitForFunction(() => !!window.__shapeeditorDebug, null, { timeout: 10000 });
        await page.locator('#btn_new').evaluate((el) => el.click());
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(0);
    }

    async function placeThree(page) {
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', 0, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', 20, 0, {}));
        await page.evaluate(() => window.__shapeeditorDebug.placePanel('matrix-8x8', 40, 0, {}));
        await expect.poll(() =>
            page.evaluate(() => window.__shapeeditorDebug.getStripCount())
        ).toBe(3);
        await page.locator('#strips_panel').evaluate((el) => { el.open = true; });
    }

    test('Chain and Reorder toolbar toggles are mutually exclusive; Esc exits', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);

        const chainBtn = page.locator('#strips_btn_chain');
        const reorderBtn = page.locator('#strips_btn_reorder');

        await chainBtn.click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('chain');
        await expect(chainBtn).toHaveAttribute('aria-pressed', 'true');
        // Connector rows appear in the panel only in Chain mode.
        await expect(page.locator('#strips_list .connector-row')).toHaveCount(2);

        await reorderBtn.click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('reorder');
        await expect(chainBtn).toHaveAttribute('aria-pressed', 'false');
        await expect(reorderBtn).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#strips_list .connector-row')).toHaveCount(0);
        // Reorder mode dims the canvas wrapper.
        await expect(page.locator('.canvas-dim')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('select');
        await expect(reorderBtn).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.canvas-dim')).toHaveCount(0);

        // Clicking an active toggle also exits.
        await chainBtn.click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('chain');
        await chainBtn.click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getMode())).toBe('select');
    });

    test('Reorder mode move arrows reorder within pin; undo restores', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);
        const names = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());

        await page.locator('#strips_btn_reorder').click();
        await expect(page.locator('#strips_list.reorder-mode')).toHaveCount(1);

        await page.locator('#strips_list .strip-row[data-strip-idx="0"] button[data-action="down"]').click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual([names[1], names[0], names[2]]);

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual(names);

        // First strip's ▲ is disabled (no upstream neighbor within pin1).
        await expect(page.locator('#strips_list .strip-row[data-strip-idx="0"] button[data-action="up"]'))
            .toBeDisabled();
    });

    test('cross-pin boundary draws a badge instead of an arrow', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);

        // All same pin: 2 arrows, 0 badges.
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainArrowCount())).toBe(2);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getCrossPinBadgeCount())).toBe(0);

        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(2, 'pin2'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainArrowCount())).toBe(1);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getCrossPinBadgeCount())).toBe(1);
        // Rendered geometry reflects the same split.
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainGeom().crossBadges.length))
            .toBe(1);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainGeom().connectors.length))
            .toBe(1);
    });

    test('simulateConnectorDrag retargets across pins as ONE undo entry; undo restores', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);
        const names = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());
        await page.evaluate(() => window.__shapeeditorDebug.repinStrip(2, 'pin2'));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1', 'pin2']);

        // Rewire: strip0 ──▶ strip2 (pin2). Strip2 joins pin1 right after strip0.
        await page.evaluate(() => window.__shapeeditorDebug.simulateConnectorDrag(0, 2));
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1', 'pin1']);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual([names[0], names[2], names[1]]);
        const undoTypes = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack());
        expect(undoTypes.at(-1)).toBe('connector-retarget');

        // Single undo fully reverses the composite (pin + position).
        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1', 'pin2']);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual(names);

        // Redo replays it.
        await page.keyboard.press('Control+y');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1', 'pin1']);
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual([names[0], names[2], names[1]]);
    });

    test('Chain mode suppresses LED group-drag', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);

        const before = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        await page.evaluate(() => window.__shapeeditorDebug.setMode('chain'));
        await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(0, 60, 60));
        const after = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        expect(after).toEqual(before);

        // Outside Chain mode the same drag moves the strip (control case).
        await page.evaluate(() => window.__shapeeditorDebug.setMode(null));
        await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
        await page.evaluate(() => window.__shapeeditorDebug.simulateLedDrag(0, 60, 60, { button: 2 }));
        const moved = await page.evaluate(() => window.__shapeeditorDebug.getStripPoints(0));
        expect(moved).not.toEqual(before);
    });

    test('unexpected pointer capture loss cancels an active connector drag', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);
        await page.locator('#strips_btn_chain').click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainGeom().connectors.length)).toBe(2);
        const undoBefore = await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length);
        const namesBefore = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());

        const arrow = await page.evaluate(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
            const connector = window.__shapeeditorDebug.getChainGeom().connectors[0];
            if (!canvas || !connector) throw new Error('chain connector canvas geometry unavailable');
            const rect = canvas.getBoundingClientRect();
            const canvasWidth = canvas.width / window.devicePixelRatio;
            const canvasHeight = canvas.height / window.devicePixelRatio;
            return {
                clientX: rect.left + connector.x2 / canvasWidth * rect.width,
                clientY: rect.top + connector.y2 / canvasHeight * rect.height,
            };
        });
        expect(await page.evaluate(({ clientX, clientY }) => (
            document.elementFromPoint(clientX, clientY)?.classList.contains('shapeeditor-overlay-canvas') ?? false
        ), arrow)).toBe(true);
        await page.evaluate(() => {
            const target = window as typeof window & { __chainPointerId?: number };
            document.querySelector('.shapeeditor-overlay-canvas')?.addEventListener('pointerdown', (event) => {
                target.__chainPointerId = (event as PointerEvent).pointerId;
            }, { once: true });
        });

        await page.mouse.move(arrow.clientX, arrow.clientY);
        await page.mouse.down();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getInteractionState().connectorDragActive)).toBe(true);
        await page.evaluate(() => {
            const target = window as typeof window & { __chainPointerId?: number };
            const canvas = document.querySelector<HTMLCanvasElement>('.shapeeditor-overlay-canvas');
            if (canvas && target.__chainPointerId !== undefined) {
                canvas.dispatchEvent(new PointerEvent('lostpointercapture', {
                    pointerId: target.__chainPointerId,
                    pointerType: 'mouse',
                }));
            }
        });
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getInteractionState().connectorDragActive)).toBe(false);
        await page.mouse.up();
        expect(await page.evaluate(() => window.__shapeeditorDebug.getUndoStack().length)).toBe(undoBefore);
        expect(await page.evaluate(() => window.__shapeeditorDebug.getStripNames())).toEqual(namesBefore);
    });

    test('right-click on a canvas connector opens the menu; Split pin here splits', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);
        await page.evaluate(() => window.__shapeeditorDebug.setMode('chain'));
        // Wait for a render pass to populate connector geometry.
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getChainGeom().connectors.length))
            .toBe(2);

        await page.evaluate(() => {
            const c = window.__shapeeditorDebug.getChainGeom().connectors[0];
            window.__shapeeditorDebug.simulateCanvasContextMenu((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2);
        });
        const menu = page.locator('.connector-menu');
        await expect(menu).toBeVisible();
        await expect(menu.locator('button')).toHaveCount(3);

        await menu.locator('button', { hasText: 'Split pin here' }).click();
        await expect(menu).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin2', 'pin2']);

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripPins()))
            .toEqual(['pin1', 'pin1', 'pin1']);
    });

    test('connector panel-row click opens menu; Swap upstream swaps the pair', async ({ page }) => {
        await freshEditor(page);
        await placeThree(page);
        const names = await page.evaluate(() => window.__shapeeditorDebug.getStripNames());
        await page.evaluate(() => window.__shapeeditorDebug.setMode('chain'));

        await page.locator('#strips_list .connector-row').first().click();
        const menu = page.locator('.connector-menu');
        await expect(menu).toBeVisible();
        await menu.locator('button', { hasText: 'Swap upstream' }).click();
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual([names[1], names[0], names[2]]);

        await page.keyboard.press('Control+z');
        await expect.poll(() => page.evaluate(() => window.__shapeeditorDebug.getStripNames()))
            .toEqual(names);
    });
});
