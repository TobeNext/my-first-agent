import { answerEvaluationRunnerOptionsSchema, AnswerEvaluationRunner } from '../lib/answer-evaluation-runner';
import { createRedisAnswerEvaluationStore, createRedisEvaluationClient } from '../lib/redis-client';

const options = answerEvaluationRunnerOptionsSchema.parse({
  pollIntervalMs: process.env.ANSWER_EVALUATION_WORKER_POLL_INTERVAL_MS,
  maxAttempts: process.env.ANSWER_EVALUATION_WORKER_MAX_ATTEMPTS,
});

const redisClient = await createRedisEvaluationClient();
const store = createRedisAnswerEvaluationStore(redisClient);
const runner = new AnswerEvaluationRunner({ store, maxAttempts: options.maxAttempts });
const abortController = new AbortController();

process.on('SIGINT', () => abortController.abort());
process.on('SIGTERM', () => abortController.abort());

console.log(
  `Answer evaluation worker started. Poll interval: ${options.pollIntervalMs}ms. Max attempts: ${options.maxAttempts}.`,
);

await runner.runForever({
  pollIntervalMs: options.pollIntervalMs,
  abortSignal: abortController.signal,
});

console.log('Answer evaluation worker stopped.');
