import { afterEach, describe, expect, it } from 'vitest';

import { streamChatWithAgent } from '../frontend/src/services/agent-stream';
import { validateResumeViaBff } from '../frontend/src/services/bff-api';
import { buildInterviewSystemSettings } from '../frontend/src/schemas/interview-setup';
import { createStartInterviewRequest } from '../frontend/src/services/interview-start-request';

import { STANDARD_INTERVIEW_FIXTURE } from './support/interview-e2e-fixtures';
import {
  createE2eMarkdownFile,
  withBffRelativeApiBase,
} from './support/interview-e2e-client';
import { assertInterviewE2eEnvironmentReady } from './support/interview-e2e-environment';

describe('interview E2E happy path', () => {
  afterEach(() => {
    expect(globalThis.fetch).toBeDefined();
  });

  it('covers resume upload and interview start through the live frontend-to-BFF-to-Mastra path', async () => {
    await assertInterviewE2eEnvironmentReady();

    const resumeFile = createE2eMarkdownFile('standard-resume.md', STANDARD_INTERVIEW_FIXTURE.resumeMarkdown);
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-project-experience',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });

    const validationResult = await withBffRelativeApiBase(() => validateResumeViaBff(resumeFile));

    expect(validationResult.success).toBe(true);
    if (!validationResult.success) {
      return;
    }

    const startResult = await withBffRelativeApiBase(() =>
      streamChatWithAgent({
        request: createStartInterviewRequest({
          threadId: `e2e-start-${Date.now()}`,
          resumeMarkdown: STANDARD_INTERVIEW_FIXTURE.resumeMarkdown,
          jobDescriptionMarkdown: STANDARD_INTERVIEW_FIXTURE.jobDescriptionMarkdown,
          settings,
        }),
      }),
    );

    expect(validationResult.professionalSkillGroupCount).toBeGreaterThan(0);
    expect(startResult.interviewState).not.toBeNull();
    expect(startResult.authoritativeAssistantReply).toBeTruthy();
    expect(startResult.interviewState?.progress.currentRoundType).toBe('professional-skills');
    expect(startResult.interviewState?.progress.currentQuestionIndex).toBe(1);
    expect(startResult.interviewState?.finalReportReady).toBe(false);
    expect(startResult.interviewState?.progress.totalQuestionCount).toBeGreaterThanOrEqual(1);
  });
});