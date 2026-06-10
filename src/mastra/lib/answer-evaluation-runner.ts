import { z } from 'zod';

import {
  ANSWER_EVALUATION_MODEL_NAME,
  ANSWER_EVALUATION_PROMPT_VERSION,
  answerEvaluationAgent,
  rawAnswerEvaluationOutputSchema,
  type RawAnswerEvaluationOutput,
} from '../agents/answer-evaluation-agent';
import {
  llmAnswerEvaluationResultSchema,
  type AnswerEvaluationTask,
  type LlmAnswerEvaluationResult,
} from './answer-evaluation-schemas';
import type { AnswerEvaluationStore } from './redis-evaluation-store';

export type AnswerEvaluationModelEvaluator = (prompt: string, task: AnswerEvaluationTask) => Promise<RawAnswerEvaluationOutput>;

export interface AnswerEvaluationRunnerOptions {
  readonly store: AnswerEvaluationStore;
  readonly evaluator?: AnswerEvaluationModelEvaluator;
  readonly now?: () => string;
  readonly evaluatorModel?: string;
  readonly promptVersion?: string;
  readonly maxAttempts?: number;
}

export interface AnswerEvaluationWorkerTickResult {
  readonly processed: boolean;
  readonly taskId?: string;
  readonly status?: 'succeeded' | 'retrying' | 'failed';
  readonly attempts?: number;
  readonly error?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;
export const DEFAULT_ANSWER_EVALUATION_MAX_ATTEMPTS = 3;

function formatLines(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '(none)';
}

export function calculateAnswerWeightedTotal(score: {
  readonly relevance: number;
  readonly accuracy: number;
  readonly depth: number;
  readonly specificity: number;
  readonly clarity: number;
}): number {
  return Number(
    (
      score.relevance * 0.25 +
      score.accuracy * 0.25 +
      score.depth * 0.25 +
      score.specificity * 0.15 +
      score.clarity * 0.1
    ).toFixed(2),
  );
}

export function buildAnswerEvaluationTaskPrompt(task: AnswerEvaluationTask): string {
  return [
    `Target role:\n${task.targetRole}`,
    `Round type:\n${task.roundType}`,
    `Question:\n${task.question}`,
    `Main question:\n${task.mainQuestion}`,
    `Reference answer:\n${task.referenceAnswer?.trim() || '(none)'}`,
    `Reference answer points:\n${formatLines(task.evaluationPoints)}`,
    `Candidate answer:\n${task.candidateAnswer}`,
    `Node conversation:\n${JSON.stringify(task.nodeConversation, null, 2)}`,
  ].join('\n\n');
}

export async function evaluateAnswerWithAgent(prompt: string): Promise<RawAnswerEvaluationOutput> {
  const response = await answerEvaluationAgent.generate(prompt, {
    structuredOutput: {
      schema: rawAnswerEvaluationOutputSchema,
      jsonPromptInjection: true,
    },
    modelSettings: {
      temperature: 0,
    },
  });

  return rawAnswerEvaluationOutputSchema.parse(response.object);
}

export function buildLlmAnswerEvaluationResult(options: {
  readonly task: AnswerEvaluationTask;
  readonly rawEvaluation: RawAnswerEvaluationOutput;
  readonly now: string;
  readonly evaluatorModel: string;
  readonly promptVersion: string;
}): LlmAnswerEvaluationResult {
  const raw = rawAnswerEvaluationOutputSchema.parse(options.rawEvaluation);
  return llmAnswerEvaluationResultSchema.parse({
    schemaVersion: 1,
    taskId: options.task.taskId,
    interviewId: options.task.interviewId,
    threadId: options.task.threadId,
    nodeId: options.task.nodeId,
    roundId: options.task.roundId,
    roundType: options.task.roundType,
    attemptId: options.task.attemptId,
    classification: raw.classification,
    score: {
      ...raw.score,
      weightedTotal: calculateAnswerWeightedTotal(raw.score),
    },
    strengths: raw.strengths,
    missingPoints: raw.missingPoints,
    incorrectPoints: raw.incorrectPoints,
    shouldAskFollowUp: raw.shouldAskFollowUp,
    followUpFocus: raw.followUpFocus,
    evaluatorModel: options.evaluatorModel,
    promptVersion: options.promptVersion,
    createdAt: options.now,
  });
}

export class AnswerEvaluationRunner {
  private readonly evaluator: AnswerEvaluationModelEvaluator;
  private readonly now: () => string;
  private readonly evaluatorModel: string;
  private readonly promptVersion: string;
  private readonly maxAttempts: number;

  constructor(private readonly options: AnswerEvaluationRunnerOptions) {
    this.evaluator = options.evaluator ?? ((prompt) => evaluateAnswerWithAgent(prompt));
    this.now = options.now ?? (() => new Date().toISOString());
    this.evaluatorModel = options.evaluatorModel ?? ANSWER_EVALUATION_MODEL_NAME;
    this.promptVersion = options.promptVersion ?? ANSWER_EVALUATION_PROMPT_VERSION;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_ANSWER_EVALUATION_MAX_ATTEMPTS;
  }

  async runOnce(): Promise<AnswerEvaluationWorkerTickResult> {
    const task = await this.options.store.claimNextTask();
    if (!task) {
      return { processed: false };
    }

    const prompt = buildAnswerEvaluationTaskPrompt(task);
    try {
      const rawEvaluation = await this.evaluator(prompt, task);
      const result = buildLlmAnswerEvaluationResult({
        task,
        rawEvaluation,
        now: this.now(),
        evaluatorModel: this.evaluatorModel,
        promptVersion: this.promptVersion,
      });

      await this.options.store.markSucceeded(result);

      return { processed: true, taskId: task.taskId, status: 'succeeded' };
    } catch (error) {
      const message = formatEvaluationError(error);
      const status = await this.options.store.readTaskStatus(task.taskId);
      const attempts = status?.attempts ?? 0;

      if (attempts >= this.maxAttempts) {
        await this.options.store.markFailed(task.taskId, message);
        return { processed: true, taskId: task.taskId, status: 'failed', attempts, error: message };
      }

      await this.options.store.retryTask(task.taskId, message);
      return { processed: true, taskId: task.taskId, status: 'retrying', attempts, error: message };
    }
  }

  async runForever(options: { readonly pollIntervalMs?: number; readonly abortSignal?: AbortSignal } = {}): Promise<void> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    while (!options.abortSignal?.aborted) {
      const result = await this.runOnce();
      if (!result.processed) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }
}

export const answerEvaluationRunnerOptionsSchema = z.object({
  pollIntervalMs: z.coerce.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
  maxAttempts: z.coerce.number().int().positive().default(DEFAULT_ANSWER_EVALUATION_MAX_ATTEMPTS),
});

function formatEvaluationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
