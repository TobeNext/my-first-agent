import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/services/bff-api.ts',
        'src/services/http-error.ts',
        'src/services/interview-progress-display.ts',
        'src/services/interview-start-request.ts',
        'src/services/resume-validation.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});