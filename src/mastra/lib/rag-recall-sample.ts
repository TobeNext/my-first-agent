import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { InterviewSessionState, InterviewTopicNodeState, RoundType } from './interview-state-machine-schema';

const RAG_LOG_DIRECTORY_NAME = 'RAG LOG INFO';
const RAG_LOG_SCHEMA_VERSION = 1;

export interface RagRecallTraceCandidate {
  readonly id: string;
  readonly questionText: string;
  readonly vectorScore: number;
  readonly bm25Score: number;
  readonly hybridScore: number;
  readonly rerankRank: number | null;
  readonly finalSelectionRank: number | null;
  readonly filterReason: string;
}

export interface RagRecallTraceSelection {
  readonly id: string;
  readonly questionText: string;
  readonly vectorScore: number;
  readonly bm25Score: number;
  readonly hybridScore: number;
  readonly rerankRank: number;
  readonly finalSelectionRank: number;
}

export interface RagRecallTrace {
  readonly timestamp: string;
  readonly roundType: RoundType | null;
  readonly skill: string;
  readonly queryText: string;
  readonly logContext: string;
  readonly candidateQuestionIds: readonly string[];
  readonly selectedQuestionIds: readonly string[];
  readonly candidates: readonly RagRecallTraceCandidate[];
  readonly finalSelectedQuestions: readonly RagRecallTraceSelection[];
}

interface RagQuestionAnswerPerformance {
  readonly roundType: RoundType;
  readonly topic: string;
  readonly mainQuestion: string;
  readonly nodeStatus: string;
  readonly followUpCount: number;
  readonly answerAttemptCount: number;
  readonly latestClassification: string | null;
  readonly aggregatedScore: number | null;
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
}

interface RagRecallOfflineSample {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly threadId: string;
  readonly targetRole: string;
  readonly recalls: ReadonlyArray<
    RagRecallTrace & {
      readonly postInterviewAnswerPerformance: readonly RagQuestionAnswerPerformance[];
    }
  >;
  readonly interviewSnapshot: {
    readonly phase: string;
    readonly finalReportReady: boolean;
    readonly answerPerformances: readonly RagQuestionAnswerPerformance[];
  };
}

function getRagLogDirectoryPath(): string {
  return resolve(process.cwd(), RAG_LOG_DIRECTORY_NAME);
}

