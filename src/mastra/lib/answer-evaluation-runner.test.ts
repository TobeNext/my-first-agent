import { describe, expect, it } from 'vitest';

import {
  AnswerEvaluationRunner,
  buildAnswerEvaluationTaskPrompt,
  calculateAnswerWeightedTotal,
} from './answer-evaluation-runner';
import type {
  AnswerEvaluationTask,
  AnswerEvaluationTaskStatus,
  InterviewEvaluationManifest,
  LlmAnswerEvaluationResult,
} from './answer-evaluation-schemas';
import type { AnswerEvaluationStore } from './redis-evaluation-store';

const NOW = '2026-06-07T00:00:00.000Z';

function buildTask(overrides: Partial<AnswerEvaluationTask> = {}): AnswerEvaluationTask {
  return {
    schemaVersion: 1,
    taskId: 'task-1',
    interviewId: 'interview-1',
    threadId: 'thread-1',
    nodeId: 'node-1',
    roundId: 'round-1',
    roundType: 'professional-skills',
    attemptId: 'attempt-1',
    targetType: 'main-question',
    targetId: 'node-1',
    targetRole: 'Backend Engineer',
    responseLanguage: 'zh',
    question: '请说明 Spring 事务传播机制。',
    mainQuestion: '请说明 Spring 事务传播机制。',
    referenceAnswer: '说明 REQUIRED 和 REQUIRES_NEW；补充异常回滚边界。',
    evaluationPoints: ['说明 REQUIRED 和 REQUIRES_NEW', '补充异常回滚边界'],
    candidateAnswer: '我会说明 REQUIRED 和 REQUIRES_NEW 的区别。',
    nodeConversation: [],
    createdAt: NOW,
    ...overrides,
  };
}

class FakeAnswerEvaluationStore implements AnswerEvaluationStore {
  readonly statuses: string[] = [];
  readonly failedTaskIds: string[] = [];
  result: LlmAnswerEvaluationResult | null = null;
  status: AnswerEvaluationTaskStatus | null = null;
  manifest: InterviewEvaluationManifest | null = null;

  constructor(private task: AnswerEvaluationTask | null) {
    if (task) {
      this.status = {
        schemaVersion: 1,
        taskId: task.taskId,
        interviewId: task.interviewId,
        attemptId: task.attemptId,
        status: 'pending',
        attempts: 0,
        createdAt: NOW,
      };
      this.manifest = {
        schemaVersion: 1,
        interviewId: task.interviewId,
        threadId: task.threadId,
        expectedTaskIds: [task.taskId],
        completedTaskIds: [],
        failedTaskIds: [],
        sealed: false,
        updatedAt: NOW,
      };
    }
  }

  async enqueueTask(): Promise<void> {}

  async claimNextTask(): Promise<AnswerEvaluationTask | null> {
    const task = this.task;
    this.task = null;
    if (task) {
      await this.markRunning(task.taskId);
    }
    return task;
  }

  async markRunning(taskId: string): Promise<void> {
    if (this.status) {
      this.status = {
        ...this.status,
        taskId,
        status: 'running',
        attempts: this.status.attempts + 1,
        startedAt: NOW,
      };
    }
    this.statuses.push('running');
  }

  async markSucceeded(result: LlmAnswerEvaluationResult): Promise<void> {
    this.result = result;
    if (this.status) {
      this.status = {
        ...this.status,
        status: 'succeeded',
        completedAt: NOW,
        lastError: undefined,
      };
    }
    if (this.manifest) {
      this.manifest = {
        ...this.manifest,
        completedTaskIds: [...new Set([...this.manifest.completedTaskIds, result.taskId])],
        failedTaskIds: this.manifest.failedTaskIds.filter((taskId) => taskId !== result.taskId),
      };
    }
    this.statuses.push('succeeded');
  }

  async markFailed(taskId: string, error: string): Promise<void> {
    if (this.status) {
      this.status = {
        ...this.status,
        status: 'failed',
        completedAt: NOW,
        lastError: error,
      };
    }
    if (this.manifest) {
      this.manifest = {
        ...this.manifest,
        failedTaskIds: [...new Set([...this.manifest.failedTaskIds, taskId])],
        completedTaskIds: this.manifest.completedTaskIds.filter((completedTaskId) => completedTaskId !== taskId),
      };
    }
    this.failedTaskIds.push(taskId);
    this.statuses.push('failed');
  }

  async retryTask(_taskId: string, error?: string): Promise<void> {
    if (this.status) {
      this.status = {
        ...this.status,
        status: 'pending',
        lastError: error ?? this.status.lastError,
      };
    }
    this.task = buildTask();
    this.statuses.push('retrying');
  }

  async sealInterview(): Promise<void> {}
  async readTask(): Promise<AnswerEvaluationTask | null> {
    return null;
  }
  async readTaskStatus(): Promise<AnswerEvaluationTaskStatus | null> {
    return this.status;
  }
  async readManifest(): Promise<InterviewEvaluationManifest | null> {
    return this.manifest;
  }
  async readResults(): Promise<LlmAnswerEvaluationResult[]> {
    return this.result ? [this.result] : [];
  }
}

