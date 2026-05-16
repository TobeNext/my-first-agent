import type { InterviewProgressSummary, InterviewStateSnapshot } from '@/types/agent';

export function formatRemainingQuestions(progress: InterviewProgressSummary | null): string {
  if (!progress) {
    return '待开始';
  }

  return `还剩${progress.remainingQuestionCount}个问题`;
}

export function formatCurrentQuestion(progress: InterviewProgressSummary | null): string {
  if (!progress?.currentQuestionText) {
    return '面试开始后，这里会显示当前问题。';
  }

  return progress.currentQuestionText;
}

export function formatCurrentStage(options: {
  readonly progress: InterviewProgressSummary | null;
  readonly interviewState: InterviewStateSnapshot | null;
}): string {
  const { progress, interviewState } = options;
  if (!progress) {
    return '当前阶段会在面试开始后显示。';
  }

  if (interviewState?.finalReportReady || progress.currentStage === 'completed') {
    return '当前处于面试总结与报告生成阶段。';
  }

  const roundLabel =
    progress.currentRoundType === 'professional-skills'
      ? '专业技能面试'
      : progress.currentRoundType === 'project-experience'
        ? '项目经历面试'
        : '模拟面试';
  const questionLabel = progress.currentQuestionIndex ? `第${progress.currentQuestionIndex}题` : '当前题目';

  if (progress.currentStage === 'follow-up') {
    const followUpLabel = progress.currentFollowUpIndex ? `第${progress.currentFollowUpIndex}轮追问` : '追问';
    return `当前在${roundLabel}的${questionLabel}${followUpLabel}环节。`;
  }

  return `当前在${roundLabel}的${questionLabel}主问题回答环节。`;
}