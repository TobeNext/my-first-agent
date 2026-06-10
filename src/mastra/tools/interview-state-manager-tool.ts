import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import {
  applyUserReply,
  buildFinalInterviewStateFromEvaluations,
  buildInterviewProgressSummary,
  classifyByRules,
  validateInterviewState,
} from '../lib/interview-state-machine';
import {
  detectKickoffPayloadFormat,
  recoverMissingInterviewSession,
} from '../lib/interview-kickoff-recovery';
import {
  createInterviewOutcomeSnapshot,
  updateInterviewOutcomeSnapshot,
} from '../lib/interview-outcome';
import {
  answerScoreSchema,
  followUpIntentSchema,
  interviewWorkingMemorySchema,
  type AnswerScore,
  type InterviewSessionState,
} from '../lib/interview-state-machine-schema';
import { ensureGeneratedFollowUpQuestion } from '../lib/interview-question-generator';
import { resolveInterviewInitializationResources } from '../lib/interview-initialization-pipeline';
import { evaluateReferenceAnswerCoverage } from '../lib/interview-answer-evaluation';
import { enqueueAnswerEvaluationTaskBestEffort } from '../lib/answer-evaluation-task-enqueue';
import { createRedisAnswerEvaluationStore, createRedisEvaluationClient } from '../lib/redis-client';
import type { AnswerEvaluationStore } from '../lib/redis-evaluation-store';
import { mastraLogger } from '../lib/logger';
import { updateRagRecallSampleAnswerPerformance, writeInitializationRagRecallSample } from '../lib/rag-recall-sample';
import {
  waitAndReadInterviewEvaluations,
  type WaitAndReadInterviewEvaluationsOutput,
} from './interview-evaluation-report-tool';

const TOOL_MEMORY_CONFIG = {
  workingMemory: {
    enabled: true,
    scope: 'resource' as const,
    schema: interviewWorkingMemorySchema,
  },
};
const FLOW_TEST_SKIP_MARKER = '[FLOW_TEST_SKIP]';
const RAG_RECALL_SAMPLE_PATH_KEY = 'ragRecallSampleFilePath';
const INTERVIEW_OUTCOME_PATH_KEY = 'interviewOutcomeFilePath';
const stateManagerLogger = mastraLogger.child({
  module: 'interview-state-manager-tool',
});
const REPORT_EVALUATION_POLL_INTERVAL_MS = 1000;
const REPORT_EVALUATION_MAX_WAIT_MS = 120000;

const initializationInputSchema = z.object({
  action: z.literal('initialize-session'),
  rawKickoffMessage: z.string().min(1),
});

const processReplyInputSchema = z.object({
  action: z.literal('process-user-reply'),
  userMessage: z.string().min(1),
});

const interviewStateManagerInputSchema = z.discriminatedUnion('action', [
  initializationInputSchema,
  processReplyInputSchema,
]);

const interviewStateManagerOutputSchema = z.object({
  assistantReply: z.string(),
  flowTestMockUserReply: z.string().nullable(),
  phase: z.string(),
  activeRoundType: z.string().nullable(),
  activeNodeTopic: z.string().nullable(),
  finalReportReady: z.boolean(),
  progress: z.object({
    totalQuestionCount: z.number().int().nonnegative(),
    completedQuestionCount: z.number().int().nonnegative(),
    remainingQuestionCount: z.number().int().nonnegative(),
    currentQuestionIndex: z.number().int().positive().nullable(),
    currentRoundType: z.string().nullable(),
    currentRoundLabel: z.string().nullable(),
    currentStage: z.enum(['main-question', 'follow-up', 'completed']),
    currentFollowUpIndex: z.number().int().positive().nullable(),
    currentQuestionText: z.string().nullable(),
    currentNodeTopic: z.string().nullable(),
  }),
});

interface InterviewAnalysisResult {
  readonly classification:
    | 'direct-answer'
    | 'partial-answer'
    | 'deep-answer'
    | 'off-topic'
    | 'clarification-request'
    | 'skip-request'
    | 'stop-request'
    | 'meta-question';
  readonly score: AnswerScore | null;
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
  readonly recommendedIntent: z.infer<typeof followUpIntentSchema>;
  readonly followUpFocus: readonly string[];
  readonly followUpQuestion: string | null;
  readonly detourReply: string | null;
  readonly clarificationReply: string | null;
  readonly shouldCompleteNode: boolean;
  readonly earlyCompletionReason: string | null;
}

type RuleBasedAnswerClassification = ReturnType<typeof classifyByRules> | 'off-topic';

