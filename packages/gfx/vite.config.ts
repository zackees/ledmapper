import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Library-mode build for @fastled/gfx.
 *
 * Inputs the re-export shim at `src/index.ts`; outputs ESM `dist/index.js`
 * with all transitive ledmapper-internal imports inlined. `three` is
 * externalized so consumers choose the version (peer dep in package.json).
 *
 * Run via `npm run build:gfx` from the repo root. Types are produced by
 * a separate `tsc --emitDeclarationOnly` pass (`build:gfx:types`) so we
 * don't add a Vite type-emit plugin as a dev dep.
 */
export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.js',
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
