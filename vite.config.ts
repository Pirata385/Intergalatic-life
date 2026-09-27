import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The game ships as one self-contained HTML file so it can be played offline,
// hosted on any static server, or opened directly from disk.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false,
  },
});
