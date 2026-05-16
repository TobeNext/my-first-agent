import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AnswerAttemptState,
  InterviewSessionState,
  InterviewTopicNodeState,
  RoundType,
} from './interview-state-machine-schema';
import type { RagRecallTrace } from './rag-recall-sample';

const INTERVIEW_OUTCOME_DIRECTORY_NAME = 'Interview outcome';
const INTERVIEW_OUTCOME_INDEX_DIRECTORY_NAME = 'index';
const INTERVIEW_OUTCOME_SCHEMA_VERSION = 2;

interface InterviewOutcomeFeedback {
  readonly status: 'pending' | 'submitted';
  readonly submittedAt: string | null;
  readonly overallExperienceScore: number | null;
  readonly questionFitScore: number | null;
  readonly difficultyScore: number | null;
  readonly comment: string | null;
}

interface OutcomeAnswerAttemptRecord {
  readonly id: string;
  readonly targetType: AnswerAttemptState['targetType'];
  readonly targetId: string;
  readonly classification: AnswerAttemptState['classification'];
  readonly createdAt: string;
  readonly userMessage: string;
  readonly score: AnswerAttemptState['score'];
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
  readonly isDetour: boolean;
}

interface OutcomeNodeRecord {
  readonly id: string;
  readonly topic: string;
  readonly source: InterviewTopicNodeState['source'];
  readonly mainQuestion: string;
  readonly status: InterviewTopicNodeState['status'];
  readonly aggregatedScore: number | null;
  readonly followUpCount: number;
  readonly maxFollowUps: number;
  readonly earlyCompletionReason: string | null;
  readonly summary: InterviewTopicNodeState['summary'];
  readonly answerAttempts: readonly OutcomeAnswerAttemptRecord[];
}

interface OutcomeRoundRecord {
  readonly id: string;
  readonly type: RoundType;
  readonly status: 'pending' | 'in-progress' | 'completed' | 'skipped';
  readonly plannedNodeCount: number;
  readonly completedNodeCount: number;
  readonly activeNodeId: string | null;
  readonly nodes: readonly OutcomeNodeRecord[];
}

interface OutcomeQuestionPerformanceRecord {
  readonly roundType: RoundType;
  readonly topic: string;
  readonly mainQuestion: string;
  readonly nodeStatus: InterviewTopicNodeState['status'];
  readonly aggregatedScore: number | null;
  readonly latestClassification: AnswerAttemptState['classification'] | null;
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
}

interface SelectorCandidateRecord {
  readonly questionId: string;
  readonly questionText: string;
  readonly vectorScore: number;
  readonly bm25Score: number;
  readonly hybridScore: number;
  readonly rerankRank: number | null;
  readonly finalSelectionRank: number | null;
  readonly filterReason: string;
  readonly wasSelected: boolean;
  readonly outcomeLabel: OutcomeQuestionPerformanceRecord | null;
}

interface SelectorTrainingEventRecord {
  readonly traceTimestamp: string;
  readonly roundType: RoundType | null;
  readonly skill: string;
  readonly queryText: string;
  readonly logContext: string;
  readonly candidates: readonly SelectorCandidateRecord[];
}

interface SelectorTrainingLabelRecord {
  readonly traceTimestamp: string;
  readonly roundType: RoundType | null;
  readonly skill: string;
  readonly queryText: string;
  readonly logContext: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly vectorScore: number;
  readonly bm25Score: number;
  readonly hybridScore: number;
  readonly rerankRank: number;
  readonly finalSelectionRank: number;
  readonly performance: OutcomeQuestionPerformanceRecord | null;
}

interface CandidateThemeRecord {
  readonly theme: string;
  readonly frequency: number;
  readonly affectedTopics: readonly string[];
  readonly exampleQuestions: readonly string[];
  readonly evidence: readonly string[];
  readonly averageQuestionScore: number | null;
}

interface CandidateKnowledgeWeaknessRecord extends CandidateThemeRecord {
  readonly kind: 'missing-knowledge' | 'incorrect-knowledge';
  readonly priority: 'high' | 'medium' | 'low';
}

