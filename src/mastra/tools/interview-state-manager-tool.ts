import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { z } from 'zod';

import {
  applyUserReply,
  buildInterviewProgressSummary,
  classifyByRules,
  extractResumeTopics,
  validateInterviewState,
} from '../lib/interview-state-machine';
import {
  extractJobDescriptionMarkdownFromKickoffMessage,
  extractResumeSectionsFromKickoffMessage,
  recoverMissingInterviewSession,
} from '../lib/interview-kickoff-recovery';
import {
  createInterviewOutcomeSnapshot,
  updateInterviewOutcomeSnapshot,
} from '../lib/interview-outcome';
import {
  answerScoreSchema,
  followUpIntentSchema,
  interviewQuestionCandidateSchema,
  interviewWorkingMemorySchema,
  type AnswerScore,
  type InterviewSessionState,
} from '../lib/interview-state-machine-schema';
import { planProfessionalQuestionQueries } from '../lib/interview-question-planner';
import { mastraLogger } from '../lib/logger';
import {
  buildProfessionalSkillQuery,
  describeProfessionalPlanSkill,
} from '../lib/professional-question-query';
import {
  type RagRecallTrace,
  updateRagRecallSampleAnswerPerformance,
  writeInitializationRagRecallSample,
} from '../lib/rag-recall-sample';
import { queryInterviewQuestions } from './interview-question-tool';
import { glmAirModel } from '../lib/zhipu-model';

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

