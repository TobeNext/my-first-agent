import { describe, expect, it } from 'vitest';

import { buildInterviewFeedbackPayload } from '../frontend/src/schemas/interview-feedback';
import { buildInterviewSystemSettings } from '../frontend/src/schemas/interview-setup';
import { submitInterviewFeedbackViaBff } from '../frontend/src/services/bff-api';

import { STANDARD_INTERVIEW_FIXTURE } from './support/interview-e2e-fixtures';
import { withBffRelativeApiBase } from './support/interview-e2e-client';
import { assertInterviewE2eEnvironmentReady } from './support/interview-e2e-environment';
import { startInterviewSession } from './support/interview-e2e-flow';
import { readInterviewOutcomeArtifacts } from './support/interview-outcome-artifacts';

describe('interview E2E feedback submission', () => {
  it('submits interview feedback against a live persisted interview outcome file', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-feedback-${Date.now()}`;
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-project-experience',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });

    const startResult = await startInterviewSession({
      threadId,
      fixture: STANDARD_INTERVIEW_FIXTURE,
      settings,
    });

    expect(startResult.interviewState).not.toBeNull();

    const feedbackPayload = buildInterviewFeedbackPayload({
      threadId,
      overallExperienceScore: 5,
      questionFitScore: 4,
      difficultyScore: 4,
      comment: '题目贴近岗位，反馈链路已经打通。',
    });

    const feedbackResult = await withBffRelativeApiBase(() => submitInterviewFeedbackViaBff(feedbackPayload));

    expect(feedbackResult.success).toBe(true);
    expect(feedbackResult.savedAt).toBeTruthy();

    const { outcomeRecord } = await readInterviewOutcomeArtifacts(threadId);

    expect(outcomeRecord.candidateImprovement?.feedback?.status).toBe('submitted');
    expect(outcomeRecord.candidateImprovement?.feedback?.submittedAt).toBe(feedbackResult.savedAt);
    expect(outcomeRecord.candidateImprovement?.feedback?.overallExperienceScore).toBe(5);
    expect(outcomeRecord.candidateImprovement?.feedback?.questionFitScore).toBe(4);
    expect(outcomeRecord.candidateImprovement?.feedback?.difficultyScore).toBe(4);
    expect(outcomeRecord.candidateImprovement?.feedback?.comment).toBe('题目贴近岗位，反馈链路已经打通。');
  });
});