interface CandidateQuestionReviewRecord {
  readonly roundType: RoundType;
  readonly topic: string;
  readonly question: string;
  readonly score: number | null;
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
  readonly improvementAdvice: readonly string[];
  readonly evidence: readonly string[];
}

interface InterviewOutcomeRecord {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly threadId: string;
  readonly session: {
    readonly targetRole: string;
    readonly responseLanguage: InterviewSessionState['responseLanguage'];
    readonly phase: InterviewSessionState['phase'];
    readonly finalReportReady: boolean;
    readonly setup: InterviewSessionState['setup'];
    readonly resumeContext: InterviewSessionState['resumeContext'];
  };
  readonly selectorTraining: {
    readonly traces: readonly RagRecallTrace[];
    readonly recallEvents: readonly SelectorTrainingEventRecord[];
    readonly selectedQuestionLabels: readonly SelectorTrainingLabelRecord[];
  };
  readonly candidateImprovement: {
    readonly totalQuestionCount: number;
    readonly completedQuestionCount: number;
    readonly finalScore: number | null;
    readonly rounds: readonly OutcomeRoundRecord[];
    readonly strongSignals: readonly CandidateThemeRecord[];
    readonly knowledgeWeaknesses: readonly CandidateKnowledgeWeaknessRecord[];
    readonly questionReviews: readonly CandidateQuestionReviewRecord[];
    readonly report: {
      readonly finalReport: string | null;
      readonly lastCorrectionSummary: string | null;
    };
    readonly feedback: InterviewOutcomeFeedback;
  };
}

type CandidateImprovementPerformanceSummary = Pick<
  InterviewOutcomeRecord['candidateImprovement'],
  'totalQuestionCount' | 'completedQuestionCount' | 'finalScore' | 'rounds'
>;

type LegacyInterviewOutcomeRecord = InterviewOutcomeRecord & {
  readonly userFeedback?: InterviewOutcomeFeedback;
};

interface InterviewOutcomeIndexRecord {
  readonly threadId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly outcomeFilePath: string;
}

function getSearchDirectories(): readonly string[] {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.cwd(),
    moduleDirectory,
    resolve(moduleDirectory, '..'),
    resolve(moduleDirectory, '../..'),
    resolve(moduleDirectory, '../../..'),
    resolve(moduleDirectory, '../../../..'),
  ];

  return [...new Set(candidates)];
}

function resolveWorkspaceRootPath(): string {
  const candidate = getSearchDirectories().find((directory) => {
    return existsSync(resolve(directory, 'package.json')) && existsSync(resolve(directory, 'src'));
  });

  return candidate ?? process.cwd();
}

function getInterviewOutcomeDirectoryPath(): string {
  return resolve(resolveWorkspaceRootPath(), INTERVIEW_OUTCOME_DIRECTORY_NAME);
}

function getInterviewOutcomeIndexDirectoryPath(): string {
  return resolve(getInterviewOutcomeDirectoryPath(), INTERVIEW_OUTCOME_INDEX_DIRECTORY_NAME);
}

function sanitizeTimestampForFileName(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function normalizeQuestionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeThemeKey(value: string): string {
  return normalizeQuestionText(value).toLowerCase();
}

function roundNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(4));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return roundNumber(total / values.length);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function buildNodeRecord(node: InterviewTopicNodeState): OutcomeNodeRecord {
  return {
    id: node.id,
    topic: node.topic,
    source: node.source,
    mainQuestion: node.mainQuestion,
    status: node.status,
    aggregatedScore: roundNumber(node.aggregatedScore),
    followUpCount: node.followUpCount,
    maxFollowUps: node.maxFollowUps,
    earlyCompletionReason: node.earlyCompletionReason,
    summary: node.summary,
    answerAttempts: node.answerAttempts.map((attempt) => ({
      id: attempt.id,
      targetType: attempt.targetType,
      targetId: attempt.targetId,
      classification: attempt.classification,
      createdAt: attempt.createdAt,
      userMessage: attempt.userMessage,
      score: attempt.score,
      strengths: attempt.strengths,
      missingPoints: attempt.missingPoints,
      incorrectPoints: attempt.incorrectPoints,
      isDetour: attempt.isDetour,
    })),
  };
}

