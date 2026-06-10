import { describe, expect, it, vi } from 'vitest';

import {
  buildAnswerEvaluationTask,
  enqueueAnswerEvaluationTaskBestEffort,
} from './answer-evaluation-task-enqueue';
import { applyUserReply, initializeInterviewSession } from './interview-state-machine';
import type { AnswerEvaluationTask } from './answer-evaluation-schemas';

const NOW = '2026-06-07T00:00:00.000Z';

function buildStateBeforeAnswer() {
  return initializeInterviewSession({
    threadId: 'thread-async-evaluation',
    rawKickoffMessage: [
      'Selected interview direction: Backend Engineer',
      'Professional question mode: custom-count',
      'Professional question count: 1',
      'Project question count: 0',
      'Skip project-experience round: yes',
    ].join('\n'),
    professionalSkills: 'Spring',
    projectExperience: '',
    normalizedProfessionalSkills: ['Spring'],
    normalizedProjectTopics: [],
    jobDescription: '需要 Spring 事务经验',
    professionalQuestions: [
      {
        id: 'spring-question-1',
        text: '请说明 Spring 事务传播机制以及异常回滚边界。',
        answer: ['说明 REQUIRED 和 REQUIRES_NEW 等传播行为', '补充 checked/unchecked exception 回滚差异'].join('\n'),
        skillArea: ['spring'],
      },
    ],
    projectQuestions: [],
  });
}

function buildDirectEvaluation() {
  return {
    classification: 'direct-answer' as const,
    score: {
      relevance: 8,
      accuracy: 8,
      depth: 7,
      specificity: 7,
      clarity: 8,
      weightedTotal: 7.65,
    },
    strengths: ['回答围绕 Spring 事务展开'],
    missingPoints: ['异常回滚边界还不够完整'],
    incorrectPoints: [],
    recommendedIntent: 'depth' as const,
    followUpFocus: ['异常回滚边界'],
    followUpQuestion: null,
    detourReply: null,
    clarificationReply: null,
    shouldCompleteNode: false,
    earlyCompletionReason: null,
  };
}

describe('answer evaluation task enqueue', () => {
  it('builds a task snapshot from the newly recorded answer attempt', () => {
    const beforeState = buildStateBeforeAnswer();
    const userMessage = '我会说明 REQUIRED 和 REQUIRES_NEW 的区别，并补充异常回滚边界。';
    const result = applyUserReply({
      state: beforeState,
      userMessage,
      evaluation: buildDirectEvaluation(),
    });

    const task = buildAnswerEvaluationTask({
      beforeState,
      afterState: result.state,
      userMessage,
      resourceId: 'resource-1',
      now: () => NOW,
      createTaskId: (attempt) => `task-${attempt.id}`,
    });

    expect(task).toMatchObject({
      schemaVersion: 1,
      interviewId: 'thread-async-evaluation',
      threadId: 'thread-async-evaluation',
      resourceId: 'resource-1',
      roundType: 'professional-skills',
      targetType: 'main-question',
      targetRole: 'Backend Engineer',
      question: '请说明 Spring 事务传播机制以及异常回滚边界。',
      mainQuestion: '请说明 Spring 事务传播机制以及异常回滚边界。',
      referenceAnswer: expect.stringContaining('REQUIRED'),
      evaluationPoints: [
        '说明 REQUIRED 和 REQUIRES_NEW 等传播行为',
        '补充 checked/unchecked exception 回滚差异',
      ],
      candidateAnswer: userMessage,
      createdAt: NOW,
    });
    expect(task?.attemptId).toMatch(/^answer-attempt-/);
    expect(task?.taskId).toBe(`task-${task?.attemptId}`);
    expect(task?.nodeConversation.at(-1)).toMatchObject({
      role: 'candidate',
      targetType: 'main-question',
      text: userMessage,
    });
  });

  it('does not build a task for non-scored detour or control attempts', () => {
    const beforeState = buildStateBeforeAnswer();
    const userMessage = '这题为什么这么问？';
    const result = applyUserReply({
      state: beforeState,
      userMessage,
      evaluation: {
        ...buildDirectEvaluation(),
        classification: 'meta-question',
        score: null,
        strengths: [],
        missingPoints: [],
        incorrectPoints: [],
      },
    });

    expect(
      buildAnswerEvaluationTask({
        beforeState,
        afterState: result.state,
        userMessage,
      }),
    ).toBeNull();
  });

  it('enqueues the task through the injected store', async () => {
    const beforeState = buildStateBeforeAnswer();
    const userMessage = '我会说明 REQUIRED 和 REQUIRES_NEW 的区别，并补充异常回滚边界。';
    const result = applyUserReply({
      state: beforeState,
      userMessage,
      evaluation: buildDirectEvaluation(),
    });
    const enqueuedTasks: AnswerEvaluationTask[] = [];

    const task = await enqueueAnswerEvaluationTaskBestEffort(
      {
        beforeState,
        afterState: result.state,
        userMessage,
        now: () => NOW,
      },
      {
        store: {
          enqueueTask: async (value) => {
            enqueuedTasks.push(value);
          },
        },
      },
    );

    expect(task?.taskId).toBe(enqueuedTasks[0]?.taskId);
    expect(enqueuedTasks).toHaveLength(1);
  });

  it('keeps the main flow safe when the injected store fails', async () => {
    const beforeState = buildStateBeforeAnswer();
    const userMessage = '我会说明 REQUIRED 和 REQUIRES_NEW 的区别，并补充异常回滚边界。';
    const result = applyUserReply({
      state: beforeState,
      userMessage,
      evaluation: buildDirectEvaluation(),
    });
    const logger = {
      warn: vi.fn(),
    };

    const task = await enqueueAnswerEvaluationTaskBestEffort(
      {
        beforeState,
        afterState: result.state,
        userMessage,
        now: () => NOW,
      },
      {
        logger,
        store: {
          enqueueTask: async () => {
            throw new Error('Redis unavailable');
          },
        },
      },
    );

    expect(task?.candidateAnswer).toBe(userMessage);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to enqueue answer evaluation task',
      expect.objectContaining({
        event: 'answer_evaluation.task.enqueue_failed',
      }),
    );
  });
});