interface MemoryLike {
  readonly storage: {
    getStore(name: 'memory'): Promise<{
      updateThread(args: {
        id: string;
        title?: string;
        metadata?: Record<string, unknown>;
      }): Promise<unknown>;
    } | null>;
  };
  getThreadById(args: {
    threadId: string;
  }): Promise<{
    id?: string;
    title?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null>;
  createThread(args: {
    threadId: string;
    resourceId?: string;
    memoryConfig?: typeof TOOL_MEMORY_CONFIG;
  }): Promise<unknown>;
  getWorkingMemory(args: {
    threadId?: string;
    resourceId?: string;
    memoryConfig?: typeof TOOL_MEMORY_CONFIG;
  }): Promise<string | null>;
  updateWorkingMemory(args: {
    threadId?: string;
    resourceId?: string;
    workingMemory: string;
    memoryConfig?: typeof TOOL_MEMORY_CONFIG;
  }): Promise<void>;
}

const THREAD_METADATA_STATE_KEY = 'interviewSessionState';

function resolveStateResourceId(threadId: string, resourceId?: string): string {
  return resourceId ?? threadId;
}

function getMemoryContext(context: unknown): {
  readonly memory: MemoryLike;
  readonly threadId: string;
  readonly resourceId: string | undefined;
} {
  const typedContext = context as {
    readonly memory?: MemoryLike;
    readonly agent?: {
      readonly threadId?: string;
      readonly resourceId?: string;
    };
  };

  const threadId = typedContext.agent?.threadId;
  const memory = typedContext.memory;
  if (!memory || !threadId) {
    throw new Error('interviewStateManagerTool requires memory and thread context.');
  }

  return {
    memory,
    threadId,
    resourceId: typedContext.agent?.resourceId,
  };
}

async function ensureThread(memory: MemoryLike, threadId: string, resourceId?: string): Promise<void> {
  const existingThread = await memory.getThreadById({ threadId });
  if (existingThread) {
    return;
  }

  await memory.createThread({
    threadId,
    resourceId,
    memoryConfig: TOOL_MEMORY_CONFIG,
  });
}

async function readStateFromThreadMetadata(memory: MemoryLike, threadId: string): Promise<InterviewSessionState | null> {
  const thread = await memory.getThreadById({ threadId });
  const rawState = thread?.metadata?.[THREAD_METADATA_STATE_KEY];
  if (typeof rawState !== 'string') {
    return null;
  }

  return validateInterviewState(JSON.parse(rawState));
}

async function readState(memory: MemoryLike, threadId: string, resourceId?: string): Promise<InterviewSessionState | null> {
  const raw = await memory.getWorkingMemory({
    threadId,
    resourceId: resolveStateResourceId(threadId, resourceId),
    memoryConfig: TOOL_MEMORY_CONFIG,
  });
  if (!raw) {
    return readStateFromThreadMetadata(memory, threadId);
  }

  return validateInterviewState(JSON.parse(raw));
}

async function writeStateToThreadMetadata(memory: MemoryLike, state: InterviewSessionState, threadId: string): Promise<void> {
  const thread = await memory.getThreadById({ threadId });
  if (!thread) {
    return;
  }

  const memoryStore = await memory.storage.getStore('memory');
  if (!memoryStore) {
    return;
  }

  await memoryStore.updateThread({
    id: threadId,
    title: thread.title ?? '',
    metadata: {
      ...(thread.metadata ?? {}),
      [THREAD_METADATA_STATE_KEY]: JSON.stringify(state),
    },
  });
}

async function writeState(memory: MemoryLike, state: InterviewSessionState, threadId: string, resourceId?: string): Promise<void> {
  try {
    await memory.updateWorkingMemory({
      threadId,
      resourceId: resolveStateResourceId(threadId, resourceId),
      workingMemory: JSON.stringify(state),
      memoryConfig: TOOL_MEMORY_CONFIG,
    });
  } finally {
    await writeStateToThreadMetadata(memory, state, threadId);
  }
}

async function writeThreadMetadataValue(
  memory: MemoryLike,
  threadId: string,
  key: string,
  value: string,
): Promise<void> {
  const thread = await memory.getThreadById({ threadId });
  if (!thread) {
    return;
  }

  const memoryStore = await memory.storage.getStore('memory');
  if (!memoryStore) {
    return;
  }

  await memoryStore.updateThread({
    id: threadId,
    title: thread.title ?? '',
    metadata: {
      ...(thread.metadata ?? {}),
      [key]: value,
    },
  });
}

async function readThreadMetadataValue(memory: MemoryLike, threadId: string, key: string): Promise<string | null> {
  const thread = await memory.getThreadById({ threadId });
  const rawValue = thread?.metadata?.[key];

  return typeof rawValue === 'string' ? rawValue : null;
}

function isFlowTestSkipMessage(userMessage: string): boolean {
  return userMessage.trim() === FLOW_TEST_SKIP_MARKER;
}

function sanitizeFlowTestFocusLabel(value: string): string {
  return value
    .replace(/^请你?/, '')
    .replace(/^你(?=(?:详细)?(?:说明|介绍|解释))/, '')
    .replace(/^你刚才(?:的回答里)?提到了/, '')
    .replace(/^继续围绕/, '')
    .replace(/^继续展开/, '')
    .replace(/^请继续(?:往下)?展开(?:，重点说明)?/, '')
    .replace(/^请结合你真实做过的项目，详细说明你是如何处理/, '')
    .replace(/^除了你刚才提到的内容之外，在/, '')
    .replace(/^(?:详细)?(?:说明|介绍|解释)/, '')
    .replace(/[“”"']/g, '')
    .replace(/[?？]\s*$/, '')
    .trim();
}

function getActiveQuestionContext(state: InterviewSessionState): {
  readonly activeRound: InterviewSessionState['rounds'][number];
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly currentQuestion: string;
  readonly focusLabel: string;
} | null {
  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId) ?? null;
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId) ?? null;
  if (!activeRound || !activeNode) {
    return null;
  }

  const currentQuestion =
    activeNode.currentTargetType === 'main-question'
      ? activeNode.mainQuestion
      : activeNode.followUps.find((followUp) => followUp.id === activeNode.currentFollowUpId)?.question ??
        activeNode.mainQuestion;
  const quotedFocus = currentQuestion.match(/["“](.+?)["”]/)?.[1]?.trim();
  const firstClause = currentQuestion
    .replace(/^请(?:继续)?(?:结合)?/, '')
    .replace(/[?？]\s*$/, '')
    .split(/[。.!?？；;，,]/)[0]
    ?.trim();
  const focusLabel = sanitizeFlowTestFocusLabel(
    quotedFocus || (firstClause && firstClause.length <= 28 ? firstClause : activeNode.topic),
  );

  return {
    activeRound,
    activeNode,
    currentQuestion,
    focusLabel,
  };
}

function buildFlowTestMockUserReply(options: { readonly state: InterviewSessionState }): string {
  const context = getActiveQuestionContext(options.state);
  if (!context) {
    return '这一步我会给出一段中文示例回答，并继续推进流程测试。';
  }

  const { activeRound, activeNode, focusLabel } = context;
  if (activeRound.type === 'professional-skills') {
    if (activeNode.currentTargetType === 'main-question') {
      return `针对“${focusLabel}”，我通常会先明确目标和约束，再把主流程、异常分支、恢复策略和可观测性拆开设计。落地时我会让状态机负责流程真相来源，让工具只处理单一能力调用，这样既能保证链路稳定，也方便后续排查和迭代。`;
    }

    return `如果继续展开“${focusLabel}”，我会重点补充实现细节和取舍。我一般会先定义关键状态与事件，再补齐失败恢复、监控指标和兜底策略，确保这套方案在真实项目里既可维护，也能快速定位问题。`;
  }

  if (activeNode.currentTargetType === 'main-question') {
    return `结合真实项目来回答的话，我会先说明业务背景、目标和我的职责。围绕“${focusLabel}”，我负责推进关键方案落地、协调上下游并持续验证效果，最终让方案可以稳定上线，并支撑后续的迭代优化。`;
  }

  return `继续围绕“${focusLabel}”补充的话，我会说明当时的关键决策、遇到的约束以及最终结果。我会重点讲清楚为什么这样取舍、过程中如何处理风险，以及上线后带来了哪些实际改善。`;
}

function buildAnswerScore(score: Omit<AnswerScore, 'weightedTotal'>): AnswerScore {
  return answerScoreSchema.parse({
    ...score,
    weightedTotal:
      score.relevance * 0.25 +
      score.accuracy * 0.25 +
      score.depth * 0.25 +
      score.specificity * 0.15 +
      score.clarity * 0.1,
  });
}

function classifyDetourByPatterns(userMessage: string): 'off-topic' | null {
  const normalized = userMessage.trim();
  if (!normalized) {
    return null;
  }

  const offTopicPatterns = [
    /先不回答/i,
    /不回答这题/i,
    /先聊聊/i,
    /聊聊别的/i,
    /我想问你/i,
    /问你一个/i,
    /before answering/i,
    /instead of answering/i,
    /let me ask you/i,
    /talk about something else/i,
  ];

  return offTopicPatterns.some((pattern) => pattern.test(normalized)) ? 'off-topic' : null;
}

function classifyMetaByPatterns(userMessage: string): 'meta-question' | null {
  const normalized = userMessage.trim();
  if (!normalized) {
    return null;
  }

  const metaPatterns = [
    /评分规则/i,
    /评分标准/i,
    /面试流程/i,
    /为什么问这个/i,
    /how are you scoring/i,
    /scoring rubric/i,
    /interview process/i,
    /why are you asking/i,
  ];

  return metaPatterns.some((pattern) => pattern.test(normalized)) ? 'meta-question' : null;
}

function classifyAnswerWithoutModel(userMessage: string): RuleBasedAnswerClassification {
  return classifyByRules(userMessage) ?? classifyMetaByPatterns(userMessage) ?? classifyDetourByPatterns(userMessage);
}

function buildFlowTestMockAnalysis(options: { readonly state: InterviewSessionState }): InterviewAnalysisResult {
  const context = getActiveQuestionContext(options.state);
  const activeRound = context?.activeRound ?? null;
  const activeNode = context?.activeNode ?? null;
  const focusLabel = context?.focusLabel ?? activeNode?.topic ?? '当前问题';

  if (!activeRound || !activeNode) {
    return {
      classification: 'stop-request',
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    };
  }

  if (activeNode.currentTargetType === 'main-question') {
    return {
      classification: 'partial-answer',
      score: buildAnswerScore({
        relevance: 7.2,
        accuracy: 6.8,
        depth: 6.1,
        specificity: 6.4,
        clarity: 7.5,
      }),
      strengths: [`已经覆盖“${focusLabel}”的主线思路`],
      missingPoints: [`还需要继续补充“${focusLabel}”的实现细节、取舍和结果`],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [focusLabel],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: false,
      earlyCompletionReason: null,
    };
  }

  if (activeRound.type === 'professional-skills' && activeNode.followUpCount < 2) {
    return {
      classification: 'direct-answer',
      score: buildAnswerScore({
        relevance: 8.0,
        accuracy: 7.8,
        depth: 7.2,
        specificity: 7.4,
        clarity: 8.0,
      }),
      strengths: [`已经进一步补充“${focusLabel}”的实现方式和关键约束`],
      missingPoints: ['还可以再补一个真实取舍或结果指标'],
      incorrectPoints: [],
      recommendedIntent: 'experience',
      followUpFocus: [focusLabel],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    };
  }

  return {
    classification: 'deep-answer',
    score: buildAnswerScore({
      relevance: 8.8,
      accuracy: 8.6,
      depth: 8.7,
      specificity: 8.4,
      clarity: 8.5,
    }),
    strengths: [`对“${focusLabel}”给出了比较完整且可落地的回答`],
    missingPoints: [],
    incorrectPoints: [],
    recommendedIntent: 'depth',
    followUpFocus: [focusLabel],
    followUpQuestion: null,
    detourReply: null,
    clarificationReply: null,
    shouldCompleteNode: true,
    earlyCompletionReason: '流程测试模式自动完成当前节点。',
  };
}

function buildFallbackAnswerAnalysis(options: {
  readonly state: InterviewSessionState;
  readonly activeRound: InterviewSessionState['rounds'][number];
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly userMessage: string;
  readonly ruleClassification: RuleBasedAnswerClassification;
}): InterviewAnalysisResult {
  const normalizedMessage = options.userMessage.replace(/\s+/g, ' ').trim();
  const isChinese = options.state.responseLanguage === 'zh';
  const focusLabel = options.activeNode.topic;

  if (options.ruleClassification === 'off-topic' || options.ruleClassification === 'meta-question') {
    return {
      classification: options.ruleClassification,
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [focusLabel],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: false,
      earlyCompletionReason: null,
    };
  }

  const messageLength = normalizedMessage.length;
  const looksSubstantial = messageLength >= 60;
  const classification = looksSubstantial ? 'direct-answer' : 'partial-answer';
  const recommendedIntent =
    options.activeNode.currentTargetType === 'main-question'
      ? 'depth'
      : options.activeRound.type === 'professional-skills'
        ? 'experience'
        : 'breadth';
  const shouldCompleteNode =
    options.activeNode.currentTargetType === 'follow-up' &&
    (options.activeNode.followUpCount >= 2 || (options.activeRound.type === 'project-experience' && looksSubstantial));
  const referenceEvaluation = evaluateReferenceAnswerCoverage({
    referenceAnswer: options.activeNode.referenceAnswer,
    evaluationPoints: options.activeNode.evaluationPoints,
    userAnswer: options.userMessage,
  });
  const referenceMissingPoints = referenceEvaluation.hasReferenceAnswer
    ? referenceEvaluation.missingPoints.slice(0, 3).map((point) =>
        isChinese ? `未覆盖参考要点：${point}` : `Missing reference point: ${point}`,
      )
    : [];
  const referenceStrengths = referenceEvaluation.coveredPoints.slice(0, 2).map((point) =>
    isChinese ? `覆盖了参考要点：${point}` : `Covered reference point: ${point}`,
  );
  const referenceAwareAccuracy = referenceEvaluation.hasReferenceAnswer
    ? Math.max(5.4, Math.min(9.2, 5.4 + referenceEvaluation.coverageRatio * 4))
    : looksSubstantial ? 7.4 : 6.2;
  const referenceAwareDepth = referenceEvaluation.hasReferenceAnswer
    ? Math.max(5.2, Math.min(9.0, 5.2 + referenceEvaluation.coverageRatio * 3.8 + (looksSubstantial ? 0.4 : 0)))
    : looksSubstantial ? 7.2 : 5.8;
  const referenceAwareSpecificity = referenceEvaluation.hasReferenceAnswer
    ? Math.max(5.2, Math.min(8.8, 5.2 + referenceEvaluation.coverageRatio * 3.2 + (looksSubstantial ? 0.3 : 0)))
    : looksSubstantial ? 7.0 : 5.9;

  return {
    classification,
    score: buildAnswerScore({
      relevance: looksSubstantial ? 7.8 : 6.6,
      accuracy: referenceAwareAccuracy,
      depth: referenceAwareDepth,
      specificity: referenceAwareSpecificity,
      clarity: looksSubstantial ? 7.8 : 6.8,
    }),
    strengths: [
      isChinese ? `回答基本围绕“${focusLabel}”展开` : `The answer stayed broadly focused on ${focusLabel}.`,
      ...referenceStrengths,
    ],
    missingPoints: shouldCompleteNode
      ? referenceMissingPoints
      : [
          ...referenceMissingPoints,
          isChinese
            ? `还需要继续补充“${focusLabel}”的实现细节、关键取舍或真实案例`
            : `The answer still needs more implementation detail, trade-offs, or a real example for ${focusLabel}.`,
        ],
    incorrectPoints: [],
    recommendedIntent,
    followUpFocus: referenceEvaluation.missingPoints.slice(0, 2).length > 0
      ? referenceEvaluation.missingPoints.slice(0, 2)
      : [focusLabel],
    followUpQuestion: null,
    detourReply: null,
    clarificationReply: null,
    shouldCompleteNode: shouldCompleteNode && (!referenceEvaluation.hasReferenceAnswer || referenceEvaluation.coverageRatio >= 0.5),
    earlyCompletionReason: shouldCompleteNode
      ? isChinese
        ? '回答分析降级为规则兜底后，当前节点已满足推进条件。'
        : 'The answer-analysis fallback determined that the current node can move forward.'
      : null,
  };
}

async function analyzeAnswer(options: {
  readonly state: InterviewSessionState;
  readonly userMessage: string;
  readonly isFlowTestSkip?: boolean;
}): Promise<InterviewAnalysisResult> {
  const activeRound = options.state.rounds.find((round) => round.id === options.state.activeRoundId) ?? null;
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId) ?? null;
  if (!activeRound || !activeNode) {
    return {
      classification: 'stop-request',
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    };
  }