function parseIntegerSetting(rawKickoffMessage: string, label: string, defaultValue: number): number {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`, 'i');
  const match = rawKickoffMessage.match(pattern);
  if (!match) {
    return defaultValue;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? defaultValue : value;
}

function parseProfessionalQuestionMode(rawKickoffMessage: string): 'per-skill-default' | 'custom-count' {
  const match = rawKickoffMessage.match(/Professional question mode:\s*(per-skill-default|custom-count)/i);
  return match?.[1]?.toLowerCase() === 'custom-count' ? 'custom-count' : 'per-skill-default';
}

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

interface InitializationResourcesInput {
  readonly action: 'initialize-session';
  readonly rawKickoffMessage: string;
}

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

function extractSelectedDirectionFromKickoffMessage(rawKickoffMessage: string): string {
  const selectedDirectionMatch = rawKickoffMessage.match(/Selected interview direction:\s*(.+)/i);
  const selectedDirection = selectedDirectionMatch?.[1]?.trim();
  if (selectedDirection && selectedDirection.toLowerCase() !== 'unknown') {
    return selectedDirection;
  }

  return /[\u3400-\u9fff]/.test(rawKickoffMessage) ? '通用技术岗位' : 'General Technical Role';
}

function buildInitializationQuery(options: {
  readonly selectedDirection: string;
  readonly roundType: 'professional-skills' | 'project-experience';
  readonly sectionContent: string;
  readonly rawKickoffMessage: string;
}): string {
  const sectionHeading = options.roundType === 'professional-skills' ? 'Professional skills' : 'Project experience';
  const fallbackContext = options.sectionContent.trim() || options.rawKickoffMessage;

  return [
    `Target role: ${options.selectedDirection}`,
    `Round type: ${options.roundType}`,
    `${sectionHeading} context:`,
    fallbackContext,
  ].join('\n');
}

type QuestionQueryResult = Awaited<ReturnType<typeof queryInterviewQuestions>>;

function createRecallTraceCollector(recallTraces: RagRecallTrace[]): (trace: RagRecallTrace) => void {
  return (trace) => {
    recallTraces.push(trace);
  };
}

function combineQuestionQueryResults(results: readonly QuestionQueryResult[]): QuestionQueryResult {
  return {
    count: results.reduce((total, result) => total + result.count, 0),
    questions: results.flatMap((result) => result.questions),
  };
}

async function resolveProfessionalInitializationQuestions(options: {
  readonly professionalQuestionPlan: ReturnType<typeof planProfessionalQuestionQueries>;
  readonly selectedDirection: string;
  readonly professionalSkills: string;
  readonly projectExperience: string;
  readonly rawKickoffMessage: string;
  readonly onRecallTrace: (trace: RagRecallTrace) => void;
}): Promise<QuestionQueryResult> {
  if (options.professionalQuestionPlan.length === 0) {
    return queryInterviewQuestions({
      queryText: buildInitializationQuery({
        selectedDirection: options.selectedDirection,
        roundType: 'professional-skills',
        sectionContent: options.professionalSkills,
        rawKickoffMessage: options.rawKickoffMessage,
      }),
      topK: 10,
      roundType: 'professional-skills',
      skill: 'professional-skills-context',
      logContext: 'initialization:professional-skills:context',
      onRecallTrace: options.onRecallTrace,
    });
  }

  const results = await Promise.all(
    options.professionalQuestionPlan.map((plan) =>
      queryInterviewQuestions({
        queryText: buildProfessionalSkillQuery({
          selectedDirection: options.selectedDirection,
          plan,
          professionalSkills: options.professionalSkills,
          projectExperience: options.projectExperience,
        }),
        topK: 1,
        roundType: 'professional-skills',
        skill: describeProfessionalPlanSkill(plan),
        logContext: `initialization:professional-skills:${describeProfessionalPlanSkill(plan)}`,
        onRecallTrace: options.onRecallTrace,
      }),
    ),
  );

  return combineQuestionQueryResults(results);
}

async function resolveProjectInitializationQuestions(options: {
  readonly selectedDirection: string;
  readonly projectExperience: string;
  readonly rawKickoffMessage: string;
  readonly onRecallTrace: (trace: RagRecallTrace) => void;
}): Promise<QuestionQueryResult> {
  return queryInterviewQuestions({
    queryText: buildInitializationQuery({
      selectedDirection: options.selectedDirection,
      roundType: 'project-experience',
      sectionContent: options.projectExperience,
      rawKickoffMessage: options.rawKickoffMessage,
    }),
    topK: 10,
    roundType: 'project-experience',
    skill: 'project-experience-context',
    logContext: 'initialization:project-experience:context',
    onRecallTrace: options.onRecallTrace,
  });
}

async function resolveInitializationResources(input: InitializationResourcesInput): Promise<{
  readonly professionalSkills: string;
  readonly projectExperience: string;
  readonly jobDescription: string;
  readonly professionalQuestions: readonly z.infer<typeof interviewQuestionCandidateSchema>[];
  readonly projectQuestions: readonly z.infer<typeof interviewQuestionCandidateSchema>[];
  readonly recallTraces: readonly RagRecallTrace[];
}> {
  const resumeSections = extractResumeSectionsFromKickoffMessage(input.rawKickoffMessage);
  const professionalSkills = resumeSections.professionalSkills;
  const projectExperience = resumeSections.projectExperience;
  const jobDescription = extractJobDescriptionMarkdownFromKickoffMessage(input.rawKickoffMessage);
  const selectedDirection = extractSelectedDirectionFromKickoffMessage(input.rawKickoffMessage);
  const professionalQuestionMode = parseProfessionalQuestionMode(input.rawKickoffMessage);
  const requestedProfessionalQuestionCount = parseIntegerSetting(input.rawKickoffMessage, 'Professional question count', 0);
  const extractedProfessionalSkills = extractResumeTopics(professionalSkills);
  const desiredProfessionalQuestionCount =
    professionalQuestionMode === 'per-skill-default'
      ? extractedProfessionalSkills.length
      : requestedProfessionalQuestionCount;
  const professionalQuestionPlan = planProfessionalQuestionQueries({
    mode: professionalQuestionMode,
    professionalSkills: extractedProfessionalSkills,
    desiredQuestionCount: desiredProfessionalQuestionCount,
  });
  const recallTraces: RagRecallTrace[] = [];
  const onRecallTrace = createRecallTraceCollector(recallTraces);

  const [professionalQueryResult, projectQueryResult] = await Promise.all([
    resolveProfessionalInitializationQuestions({
      professionalQuestionPlan,
      selectedDirection,
      professionalSkills,
      projectExperience,
      rawKickoffMessage: input.rawKickoffMessage,
      onRecallTrace,
    }),
    resolveProjectInitializationQuestions({
      selectedDirection,
      projectExperience,
      rawKickoffMessage: input.rawKickoffMessage,
      onRecallTrace,
    }),
  ]);

  return {
    professionalSkills,
    projectExperience,
    jobDescription,
    professionalQuestions: professionalQueryResult.questions,
    projectQuestions: projectQueryResult.questions,
    recallTraces,
  };
}

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

function extractJsonObjectText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;
  const startIndex = candidate.indexOf('{');
  const endIndex = candidate.lastIndexOf('}');

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return candidate.slice(startIndex, endIndex + 1);
}

function parseModelJsonObject(text: string): Record<string, unknown> | null {
  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function buildNodeConversationRecord(options: {
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly userMessage: string;
}): string {
  const lines = [`Interviewer main question: ${options.activeNode.mainQuestion}`];
  const answerAttemptsByTargetId = new Map<string, string>();

  for (const attempt of options.activeNode.answerAttempts) {
    answerAttemptsByTargetId.set(attempt.targetId, attempt.userMessage);
  }

  const mainAnswer = options.activeNode.answerAttempts.find((attempt) => attempt.targetType === 'main-question')?.userMessage;
  if (mainAnswer) {
    lines.push(`Candidate answer #1: ${mainAnswer}`);
  }

  for (const followUp of options.activeNode.followUps) {
    if (followUp.status === 'pending' || !followUp.question.trim()) {
      continue;
    }

    lines.push(`Interviewer follow-up #${followUp.index}: ${followUp.question}`);
    const linkedAnswer = followUp.linkedAnswerId
      ? options.activeNode.answerAttempts.find((attempt) => attempt.id === followUp.linkedAnswerId)?.userMessage
      : answerAttemptsByTargetId.get(followUp.id);
    if (linkedAnswer) {
      lines.push(`Candidate answer #${followUp.index + 1}: ${linkedAnswer}`);
    }
  }

  const lastRecordedAnswer = options.activeNode.answerAttempts.at(-1)?.userMessage?.trim();
  if (options.userMessage.trim() !== lastRecordedAnswer) {
    lines.push(`Candidate latest answer: ${options.userMessage}`);
  }

  return lines.join('\n');
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

  return {
    classification,
    score: buildAnswerScore({
      relevance: looksSubstantial ? 7.8 : 6.6,
      accuracy: looksSubstantial ? 7.4 : 6.2,
      depth: looksSubstantial ? 7.2 : 5.8,
      specificity: looksSubstantial ? 7.0 : 5.9,
      clarity: looksSubstantial ? 7.8 : 6.8,
    }),
    strengths: [
      isChinese ? `回答基本围绕“${focusLabel}”展开` : `The answer stayed broadly focused on ${focusLabel}.`,
    ],
    missingPoints: shouldCompleteNode
      ? []
      : [
          isChinese
            ? `还需要继续补充“${focusLabel}”的实现细节、关键取舍或真实案例`
            : `The answer still needs more implementation detail, trade-offs, or a real example for ${focusLabel}.`,
        ],
    incorrectPoints: [],
    recommendedIntent,
    followUpFocus: [focusLabel],
    followUpQuestion: null,
    detourReply: null,
    clarificationReply: null,
    shouldCompleteNode,
    earlyCompletionReason: shouldCompleteNode
      ? isChinese
        ? '回答分析降级为规则兜底后，当前节点已满足推进条件。'
        : 'The answer-analysis fallback determined that the current node can move forward.'
      : null,
  };
}