function sanitizeTimestampForFileName(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function normalizeQuestionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function roundNumber(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Number(value.toFixed(4));
}

function buildQuestionAnswerPerformance(roundType: RoundType, node: InterviewTopicNodeState): RagQuestionAnswerPerformance {
  const latestAttempt = node.answerAttempts.at(-1) ?? null;

  return {
    roundType,
    topic: node.topic,
    mainQuestion: node.mainQuestion,
    nodeStatus: node.status,
    followUpCount: node.followUpCount,
    answerAttemptCount: node.answerAttempts.length,
    latestClassification: latestAttempt?.classification ?? null,
    aggregatedScore: node.aggregatedScore,
    strengths: node.summary?.strengths ?? [],
    missingPoints: node.summary?.missingPoints ?? [],
    incorrectPoints: node.summary?.weaknesses ?? [],
  };
}

function buildAnswerPerformanceList(state: InterviewSessionState): RagQuestionAnswerPerformance[] {
  return state.rounds.flatMap((round) =>
    round.nodes.map((node) => buildQuestionAnswerPerformance(round.type, node)),
  );
}

function buildAnswerPerformanceMap(state: InterviewSessionState): Map<string, RagQuestionAnswerPerformance> {
  return new Map(
    buildAnswerPerformanceList(state).map((performance) => [
      normalizeQuestionText(performance.mainQuestion),
      performance,
    ]),
  );
}

function buildInitialSample(options: {
  readonly threadId: string;
  readonly targetRole: string;
  readonly createdAt: string;
  readonly recallTraces: readonly RagRecallTrace[];
  readonly state: InterviewSessionState;
}): RagRecallOfflineSample {
  const answerPerformanceMap = buildAnswerPerformanceMap(options.state);

  return {
    schemaVersion: RAG_LOG_SCHEMA_VERSION,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    threadId: options.threadId,
    targetRole: options.targetRole,
    recalls: options.recallTraces.map((trace) => ({
      ...trace,
      postInterviewAnswerPerformance: trace.finalSelectedQuestions
        .map((selection) => answerPerformanceMap.get(normalizeQuestionText(selection.questionText)) ?? null)
        .filter((performance): performance is RagQuestionAnswerPerformance => performance !== null),
    })),
    interviewSnapshot: {
      phase: options.state.phase,
      finalReportReady: options.state.finalReportReady,
      answerPerformances: buildAnswerPerformanceList(options.state),
    },
  };
}

async function writeSample(filePath: string, sample: RagRecallOfflineSample): Promise<void> {
  await mkdir(getRagLogDirectoryPath(), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sample, null, 2)}\n`, 'utf-8');
}

export async function writeInitializationRagRecallSample(options: {
  readonly threadId: string;
  readonly targetRole: string;
  readonly recallTraces: readonly RagRecallTrace[];
  readonly state: InterviewSessionState;
}): Promise<string> {
  const createdAt = new Date().toISOString();
  const fileName = `${sanitizeTimestampForFileName(createdAt)}-${options.threadId}-rag-recall-sample.json`;
  const filePath = resolve(getRagLogDirectoryPath(), fileName);
  const sample = buildInitialSample({
    ...options,
    createdAt,
  });

  await writeSample(filePath, sample);

  return filePath;
}

export async function updateRagRecallSampleAnswerPerformance(filePath: string, state: InterviewSessionState): Promise<void> {
  const raw = await readFile(filePath, 'utf-8');
  const currentSample = JSON.parse(raw) as RagRecallOfflineSample;
  const updatedAt = new Date().toISOString();
  const answerPerformanceMap = buildAnswerPerformanceMap(state);
  const updatedSample: RagRecallOfflineSample = {
    ...currentSample,
    updatedAt,
    recalls: currentSample.recalls.map((trace) => ({
      ...trace,
      postInterviewAnswerPerformance: trace.finalSelectedQuestions
        .map((selection) => answerPerformanceMap.get(normalizeQuestionText(selection.questionText)) ?? null)
        .filter((performance): performance is RagQuestionAnswerPerformance => performance !== null),
    })),
    interviewSnapshot: {
      phase: state.phase,
      finalReportReady: state.finalReportReady,
      answerPerformances: buildAnswerPerformanceList(state),
    },
  };

  await writeSample(filePath, updatedSample);
}

export function createRagRecallTrace(options: {
  readonly timestamp: string;
  readonly roundType: RoundType | null;
  readonly skill: string;
  readonly queryText: string;
  readonly logContext: string;
  readonly candidates: readonly RagRecallTraceCandidate[];
  readonly finalSelectedQuestions: readonly RagRecallTraceSelection[];
}): RagRecallTrace {
  return {
    timestamp: options.timestamp,
    roundType: options.roundType,
    skill: options.skill,
    queryText: options.queryText,
    logContext: options.logContext,
    candidateQuestionIds: options.candidates.map((candidate) => candidate.id),
    selectedQuestionIds: options.finalSelectedQuestions.map((selection) => selection.id),
    candidates: options.candidates.map((candidate) => ({
      ...candidate,
      vectorScore: roundNumber(candidate.vectorScore),
      bm25Score: roundNumber(candidate.bm25Score),
      hybridScore: roundNumber(candidate.hybridScore),
    })),
    finalSelectedQuestions: options.finalSelectedQuestions.map((selection) => ({
      ...selection,
      vectorScore: roundNumber(selection.vectorScore),
      bm25Score: roundNumber(selection.bm25Score),
      hybridScore: roundNumber(selection.hybridScore),
    })),
  };
}