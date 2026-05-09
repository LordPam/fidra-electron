import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'pg', '@vlcn.io/crsqlite', 'electron-updater'],
    },
  },
});
