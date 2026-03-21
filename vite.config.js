import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import fs from 'fs';

const certPath = resolve(__dirname, '.certs/cert.pem');
const keyPath = resolve(__dirname, '.certs/key.pem');
const httpsConfig = fs.existsSync(certPath) && fs.existsSync(keyPath)
  ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
  : undefined;

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [tailwindcss(), {
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
