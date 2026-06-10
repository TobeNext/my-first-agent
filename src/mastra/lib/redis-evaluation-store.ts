import {
  answerEvaluationTaskSchema,
  answerEvaluationTaskStatusSchema,
  interviewEvaluationManifestSchema,
  llmAnswerEvaluationResultSchema,
  type AnswerEvaluationTask,
  type AnswerEvaluationTaskStatus,
  type InterviewEvaluationManifest,
  type LlmAnswerEvaluationResult,
} from './answer-evaluation-schemas';

export interface EvaluationRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  rPush(key: string, value: string): Promise<unknown>;
  lPop(key: string): Promise<string | null>;
  sAdd(key: string, value: string): Promise<unknown>;
  sMembers(key: string): Promise<string[]>;
}

export interface AnswerEvaluationStore {
  enqueueTask(task: AnswerEvaluationTask): Promise<void>;
  claimNextTask(): Promise<AnswerEvaluationTask | null>;
  markRunning(taskId: string): Promise<void>;
  markSucceeded(result: LlmAnswerEvaluationResult): Promise<void>;
  markFailed(taskId: string, error: string): Promise<void>;
  retryTask(taskId: string, error?: string): Promise<void>;
  sealInterview(interviewId: string): Promise<void>;
  readTask(taskId: string): Promise<AnswerEvaluationTask | null>;
  readTaskStatus(taskId: string): Promise<AnswerEvaluationTaskStatus | null>;
  readManifest(interviewId: string): Promise<InterviewEvaluationManifest | null>;
  readResults(interviewId: string): Promise<LlmAnswerEvaluationResult[]>;
}

export const ANSWER_EVALUATION_PENDING_QUEUE_KEY = 'answer-evaluation:pending';

const TASK_INTERVIEW_INDEX_PREFIX = 'answer-evaluation:task-interview:';

function taskInterviewIndexKey(taskId: string): string {
  return `${TASK_INTERVIEW_INDEX_PREFIX}${taskId}`;
}

function manifestKey(interviewId: string): string {
  return `interview:${interviewId}:evaluation:manifest`;
}

function tasksKey(interviewId: string): string {
  return `interview:${interviewId}:evaluation:tasks`;
}

function taskKey(interviewId: string, taskId: string): string {
  return `interview:${interviewId}:evaluation:task:${taskId}`;
}

function statusKey(interviewId: string, taskId: string): string {
  return `interview:${interviewId}:evaluation:status:${taskId}`;
}

function resultKey(interviewId: string, taskId: string): string {
  return `interview:${interviewId}:evaluation:result:${taskId}`;
}

