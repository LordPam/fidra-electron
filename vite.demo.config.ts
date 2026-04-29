import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'gh-pages/demo',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'demo.html'),
    },
  },
});