  if (options.isFlowTestSkip) {
    return buildFlowTestMockAnalysis({ state: options.state });
  }

  const currentQuestion =
    activeNode.currentTargetType === 'main-question'
      ? activeNode.mainQuestion
      : activeNode.followUps.find((followUp) => followUp.id === activeNode.currentFollowUpId)?.question ??
        activeNode.mainQuestion;
  const ruleClassification = classifyAnswerWithoutModel(options.userMessage);

  if (ruleClassification === 'stop-request' || ruleClassification === 'skip-request' || ruleClassification === 'clarification-request') {
    return {
      classification: ruleClassification,
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [],
      followUpQuestion: null,
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: ruleClassification !== 'clarification-request',
      earlyCompletionReason: null,
    };
  }

  const fallbackAnalysis = buildFallbackAnswerAnalysis({
    state: options.state,
    activeRound,
    activeNode,
    userMessage: options.userMessage,
    ruleClassification,
  });

  return ensureGeneratedFollowUpQuestion({
    state: options.state,
    activeRound,
    activeNode,
    currentQuestion,
    userMessage: options.userMessage,
    analysis: fallbackAnalysis,
  });
}

function buildStateManagerOutput(options: {
  readonly state: InterviewSessionState;
  readonly assistantReply: string;
  readonly flowTestMockUserReply?: string | null;
}): z.infer<typeof interviewStateManagerOutputSchema> {
  const activeRound = options.state.rounds.find((round) => round.id === options.state.activeRoundId) ?? null;
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId) ?? null;

  return {
    assistantReply: options.assistantReply,
    flowTestMockUserReply: options.flowTestMockUserReply ?? null,
    phase: options.state.phase,
    activeRoundType: activeRound?.type ?? null,
    activeNodeTopic: activeNode?.topic ?? null,
    finalReportReady: options.state.finalReportReady,
    progress: buildInterviewProgressSummary(options.state),
  };
}

