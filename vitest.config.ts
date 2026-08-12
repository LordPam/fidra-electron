import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest previously ran on bare defaults, which meant no `@/` alias — so any
 * renderer module importing through it could not be tested at all. Mirrors the
 * alias in vite.renderer.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
