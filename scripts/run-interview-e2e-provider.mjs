import { spawnSync } from 'node:child_process';

const [mode = 'smoke', provider = 'python'] = process.argv.slice(2);

if (!['smoke', 'complete', 'all'].includes(mode)) {
  throw new Error(`Unsupported E2E mode: ${mode}`);
}

if (!['mastra', 'python'].includes(provider)) {
  throw new Error(`Unsupported agent runtime provider: ${provider}`);
}

const suites = {
  smoke: ['e2e/interview-e2e-environment.test.ts', 'e2e/interview-start-happy-path.test.ts'],
  complete: ['e2e/interview-complete-flow.test.ts', 'e2e/interview-feedback-submission.test.ts'],
  all: [
    'e2e/interview-e2e-environment.test.ts',
    'e2e/interview-start-happy-path.test.ts',
    'e2e/interview-complete-flow.test.ts',
    'e2e/interview-edge-scenarios.test.ts',
    'e2e/interview-feedback-submission.test.ts',
  ],
};

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.e2e.config.ts', ...suites[mode]],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      AGENT_RUNTIME_PROVIDER: provider,
      INTERVIEW_E2E_AGENT_RUNTIME_PROVIDER: provider,
    },
  },
);

process.exit(result.status ?? 1);
