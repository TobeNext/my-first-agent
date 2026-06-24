import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/mastra/lib/**/*.test.ts',
      'src/mastra/tools/**/*.test.ts',
      'evals/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: [
        'src/mastra/lib/interview-kickoff-recovery.ts',
        'src/mastra/lib/interview-question-planner.ts',
        'src/mastra/lib/professional-question-query.ts',
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
