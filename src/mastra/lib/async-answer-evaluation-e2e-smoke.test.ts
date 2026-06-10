import { describe, expect, it } from 'vitest';

import { AnswerEvaluationRunner } from './answer-evaluation-runner';
import type {
  AnswerEvaluationTask,
  AnswerEvaluationTaskStatus,
  InterviewEvaluationManifest,
  LlmAnswerEvaluationResult,
} from './answer-evaluation-schemas';
import { buildAnswerEvaluationTask } from './answer-evaluation-task-enqueue';
import {
  applyUserReply,
  buildFinalInterviewStateFromEvaluations,
  initializeInterviewSession,
} from './interview-state-machine';
import type { AnswerEvaluationStore } from './redis-evaluation-store';
import { waitAndReadInterviewEvaluations } from '../tools/interview-evaluation-report-tool';

const NOW = '2026-06-09T00:00:00.000Z';

class InMemoryAnswerEvaluationStore implements AnswerEvaluationStore {
  readonly tasks = new Map<string, AnswerEvaluationTask>();
  readonly statuses = new Map<string, AnswerEvaluationTaskStatus>();
  readonly results = new Map<string, LlmAnswerEvaluationResult>();
  readonly manifests = new Map<string, InterviewEvaluationManifest>();
  readonly pendingTaskIds: string[] = [];

  async enqueueTask(task: AnswerEvaluationTask): Promise<void> {
    this.tasks.set(task.taskId, task);
    this.statuses.set(task.taskId, {
      schemaVersion: 1,
      taskId: task.taskId,
      interviewId: task.interviewId,
      attemptId: task.attemptId,
      status: 'pending',
      attempts: 0,
      createdAt: NOW,
    });
    const manifest = this.manifests.get(task.interviewId) ?? {
      schemaVersion: 1,
      interviewId: task.interviewId,
      threadId: task.threadId,
      expectedTaskIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      sealed: false,
      updatedAt: NOW,
    };

    this.manifests.set(task.interviewId, {
      ...manifest,
      expectedTaskIds: [...new Set([...manifest.expectedTaskIds, task.taskId])],
      updatedAt: NOW,
    });
    this.pendingTaskIds.push(task.taskId);
  }

  async claimNextTask(): Promise<AnswerEvaluationTask | null> {
    const taskId = this.pendingTaskIds.shift();
    if (!taskId) {
      return null;
    }

    await this.markRunning(taskId);
    return this.tasks.get(taskId) ?? null;
  }

  async markRunning(taskId: string): Promise<void> {
    const status = this.statuses.get(taskId);
    if (!status) {
      throw new Error(`Missing status for ${taskId}`);
    }

    this.statuses.set(taskId, {
      ...status,
      status: 'running',
      attempts: status.attempts + 1,
      startedAt: NOW,
    });
  }

  async markSucceeded(result: LlmAnswerEvaluationResult): Promise<void> {
    this.results.set(result.taskId, result);
    const status = this.statuses.get(result.taskId);
    if (status) {
      this.statuses.set(result.taskId, {
        ...status,
        status: 'succeeded',
        completedAt: NOW,
      });
    }

    const manifest = this.manifests.get(result.interviewId);
    if (manifest) {
      this.manifests.set(result.interviewId, {
        ...manifest,
        completedTaskIds: [...new Set([...manifest.completedTaskIds, result.taskId])],
        failedTaskIds: manifest.failedTaskIds.filter((taskId) => taskId !== result.taskId),
        updatedAt: NOW,
      });
    }
  }

  async markFailed(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const status = this.statuses.get(taskId);
    if (!task || !status) {
      throw new Error(`Missing task ${taskId}`);
    }

    this.statuses.set(taskId, {
      ...status,
      status: 'failed',
      completedAt: NOW,
      lastError: error,
    });
    const manifest = this.manifests.get(task.interviewId);
    if (manifest) {
      this.manifests.set(task.interviewId, {
        ...manifest,
        failedTaskIds: [...new Set([...manifest.failedTaskIds, taskId])],
        completedTaskIds: manifest.completedTaskIds.filter((completedTaskId) => completedTaskId !== taskId),
        updatedAt: NOW,
      });
    }
  }

  async retryTask(taskId: string): Promise<void> {
    this.pendingTaskIds.push(taskId);
  }

  async sealInterview(interviewId: string): Promise<void> {
    const manifest = this.manifests.get(interviewId);
    if (!manifest) {
      throw new Error(`Missing manifest for ${interviewId}`);
    }

    this.manifests.set(interviewId, {
      ...manifest,
      sealed: true,
      sealedAt: NOW,
      updatedAt: NOW,
    });
  }

