import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest previously ran on bare defaults, which meant no `@/` alias — so any
 * renderer module importing through it could not be tested at all. Mirrors the
 * alias in vite.renderer.config.ts.
 */
export default defineConfig({
  test: {
    // Native SQLite fixtures compete for the hosted Windows volume. Bound disk
    // concurrency instead of relaxing assertions or the five-second test limit.
    maxWorkers: process.env.CI && process.platform === 'win32' ? 2 : undefined,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
