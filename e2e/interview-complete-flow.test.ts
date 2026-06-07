import { describe, expect, it } from 'vitest';

import { streamChatWithAgent } from '../frontend/src/services/agent-stream';
import { buildInterviewSystemSettings } from '../frontend/src/schemas/interview-setup';

import { STANDARD_INTERVIEW_FIXTURE } from './support/interview-e2e-fixtures';
import { assertInterviewE2eEnvironmentReady } from './support/interview-e2e-environment';
import { completeInterviewToFinalReport } from './support/interview-e2e-flow';
import { readInterviewOutcomeArtifacts } from './support/interview-outcome-artifacts';

describe('interview E2E completion flow', () => {
  it('covers continued answers until the interview reaches the final report stage', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-complete-${Date.now()}`;
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-professional-skills',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });

    const latestResult = await completeInterviewToFinalReport({
      threadId,
      fixture: STANDARD_INTERVIEW_FIXTURE,
      settings,
    });

    expect(latestResult.interviewState).not.toBeNull();
    expect(latestResult.interviewState?.finalReportReady).toBe(true);
    expect(latestResult.interviewState?.progress.currentStage).toBe('completed');
    expect(latestResult.authoritativeAssistantReply).toBeTruthy();
    expect(latestResult.authoritativeAssistantReply).toMatch(/报告|评价|总结|report/i);

    const { indexRecord, outcomeRecord } = await readInterviewOutcomeArtifacts(threadId);

    expect(indexRecord.threadId).toBe(threadId);
    expect(indexRecord.outcomeFilePath).toContain(threadId);
    expect(outcomeRecord.threadId).toBe(threadId);
    expect(outcomeRecord.session.finalReportReady).toBe(true);
    expect(outcomeRecord.candidateImprovement?.completedQuestionCount).toBeGreaterThanOrEqual(1);
    expect(outcomeRecord.candidateImprovement?.report?.finalReport).toMatch(/模拟面试报告|Interview/i);
  });
});