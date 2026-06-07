import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./frontend/src', import.meta.url)),
    },
  },
  test: {
    include: ['e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});