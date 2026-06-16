import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cssVar, gfxColors, snapshotGfxColors, invalidateThemeCache } from '../../src/ui/theme.ts';

/** Phase 1 of #170. Tests run under Node — no document/getComputedStyle —
 *  so every lookup falls through to FALLBACK. That's the contract for
 *  workers too, so the test doubles as the worker-side check. */

test('theme: cssVar returns the fallback when document is absent', () => {
    invalidateThemeCache();
    assert.equal(cssVar('--fastled-accent-blue'), '#3b82f6');
    assert.equal(cssVar('--fastled-accent-amber'), '#f59e0b');
    assert.equal(cssVar('--fastled-led-start'), '#22c55e');
});

test('theme: cssVar caches per-name', () => {
    invalidateThemeCache();
    const a = cssVar('--fastled-accent-purple');
    const b = cssVar('--fastled-accent-purple');
    assert.equal(a, b);
    assert.equal(a, '#a855f7');
});

test('theme: invalidateThemeCache clears the cache', () => {
    invalidateThemeCache();
    cssVar('--fastled-accent-cyan');
    invalidateThemeCache();
    // Re-reading still returns the right fallback after cache clear.
    assert.equal(cssVar('--fastled-accent-cyan'), '#22d3ee');
});

test('theme: unknown tokens fall back to #ffffff', () => {
    invalidateThemeCache();
    assert.equal(cssVar('--color-not-a-thing'), '#ffffff');
});

test('theme: gfxColors named accessors round-trip', () => {
    invalidateThemeCache();
    assert.equal(gfxColors.accentBlue(), '#3b82f6');
    assert.equal(gfxColors.accentAmberHover(), '#fbbf24');
    assert.equal(gfxColors.ledEnd(), '#ef4444');
    assert.equal(gfxColors.textMuted(), '#a1a1aa');
});

test('theme: gfxColors.group wraps mod 8', () => {
    invalidateThemeCache();
    assert.equal(gfxColors.group(0), '#3b82f6');
    assert.equal(gfxColors.group(7), '#84cc16');
    assert.equal(gfxColors.group(8), '#3b82f6');  // wraps
    assert.equal(gfxColors.group(15), '#84cc16'); // wraps
    assert.equal(gfxColors.group(-1), '#84cc16'); // negative input wraps to 7
});

test('theme: snapshotGfxColors returns the full palette', () => {
    invalidateThemeCache();
    const snap = snapshotGfxColors();
    assert.equal(snap['--fastled-accent-blue'], '#3b82f6');
    assert.equal(snap['--fastled-group-4'], '#a855f7');
    assert.equal(snap['--fastled-led-start'], '#22c55e');
    // At least 27 keys (10 accents + 2 LED + 7 popover/text + 8 group).
    assert.ok(Object.keys(snap).length >= 27);
});
