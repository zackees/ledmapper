import { defineConfig } from '@playwright/test';

// Smoke-test config: runs against the production build via `vite preview`.
// Distinct from playwright.config.js (integration, runs against `npm run
// dev`) because the smoke suite's whole purpose is to catch production-
// bundle regressions — tree-shaking drops, broken dynamic imports,
// missing CSS, etc. — that the dev server can't expose.
export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '*.spec.ts',
  workers: process.env.CI ? 4 : undefined,
  timeout: 15000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    // Assumes `npm run build` already ran (the CI job does it once before
    // the playwright step). Locally, `npm run test:smoke` triggers
    // `vite build` first via the prepended script.
    command: 'npx vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
