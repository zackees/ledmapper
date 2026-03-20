import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [{
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
    https: {
      key: fs.readFileSync(resolve(__dirname, '.certs/key.pem')),
      cert: fs.readFileSync(resolve(__dirname, '.certs/cert.pem')),
    },
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
