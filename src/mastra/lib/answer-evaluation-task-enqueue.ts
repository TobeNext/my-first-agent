import type { AnswerEvaluationTask } from './answer-evaluation-schemas';
import type {
  AnswerAttemptState,
  InterviewRoundState,
  InterviewSessionState,
  InterviewTopicNodeState,
} from './interview-state-machine-schema';
import {
  createRedisAnswerEvaluationStore,
  createRedisEvaluationClient,
} from './redis-client';
import type { AnswerEvaluationStore } from './redis-evaluation-store';

interface LoggerLike {
  warn(message: string, details?: Record<string, unknown>): void;
  info?(message: string, details?: Record<string, unknown>): void;
}

export interface AnswerEvaluationEnqueueDependencies {
  readonly store?: Pick<AnswerEvaluationStore, 'enqueueTask'>;
  readonly logger?: LoggerLike;
  readonly now?: () => string;
  readonly createTaskId?: (attempt: AnswerAttemptState) => string;
}

export interface BuildAnswerEvaluationTaskOptions {
  readonly beforeState: InterviewSessionState;
  readonly afterState: InterviewSessionState;
  readonly userMessage: string;
  readonly resourceId?: string;
  readonly now?: () => string;
  readonly createTaskId?: (attempt: AnswerAttemptState) => string;
}

let defaultStorePromise: Promise<Pick<AnswerEvaluationStore, 'enqueueTask'>> | null = null;

function getActiveRound(state: InterviewSessionState): InterviewRoundState | null {
  return state.rounds.find((round) => round.id === state.activeRoundId) ?? null;
}

function getActiveNode(round: InterviewRoundState | null): InterviewTopicNodeState | null {
  return round?.nodes.find((node) => node.id === round.activeNodeId) ?? null;
}

function getCurrentQuestion(node: InterviewTopicNodeState): string {
  if (node.currentTargetType === 'main-question') {
    return node.mainQuestion;
  }

  return node.followUps.find((followUp) => followUp.id === node.currentFollowUpId)?.question ?? node.mainQuestion;
}

function collectAttemptIds(state: InterviewSessionState): Set<string> {
  return new Set(
    state.rounds.flatMap((round) =>
      round.nodes.flatMap((node) => node.answerAttempts.map((attempt) => attempt.id)),
    ),
  );
}

function findNewAnswerAttempt(options: {
  readonly beforeState: InterviewSessionState;
  readonly afterState: InterviewSessionState;
  readonly userMessage: string;
}): AnswerAttemptState | null {
  const previousAttemptIds = collectAttemptIds(options.beforeState);
  const normalizedUserMessage = options.userMessage.trim();

  return (
    options.afterState.rounds
      .flatMap((round) => round.nodes)
      .flatMap((node) => node.answerAttempts)
      .find((attempt) => {
        return (
          !previousAttemptIds.has(attempt.id) &&
          attempt.userMessage.trim() === normalizedUserMessage &&
          attempt.score !== null &&
          !attempt.isDetour
        );
      }) ?? null
  );
}

function buildNodeConversation(options: {
  readonly node: InterviewTopicNodeState;
  readonly currentQuestion: string;
  readonly userMessage: string;
  readonly createdAt: string;
}): AnswerEvaluationTask['nodeConversation'] {
  const conversation: AnswerEvaluationTask['nodeConversation'] = [
    {
      role: 'interviewer',
      targetType: 'main-question',
      text: options.node.mainQuestion,
      createdAt: options.createdAt,
    },
  ];

  for (const attempt of options.node.answerAttempts) {
    conversation.push({
      role: 'candidate',
      targetType: attempt.targetType,
      text: attempt.userMessage,
      createdAt: attempt.createdAt,
    });
  }

  if (options.node.currentTargetType === 'follow-up' && options.currentQuestion.trim()) {
    conversation.push({
      role: 'interviewer',
      targetType: 'follow-up',
      text: options.currentQuestion,
      createdAt: options.createdAt,
    });
  }

  conversation.push({
    role: 'candidate',
    targetType: options.node.currentTargetType,
    text: options.userMessage,
    createdAt: options.createdAt,
  });

  return conversation;
}

function defaultTaskId(attempt: AnswerAttemptState): string {
  return `answer-evaluation-${attempt.id}`;
}

async function getDefaultStore(): Promise<Pick<AnswerEvaluationStore, 'enqueueTask'>> {
  defaultStorePromise ??= createRedisEvaluationClient().then((client) => createRedisAnswerEvaluationStore(client));

  return defaultStorePromise;
}

export function buildAnswerEvaluationTask(options: BuildAnswerEvaluationTaskOptions): AnswerEvaluationTask | null {
  const activeRound = getActiveRound(options.beforeState);
  const activeNode = getActiveNode(activeRound);
  if (!activeRound || !activeNode) {
    return null;
  }

  const answerAttempt = findNewAnswerAttempt({
    beforeState: options.beforeState,
    afterState: options.afterState,
    userMessage: options.userMessage,
  });
  if (!answerAttempt) {
    return null;
  }

  const createdAt = options.now?.() ?? new Date().toISOString();
  const currentQuestion = getCurrentQuestion(activeNode);
  const followUpQuestion =
    activeNode.currentTargetType === 'follow-up' ? currentQuestion : undefined;

  return {
    schemaVersion: 1,
    taskId: options.createTaskId?.(answerAttempt) ?? defaultTaskId(answerAttempt),
    interviewId: options.beforeState.threadId,
    threadId: options.beforeState.threadId,
    resourceId: options.resourceId,
    nodeId: activeNode.id,
    roundId: activeRound.id,
    roundType: activeRound.type,
    attemptId: answerAttempt.id,
    targetType: answerAttempt.targetType,
    targetId: answerAttempt.targetId,
    targetRole: options.beforeState.targetRole,
    responseLanguage: options.beforeState.responseLanguage,
    question: currentQuestion,
    mainQuestion: activeNode.mainQuestion,
    followUpQuestion,
    referenceAnswer: activeNode.referenceAnswer,
    evaluationPoints: activeNode.evaluationPoints ?? [],
    candidateAnswer: options.userMessage,
    nodeConversation: buildNodeConversation({
      node: activeNode,
      currentQuestion,
      userMessage: options.userMessage,
      createdAt,
    }),
    createdAt,
  };
}

export async function enqueueAnswerEvaluationTaskBestEffort(
  options: BuildAnswerEvaluationTaskOptions,
  deps: AnswerEvaluationEnqueueDependencies = {},
): Promise<AnswerEvaluationTask | null> {
  const task = buildAnswerEvaluationTask({
    ...options,
    now: deps.now ?? options.now,
    createTaskId: deps.createTaskId ?? options.createTaskId,
  });
  if (!task) {
    return null;
  }

  try {
    const store = deps.store ?? (await getDefaultStore());
    await store.enqueueTask(task);
    deps.logger?.info?.('Answer evaluation task enqueued', {
      event: 'answer_evaluation.task.enqueued',
      interviewId: task.interviewId,
      taskId: task.taskId,
      attemptId: task.attemptId,
    });
  } catch (error) {
    deps.logger?.warn('Failed to enqueue answer evaluation task', {
      event: 'answer_evaluation.task.enqueue_failed',
      interviewId: task.interviewId,
      taskId: task.taskId,
      attemptId: task.attemptId,
      err: error,
    });
  }

  return task;
}
