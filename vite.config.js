import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  server: {
    port: 8080,
    open: '/hub/index.html',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        hub: resolve(__dirname, 'src/hub/index.html'),
        demo: resolve(__dirname, 'src/demo/index.html'),
        screenmap: resolve(__dirname, 'src/screenmap/index.html'),
        moviemaker: resolve(__dirname, 'src/moviemaker/index.html'),
        movieplayer: resolve(__dirname, 'src/movieplayer/index.html'),
        shapeviewer: resolve(__dirname, 'src/shapeviewer/index.html'),
      },
    },
  },
});