describe('AnswerEvaluationRunner', () => {
  it('builds prompts with the reference answer for evaluator-only context', () => {
    const prompt = buildAnswerEvaluationTaskPrompt(buildTask());

    expect(prompt).toContain('Reference answer:');
    expect(prompt).toContain('说明 REQUIRED 和 REQUIRES_NEW；补充异常回滚边界。');
    expect(prompt).toContain('Candidate answer:');
  });

  it('computes the fixed weighted total formula', () => {
    expect(
      calculateAnswerWeightedTotal({
        relevance: 8,
        accuracy: 7,
        depth: 6,
        specificity: 5,
        clarity: 9,
      }),
    ).toBe(6.9);
  });

  it('claims a task, evaluates it, writes result, and marks success', async () => {
    const store = new FakeAnswerEvaluationStore(buildTask());
    const seenPrompts: string[] = [];
    const runner = new AnswerEvaluationRunner({
      store,
      now: () => NOW,
      evaluatorModel: 'mock-model',
      evaluator: async (prompt) => {
        seenPrompts.push(prompt);
        return {
          classification: 'direct-answer',
          score: {
            relevance: 8,
            accuracy: 7,
            depth: 6,
            specificity: 5,
            clarity: 9,
          },
          strengths: ['覆盖了核心传播类型'],
          missingPoints: ['异常回滚边界还不够完整'],
          incorrectPoints: [],
          shouldAskFollowUp: true,
          followUpFocus: ['异常回滚边界'],
        };
      },
    });

    await runner.runOnce();

    expect(store.statuses).toEqual(['running', 'succeeded']);
    expect(seenPrompts[0]).toContain('说明 REQUIRED 和 REQUIRES_NEW；补充异常回滚边界。');
    expect(store.result).toMatchObject({
      taskId: 'task-1',
      evaluatorModel: 'mock-model',
      promptVersion: 'answer-evaluation-v1',
      score: {
        weightedTotal: 6.9,
      },
    });
    expect(JSON.stringify(store.result)).not.toContain('说明 REQUIRED 和 REQUIRES_NEW；补充异常回滚边界。');
  });

  it('requeues failed evaluations until a later attempt succeeds', async () => {
    const store = new FakeAnswerEvaluationStore(buildTask());
    let calls = 0;
    const runner = new AnswerEvaluationRunner({
      store,
      now: () => NOW,
      evaluatorModel: 'mock-model',
      evaluator: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('temporary model failure');
        }

        return {
          classification: 'partial-answer',
          score: {
            relevance: 8,
            accuracy: 7,
            depth: 6,
            specificity: 5,
            clarity: 9,
          },
          strengths: ['覆盖了核心传播类型'],
          missingPoints: ['异常回滚边界还不够完整'],
          incorrectPoints: [],
          shouldAskFollowUp: true,
          followUpFocus: ['异常回滚边界'],
        };
      },
    });

    await expect(runner.runOnce()).resolves.toMatchObject({
      processed: true,
      status: 'retrying',
      attempts: 1,
      error: 'temporary model failure',
    });
    await expect(runner.runOnce()).resolves.toMatchObject({
      processed: true,
      status: 'retrying',
      attempts: 2,
    });
    await expect(runner.runOnce()).resolves.toMatchObject({
      processed: true,
      status: 'succeeded',
    });

    expect(store.statuses).toEqual(['running', 'retrying', 'running', 'retrying', 'running', 'succeeded']);
    expect(store.status).toMatchObject({
      status: 'succeeded',
      attempts: 3,
    });
    expect(store.manifest).toMatchObject({
      completedTaskIds: ['task-1'],
      failedTaskIds: [],
    });
  });

  it('marks a task failed after the maximum evaluator failures', async () => {
    const store = new FakeAnswerEvaluationStore(buildTask());
    const runner = new AnswerEvaluationRunner({
      store,
      maxAttempts: 3,
      evaluator: async () => {
        throw new Error('model returned invalid JSON');
      },
    });

    await runner.runOnce();
    await runner.runOnce();
    await expect(runner.runOnce()).resolves.toMatchObject({
      processed: true,
      taskId: 'task-1',
      status: 'failed',
      attempts: 3,
      error: 'model returned invalid JSON',
    });

    expect(store.status).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'model returned invalid JSON',
    });
    expect(store.manifest).toMatchObject({
      completedTaskIds: [],
      failedTaskIds: ['task-1'],
    });
  });

  it('does nothing when no task is available', async () => {
    const store = new FakeAnswerEvaluationStore(null);
    const runner = new AnswerEvaluationRunner({ store });

    await expect(runner.runOnce()).resolves.toEqual({ processed: false });
    expect(store.statuses).toEqual([]);
  });
});
