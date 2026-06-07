import { generateText } from 'ai';

import {
  extractJobDescriptionSignalSet,
  resolveQuestionDriver,
  type QuestionDriver,
} from './job-description-signals';
import { mastraLogger } from './logger';
import type {
  AnswerClassification,
  FollowUpIntent,
  InterviewQuestionCandidate,
  InterviewRoundState,
  InterviewSessionState,
  InterviewTopicNodeState,
} from './interview-state-machine-schema';
import type {
  PlannedQuestionDifficulty,
  PlannedQuestionType,
  ProfessionalQuestionPlan,
} from './interview-question-planner';
import { glmAirModel } from './zhipu-model';

const questionGeneratorLogger = mastraLogger.child({
  module: 'interview-question-generator',
});

export interface FollowUpGenerationAnalysis {
  readonly classification: AnswerClassification;
  readonly recommendedIntent: FollowUpIntent;
  readonly followUpFocus: readonly string[];
  readonly followUpQuestion: string | null;
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
}

export interface GeneratedQuestionRecord {
  readonly roundType: 'professional-skills' | 'project-experience';
  readonly source: 'retrieved';
  readonly targetAbility: string | null;
  readonly questionType: PlannedQuestionType | 'project-deep-dive';
  readonly coverageIntent: string;
  readonly questionDriver: QuestionDriver;
  readonly resumeSignals: readonly string[];
  readonly jobDescriptionSignals: readonly string[];
  readonly expectedDifficulty: PlannedQuestionDifficulty | 'medium';
  readonly questionId: string;
  readonly questionText: string;
  readonly selectionReason: string;
}

export interface GenerateInitializationQuestionSetOptions {
  readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly jobDescription?: string;
  readonly normalizedProjectTopics?: readonly string[];
}

export interface GenerateInitializationQuestionSetResult {
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly generationTrace: readonly GeneratedQuestionRecord[];
}

interface EnsureGeneratedFollowUpQuestionOptions<TAnalysis extends FollowUpGenerationAnalysis> {
  readonly state: InterviewSessionState;
  readonly activeRound: InterviewRoundState;
  readonly activeNode: InterviewTopicNodeState;
  readonly currentQuestion: string;
  readonly userMessage: string;
  readonly analysis: TAnalysis;
}

interface FollowUpGenerationDependencies {
  readonly generateFollowUpQuestion: <TAnalysis extends FollowUpGenerationAnalysis>(
    options: EnsureGeneratedFollowUpQuestionOptions<TAnalysis>,
  ) => Promise<string | null>;
}

function normalizeQuestionCandidate(question: InterviewQuestionCandidate): InterviewQuestionCandidate | null {
  const normalizedText = question.text.trim();
  if (!normalizedText) {
    return null;
  }

  return {
    ...question,
    text: normalizedText,
  };
}

function buildProfessionalGenerationTrace(options: {
  readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
}): GeneratedQuestionRecord[] {
  return options.professionalQuestions.map((question, index) => {
    const plan = options.professionalQuestionPlan[index] ?? null;

    return {
      roundType: 'professional-skills',
      source: 'retrieved',
      targetAbility: plan?.targetAbility ?? null,
      questionType: plan?.questionType ?? 'knowledge-check',
      coverageIntent: plan?.coverageIntent ?? 'professional-skills-context',
      questionDriver: plan?.questionDriver ?? 'resume',
      resumeSignals: plan?.resumeSignals ?? [],
      jobDescriptionSignals: plan?.jobDescriptionSignals ?? [],
      expectedDifficulty: plan?.expectedDifficulty ?? 'medium',
      questionId: question.id,
      questionText: question.text,
      selectionReason:
        plan?.selectionReason ??
        'Adapted a retrieved professional-skills candidate into the final main-question set.',
    };
  });
}

