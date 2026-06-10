import { describe, expect, it } from 'vitest';

import {
  ANSWER_EVALUATION_PENDING_QUEUE_KEY,
  RedisAnswerEvaluationStore,
  type EvaluationRedisClient,
} from './redis-evaluation-store';
import type { AnswerEvaluationTask, LlmAnswerEvaluationResult } from './answer-evaluation-schemas';

class FakeRedisClient implements EvaluationRedisClient {
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return 'OK';
  }

  async rPush(key: string, value: string): Promise<unknown> {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async lPop(key: string): Promise<string | null> {
    const list = this.lists.get(key) ?? [];
    const value = list.shift() ?? null;
    this.lists.set(key, list);
    return value;
  }

  async sAdd(key: string, value: string): Promise<unknown> {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(value);
    this.sets.set(key, set);
    return set.size;
  }

  async sMembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }
}

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

function buildResult(overrides: Partial<LlmAnswerEvaluationResult> = {}): LlmAnswerEvaluationResult {
  return {
    schemaVersion: 1,
    taskId: 'task-1',
    interviewId: 'interview-1',
    threadId: 'thread-1',
    nodeId: 'node-1',
    roundId: 'round-1',
    roundType: 'professional-skills',
    attemptId: 'attempt-1',
    classification: 'direct-answer',
    score: {
      relevance: 8,
      accuracy: 8,
      depth: 7,
      specificity: 7,
      clarity: 8,
      weightedTotal: 7.65,
    },
    strengths: ['覆盖了事务传播机制'],
    missingPoints: ['异常回滚边界还不够完整'],
    incorrectPoints: [],
    shouldAskFollowUp: true,
    followUpFocus: ['异常回滚边界'],
    evaluatorModel: 'test-model',
    promptVersion: 'answer-evaluation-v1',
    createdAt: NOW,
    ...overrides,
  };
}

describe('RedisAnswerEvaluationStore', () => {
  it('enqueues a task and creates pending status plus manifest entries', async () => {
    const redis = new FakeRedisClient();
    const store = new RedisAnswerEvaluationStore(redis, () => NOW);

    await store.enqueueTask(buildTask());

    expect(redis.lists.get(ANSWER_EVALUATION_PENDING_QUEUE_KEY)).toEqual(['task-1']);
    expect(await store.readTask('task-1')).toMatchObject({
      taskId: 'task-1',
      referenceAnswer: '说明 REQUIRED 和 REQUIRES_NEW；补充异常回滚边界。',
    });
    expect(await store.readTaskStatus('task-1')).toMatchObject({
      taskId: 'task-1',
      status: 'pending',
      attempts: 0,
    });
    expect(await store.readManifest('interview-1')).toMatchObject({
      interviewId: 'interview-1',
      expectedTaskIds: ['task-1'],
      completedTaskIds: [],
      sealed: false,
    });
  });

  it('claims the next task and marks it running', async () => {
    const store = new RedisAnswerEvaluationStore(new FakeRedisClient(), () => NOW);
    await store.enqueueTask(buildTask());

    const claimedTask = await store.claimNextTask();

    expect(claimedTask?.taskId).toBe('task-1');
    expect(await store.readTaskStatus('task-1')).toMatchObject({
      status: 'running',
      attempts: 1,
      startedAt: NOW,
    });
  });

  it('marks a result succeeded and records completed task ids', async () => {
    const store = new RedisAnswerEvaluationStore(new FakeRedisClient(), () => NOW);
    await store.enqueueTask(buildTask());
    await store.markRunning('task-1');
    await store.markSucceeded(buildResult());

    expect(await store.readTaskStatus('task-1')).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      completedAt: NOW,
    });
    expect(await store.readManifest('interview-1')).toMatchObject({
      expectedTaskIds: ['task-1'],
      completedTaskIds: ['task-1'],
      failedTaskIds: [],
    });
    expect(await store.readResults('interview-1')).toEqual([buildResult()]);
  });

  it('seals an existing interview manifest', async () => {
    const store = new RedisAnswerEvaluationStore(new FakeRedisClient(), () => NOW);
    await store.enqueueTask(buildTask());

    await store.sealInterview('interview-1');

    expect(await store.readManifest('interview-1')).toMatchObject({
      sealed: true,
      sealedAt: NOW,
    });
  });

  it('marks failed tasks and supports retrying them', async () => {
    const redis = new FakeRedisClient();
    const store = new RedisAnswerEvaluationStore(redis, () => NOW);
    await store.enqueueTask(buildTask());

    await store.markFailed('task-1', 'model returned invalid JSON');

    expect(await store.readTaskStatus('task-1')).toMatchObject({
      status: 'failed',
      lastError: 'model returned invalid JSON',
    });
    expect(await store.readManifest('interview-1')).toMatchObject({
      failedTaskIds: ['task-1'],
    });

    await store.retryTask('task-1');

    expect(await store.readTaskStatus('task-1')).toMatchObject({
      status: 'pending',
    });
    expect(await store.readManifest('interview-1')).toMatchObject({
      failedTaskIds: [],
    });
    expect(redis.lists.get(ANSWER_EVALUATION_PENDING_QUEUE_KEY)).toEqual(['task-1', 'task-1']);
  });
});
