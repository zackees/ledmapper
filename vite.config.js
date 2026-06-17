import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import fs from 'fs';

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
    open: '/',
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
