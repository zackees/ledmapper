import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

interface SharedContextFixtures {
    sharedContext: BrowserContext;
    page: Page;
}

// Minimal redeclare of the window.__lmLog hook installed by src/debug-log.ts.
// Kept intentionally narrow (just the `dump` shape the fixture needs) so this
// test-only file doesn't need to pull in src/ types via tsconfig.tests.json.
declare global {
    interface Window {
        __lmLog?: { dump: () => string };
    }
}

// Extend the base test with a worker-scoped browser context.
// Instead of creating a new context per test (default), one context
// is shared across all tests within a worker — recycling the Chromium
// process and GPU context to reduce memory usage.
export const test = base.extend<{ page: Page; lmLogDump: undefined }, SharedContextFixtures>({
  // New worker-scoped fixture (can't override built-in context scope)
  sharedContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    // Suppress the shapeeditor first-run help modal in all existing specs.
    // New discoverability-specific spec clears this key explicitly to exercise
    // the first-run gate.
    await context.addInitScript(() => {
      try { localStorage.setItem('lm:shapeeditor-helpDismissed', '1'); } catch { /* ignore */ }
    });
    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  // Override page to use the shared worker-scoped context
  page: async ({ sharedContext }, use) => {
    const page = await sharedContext.newPage();
    await use(page);
    await page.close();
    await sharedContext.clearCookies();
  },

  // Automatic fixture: on test failure, attach the window.__lmLog event
  // trail to the report. Depends on `page` (not just a bare function) so
  // the page is guaranteed to still be alive during teardown. Complements
  // traces — traces never capture window state, and `trace: 'on-first-retry'`
  // produces nothing at local `retries: 0`.
  lmLogDump: [async ({ page }, use, testInfo) => {
    await use(undefined);
    if (testInfo.status !== testInfo.expectedStatus) {
      const dump = await page.evaluate(() => window.__lmLog?.dump() ?? '(no __lmLog)')
        .catch((e: unknown) => `dump failed: ${String(e)}`); // crashed page must not mask the real failure
      await testInfo.attach('lm-log', { body: dump, contentType: 'text/plain' });
    }
  }, { auto: true }],
});

export { expect };
