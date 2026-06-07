import { describe, expect, it } from 'vitest';

import {
  FLOW_TEST_SKIP_MARKER,
  NON_STANDARD_RESUME_FIXTURE,
  STANDARD_INTERVIEW_FIXTURE,
} from './support/interview-e2e-fixtures';
import {
  assertInterviewE2eEnvironmentReady,
  resolveInterviewE2eEnvironment,
} from './support/interview-e2e-environment';

describe('interview E2E harness', () => {
  it('resolves the default service targets and shared fixtures', async () => {
    const environment = resolveInterviewE2eEnvironment();

    expect(environment.frontend.url).toContain('localhost');
    expect(environment.bff.url).toContain('localhost');
    expect(environment.mastra.url).toContain('localhost');
    expect(STANDARD_INTERVIEW_FIXTURE.resumeMarkdown).toContain('### 专业技能');
    expect(STANDARD_INTERVIEW_FIXTURE.jobDescriptionMarkdown).toContain('### 岗位职责');
    expect(NON_STANDARD_RESUME_FIXTURE.resumeMarkdown).toContain('Professional Skills');
    expect(FLOW_TEST_SKIP_MARKER).toBe('[FLOW_TEST_SKIP]');

    await expect(assertInterviewE2eEnvironmentReady(environment)).resolves.toBeUndefined();
  });
});