function shouldGenerateDedicatedFollowUpQuestion(options: {
  readonly analysis: InterviewAnalysisResult;
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
}): boolean {
  if (options.analysis.followUpQuestion?.trim()) {
    return false;
  }

  if (options.activeNode.followUpCount >= options.activeNode.maxFollowUps) {
    return false;
  }

  return (
    options.analysis.classification === 'direct-answer' ||
    options.analysis.classification === 'partial-answer' ||
    options.analysis.classification === 'deep-answer'
  );
}

function buildDedicatedFollowUpQuestionPrompt(options: {
  readonly state: InterviewSessionState;
  readonly activeRound: InterviewSessionState['rounds'][number];
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly currentQuestion: string;
  readonly userMessage: string;
  readonly analysis: InterviewAnalysisResult;
}): string {
  return [
    'You are writing the next interviewer follow-up question for a mock interview.',
    'Return JSON only. Do not add markdown.',
    'Return exactly this shape: {"followUpQuestion":"..."}.',
    `Interview language: ${options.state.responseLanguage}`,
    `Target role: ${options.state.targetRole}`,
    `Round type: ${options.activeRound.type}`,
    `Topic: ${options.activeNode.topic}`,
    `Current target type: ${options.activeNode.currentTargetType}`,
    `Current question: ${options.currentQuestion}`,
    `Main question: ${options.activeNode.mainQuestion}`,
    `Next follow-up index: ${options.activeNode.followUpCount + 1}`,
    `Job description context: ${options.state.resumeContext.jobDescription.trim() || 'not provided'}`,
    'Current question dialogue record:',
    buildNodeConversationRecord({
      activeNode: options.activeNode,
      userMessage: options.userMessage,
    }),
    `Answer classification: ${options.analysis.classification}`,
    `Recommended intent: ${options.analysis.recommendedIntent}`,
    `Follow-up focus: ${options.analysis.followUpFocus.join(' | ') || options.activeNode.topic}`,
    `Missing points: ${options.analysis.missingPoints.join(' | ') || 'none'}`,
    `Incorrect points: ${options.analysis.incorrectPoints.join(' | ') || 'none'}`,
    'Write exactly one short interviewer question that stays on the same topic as the current question and the candidate answer.',
    'Deepen naturally. Do not jump to a much broader topic.',
    'Use this simple deepening pattern:',
    '- index 1: ask the candidate to explain the mentioned concept in more detail',
    '- index 2: ask for concrete use cases, implementation approach, or internal distinctions',
    '- index 3 or above: continue drilling into practical details, trade-offs, limitations, or edge cases that are still directly related',
    'Do not force system design, production pressure, rollback, metrics, or alternative comparisons unless the candidate already brought them up.',
    'Prefer asking about the specific concept the candidate actually mentioned, instead of repeating the full original question.',
    'Example: if the candidate says the key part is memory, ask about memory itself next, not the whole agent architecture question again.',
  ].join('\n');
}

