import { test, expect } from './fixtures.ts';

test('issue #375: strip drag builds typed snap targets and engages an axis snap', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
        localStorage.setItem('lm:screenmap', JSON.stringify({ map: {
            dragged: { x: [0, 1, 2, 3], y: [0, 0, 0, 0], diameter: 0.5 },
            neighbor: { x: [0, 1, 2, 3], y: [5, 5, 5, 5], diameter: 0.5 },
        }}));
        localStorage.setItem('lm:screenmap-meta', JSON.stringify({ savedAt: Date.now(), source: 'save', ledCount: 8, stripCount: 2 }));
        localStorage.setItem('lm:shapeeditor-helpDismissed', '1');
    });
    await page.goto('/create');
    await page.waitForFunction(() => !!window.__shapeeditorDebug);
    await page.waitForFunction(() => window.__shapeeditorDebug.getLedCanvasPos(0) !== null);

    const pos = await page.evaluate(() => window.__shapeeditorDebug.getLedCanvasPos(0));
    await page.evaluate(() => window.__shapeeditorDebug.selectStrip(0));
    await page.mouse.move(pos.clientX, pos.clientY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(pos.clientX, pos.clientY + 12);

    const state = await page.evaluate(() => window.__shapeeditorDebug.getStripSnapState());
    expect(state.active).toBe(true);
    expect(state.targetCounts.x + state.targetCounts.y).toBeGreaterThan(0);
    expect(state.targetKinds.x.concat(state.targetKinds.y)).toEqual(expect.arrayContaining(['centroid', 'bbox-edge']));

    await page.mouse.up({ button: 'right' });
});
