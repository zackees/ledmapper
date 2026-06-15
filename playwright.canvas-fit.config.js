import { defineConfig } from '@playwright/test';

/**
 * Canvas-fit snapshot config — drives the iterate-and-look loop for
 * /play, /create, /record across multiple viewports. Runs against the
 * production build via `vite preview`. Snapshots land in
 * `tests/canvas-fit/output/` for visual inspection between iterations.
 */
export default defineConfig({
  testDir: './tests/canvas-fit',
  testMatch: '*.spec.ts',
  workers: 1,        // sequential so snapshots are predictable
  timeout: 30000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'off',
  },
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npx vite preview --port 4174',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
