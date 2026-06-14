import { defineConfig } from '@playwright/test';
import { resolve } from 'path';
import fs from 'fs';

const certPath = resolve(import.meta.dirname, '.certs/cert.pem');
const hasHttps = fs.existsSync(certPath);
const protocol = hasHttps ? 'https' : 'http';

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '*.spec.ts',
  // 4 workers matches the GitHub-hosted ubuntu-latest core count.
  // Local runs benefit too — most boxes have at least 4 cores.
  workers: process.env.CI ? 4 : undefined,
  timeout: 30000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
  },
  use: {
    baseURL: `${protocol}://localhost:8080`,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `${protocol}://localhost:8080`,
    reuseExistingServer: !process.env.CI,
    ignoreHTTPSErrors: true,
  },
});
