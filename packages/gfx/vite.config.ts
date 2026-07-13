import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Library-mode build for @fastled/gfx.
 *
 * Inputs the package entry points and outputs ESM files for each supported
 * subpath. All transitive renderer imports are inlined. `three` is
 * externalized so consumers choose the version (peer dep in package.json).
 *
 * Run via `npm run build:gfx` from the repo root. Types are produced by
 * a separate `tsc --emitDeclarationOnly` pass (`build:gfx:types`) so we
 * don't add a Vite type-emit plugin as a dev dep.
 */
export default defineConfig({
    build: {
        lib: {
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                core: resolve(__dirname, 'src/core.ts'),
                fled: resolve(__dirname, 'src/fled.ts'),
                worker: resolve(__dirname, 'src/worker.ts'),
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
        },
        rollupOptions: {
            external: ['three'],
            output: {
                preserveModules: false,
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        minify: false,
        target: 'es2022',
    },
});