function buildEvaluationWaitBlockedReply(
  state: InterviewSessionState,
  waitResult: WaitAndReadInterviewEvaluationsOutput,
): string {
  if (state.responseLanguage === 'zh') {
    if (waitResult.blockingReason === 'failed') {
      return `面试题目已经完成，但异步评分中有 ${waitResult.failedCount} 个任务失败，暂时不能生成最终报告。请稍后重试或让系统重新处理失败任务。`;
    }

    return `面试题目已经完成，我正在等待异步评分完成后生成最终报告。当前进度：${waitResult.completedCount}/${waitResult.expectedCount}。请稍后再发送一条消息获取报告。`;
  }

  if (waitResult.blockingReason === 'failed') {
    return `The interview questions are complete, but ${waitResult.failedCount} async evaluation task(s) failed, so I cannot generate the final report yet. Please retry after the failed task is reprocessed.`;
  }

  return `The interview questions are complete. I am waiting for async evaluations before generating the final report. Current progress: ${waitResult.completedCount}/${waitResult.expectedCount}. Please send another message shortly to fetch the report.`;
}

function buildPendingFinalReportState(state: InterviewSessionState): InterviewSessionState {
  return validateInterviewState({
    ...state,
    phase: 'wrap-up',
    activeRoundId: null,
    finalReportReady: false,
    finalReport: null,
  });
}

