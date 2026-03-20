import { defineConfig } from 'vite';
import { resolve } from 'path';

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