function buildProjectGenerationTrace(options: {
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly jobDescription?: string;
  readonly normalizedProjectTopics?: readonly string[];
}): GeneratedQuestionRecord[] {
  const signalSet = extractJobDescriptionSignalSet({
    jobDescription: options.jobDescription,
    projectTopics: options.normalizedProjectTopics,
  });
  const jobDescriptionSignals = (
    signalSet.alignedSignals.length > 0 ? signalSet.alignedSignals : signalSet.topSignals
  ).slice(0, 3);
  const resumeSignals = (options.normalizedProjectTopics ?? []).slice(0, 3);
  const questionDriver = resolveQuestionDriver({
    hasResumeSignals: resumeSignals.length > 0,
    hasJobDescriptionSignals: jobDescriptionSignals.length > 0,
  });
  const selectionReason = questionDriver === 'resume-and-job-description'
    ? 'Adapted a retrieved project-experience candidate into the final main-question set by cross-checking JD requirements against project evidence.'
    : questionDriver === 'job-description'
      ? 'Adapted a retrieved project-experience candidate into the final main-question set to validate a JD requirement with limited resume evidence.'
      : 'Adapted a retrieved project-experience candidate into the final main-question set.';

  return options.projectQuestions.map((question) => ({
    roundType: 'project-experience',
    source: 'retrieved',
    targetAbility: null,
    questionType: 'project-deep-dive',
    coverageIntent: 'project-experience-context',
    questionDriver,
    resumeSignals,
    jobDescriptionSignals,
    expectedDifficulty: 'medium',
    questionId: question.id,
    questionText: question.text,
    selectionReason,
  }));
}

function buildNodeConversationRecord(options: {
  readonly activeNode: InterviewTopicNodeState;
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

function shouldGenerateDedicatedFollowUpQuestion<TAnalysis extends FollowUpGenerationAnalysis>(options: {
  readonly analysis: TAnalysis;
  readonly activeNode: InterviewTopicNodeState;
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

function buildDedicatedFollowUpQuestionPrompt<TAnalysis extends FollowUpGenerationAnalysis>(
  options: EnsureGeneratedFollowUpQuestionOptions<TAnalysis>,
): string {
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

async function generateFollowUpQuestionWithModel<TAnalysis extends FollowUpGenerationAnalysis>(
  options: EnsureGeneratedFollowUpQuestionOptions<TAnalysis>,
): Promise<string | null> {
  try {
    const result = await generateText({
      model: glmAirModel,
      prompt: buildDedicatedFollowUpQuestionPrompt(options),
    });

    const parsed = parseModelJsonObject(result.text);
    const followUpQuestion = normalizeNullableString(parsed?.followUpQuestion);

    return typeof followUpQuestion === 'string' ? followUpQuestion : null;
  } catch (error) {
    questionGeneratorLogger.warn('Dedicated follow-up question generation failed', {
      event: 'interview.question_generator.generate_follow_up_question.fallback',
      threadId: options.state.threadId,
      phase: options.state.phase,
      roundType: options.activeRound.type,
      currentTargetType: options.activeNode.currentTargetType,
      err: error,
    });

    return null;
  }
}

export function generateInitializationQuestionSet(
  options: GenerateInitializationQuestionSetOptions,
): GenerateInitializationQuestionSetResult {
  const professionalQuestions = options.professionalQuestions
    .map(normalizeQuestionCandidate)
    .filter((question): question is InterviewQuestionCandidate => question !== null);
  const projectQuestions = options.projectQuestions
    .map(normalizeQuestionCandidate)
    .filter((question): question is InterviewQuestionCandidate => question !== null);

  return {
    professionalQuestions,
    projectQuestions,
    generationTrace: [
      ...buildProfessionalGenerationTrace({
        professionalQuestionPlan: options.professionalQuestionPlan,
        professionalQuestions,
      }),
      ...buildProjectGenerationTrace({
        projectQuestions,
        jobDescription: options.jobDescription,
        normalizedProjectTopics: options.normalizedProjectTopics,
      }),
    ],
  };
}

export async function ensureGeneratedFollowUpQuestion<TAnalysis extends FollowUpGenerationAnalysis>(
  options: EnsureGeneratedFollowUpQuestionOptions<TAnalysis>,
  deps: Partial<FollowUpGenerationDependencies> = {},
): Promise<TAnalysis> {
  if (!shouldGenerateDedicatedFollowUpQuestion({ analysis: options.analysis, activeNode: options.activeNode })) {
    return options.analysis;
  }

  const generateFollowUpQuestion = deps.generateFollowUpQuestion ?? generateFollowUpQuestionWithModel;
  const followUpQuestion = await generateFollowUpQuestion(options);
  if (!followUpQuestion) {
    return options.analysis;
  }

  return {
    ...options.analysis,
    followUpQuestion,
  };
}