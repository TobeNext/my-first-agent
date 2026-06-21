import { describe, expect, it } from 'vitest';

import type { PersistedInterviewSession } from './interview-session-storage';

import {
  buildRestoredInterviewState,
  canRestorePersistedInterviewSession,
  formatInterviewSessionRecoverySummary,
  getInterviewSessionRecoveryTitle,
  isInvalidRecoveredSessionError,
} from './interview-session-recovery';

const baseSession: PersistedInterviewSession = {
  threadId: 'thread-1',
  settings: {
    reviewIncorrectOrMissingPoints: true,
    skipProfessionalSkillsRound: false,
    skipProjectExperienceRound: false,
    enableFlowTestMode: false,
    enableHistoricalMemory: true,
    professionalQuestionMode: 'per-skill-default',
    professionalQuestionCount: 2,
    projectQuestionCount: 2,
  },
  summary: {
    phase: 'professional-skills-round',
    activeRoundType: 'professional-skills',
    finalReportReady: false,
    totalQuestionCount: 4,
    completedQuestionCount: 1,
    currentStage: 'follow-up',
    currentQuestionIndex: 2,
    currentRoundType: 'professional-skills',
    currentFollowUpIndex: 1,
    remainingQuestionCount: 3,
    currentQuestionText: '请继续说明你如何做性能排查。',
    assistantReply: '请继续说明你如何做性能排查。',
  },
  updatedAt: '2026-05-17T10:30:00.000Z',
};

describe('interview-session-recovery', () => {
  it('identifies whether a persisted session can still be restored', () => {
    expect(canRestorePersistedInterviewSession(baseSession)).toBe(true);
    expect(
      canRestorePersistedInterviewSession({
        ...baseSession,
        summary: {
          ...baseSession.summary,
          finalReportReady: true,
        },
      }),
    ).toBe(false);
    expect(canRestorePersistedInterviewSession(null)).toBe(false);
  });

  it('formats different titles for active and completed persisted sessions', () => {
    expect(getInterviewSessionRecoveryTitle(baseSession)).toBe('检测到上次未完成的面试会话');
    expect(
      getInterviewSessionRecoveryTitle({
        ...baseSession,
        summary: {
          ...baseSession.summary,
          finalReportReady: true,
        },
      }),
    ).toBe('检测到上次已完成的面试记录');
  });

  it('formats the recovery summary for in-progress and completed sessions', () => {
    expect(formatInterviewSessionRecoverySummary(baseSession)).toContain('上次停留在第 2 题的追问阶段，还剩 3 道题。');
    expect(formatInterviewSessionRecoverySummary(baseSession)).toContain('当前问题：请继续说明你如何做性能排查。');

    expect(
      formatInterviewSessionRecoverySummary({
        ...baseSession,
        summary: {
          ...baseSession.summary,
          finalReportReady: true,
          currentQuestionText: null,
        },
      }),
    ).toContain('这场面试已经完成，可以清理本地记录后重新开始新的面试。');
  });

  it('rebuilds a minimal interview state snapshot for UI restoration', () => {
    expect(buildRestoredInterviewState(baseSession)).toEqual({
      assistantReply: '请继续说明你如何做性能排查。',
      flowTestMockUserReply: null,
      phase: 'professional-skills-round',
      activeRoundType: 'professional-skills',
      activeNodeTopic: null,
      finalReportReady: false,
      progress: {
        totalQuestionCount: 4,
        completedQuestionCount: 1,
        remainingQuestionCount: 3,
        currentQuestionIndex: 2,
        currentRoundType: 'professional-skills',
        currentRoundLabel: '专业技能面试',
        currentStage: 'follow-up',
        currentFollowUpIndex: 1,
        currentQuestionText: '请继续说明你如何做性能排查。',
        currentNodeTopic: null,
      },
    });
  });

  it('only treats missing-thread style errors as invalid recovered sessions', () => {
    expect(isInvalidRecoveredSessionError('thread not found')).toBe(true);
    expect(isInvalidRecoveredSessionError('missing thread state')).toBe(true);
    expect(isInvalidRecoveredSessionError('network timeout')).toBe(false);
  });
});
