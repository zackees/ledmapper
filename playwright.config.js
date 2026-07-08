import { defineConfig } from '@playwright/test';
import { resolve } from 'path';
import fs from 'fs';

const certPath = resolve(import.meta.dirname, '.certs/cert.pem');
const hasHttps = fs.existsSync(certPath);
const protocol = hasHttps ? 'https' : 'http';
const isCI = !!process.env.CI;
// Nightly SwiftShader GPU job (.github/workflows/gpu-nightly.yml) sets
// GPU_CI=1 to run the @gpu-tagged WebGL specs under headless CPU rendering.
const isGpuCI = !!process.env.GPU_CI;

const ciArgs = isCI ? ['--disable-dev-shm-usage'] : [];
// SwiftShader (CPU) WebGL args — load-bearing since Chrome ~130, per
// Chromium docs' intended headless-testing opt-in.
const gpuArgs = isGpuCI
  ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']
  : [];

export default defineConfig({
  testDir: './tests/integration',
  testMatch: '*.spec.ts',
  // CI: single worker. The previous 4-worker config repeatedly OOM-killed
  // Chromium mid-run on ubuntu-latest (issue #74); each parallel worker
  // launches its own browser + Vite client + render contexts, and 4 of
  // them combined exceeded the runner's ~7 GB working-set budget.
  // Single-worker takes longer but eliminates the cross-spec "Target page
  // has been closed" cascade.
  // Local: undefined → Playwright picks N (~core count).
  workers: isCI ? 1 : undefined,
  // CI: retry transient browser deaths twice. With workers=1 the
  // serialization helps, but a single OOM still kills the whole run
  // without retries. Local stays at 0 so flaky logic surfaces during
  // development.
  retries: isCI ? 2 : 0,
  // SwiftShader (CPU-rendered WebGL) is 10-30x slower than a real GPU;
  // the recording/points-mesh specs need much more headroom in that mode.
  timeout: isGpuCI ? 120000 : 30000,
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
    // `/dev/shm` on ubuntu-latest runners is small (~64 MB); Chromium
    // defaults to using it for shared-memory rendering buffers and
    // crashes when it fills. Forcing /tmp avoids that path.
    launchOptions: { args: [...ciArgs, ...gpuArgs] },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    // CI: serve a built bundle via `vite preview`. The dev server holds
    // a Vite module graph + hot-reload watcher per page, which compounded
    // the memory pressure during parallel-worker runs. Preview serves
    // static files — much lighter.
    // Local: keep the dev server so changes still hot-reload while tests
    // are being authored.
    command: isCI ? 'npm run build && npx vite preview --port 8080' : 'npm run dev',
    url: `${protocol}://localhost:8080`,
    reuseExistingServer: !isCI,
    ignoreHTTPSErrors: true,
    timeout: 120000, // CI build can take ~30s on a cold cache
  },
});
