import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest previously ran on bare defaults, which meant no `@/` alias — so any
 * renderer module importing through it could not be tested at all. Mirrors the
 * alias in vite.renderer.config.ts.
 */
export default defineConfig({
  test: {
    // Native SQLite I/O and real key derivation compete on hosted runners. Match
    // the bounded concurrency used for local acceptance on both CI platforms.
    maxWorkers: process.env.CI ? 2 : undefined,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
