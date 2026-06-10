import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  interviewEvaluationManifestSchema,
  llmAnswerEvaluationResultSchema,
  type InterviewEvaluationManifest,
  type LlmAnswerEvaluationResult,
} from '../lib/answer-evaluation-schemas';
import { createRedisAnswerEvaluationStore, createRedisEvaluationClient } from '../lib/redis-client';
import type { AnswerEvaluationStore } from '../lib/redis-evaluation-store';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_WAIT_MS = 120000;

export const waitAndReadInterviewEvaluationsInputSchema = z.object({
  interviewId: z.string().min(1),
  threadId: z.string().min(1),
  pollIntervalMs: z.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
  maxWaitMs: z.number().int().nonnegative().default(DEFAULT_MAX_WAIT_MS),
});

export const waitAndReadInterviewEvaluationsOutputSchema = z.object({
  ready: z.boolean(),
  sealed: z.boolean(),
  expectedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  evaluations: z.array(llmAnswerEvaluationResultSchema),
  waitElapsedMs: z.number().int().nonnegative(),
  blockingReason: z.enum(['manifest-missing', 'not-sealed', 'pending', 'failed', 'timeout']).nullable(),
});

export type WaitAndReadInterviewEvaluationsInput = z.infer<typeof waitAndReadInterviewEvaluationsInputSchema>;
export type WaitAndReadInterviewEvaluationsOutput = z.infer<typeof waitAndReadInterviewEvaluationsOutputSchema>;

export interface WaitAndReadInterviewEvaluationsOptions {
  readonly store: AnswerEvaluationStore;
  readonly nowMs?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function buildBlockedOutput(options: {
  readonly manifest: InterviewEvaluationManifest | null;
  readonly waitElapsedMs: number;
  readonly blockingReason: NonNullable<WaitAndReadInterviewEvaluationsOutput['blockingReason']>;
}): WaitAndReadInterviewEvaluationsOutput {
  return waitAndReadInterviewEvaluationsOutputSchema.parse({
    ready: false,
    sealed: options.manifest?.sealed ?? false,
    expectedCount: options.manifest?.expectedTaskIds.length ?? 0,
    completedCount: options.manifest?.completedTaskIds.length ?? 0,
    failedCount: options.manifest?.failedTaskIds.length ?? 0,
    evaluations: [],
    waitElapsedMs: options.waitElapsedMs,
    blockingReason: options.blockingReason,
  });
}

function isManifestComplete(manifest: InterviewEvaluationManifest): boolean {
  return manifest.completedTaskIds.length === manifest.expectedTaskIds.length;
}

function validateManifestThread(manifest: InterviewEvaluationManifest, threadId: string): void {
  if (manifest.threadId !== threadId) {
    throw new Error(
      `Evaluation manifest thread mismatch for interview ${manifest.interviewId}: expected ${threadId}, found ${manifest.threadId}.`,
    );
  }
}

export async function waitAndReadInterviewEvaluations(
  input: WaitAndReadInterviewEvaluationsInput,
  options: WaitAndReadInterviewEvaluationsOptions,
): Promise<WaitAndReadInterviewEvaluationsOutput> {
  const parsedInput = waitAndReadInterviewEvaluationsInputSchema.parse(input);
  const nowMs = options.nowMs ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = nowMs();

  while (true) {
    const waitElapsedMs = Math.max(0, nowMs() - startedAt);
    const manifest = interviewEvaluationManifestSchema.nullable().parse(
      await options.store.readManifest(parsedInput.interviewId),
    );

    if (manifest) {
      validateManifestThread(manifest, parsedInput.threadId);

      if (manifest.failedTaskIds.length > 0) {
        return buildBlockedOutput({ manifest, waitElapsedMs, blockingReason: 'failed' });
      }

      if (manifest.sealed && isManifestComplete(manifest)) {
        const evaluations = await options.store.readResults(parsedInput.interviewId);
        const resultByTaskId = new Map(evaluations.map((evaluation) => [evaluation.taskId, evaluation]));
        const orderedEvaluations = manifest.expectedTaskIds
          .map((taskId) => resultByTaskId.get(taskId) ?? null)
          .filter((evaluation): evaluation is LlmAnswerEvaluationResult => evaluation !== null);

        if (orderedEvaluations.length === manifest.expectedTaskIds.length) {
          return waitAndReadInterviewEvaluationsOutputSchema.parse({
            ready: true,
            sealed: true,
            expectedCount: manifest.expectedTaskIds.length,
            completedCount: manifest.completedTaskIds.length,
            failedCount: 0,
            evaluations: orderedEvaluations,
            waitElapsedMs,
            blockingReason: null,
          });
        }
      }
    }

    if (waitElapsedMs >= parsedInput.maxWaitMs) {
      return buildBlockedOutput({
        manifest,
        waitElapsedMs,
        blockingReason: manifest ? (manifest.sealed ? 'pending' : 'not-sealed') : 'manifest-missing',
      });
    }

    const remainingWaitMs = parsedInput.maxWaitMs - waitElapsedMs;
    await sleep(Math.min(parsedInput.pollIntervalMs, remainingWaitMs));
  }
}

export const waitAndReadInterviewEvaluationsTool = createTool({
  id: 'wait-and-read-interview-evaluations',
  description:
    'Waits until the async answer-evaluation worker has completed every task for an interview, then reads all evaluation results. It never returns partial report data.',
  inputSchema: waitAndReadInterviewEvaluationsInputSchema,
  outputSchema: waitAndReadInterviewEvaluationsOutputSchema,
  execute: async (input) => {
    const redisClient = await createRedisEvaluationClient();
    const store = createRedisAnswerEvaluationStore(redisClient);

    try {
      return await waitAndReadInterviewEvaluations(input, { store });
    } finally {
      if ('disconnect' in redisClient && typeof redisClient.disconnect === 'function') {
        await redisClient.disconnect();
      }
    }
  },
});
