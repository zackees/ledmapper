import { test as base, expect } from '@playwright/test';

// Extend the base test with a worker-scoped browser context.
// Instead of creating a new context per test (default), one context
// is shared across all tests within a worker — recycling the Chromium
// process and GPU context to reduce memory usage.
export const test = base.extend({
  // New worker-scoped fixture (can't override built-in context scope)
  sharedContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
});

export { expect };