  async readTask(taskId: string): Promise<AnswerEvaluationTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async readTaskStatus(taskId: string): Promise<AnswerEvaluationTaskStatus | null> {
    return this.statuses.get(taskId) ?? null;
  }

  async readManifest(interviewId: string): Promise<InterviewEvaluationManifest | null> {
    return this.manifests.get(interviewId) ?? null;
  }

  async readResults(interviewId: string): Promise<LlmAnswerEvaluationResult[]> {
    const manifest = this.manifests.get(interviewId);
    return (manifest?.expectedTaskIds ?? [])
      .map((taskId) => this.results.get(taskId) ?? null)
      .filter((result): result is LlmAnswerEvaluationResult => result !== null);
  }
}

function buildDirectEvaluation() {
  return {
    classification: 'direct-answer' as const,
    score: {
      relevance: 8,
      accuracy: 8,
      depth: 8,
      specificity: 8,
      clarity: 8,
      weightedTotal: 8,
    },
    strengths: ['规则评分亮点'],
    missingPoints: [],
    incorrectPoints: [],
    recommendedIntent: 'depth' as const,
    followUpFocus: ['事务边界'],
    followUpQuestion: null,
    detourReply: null,
    clarificationReply: null,
    shouldCompleteNode: true,
    earlyCompletionReason: null,
  };
}

describe('async answer evaluation smoke', () => {
  it('uses worker-written LLM evaluations when building the final report dataset', async () => {
    let state = initializeInterviewSession({
      threadId: 'thread-async-smoke',
      rawKickoffMessage: [
        'Selected interview direction: Backend Engineer',
        'Professional question mode: custom-count',
        'Professional question count: 0',
        'Project question count: 1',
        'Skip professional-skills round: yes',
      ].join('\n'),
      professionalSkills: '',
      projectExperience: '支付项目：负责事务一致性。',
      normalizedProfessionalSkills: [],
      normalizedProjectTopics: ['支付事务一致性'],
      jobDescription: '需要可靠事务处理经验',
      professionalQuestions: [],
      projectQuestions: [
        {
          id: 'project-question-1',
          text: '请结合项目说明你如何保障事务一致性。',
          answer: '说明事务边界、失败恢复、幂等和补偿机制。',
          skillArea: ['transaction'],
        },
      ],
    });
    const store = new InMemoryAnswerEvaluationStore();
    const answers = [
      '我在支付项目中会先划定事务边界，并用幂等控制重复请求。',
      '后续我会补充失败恢复、补偿任务和告警监控，避免部分成功无人发现。',
    ];

    for (const answer of answers) {
      const beforeState = state;
      const result = applyUserReply({
        state,
        userMessage: answer,
        evaluation: buildDirectEvaluation(),
      });
      const task = buildAnswerEvaluationTask({
        beforeState,
        afterState: result.state,
        userMessage: answer,
        now: () => NOW,
      });

      if (task) {
        await store.enqueueTask(task);
      }

      state = result.state;
    }

    expect(state.finalReportReady).toBe(true);
    expect(store.pendingTaskIds).toHaveLength(2);

    const runner = new AnswerEvaluationRunner({
      store,
      now: () => NOW,
      evaluatorModel: 'mock-evaluator',
      evaluator: async () => ({
        classification: 'partial-answer',
        score: {
          relevance: 9,
          accuracy: 4,
          depth: 4,
          specificity: 4,
          clarity: 8,
        },
        strengths: ['LLM 认为回答覆盖了事务边界'],
        missingPoints: ['LLM missing: 补偿机制需要更具体'],
        incorrectPoints: [],
        shouldAskFollowUp: true,
        followUpFocus: ['补偿机制'],
      }),
    });

    await runner.runOnce();
    await runner.runOnce();
    await store.sealInterview(state.threadId);

    const waitResult = await waitAndReadInterviewEvaluations(
      {
        interviewId: state.threadId,
        threadId: state.threadId,
        pollIntervalMs: 1,
        maxWaitMs: 1,
      },
      { store, nowMs: () => 0 },
    );
    const finalState = buildFinalInterviewStateFromEvaluations(state, waitResult.evaluations);

    expect(waitResult.ready).toBe(true);
    expect(waitResult.evaluations).toHaveLength(2);
    expect(finalState.finalReportReady).toBe(true);
    expect(finalState.finalReport).toContain('LLM missing: 补偿机制需要更具体');
    expect(finalState.finalReport).not.toContain('说明事务边界、失败恢复、幂等和补偿机制。');
  });
});
