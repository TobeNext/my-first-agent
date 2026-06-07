import { describe, expect, it } from 'vitest';

import { FLOW_TEST_SKIP_MARKER, streamChatWithAgent } from '../frontend/src/services/agent-stream';
import { validateResumeViaBff } from '../frontend/src/services/bff-api';
import { buildInterviewSystemSettings } from '../frontend/src/schemas/interview-setup';
import { createStartInterviewRequest } from '../frontend/src/services/interview-start-request';
import { buildPersistedInterviewSession } from '../frontend/src/services/interview-session-storage';
import {
  buildRestoredInterviewState,
  canRestorePersistedInterviewSession,
} from '../frontend/src/services/interview-session-recovery';

import {
  NON_STANDARD_RESUME_FIXTURE,
  STANDARD_INTERVIEW_FIXTURE,
} from './support/interview-e2e-fixtures';
import {
  createE2eMarkdownFile,
  withBffRelativeApiBase,
} from './support/interview-e2e-client';
import { assertInterviewE2eEnvironmentReady } from './support/interview-e2e-environment';
import { completeInterviewToFinalReport } from './support/interview-e2e-flow';
import { readInterviewOutcomeArtifacts } from './support/interview-outcome-artifacts';

async function startInterviewScenario(options: {
  readonly threadId: string;
  readonly resumeMarkdown: string;
  readonly jobDescriptionMarkdown: string;
  readonly settings: ReturnType<typeof buildInterviewSystemSettings>;
}) {
  return await withBffRelativeApiBase(() =>
    streamChatWithAgent({
      request: createStartInterviewRequest({
        threadId: options.threadId,
        resumeMarkdown: options.resumeMarkdown,
        jobDescriptionMarkdown: options.jobDescriptionMarkdown,
        settings: options.settings,
      }),
    }),
  );
}

describe('interview E2E edge scenarios', () => {
  it('returns structured validation errors for a non-standard resume sample', async () => {
    await assertInterviewE2eEnvironmentReady();

    const resumeFile = createE2eMarkdownFile(
      'non-standard-resume.md',
      NON_STANDARD_RESUME_FIXTURE.resumeMarkdown,
    );
    const validationResult = await withBffRelativeApiBase(() => validateResumeViaBff(resumeFile));

    expect(validationResult.success).toBe(false);
    if (validationResult.success) {
      return;
    }

    expect(validationResult.message).toBe('BFF 校验失败，请根据以下问题修改简历。');
    expect(validationResult.details).toEqual([
      '缺少章节：### 专业技能。',
      '缺少章节：### 项目经历。',
    ]);
  });

  it('persists the project-experience round as skipped when that round is disabled', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-skip-round-${Date.now()}`;
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-project-experience',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });
    const startResult = await startInterviewScenario({
      threadId,
      resumeMarkdown: STANDARD_INTERVIEW_FIXTURE.resumeMarkdown,
      jobDescriptionMarkdown: STANDARD_INTERVIEW_FIXTURE.jobDescriptionMarkdown,
      settings,
    });
    const { outcomeRecord } = await readInterviewOutcomeArtifacts(threadId);

    expect(startResult.interviewState?.progress.currentQuestionIndex).toBe(1);
    expect(outcomeRecord.candidateImprovement?.rounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'project-experience',
          status: 'skipped',
        }),
      ]),
    );
  });

  it('keeps advancing when flow-test mode sends the skip marker', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-flow-test-${Date.now()}`;
    const startResult = await startInterviewScenario({
      threadId,
      resumeMarkdown: STANDARD_INTERVIEW_FIXTURE.resumeMarkdown,
      jobDescriptionMarkdown: STANDARD_INTERVIEW_FIXTURE.jobDescriptionMarkdown,
      settings: buildInterviewSystemSettings({
        reviewIncorrectOrMissingPoints: true,
        roundPreference: 'skip-project-experience',
        enableFlowTestMode: true,
        professionalQuestionMode: 'custom-count',
        professionalQuestionCount: 1,
        projectQuestionCount: 1,
      }),
    });

    expect(startResult.interviewState?.finalReportReady).toBe(false);

    const skipResult = await withBffRelativeApiBase(() =>
      streamChatWithAgent({
        request: {
          threadId,
          message: FLOW_TEST_SKIP_MARKER,
        },
      }),
    );

    expect(skipResult.authoritativeAssistantReply).toBeTruthy();
    if (skipResult.interviewState) {
      expect(skipResult.interviewState.progress.currentStage).toMatch(/follow-up|completed/);
    }
  });

  it('continues the same thread after rebuilding a restored session snapshot', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-restore-${Date.now()}`;
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-project-experience',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });
    const startResult = await startInterviewScenario({
      threadId,
      resumeMarkdown: STANDARD_INTERVIEW_FIXTURE.resumeMarkdown,
      jobDescriptionMarkdown: STANDARD_INTERVIEW_FIXTURE.jobDescriptionMarkdown,
      settings,
    });

    expect(startResult.interviewState).not.toBeNull();
    if (!startResult.interviewState) {
      return;
    }

    const persistedSession = buildPersistedInterviewSession({
      threadId,
      settings,
      interviewState: startResult.interviewState,
    });
    const restoredState = buildRestoredInterviewState(persistedSession);

    expect(canRestorePersistedInterviewSession(persistedSession)).toBe(true);
    expect(restoredState.progress.currentQuestionIndex).toBe(
      startResult.interviewState.progress.currentQuestionIndex,
    );

    const continuedResult = await withBffRelativeApiBase(() =>
      streamChatWithAgent({
        request: {
          threadId,
          message: STANDARD_INTERVIEW_FIXTURE.candidateAnswers[0] ?? '我先说明整体方案。',
        },
      }),
    );

    expect(continuedResult.interviewState).not.toBeNull();
    expect(continuedResult.authoritativeAssistantReply).toBeTruthy();
  });
});