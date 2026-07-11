import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// Build-version string baked into the bundle via `define` below (issue
// #230's copy-diagnostics button reads it as `__APP_VERSION__`). Read once
// at config-eval time so dev server + build share the same value.
// `git rev-parse` fails outside a git checkout (e.g. some archive-based
// deploy sandboxes), so it's wrapped in a try/catch with an 'unknown'
// fallback rather than failing the whole build.
function getGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const APP_VERSION = `${getGitSha()} (${new Date().toISOString().slice(0, 10)})`;

const certPath = resolve(__dirname, '.certs/cert.pem');
const keyPath = resolve(__dirname, '.certs/key.pem');
const httpsConfig = fs.existsSync(certPath) && fs.existsSync(keyPath)
  ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  : undefined;

// Bakes public/screenmaps/manifest.json into the JS bundle at build time so
// tools can render preset UI from it without hand-maintained button lists.
const presetManifestPlugin = () => {
  const virtualId = 'virtual:screenmap-presets';
  const resolvedId = '\0' + virtualId;
  const manifestPath = resolve(__dirname, 'public/screenmaps/manifest.json');
  return {
    name: 'screenmap-presets',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      this.addWatchFile(manifestPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return `export default ${JSON.stringify(manifest)};`;
    },
  };
};

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [tailwindcss(), presetManifestPlugin(), {
    name: 'spa-fallback',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.url && !req.url.includes('.') && req.url !== '/') {
            req.url = '/index.html';
          }
          next();
        });
      };
    }
  }],
  server: {
    port: 8080,
    // No auto-open: agents start this server far more often than humans
    // do (scripts/dev-server.mjs, the blessed test runner), and a popped
    // browser tab on every invocation is disruptive noise for both. Opt in
    // with `LM_OPEN=1 npm run dev` when you actually want it.
    open: process.env.LM_OPEN ? '/' : false,
    https: httpsConfig,
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
      },
      treeshake: {
        preset: 'smallest',
      },
    },
  },
});