function countExpectedEvaluationAttempts(state: InterviewSessionState): number {
  return state.rounds.reduce(
    (total, round) =>
      total +
      round.nodes.reduce(
        (nodeTotal, node) =>
          nodeTotal + node.answerAttempts.filter((attempt) => attempt.score !== null && !attempt.isDetour).length,
        0,
      ),
    0,
  );
}

export async function completeFinalReportWithAsyncEvaluations(options: {
  readonly state: InterviewSessionState;
  readonly store: AnswerEvaluationStore;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
}): Promise<{
  readonly state: InterviewSessionState;
  readonly assistantReply: string;
  readonly ready: boolean;
}> {
  const expectedEvaluationAttemptCount = countExpectedEvaluationAttempts(options.state);
  const manifest = await options.store.readManifest(options.state.threadId);
  if (!manifest) {
    if (expectedEvaluationAttemptCount === 0) {
      return {
        state: options.state,
        assistantReply: options.state.finalReport ?? '',
        ready: true,
      };
    }

    const pendingState = buildPendingFinalReportState(options.state);
    return {
      state: pendingState,
      assistantReply: buildEvaluationWaitBlockedReply(pendingState, {
        ready: false,
        sealed: false,
        expectedCount: expectedEvaluationAttemptCount,
        completedCount: 0,
        failedCount: 0,
        evaluations: [],
        waitElapsedMs: 0,
        blockingReason: 'manifest-missing',
      }),
      ready: false,
    };
  }

  if (manifest.expectedTaskIds.length < expectedEvaluationAttemptCount) {
    const pendingState = buildPendingFinalReportState(options.state);
    return {
      state: pendingState,
      assistantReply: buildEvaluationWaitBlockedReply(pendingState, {
        ready: false,
        sealed: manifest.sealed,
        expectedCount: expectedEvaluationAttemptCount,
        completedCount: manifest.completedTaskIds.length,
        failedCount: manifest.failedTaskIds.length,
        evaluations: [],
        waitElapsedMs: 0,
        blockingReason: 'pending',
      }),
      ready: false,
    };
  }

  await options.store.sealInterview(options.state.threadId);
  const waitResult = await waitAndReadInterviewEvaluations(
    {
      interviewId: options.state.threadId,
      threadId: options.state.threadId,
      pollIntervalMs: options.pollIntervalMs ?? REPORT_EVALUATION_POLL_INTERVAL_MS,
      maxWaitMs: options.maxWaitMs ?? REPORT_EVALUATION_MAX_WAIT_MS,
    },
    { store: options.store },
  );

  if (!waitResult.ready) {
    const pendingState = buildPendingFinalReportState(options.state);
    return {
      state: pendingState,
      assistantReply: buildEvaluationWaitBlockedReply(pendingState, waitResult),
      ready: false,
    };
  }

  const finalState = buildFinalInterviewStateFromEvaluations(options.state, waitResult.evaluations);

  return {
    state: finalState,
    assistantReply: finalState.finalReport ?? '',
    ready: true,
  };
}

