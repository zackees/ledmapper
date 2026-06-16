import { defineConfig } from '@playwright/test';

/**
 * Perf-snapshot config (issue #160). Reads `gfx.getStats()` from /play
 * over a steady-state window to catch renderer regressions that would
 * land sub-60 FPS even with a healthy frame source.
 *
 * Runs against the production build via `vite preview` (same approach
 * as canvas-fit). Not part of `npm test`; trigger explicitly via
 * `npm run test:perf`.
 */
export default defineConfig({
    testDir: './tests/perf',
    testMatch: '*.spec.ts',
    workers: 1,
    timeout: 60000,
    expect: { timeout: 10000 },
    use: {
        baseURL: 'http://localhost:4175',
        trace: 'off',
    },
    reporter: 'list',
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
                // Disable background-tab throttling so the demo's RAF
                // frame pump runs at full rate even in headless. Without
                // these, headless Chromium clamps RAF to ~1 Hz when the
                // page is "occluded" — meaningless for a perf snapshot.
                // Set PERF_HEADED=1 for a real-browser run; the headless
                // Chromium in Playwright clamps both renderFps and
                // pushFps equally, so a comparative reading isn't useful
                // without a real GPU + paint cycle.
                headless: process.env.PERF_HEADED !== '1',
                launchOptions: {
                    args: [
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                    ],
                },
            },
        },
    ],
    webServer: {
        command: 'npx vite preview --port 4175',
        url: 'http://localhost:4175',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
