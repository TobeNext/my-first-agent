import type { InterviewStateSnapshot } from '@/types/agent';

import type { PersistedInterviewSession } from './interview-session-storage';

export function canRestorePersistedInterviewSession(session: PersistedInterviewSession | null): boolean {
  return session !== null && !session.summary.finalReportReady;
}

export function getInterviewSessionRecoveryTitle(session: PersistedInterviewSession | null): string {
  if (canRestorePersistedInterviewSession(session)) {
    return '检测到上次未完成的面试会话';
  }

  return '检测到上次已完成的面试记录';
}

export function formatInterviewSessionRecoverySummary(session: PersistedInterviewSession): string {
  const updatedAtLabel = new Date(session.updatedAt).toLocaleString('zh-CN', {
    hour12: false,
  });
  const progressSummary = session.summary.finalReportReady
    ? '这场面试已经完成，可以清理本地记录后重新开始新的面试。'
    : `上次停留在第 ${session.summary.currentQuestionIndex ?? '?'} 题${
        session.summary.currentStage === 'follow-up' ? '的追问阶段' : '的主问题阶段'
      }，还剩 ${session.summary.remainingQuestionCount} 道题。`;
  const questionSummary = session.summary.currentQuestionText
    ? `当前问题：${session.summary.currentQuestionText}`
    : `最近一条面试官提示：${session.summary.assistantReply}`;

  return `最近更新于 ${updatedAtLabel}。${progressSummary} ${questionSummary}`;
}

export function buildRestoredInterviewState(session: PersistedInterviewSession): InterviewStateSnapshot {
  return {
    assistantReply: session.summary.assistantReply,
    flowTestMockUserReply: null,
    phase: session.summary.phase,
    activeRoundType: session.summary.activeRoundType,
    activeNodeTopic: null,
    finalReportReady: session.summary.finalReportReady,
    progress: {
      totalQuestionCount: session.summary.totalQuestionCount,
      completedQuestionCount: session.summary.completedQuestionCount,
      remainingQuestionCount: session.summary.remainingQuestionCount,
      currentQuestionIndex: session.summary.currentQuestionIndex,
      currentRoundType: session.summary.currentRoundType,
      currentRoundLabel:
        session.summary.currentRoundType === 'professional-skills'
          ? '专业技能面试'
          : session.summary.currentRoundType === 'project-experience'
            ? '项目经历面试'
            : null,
      currentStage: session.summary.currentStage,
      currentFollowUpIndex: session.summary.currentFollowUpIndex,
      currentQuestionText: session.summary.currentQuestionText,
      currentNodeTopic: null,
    },
  };
}

export function isInvalidRecoveredSessionError(messageText: string): boolean {
  const normalizedMessage = messageText.toLowerCase();
  return normalizedMessage.includes('thread') && (normalizedMessage.includes('not found') || normalizedMessage.includes('missing'));
}