function buildRoundRecords(state: InterviewSessionState): OutcomeRoundRecord[] {
  return state.rounds.map((round) => ({
    id: round.id,
    type: round.type,
    status: round.status,
    plannedNodeCount: round.plannedNodeCount,
    completedNodeCount: round.completedNodeCount,
    activeNodeId: round.activeNodeId,
    nodes: round.nodes.map((node) => buildNodeRecord(node)),
  }));
}

function buildQuestionPerformanceMap(state: InterviewSessionState): Map<string, OutcomeQuestionPerformanceRecord> {
  return new Map(
    state.rounds.flatMap((round) =>
      round.nodes.map((node) => {
        const latestAttempt = node.answerAttempts.at(-1) ?? null;

        return [
          normalizeQuestionText(node.mainQuestion),
          {
            roundType: round.type,
            topic: node.topic,
            mainQuestion: node.mainQuestion,
            nodeStatus: node.status,
            aggregatedScore: roundNumber(node.aggregatedScore),
            latestClassification: latestAttempt?.classification ?? null,
            strengths: node.summary?.strengths ?? [],
            missingPoints: node.summary?.missingPoints ?? [],
            incorrectPoints: node.summary?.weaknesses ?? [],
          },
        ] as const;
      }),
    ),
  );
}

function buildSelectorTrainingEvents(
  recallTraces: readonly RagRecallTrace[],
  state: InterviewSessionState,
): SelectorTrainingEventRecord[] {
  const questionPerformanceMap = buildQuestionPerformanceMap(state);

  return recallTraces.map((trace) => ({
    traceTimestamp: trace.timestamp,
    roundType: trace.roundType,
    skill: trace.skill,
    queryText: trace.queryText,
    logContext: trace.logContext,
    candidates: trace.candidates.map((candidate) => ({
      questionId: candidate.id,
      questionText: candidate.questionText,
      vectorScore: candidate.vectorScore,
      bm25Score: candidate.bm25Score,
      hybridScore: candidate.hybridScore,
      rerankRank: candidate.rerankRank,
      finalSelectionRank: candidate.finalSelectionRank,
      filterReason: candidate.filterReason,
      wasSelected: candidate.finalSelectionRank !== null,
      outcomeLabel: questionPerformanceMap.get(normalizeQuestionText(candidate.questionText)) ?? null,
    })),
  }));
}

function buildSelectorTrainingLabels(
  recallTraces: readonly RagRecallTrace[],
  state: InterviewSessionState,
): SelectorTrainingLabelRecord[] {
  const questionPerformanceMap = buildQuestionPerformanceMap(state);

  return recallTraces.flatMap((trace) =>
    trace.finalSelectedQuestions.map((selection) => ({
      traceTimestamp: trace.timestamp,
      roundType: trace.roundType,
      skill: trace.skill,
      queryText: trace.queryText,
      logContext: trace.logContext,
      questionId: selection.id,
      questionText: selection.questionText,
      vectorScore: selection.vectorScore,
      bm25Score: selection.bm25Score,
      hybridScore: selection.hybridScore,
      rerankRank: selection.rerankRank,
      finalSelectionRank: selection.finalSelectionRank,
      performance: questionPerformanceMap.get(normalizeQuestionText(selection.questionText)) ?? null,
    })),
  );
}

function buildPerformanceSummary(state: InterviewSessionState): CandidateImprovementPerformanceSummary {
  const allNodes = state.rounds.flatMap((round) => round.nodes);
  const completedNodeCount = allNodes.filter((node) => node.status === 'completed' || node.status === 'skipped').length;
  const scoredNodes = allNodes
    .map((node) => node.aggregatedScore)
    .filter((score): score is number => typeof score === 'number' && !Number.isNaN(score));

  return {
    totalQuestionCount: allNodes.length,
    completedQuestionCount: completedNodeCount,
    finalScore: average(scoredNodes),
    rounds: buildRoundRecords(state),
  };
}

function buildPendingFeedback(): InterviewOutcomeFeedback {
  return {
    status: 'pending',
    submittedAt: null,
    overallExperienceScore: null,
    questionFitScore: null,
    difficultyScore: null,
    comment: null,
  };
}

