/**
 * Shared gate for GPU-dependent specs (WebGL recording / rendering).
 *
 * Headless ubuntu-latest Chromium has no real GPU, so these specs are
 * skipped on the default push/PR CI path. The nightly SwiftShader job
 * (.github/workflows/gpu-nightly.yml) sets GPU_CI=1 to opt back in — it
 * runs Chromium with `--use-gl=angle --use-angle=swiftshader-webgl
 * --enable-unsafe-swiftshader` for CPU-based but correctness-accurate
 * WebGL. Local runs (CI unset) always execute.
 */
export function shouldSkipGpuTest(): boolean {
    return !!process.env.CI && !process.env.GPU_CI;
}

/**
 * Multiplier for spec-internal wait timeouts (download events,
 * waitForFunction polls, ...) so they scale with SwiftShader's 10-30x
 * CPU-rendering slowdown the same way playwright.config.js scales the
 * per-test timeout. The first gpu-nightly run showed hard-coded 15s waits
 * expiring long before the 120s test budget.
 */
export const GPU_WAIT_SCALE = process.env.GPU_CI ? 4 : 1;