function uniqueAppend(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function removeValue(values: readonly string[], value: string): string[] {
  return values.filter((item) => item !== value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(raw: string | null, parser: { parse(value: unknown): T }): T | null {
  if (!raw) {
    return null;
  }

  return parser.parse(JSON.parse(raw));
}

export class RedisAnswerEvaluationStore implements AnswerEvaluationStore {
  constructor(
    private readonly client: EvaluationRedisClient,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async enqueueTask(rawTask: AnswerEvaluationTask): Promise<void> {
    const task = answerEvaluationTaskSchema.parse(rawTask);
    const manifest = await this.readOrCreateManifest(task.interviewId, task.threadId);
    const status = answerEvaluationTaskStatusSchema.parse({
      schemaVersion: 1,
      taskId: task.taskId,
      interviewId: task.interviewId,
      attemptId: task.attemptId,
      status: 'pending',
      attempts: 0,
      createdAt: this.now(),
    });
    const nextManifest = interviewEvaluationManifestSchema.parse({
      ...manifest,
      expectedTaskIds: uniqueAppend(manifest.expectedTaskIds, task.taskId),
      failedTaskIds: removeValue(manifest.failedTaskIds, task.taskId),
      updatedAt: this.now(),
    });

    await this.client.set(taskInterviewIndexKey(task.taskId), task.interviewId);
    await this.client.set(taskKey(task.interviewId, task.taskId), serialize(task));
    await this.client.set(statusKey(task.interviewId, task.taskId), serialize(status));
    await this.client.sAdd(tasksKey(task.interviewId), task.taskId);
    await this.writeManifest(nextManifest);
    await this.client.rPush(ANSWER_EVALUATION_PENDING_QUEUE_KEY, task.taskId);
  }

  async claimNextTask(): Promise<AnswerEvaluationTask | null> {
    const taskId = await this.client.lPop(ANSWER_EVALUATION_PENDING_QUEUE_KEY);
    if (!taskId) {
      return null;
    }

    const task = await this.readTask(taskId);
    if (!task) {
      return null;
    }

    await this.markRunning(taskId);

    return task;
  }

  async markRunning(taskId: string): Promise<void> {
    const task = await this.requireTask(taskId);
    const currentStatus = await this.readTaskStatus(taskId);
    const status = answerEvaluationTaskStatusSchema.parse({
      schemaVersion: 1,
      taskId,
      interviewId: task.interviewId,
      attemptId: task.attemptId,
      status: 'running',
      attempts: (currentStatus?.attempts ?? 0) + 1,
      createdAt: currentStatus?.createdAt ?? this.now(),
      startedAt: this.now(),
      lastError: currentStatus?.lastError,
    });

    await this.client.set(statusKey(task.interviewId, taskId), serialize(status));
  }

  async markSucceeded(rawResult: LlmAnswerEvaluationResult): Promise<void> {
    const result = llmAnswerEvaluationResultSchema.parse(rawResult);
    const task = await this.requireTask(result.taskId);
    const currentStatus = await this.readTaskStatus(result.taskId);
    const status = answerEvaluationTaskStatusSchema.parse({
      schemaVersion: 1,
      taskId: result.taskId,
      interviewId: result.interviewId,
      attemptId: result.attemptId,
      status: 'succeeded',
      attempts: currentStatus?.attempts ?? 0,
      createdAt: currentStatus?.createdAt ?? this.now(),
      startedAt: currentStatus?.startedAt,
      completedAt: this.now(),
    });
    const manifest = await this.readOrCreateManifest(task.interviewId, task.threadId);
    const nextManifest = interviewEvaluationManifestSchema.parse({
      ...manifest,
      completedTaskIds: uniqueAppend(manifest.completedTaskIds, result.taskId),
      failedTaskIds: removeValue(manifest.failedTaskIds, result.taskId),
      updatedAt: this.now(),
    });

    await this.client.set(resultKey(result.interviewId, result.taskId), serialize(result));
    await this.client.set(statusKey(result.interviewId, result.taskId), serialize(status));
    await this.writeManifest(nextManifest);
  }

  async markFailed(taskId: string, error: string): Promise<void> {
    const task = await this.requireTask(taskId);
    const currentStatus = await this.readTaskStatus(taskId);
    const status = answerEvaluationTaskStatusSchema.parse({
      schemaVersion: 1,
      taskId,
      interviewId: task.interviewId,
      attemptId: task.attemptId,
      status: 'failed',
      attempts: currentStatus?.attempts ?? 0,
      createdAt: currentStatus?.createdAt ?? this.now(),
      startedAt: currentStatus?.startedAt,
      completedAt: this.now(),
      lastError: error,
    });
    const manifest = await this.readOrCreateManifest(task.interviewId, task.threadId);
    const nextManifest = interviewEvaluationManifestSchema.parse({
      ...manifest,
      failedTaskIds: uniqueAppend(manifest.failedTaskIds, taskId),
      completedTaskIds: removeValue(manifest.completedTaskIds, taskId),
      updatedAt: this.now(),
    });

    await this.client.set(statusKey(task.interviewId, taskId), serialize(status));
    await this.writeManifest(nextManifest);
  }

  async retryTask(taskId: string, error?: string): Promise<void> {
    const task = await this.requireTask(taskId);
    const currentStatus = await this.readTaskStatus(taskId);
    const status = answerEvaluationTaskStatusSchema.parse({
      schemaVersion: 1,
      taskId,
      interviewId: task.interviewId,
      attemptId: task.attemptId,
      status: 'pending',
      attempts: currentStatus?.attempts ?? 0,
      createdAt: currentStatus?.createdAt ?? this.now(),
      lastError: error ?? currentStatus?.lastError,
    });
    const manifest = await this.readOrCreateManifest(task.interviewId, task.threadId);
    const nextManifest = interviewEvaluationManifestSchema.parse({
      ...manifest,
      failedTaskIds: removeValue(manifest.failedTaskIds, taskId),
      updatedAt: this.now(),
    });

    await this.client.set(statusKey(task.interviewId, taskId), serialize(status));
    await this.writeManifest(nextManifest);
    await this.client.rPush(ANSWER_EVALUATION_PENDING_QUEUE_KEY, taskId);
  }

  async sealInterview(interviewId: string): Promise<void> {
    const manifest = await this.readManifest(interviewId);
    if (!manifest) {
      throw new Error(`Cannot seal missing evaluation manifest for interview ${interviewId}.`);
    }

    await this.writeManifest({
      ...manifest,
      sealed: true,
      sealedAt: this.now(),
      updatedAt: this.now(),
    });
  }

  async readTask(taskId: string): Promise<AnswerEvaluationTask | null> {
    const interviewId = await this.client.get(taskInterviewIndexKey(taskId));
    if (!interviewId) {
      return null;
    }

    return parseJson(await this.client.get(taskKey(interviewId, taskId)), answerEvaluationTaskSchema);
  }

  async readTaskStatus(taskId: string): Promise<AnswerEvaluationTaskStatus | null> {
    const interviewId = await this.client.get(taskInterviewIndexKey(taskId));
    if (!interviewId) {
      return null;
    }

    return parseJson(await this.client.get(statusKey(interviewId, taskId)), answerEvaluationTaskStatusSchema);
  }

  async readManifest(interviewId: string): Promise<InterviewEvaluationManifest | null> {
    return parseJson(await this.client.get(manifestKey(interviewId)), interviewEvaluationManifestSchema);
  }

  async readResults(interviewId: string): Promise<LlmAnswerEvaluationResult[]> {
    const manifest = await this.readManifest(interviewId);
    const taskIds = manifest?.expectedTaskIds ?? (await this.client.sMembers(tasksKey(interviewId)));
    const results = await Promise.all(
      taskIds.map(async (taskId) =>
        parseJson(await this.client.get(resultKey(interviewId, taskId)), llmAnswerEvaluationResultSchema),
      ),
    );

    return results.filter((result): result is LlmAnswerEvaluationResult => result !== null);
  }

  private async requireTask(taskId: string): Promise<AnswerEvaluationTask> {
    const task = await this.readTask(taskId);
    if (!task) {
      throw new Error(`Answer evaluation task ${taskId} was not found.`);
    }

    return task;
  }

  private async readOrCreateManifest(interviewId: string, threadId: string): Promise<InterviewEvaluationManifest> {
    const existingManifest = await this.readManifest(interviewId);
    if (existingManifest) {
      return existingManifest;
    }

    return interviewEvaluationManifestSchema.parse({
      schemaVersion: 1,
      interviewId,
      threadId,
      expectedTaskIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      sealed: false,
      updatedAt: this.now(),
    });
  }

  private async writeManifest(manifest: InterviewEvaluationManifest): Promise<void> {
    await this.client.set(manifestKey(manifest.interviewId), serialize(interviewEvaluationManifestSchema.parse(manifest)));
  }
}