async function maybeFinalizeReportWithAsyncEvaluations(options: {
  readonly beforeState: InterviewSessionState;
  readonly resultState: InterviewSessionState;
  readonly userMessage: string;
  readonly resourceId?: string;
  readonly isFlowTestSkip: boolean;
}): Promise<{
  readonly state: InterviewSessionState;
  readonly assistantReply: string | null;
}> {
  if (!options.resultState.finalReportReady) {
    if (!options.isFlowTestSkip) {
      void enqueueAnswerEvaluationTaskBestEffort(
        {
          beforeState: options.beforeState,
          afterState: options.resultState,
          userMessage: options.userMessage,
          resourceId: options.resourceId,
        },
        {
          logger: stateManagerLogger,
        },
      );
    }

    return { state: options.resultState, assistantReply: null };
  }

  if (options.isFlowTestSkip) {
    return {
      state: options.resultState,
      assistantReply: options.resultState.finalReport ?? '',
    };
  }

  const redisClient = await createRedisEvaluationClient();
  const store = createRedisAnswerEvaluationStore(redisClient);

  try {
    if (!options.isFlowTestSkip) {
      await enqueueAnswerEvaluationTaskBestEffort(
        {
          beforeState: options.beforeState,
          afterState: options.resultState,
          userMessage: options.userMessage,
          resourceId: options.resourceId,
        },
        {
          store,
          logger: stateManagerLogger,
        },
      );
    }

    return await completeFinalReportWithAsyncEvaluations({
      state: options.resultState,
      store,
    });
  } finally {
    await redisClient.disconnect();
  }
}

