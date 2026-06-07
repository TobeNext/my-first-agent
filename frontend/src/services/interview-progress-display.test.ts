import { describe, expect, it } from 'vitest';

import {
  formatCurrentQuestion,
  formatCurrentStage,
  formatRemainingQuestions,
} from './interview-progress-display';

describe('interview-progress-display', () => {
  it('renders the pre-start placeholders when progress is missing', () => {
    expect(formatRemainingQuestions(null)).toBe('待开始');
    expect(formatCurrentQuestion(null)).toBe('面试开始后，这里会显示当前问题。');
    expect(
      formatCurrentStage({
        progress: null,
        interviewState: null,
      }),
    ).toBe('当前阶段会在面试开始后显示。');
  });

  it('renders the follow-up stage for the professional round', () => {
    expect(
      formatCurrentStage({
        progress: {
          totalQuestionCount: 6,
          completedQuestionCount: 2,
          remainingQuestionCount: 4,
          currentQuestionIndex: 3,
          currentRoundType: 'professional-skills',
          currentRoundLabel: '专业技能面试',
          currentStage: 'follow-up',
          currentFollowUpIndex: 2,
          currentQuestionText: '请说明你的 RAG 设计。',
          currentNodeTopic: 'RAG',
        },
        interviewState: null,
      }),
    ).toBe('当前在专业技能面试的第3题第2轮追问环节。');
  });

  it('renders the remaining count and current question text when progress is available', () => {
    const progress = {
      totalQuestionCount: 6,
      completedQuestionCount: 2,
      remainingQuestionCount: 4,
      currentQuestionIndex: 3,
      currentRoundType: 'professional-skills' as const,
      currentRoundLabel: '专业技能面试',
      currentStage: 'main-question' as const,
      currentFollowUpIndex: null,
      currentQuestionText: '请解释你的状态机设计。',
      currentNodeTopic: '状态机',
    };

    expect(formatRemainingQuestions(progress)).toBe('还剩4个问题');
    expect(formatCurrentQuestion(progress)).toBe('请解释你的状态机设计。');
  });

  it('falls back to a generic follow-up label when the follow-up index is missing', () => {
    expect(
      formatCurrentStage({
        progress: {
          totalQuestionCount: 6,
          completedQuestionCount: 2,
          remainingQuestionCount: 4,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'follow-up',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
        interviewState: null,
      }),
    ).toBe('当前在模拟面试的当前题目追问环节。');
  });

  it('renders the main-question stage for the project round', () => {
    expect(
      formatCurrentStage({
        progress: {
          totalQuestionCount: 6,
          completedQuestionCount: 4,
          remainingQuestionCount: 2,
          currentQuestionIndex: 5,
          currentRoundType: 'project-experience',
          currentRoundLabel: '项目经历面试',
          currentStage: 'main-question',
          currentFollowUpIndex: null,
          currentQuestionText: '介绍一个你主导的项目。',
          currentNodeTopic: '项目经历',
        },
        interviewState: null,
      }),
    ).toBe('当前在项目经历面试的第5题主问题回答环节。');
  });

  it('switches to the report stage when the interview is complete', () => {
    expect(
      formatCurrentStage({
        progress: {
          totalQuestionCount: 6,
          completedQuestionCount: 6,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
        interviewState: {
          assistantReply: '报告已生成。',
          flowTestMockUserReply: null,
          phase: 'completed',
          activeRoundType: null,
          activeNodeTopic: null,
          finalReportReady: true,
          progress: {
            totalQuestionCount: 6,
            completedQuestionCount: 6,
            remainingQuestionCount: 0,
            currentQuestionIndex: null,
            currentRoundType: null,
            currentRoundLabel: null,
            currentStage: 'completed',
            currentFollowUpIndex: null,
            currentQuestionText: null,
            currentNodeTopic: null,
          },
        },
      }),
    ).toBe('当前处于面试总结与报告生成阶段。');
  });
});