function computeWeaknessPriority(options: {
  readonly frequency: number;
  readonly averageQuestionScore: number | null;
}): CandidateKnowledgeWeaknessRecord['priority'] {
  if (options.frequency >= 2) {
    return 'high';
  }

  if (options.averageQuestionScore !== null && options.averageQuestionScore < 6.5) {
    return 'high';
  }

  if (options.averageQuestionScore !== null && options.averageQuestionScore < 7.5) {
    return 'medium';
  }

  return 'low';
}

function buildCandidateThemeRecords(state: InterviewSessionState, kind: 'strength' | 'missing' | 'incorrect'): CandidateThemeRecord[] {
  const buckets = new Map<
    string,
    {
      theme: string;
      frequency: number;
      affectedTopics: Set<string>;
      exampleQuestions: Set<string>;
      evidence: Set<string>;
      scores: number[];
    }
  >();

  for (const round of state.rounds) {
    for (const node of round.nodes) {
      const values =
        kind === 'strength'
          ? node.summary?.strengths ?? []
          : kind === 'missing'
            ? node.summary?.missingPoints ?? []
            : node.summary?.weaknesses ?? [];

      for (const value of values) {
        const key = normalizeThemeKey(value);
        if (!key) {
          continue;
        }

        const existingBucket = buckets.get(key) ?? {
          theme: value,
          frequency: 0,
          affectedTopics: new Set<string>(),
          exampleQuestions: new Set<string>(),
          evidence: new Set<string>(),
          scores: [],
        };

        existingBucket.frequency += 1;
        existingBucket.affectedTopics.add(node.topic);
        existingBucket.exampleQuestions.add(node.mainQuestion);
        for (const evidence of node.summary?.evidence ?? []) {
          existingBucket.evidence.add(evidence);
        }

        if (typeof node.aggregatedScore === 'number' && !Number.isNaN(node.aggregatedScore)) {
          existingBucket.scores.push(node.aggregatedScore);
        }

        buckets.set(key, existingBucket);
      }
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      theme: bucket.theme,
      frequency: bucket.frequency,
      affectedTopics: [...bucket.affectedTopics],
      exampleQuestions: [...bucket.exampleQuestions].slice(0, 3),
      evidence: [...bucket.evidence].slice(0, 3),
      averageQuestionScore: average(bucket.scores),
    }))
    .sort((left, right) => right.frequency - left.frequency || (left.averageQuestionScore ?? 10) - (right.averageQuestionScore ?? 10));
}

function buildKnowledgeWeaknessRecords(state: InterviewSessionState): CandidateKnowledgeWeaknessRecord[] {
  const missingThemes = buildCandidateThemeRecords(state, 'missing').map((theme) => ({
    ...theme,
    kind: 'missing-knowledge' as const,
    priority: computeWeaknessPriority({
      frequency: theme.frequency,
      averageQuestionScore: theme.averageQuestionScore,
    }),
  }));
  const incorrectThemes = buildCandidateThemeRecords(state, 'incorrect').map((theme) => ({
    ...theme,
    kind: 'incorrect-knowledge' as const,
    priority: computeWeaknessPriority({
      frequency: theme.frequency,
      averageQuestionScore: theme.averageQuestionScore,
    }),
  }));

  return [...missingThemes, ...incorrectThemes].sort((left, right) => {
    const priorityWeight = { high: 0, medium: 1, low: 2 } as const;
    return (
      priorityWeight[left.priority] - priorityWeight[right.priority] ||
      right.frequency - left.frequency ||
      (left.averageQuestionScore ?? 10) - (right.averageQuestionScore ?? 10)
    );
  });
}

function buildCandidateQuestionReviews(state: InterviewSessionState): CandidateQuestionReviewRecord[] {
  return state.rounds.flatMap((round) =>
    round.nodes.map((node) => ({
      roundType: round.type,
      topic: node.topic,
      question: node.mainQuestion,
      score: roundNumber(node.aggregatedScore),
      strengths: node.summary?.strengths ?? [],
      missingPoints: node.summary?.missingPoints ?? [],
      incorrectPoints: node.summary?.weaknesses ?? [],
      improvementAdvice: node.summary?.improvementAdvice ?? [],
      evidence: uniqueStrings(node.summary?.evidence ?? []).slice(0, 3),
    })),
  );
}

