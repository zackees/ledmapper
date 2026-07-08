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