export const interviewStateManagerTool = createTool({
  id: 'interview-state-manager',
  description:
    'Owns the explicit interview state machine. It initializes the interview session, processes candidate replies, persists structured thread state, and returns the exact next interviewer reply.',
  inputSchema: interviewStateManagerInputSchema,
  outputSchema: interviewStateManagerOutputSchema,
  execute: async (input, context) => {
    const { memory, threadId, resourceId } = getMemoryContext(context);
    await ensureThread(memory, threadId, resourceId);

    if (input.action === 'initialize-session') {
      const initializationStartedAt = Date.now();
      const kickoffPayloadFormat = detectKickoffPayloadFormat(input.rawKickoffMessage);
      const initializationResources = await resolveInterviewInitializationResources(input.rawKickoffMessage);
      const state = recoverMissingInterviewSession({
        threadId,
        rawKickoffMessage: input.rawKickoffMessage,
        professionalSkills: initializationResources.professionalSkills,
        projectExperience: initializationResources.projectExperience,
        normalizedProfessionalSkills: initializationResources.normalizedProfessionalSkills,
        normalizedProjectTopics: initializationResources.normalizedProjectTopics,
        jobDescription: initializationResources.jobDescription,
        professionalQuestions: initializationResources.professionalQuestions,
        projectQuestions: initializationResources.projectQuestions,
      });
      await writeState(memory, state, threadId, resourceId);

      try {
        const sampleFilePath = await writeInitializationRagRecallSample({
          threadId,
          targetRole: state.targetRole,
          recallTraces: initializationResources.recallTraces,
          state,
        });
        await writeThreadMetadataValue(memory, threadId, RAG_RECALL_SAMPLE_PATH_KEY, sampleFilePath);
      } catch (error) {
        stateManagerLogger.warn('Failed to persist initialization RAG recall sample', {
          event: 'interview.state_manager.rag_recall_sample.init_failed',
          threadId,
          err: error,
        });
      }

      try {
        const outcomeFilePath = await createInterviewOutcomeSnapshot({
          threadId,
          state,
          recallTraces: initializationResources.recallTraces,
          generationTrace: initializationResources.generationTrace,
        });
        await writeThreadMetadataValue(memory, threadId, INTERVIEW_OUTCOME_PATH_KEY, outcomeFilePath);
      } catch (error) {
        stateManagerLogger.warn('Failed to persist interview outcome snapshot during initialization', {
          event: 'interview.state_manager.outcome.init_failed',
          threadId,
          err: error,
        });
      }

      stateManagerLogger.info('Interview session initialized', {
        event: 'interview.state_manager.initialized',
        threadId,
        kickoffPayloadFormat,
        elapsedMs: Date.now() - initializationStartedAt,
        phase: state.phase,
        professionalQuestionCount: initializationResources.professionalQuestions.length,
        projectQuestionCount: initializationResources.projectQuestions.length,
        flowTestMode: state.setup.settings.enableFlowTestMode,
      });

      return buildStateManagerOutput({
        state,
        assistantReply: state.finalReport ?? buildInitializationReply(state),
        flowTestMockUserReply: null,
      });
    }

    const currentState = await readState(memory, threadId, resourceId);
    if (!currentState) {
      const kickoffPayloadFormat = detectKickoffPayloadFormat(input.userMessage);
      const recoveredState = recoverMissingInterviewSession({
        threadId,
        rawKickoffMessage: input.userMessage,
      });
      await writeState(memory, recoveredState, threadId, resourceId);

      stateManagerLogger.info('Interview session state recovered from kickoff payload', {
        event: 'interview.state_manager.recovered_missing_state',
        threadId,
        kickoffPayloadFormat,
        phase: recoveredState.phase,
        flowTestMode: recoveredState.setup.settings.enableFlowTestMode,
      });

      try {
        const outcomeFilePath = await createInterviewOutcomeSnapshot({
          threadId,
          state: recoveredState,
          recallTraces: [],
        });
        await writeThreadMetadataValue(memory, threadId, INTERVIEW_OUTCOME_PATH_KEY, outcomeFilePath);
      } catch (error) {
        stateManagerLogger.warn('Failed to persist interview outcome snapshot during recovery', {
          event: 'interview.state_manager.outcome.recovery_failed',
          threadId,
          err: error,
        });
      }

      return buildStateManagerOutput({
        state: recoveredState,
        assistantReply: recoveredState.finalReport ?? buildInitializationReply(recoveredState),
        flowTestMockUserReply: null,
      });
    }

    const isFlowTestSkip =
      currentState.setup.settings.enableFlowTestMode && isFlowTestSkipMessage(input.userMessage);
    const flowTestMockUserReply = isFlowTestSkip ? buildFlowTestMockUserReply({ state: currentState }) : null;
    const storedUserMessage = flowTestMockUserReply ?? input.userMessage;
    if (isFlowTestSkip) {
      stateManagerLogger.info('Interview flow-test skip processed', {
        event: 'interview.state_manager.flow_test_skip',
        threadId,
        activeRoundId: currentState.activeRoundId,
        phase: currentState.phase,
      });
    }

    const evaluation = await analyzeAnswer({
      state: currentState,
      userMessage: storedUserMessage,
      isFlowTestSkip,
    });
    const result = applyUserReply({
      state: currentState,
      userMessage: storedUserMessage,
      evaluation,
    });
    const finalizedResult = await maybeFinalizeReportWithAsyncEvaluations({
      beforeState: currentState,
      resultState: result.state,
      userMessage: storedUserMessage,
      resourceId,
      isFlowTestSkip,
    });
    const nextState = finalizedResult.state;
    const assistantReply = finalizedResult.assistantReply ?? result.assistantReply;

    await writeState(memory, nextState, threadId, resourceId);

    try {
      const outcomeFilePath = await readThreadMetadataValue(memory, threadId, INTERVIEW_OUTCOME_PATH_KEY);
      if (outcomeFilePath) {
        await updateInterviewOutcomeSnapshot({
          filePath: outcomeFilePath,
          state: nextState,
        });
      } else {
        const createdOutcomeFilePath = await createInterviewOutcomeSnapshot({
          threadId,
          state: nextState,
          recallTraces: [],
        });
        await writeThreadMetadataValue(memory, threadId, INTERVIEW_OUTCOME_PATH_KEY, createdOutcomeFilePath);
      }
    } catch (error) {
      stateManagerLogger.warn('Failed to persist interview outcome snapshot after reply', {
        event: 'interview.state_manager.outcome.update_failed',
        threadId,
        err: error,
      });
    }

    try {
      const sampleFilePath = await readThreadMetadataValue(memory, threadId, RAG_RECALL_SAMPLE_PATH_KEY);
      if (sampleFilePath) {
        await updateRagRecallSampleAnswerPerformance(sampleFilePath, nextState);
      }
    } catch (error) {
      stateManagerLogger.warn('Failed to update RAG recall sample answer performance', {
        event: 'interview.state_manager.rag_recall_sample.update_failed',
        threadId,
        err: error,
      });
    }

    stateManagerLogger.info('Interview reply processed', {
      event: 'interview.state_manager.processed_reply',
      threadId,
      classification: evaluation.classification,
      flowTestSkip: isFlowTestSkip,
      phase: nextState.phase,
      currentStage: nextState.finalReportReady ? 'completed' : nextState.phase,
      remainingQuestionCount: buildInterviewProgressSummary(nextState).remainingQuestionCount,
    });

    return buildStateManagerOutput({
      state: nextState,
      assistantReply,
      flowTestMockUserReply,
    });
  },
});