function readFeedbackFromCurrentRecord(currentRecord: LegacyInterviewOutcomeRecord): InterviewOutcomeFeedback {
  return currentRecord.candidateImprovement?.feedback ?? currentRecord.userFeedback ?? buildPendingFeedback();
}

function buildOutcomeRecord(options: {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: InterviewSessionState;
  readonly recallTraces: readonly RagRecallTrace[];
  readonly userFeedback: InterviewOutcomeFeedback;
}): InterviewOutcomeRecord {
  return {
    schemaVersion: INTERVIEW_OUTCOME_SCHEMA_VERSION,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    threadId: options.state.threadId,
    session: {
      targetRole: options.state.targetRole,
      responseLanguage: options.state.responseLanguage,
      phase: options.state.phase,
      finalReportReady: options.state.finalReportReady,
      setup: options.state.setup,
      resumeContext: options.state.resumeContext,
    },
    selectorTraining: {
      traces: options.recallTraces,
      recallEvents: buildSelectorTrainingEvents(options.recallTraces, options.state),
      selectedQuestionLabels: buildSelectorTrainingLabels(options.recallTraces, options.state),
    },
    candidateImprovement: {
      ...buildPerformanceSummary(options.state),
      strongSignals: buildCandidateThemeRecords(options.state, 'strength').slice(0, 8),
      knowledgeWeaknesses: buildKnowledgeWeaknessRecords(options.state).slice(0, 12),
      questionReviews: buildCandidateQuestionReviews(options.state),
      report: {
        finalReport: options.state.finalReport,
        lastCorrectionSummary: options.state.lastCorrectionSummary,
      },
      feedback: options.userFeedback,
    },
  };
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function writeInterviewOutcomeIndex(options: {
  readonly threadId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly outcomeFilePath: string;
}): Promise<void> {
  const indexFilePath = resolve(getInterviewOutcomeIndexDirectoryPath(), `${options.threadId}.json`);
  const indexRecord: InterviewOutcomeIndexRecord = {
    threadId: options.threadId,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    outcomeFilePath: options.outcomeFilePath,
  };

  await writeJsonFile(indexFilePath, indexRecord);
}

async function readInterviewOutcomeRecord(filePath: string): Promise<InterviewOutcomeRecord> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as InterviewOutcomeRecord;
}

export async function createInterviewOutcomeSnapshot(options: {
  readonly threadId: string;
  readonly state: InterviewSessionState;
  readonly recallTraces: readonly RagRecallTrace[];
}): Promise<string> {
  const createdAt = new Date().toISOString();
  const directoryName = `${sanitizeTimestampForFileName(createdAt)}-${options.threadId}`;
  const outcomeFilePath = resolve(
    getInterviewOutcomeDirectoryPath(),
    directoryName,
    'interview-outcome.json',
  );
  const outcomeRecord = buildOutcomeRecord({
    createdAt,
    updatedAt: createdAt,
    state: options.state,
    recallTraces: options.recallTraces,
    userFeedback: buildPendingFeedback(),
  });

  await writeJsonFile(outcomeFilePath, outcomeRecord);
  await writeInterviewOutcomeIndex({
    threadId: options.threadId,
    createdAt,
    updatedAt: createdAt,
    outcomeFilePath,
  });

  return outcomeFilePath;
}

export async function updateInterviewOutcomeSnapshot(options: {
  readonly filePath: string;
  readonly state: InterviewSessionState;
  readonly recallTraces?: readonly RagRecallTrace[];
}): Promise<void> {
  const currentRecord = await readInterviewOutcomeRecord(options.filePath);
  const updatedAt = new Date().toISOString();
  const recallTraces = options.recallTraces ?? currentRecord.selectorTraining.traces;
  const updatedRecord = buildOutcomeRecord({
    createdAt: currentRecord.createdAt,
    updatedAt,
    state: options.state,
    recallTraces,
    userFeedback: readFeedbackFromCurrentRecord(currentRecord),
  });

  await writeJsonFile(options.filePath, updatedRecord);
  await writeInterviewOutcomeIndex({
    threadId: options.state.threadId,
    createdAt: currentRecord.createdAt,
    updatedAt,
    outcomeFilePath: options.filePath,
  });
}