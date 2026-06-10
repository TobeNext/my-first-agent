import { describe, expect, it } from 'vitest';

import type {
  AnswerEvaluationTask,
  AnswerEvaluationTaskStatus,
  InterviewEvaluationManifest,
  LlmAnswerEvaluationResult,
} from '../lib/answer-evaluation-schemas';
import type { AnswerEvaluationStore } from '../lib/redis-evaluation-store';
import { waitAndReadInterviewEvaluations } from './interview-evaluation-report-tool';

const NOW = '2026-06-09T00:00:00.000Z';

function buildManifest(overrides: Partial<InterviewEvaluationManifest> = {}): InterviewEvaluationManifest {
  return {
    schemaVersion: 1,
    interviewId: 'interview-1',
    threadId: 'thread-1',
    expectedTaskIds: ['task-1', 'task-2'],
    completedTaskIds: [],
    failedTaskIds: [],
    sealed: false,
    updatedAt: NOW,
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
    strengths: ['覆盖了核心点'],
    missingPoints: ['还缺少边界说明'],
    incorrectPoints: [],
    shouldAskFollowUp: true,
    followUpFocus: ['边界说明'],
    evaluatorModel: 'test-model',
    promptVersion: 'answer-evaluation-v1',
    createdAt: NOW,
    ...overrides,
  };
}

class FakeAnswerEvaluationStore implements AnswerEvaluationStore {
  manifest: InterviewEvaluationManifest | null;
  results: LlmAnswerEvaluationResult[];

  constructor(options: {
    readonly manifest?: InterviewEvaluationManifest | null;
    readonly results?: readonly LlmAnswerEvaluationResult[];
  } = {}) {
    this.manifest = options.manifest ?? null;
    this.results = [...(options.results ?? [])];
  }

  async enqueueTask(): Promise<void> {}
  async claimNextTask(): Promise<AnswerEvaluationTask | null> {
    return null;
  }
  async markRunning(): Promise<void> {}
  async markSucceeded(): Promise<void> {}
  async markFailed(): Promise<void> {}
  async retryTask(): Promise<void> {}
  async sealInterview(): Promise<void> {}
  async readTask(): Promise<AnswerEvaluationTask | null> {
    return null;
  }
  async readTaskStatus(): Promise<AnswerEvaluationTaskStatus | null> {
    return null;
  }
  async readManifest(): Promise<InterviewEvaluationManifest | null> {
    return this.manifest;
  }
  async readResults(): Promise<LlmAnswerEvaluationResult[]> {
    return this.results;
  }
}

describe('waitAndReadInterviewEvaluations', () => {
  it('returns all completed evaluations in manifest order', async () => {
    const task1Result = buildResult({ taskId: 'task-1', attemptId: 'attempt-1' });
    const task2Result = buildResult({
      taskId: 'task-2',
      nodeId: 'node-2',
      attemptId: 'attempt-2',
    });
    const store = new FakeAnswerEvaluationStore({
      manifest: buildManifest({
        sealed: true,
        completedTaskIds: ['task-2', 'task-1'],
      }),
      results: [task2Result, task1Result],
    });

    await expect(
      waitAndReadInterviewEvaluations(
        {
          interviewId: 'interview-1',
          threadId: 'thread-1',
          pollIntervalMs: 10,
          maxWaitMs: 100,
        },
        { store, nowMs: () => 0 },
      ),
    ).resolves.toMatchObject({
      ready: true,
      sealed: true,
      expectedCount: 2,
      completedCount: 2,
      failedCount: 0,
      evaluations: [{ taskId: 'task-1' }, { taskId: 'task-2' }],
      waitElapsedMs: 0,
      blockingReason: null,
    });
  });

  it('waits while the manifest is not sealed and then returns completed results', async () => {
    const store = new FakeAnswerEvaluationStore({
      manifest: buildManifest({
        sealed: false,
        completedTaskIds: ['task-1', 'task-2'],
      }),
      results: [
        buildResult({ taskId: 'task-1', attemptId: 'attempt-1' }),
        buildResult({ taskId: 'task-2', nodeId: 'node-2', attemptId: 'attempt-2' }),
      ],
    });
    let now = 0;

    const output = await waitAndReadInterviewEvaluations(
      {
        interviewId: 'interview-1',
        threadId: 'thread-1',
        pollIntervalMs: 25,
        maxWaitMs: 100,
      },
      {
        store,
        nowMs: () => now,
        sleep: async (ms) => {
          now += ms;
          store.manifest = buildManifest({
            sealed: true,
            completedTaskIds: ['task-1', 'task-2'],
          });
        },
      },
    );

    expect(output).toMatchObject({
      ready: true,
      waitElapsedMs: 25,
      evaluations: [{ taskId: 'task-1' }, { taskId: 'task-2' }],
    });
  });

  it('does not return partial results while sealed tasks are still pending', async () => {
    const store = new FakeAnswerEvaluationStore({
      manifest: buildManifest({
        sealed: true,
        completedTaskIds: ['task-1'],
      }),
      results: [buildResult({ taskId: 'task-1' })],
    });
    let now = 0;

    const output = await waitAndReadInterviewEvaluations(
      {
        interviewId: 'interview-1',
        threadId: 'thread-1',
        pollIntervalMs: 25,
        maxWaitMs: 50,
      },
      {
        store,
        nowMs: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    );

    expect(output).toMatchObject({
      ready: false,
      sealed: true,
      expectedCount: 2,
      completedCount: 1,
      failedCount: 0,
      evaluations: [],
      waitElapsedMs: 50,
      blockingReason: 'pending',
    });
  });

  it('blocks immediately when strict mode sees failed task ids', async () => {
    const store = new FakeAnswerEvaluationStore({
      manifest: buildManifest({
        sealed: true,
        completedTaskIds: ['task-1'],
        failedTaskIds: ['task-2'],
      }),
      results: [buildResult({ taskId: 'task-1' })],
    });

    await expect(
      waitAndReadInterviewEvaluations(
        {
          interviewId: 'interview-1',
          threadId: 'thread-1',
          pollIntervalMs: 25,
          maxWaitMs: 100,
        },
        { store, nowMs: () => 0 },
      ),
    ).resolves.toMatchObject({
      ready: false,
      sealed: true,
      expectedCount: 2,
      completedCount: 1,
      failedCount: 1,
      evaluations: [],
      waitElapsedMs: 0,
      blockingReason: 'failed',
    });
  });

  it('times out while the manifest is missing', async () => {
    const store = new FakeAnswerEvaluationStore();
    let now = 0;

    const output = await waitAndReadInterviewEvaluations(
      {
        interviewId: 'interview-1',
        threadId: 'thread-1',
        pollIntervalMs: 10,
        maxWaitMs: 20,
      },
      {
        store,
        nowMs: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      },
    );

    expect(output).toMatchObject({
      ready: false,
      sealed: false,
      expectedCount: 0,
      completedCount: 0,
      failedCount: 0,
      evaluations: [],
      waitElapsedMs: 20,
      blockingReason: 'manifest-missing',
    });
  });

  it('rejects when the manifest belongs to a different thread', async () => {
    const store = new FakeAnswerEvaluationStore({
      manifest: buildManifest({ threadId: 'other-thread' }),
    });

    await expect(
      waitAndReadInterviewEvaluations(
        {
          interviewId: 'interview-1',
          threadId: 'thread-1',
          maxWaitMs: 0,
        },
        { store, nowMs: () => 0 },
      ),
    ).rejects.toThrow('Evaluation manifest thread mismatch');
  });
});