async function generateDedicatedFollowUpQuestion(options: {
  readonly state: InterviewSessionState;
  readonly activeRound: InterviewSessionState['rounds'][number];
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly currentQuestion: string;
  readonly userMessage: string;
  readonly analysis: InterviewAnalysisResult;
}): Promise<string | null> {
  try {
    const result = await generateText({
      model: glmAirModel,
      prompt: buildDedicatedFollowUpQuestionPrompt(options),
    });

    const parsed = parseModelJsonObject(result.text);
    const followUpQuestion = normalizeNullableString(parsed?.followUpQuestion);

    return typeof followUpQuestion === 'string' ? followUpQuestion : null;
  } catch (error) {
    stateManagerLogger.warn('Dedicated follow-up question generation failed', {
      event: 'interview.state_manager.generate_follow_up_question.fallback',
      threadId: options.state.threadId,
      phase: options.state.phase,
      roundType: options.activeRound.type,
      currentTargetType: options.activeNode.currentTargetType,
      err: error,
    });

    return null;
  }
}

async function ensureDedicatedFollowUpQuestion(options: {
  readonly state: InterviewSessionState;
  readonly activeRound: InterviewSessionState['rounds'][number];
  readonly activeNode: InterviewSessionState['rounds'][number]['nodes'][number];
  readonly currentQuestion: string;
  readonly userMessage: string;
  readonly analysis: InterviewAnalysisResult;
}): Promise<InterviewAnalysisResult> {
  if (!shouldGenerateDedicatedFollowUpQuestion({ analysis: options.analysis, activeNode: options.activeNode })) {
    return options.analysis;
  }

  const followUpQuestion = await generateDedicatedFollowUpQuestion(options);
  if (!followUpQuestion) {
    return options.analysis;
  }

  return {
    ...options.analysis,
    followUpQuestion,
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

  return ensureDedicatedFollowUpQuestion({
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
      const initializationResources = await resolveInitializationResources(input);
      const state = recoverMissingInterviewSession({
        threadId,
        rawKickoffMessage: input.rawKickoffMessage,
        professionalSkills: initializationResources.professionalSkills,
        projectExperience: initializationResources.projectExperience,
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
      const recoveredState = recoverMissingInterviewSession({
        threadId,
        rawKickoffMessage: input.userMessage,
      });
      await writeState(memory, recoveredState, threadId, resourceId);

      stateManagerLogger.info('Interview session state recovered from kickoff payload', {
        event: 'interview.state_manager.recovered_missing_state',
        threadId,
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
    await writeState(memory, result.state, threadId, resourceId);

    try {
      const outcomeFilePath = await readThreadMetadataValue(memory, threadId, INTERVIEW_OUTCOME_PATH_KEY);
      if (outcomeFilePath) {
        await updateInterviewOutcomeSnapshot({
          filePath: outcomeFilePath,
          state: result.state,
        });
      } else {
        const createdOutcomeFilePath = await createInterviewOutcomeSnapshot({
          threadId,
          state: result.state,
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
        await updateRagRecallSampleAnswerPerformance(sampleFilePath, result.state);
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
      phase: result.state.phase,
      currentStage: result.state.finalReportReady ? 'completed' : result.state.phase,
      remainingQuestionCount: buildInterviewProgressSummary(result.state).remainingQuestionCount,
    });

    return buildStateManagerOutput({
      state: result.state,
      assistantReply: result.assistantReply,
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