function buildInitializationReply(state: InterviewSessionState): string {
  const activeRound = state.rounds.find((round) => round.id === state.activeRoundId) ?? null;
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId) ?? null;
  const roundLabel =
    activeRound?.type === 'professional-skills'
      ? state.responseLanguage === 'zh'
        ? '【第一轮：专业技能面试】'
        : '[Round 1: Professional Skills Interview]'
      : state.responseLanguage === 'zh'
        ? '【第二轮：项目经历面试】'
        : '[Round 2: Project Experience Interview]';
  const intro =
    state.responseLanguage === 'zh'
      ? `我们将围绕 ${state.targetRole} 岗位进行结构化模拟面试。第一轮会按 6 个专业技能点逐点深挖，每个点最多 3 次追问。`
      : `We will run a structured mock interview for the ${state.targetRole} role. The first round is organized into 6 professional-skill nodes with up to 3 follow-up questions per node.`;
  const skips = [
    state.setup.settings.skipProfessionalSkillsRound
      ? state.responseLanguage === 'zh'
        ? '根据当前设置，我会跳过第一轮专业技能面试。'
        : 'Based on the current settings, I will skip the professional-skills round.'
      : '',
    state.setup.settings.skipProjectExperienceRound
      ? state.responseLanguage === 'zh'
        ? '根据当前设置，我会在第一轮后跳过项目经历面试。'
        : 'Based on the current settings, I will skip the project-experience round after round 1.'
      : '',
  ].filter((line) => line.length > 0);

  return [intro, ...skips, roundLabel, activeNode?.mainQuestion ?? ''].filter((line) => line.length > 0).join('\n\n');
}
