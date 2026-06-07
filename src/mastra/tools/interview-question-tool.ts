import { createTool } from '@mastra/core/tools';
import { embed } from 'ai';
import { fastembed } from '@mastra/fastembed';
import { z } from 'zod';

import { DEFAULT_SKILL_AREA, normalizeSkillAreaFromText } from '../lib/interview-question-metadata';
import { interviewQuestionCandidateSchema } from '../lib/interview-state-machine-schema';
import { mastraLogger } from '../lib/logger';
import {
  createRagRecallTrace,
  type RagRecallTrace,
  type RagRecallTraceCandidate,
  type RagRecallTraceSelection,
} from '../lib/rag-recall-sample';
import { vectorStore, INTERVIEW_INDEX_NAME } from '../lib/vector-store';

const RETRIEVAL_TOP_K = 20;
const HYBRID_TOP_K = 10;
const VECTOR_WEIGHT = 0.55;
const BM25_WEIGHT = 0.45;
const ragLogger = mastraLogger.child({
  module: 'interview-question-tool',
  component: 'rag-recall',
});

interface VectorSearchResult {
  readonly id: string;
  readonly score: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Fisher-Yates shuffle — returns a new shuffled copy, does not mutate the input.
 */
function shuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface QueryInterviewQuestionsOptions {
  readonly queryText: string;
  readonly topK?: number;
  readonly logContext?: string;
  readonly roundType?: 'professional-skills' | 'project-experience' | null;
  readonly skill?: string;
  readonly onRecallTrace?: (trace: RagRecallTrace) => void | Promise<void>;
}

export interface QueryInterviewQuestionsResult {
  readonly count: number;
  readonly questions: z.infer<typeof interviewQuestionCandidateSchema>[];
}

interface RerankedCandidateEntry {
  readonly result: VectorSearchResult;
  readonly vectorScore: number;
  readonly bm25Score: number;
  readonly hybridScore: number;
  readonly matchedSkillArea: readonly string[];
  readonly rerankRank: number;
}

function buildQueryPreview(queryText: string): string {
  return queryText.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function extractLabeledQueryValue(queryText: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = queryText.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, 'im'));
  const value = match?.[1]?.trim();

  return value && value.length > 0 ? value : null;
}

function buildEmbeddingQueryText(queryText: string): string {
  const targetRole = extractLabeledQueryValue(queryText, 'Target role');
  const primarySkill = extractLabeledQueryValue(queryText, 'Primary skill');

  if (targetRole && primarySkill) {
    return `Target role: ${targetRole} Primary skill: ${primarySkill}`;
  }

  return queryText;
}

function buildCandidatePreview(result: VectorSearchResult): {
  readonly id: string;
  readonly score: number;
  readonly textPreview: string;
} {
  const rawText = (result.metadata?.['question'] as string) ?? (result.metadata?.['text'] as string) ?? '';

  return {
    id: result.id,
    score: Number(result.score.toFixed(4)),
    textPreview: rawText.replace(/\s+/g, ' ').trim().slice(0, 100),
  };
}

function formatTags(tags: unknown): string | undefined {
  if (Array.isArray(tags)) {
    return tags.join(', ');
  }

  return typeof tags === 'string' ? tags : undefined;
}

function formatSkillArea(skillArea: unknown): string[] {
  if (Array.isArray(skillArea)) {
    return skillArea
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
  }

  if (typeof skillArea === 'string') {
    return skillArea
      .split(/[,，\s]+/u)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
  }

  return [];
}

function normalizeScore(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (max <= min) {
    return 1;
  }

  return (value - min) / (max - min);
}

export function extractJdSkillArea(queryText: string): string[] {
  const normalized = normalizeSkillAreaFromText(queryText);
  return normalized.length === 1 && normalized[0] === DEFAULT_SKILL_AREA ? [] : normalized;
}

function scoreWithSkillArea(
  jdSkillArea: readonly string[],
  results: readonly VectorSearchResult[],
): Map<string, { readonly score: number; readonly matchedSkillArea: readonly string[] }> {
  const jdSkillSet = new Set(jdSkillArea);

  return new Map(
    results.map((result) => {
      const candidateSkillArea = formatSkillArea(result.metadata?.['skillArea']);
      const matchedSkillArea = candidateSkillArea.filter((skill) => jdSkillSet.has(skill));
      const score = jdSkillArea.length > 0 ? matchedSkillArea.length / jdSkillArea.length : 0;

      return [result.id, { score, matchedSkillArea }] as const;
    }),
  );
}

export function buildRerankedEntries(queryText: string, results: readonly VectorSearchResult[]): RerankedCandidateEntry[] {
  if (results.length === 0) {
    return [];
  }

  const jdSkillArea = extractJdSkillArea(queryText);
  const skillAreaScores = scoreWithSkillArea(jdSkillArea, results);
  const vectorScores = results.map((result) => result.score);
  const skillAreaValues = results.map((result) => skillAreaScores.get(result.id)?.score ?? 0);
  const minVector = Math.min(...vectorScores);
  const maxVector = Math.max(...vectorScores);
  const minSkillArea = Math.min(...skillAreaValues);
  const maxSkillArea = Math.max(...skillAreaValues);

  return [...results]
    .map((result) => {
      const normalizedVectorScore = normalizeScore(result.score, minVector, maxVector);
      const skillAreaScore = skillAreaScores.get(result.id) ?? { score: 0, matchedSkillArea: [] };
      const normalizedSkillAreaScore =
        jdSkillArea.length > 0 && maxSkillArea > minSkillArea
          ? normalizeScore(skillAreaScore.score, minSkillArea, maxSkillArea)
          : skillAreaScore.score;

      return {
        result,
        vectorScore: result.score,
        bm25Score: skillAreaScore.score,
        hybridScore: normalizedVectorScore * VECTOR_WEIGHT + normalizedSkillAreaScore * BM25_WEIGHT,
        matchedSkillArea: skillAreaScore.matchedSkillArea,
      };
    })
    .sort((left, right) => right.hybridScore - left.hybridScore)
    .map((entry, index) => ({
      ...entry,
      rerankRank: index + 1,
    }));
}

function buildRecallCandidates(options: {
  readonly results: readonly VectorSearchResult[];
  readonly rerankedEntries: readonly RerankedCandidateEntry[];
  readonly selectedEntries: readonly RerankedCandidateEntry[];
}): RagRecallTraceCandidate[] {
  const rerankedEntryMap = new Map(options.rerankedEntries.map((entry) => [entry.result.id, entry]));
  const selectedRankMap = new Map(options.selectedEntries.map((entry, index) => [entry.result.id, index + 1]));

  return options.results.map((result) => {
    const rerankedEntry = rerankedEntryMap.get(result.id) ?? null;
    const finalSelectionRank = selectedRankMap.get(result.id) ?? null;

    let filterReason = 'filtered-out-by-hybrid-rerank';
    if (finalSelectionRank !== null) {
      filterReason = 'selected';
    } else if (rerankedEntry) {
      filterReason = 'not-selected-after-final-randomization';
    }

    return {
      id: result.id,
      questionText: (result.metadata?.['question'] as string) ?? (result.metadata?.['text'] as string) ?? '',
      vectorScore: result.score,
      bm25Score: rerankedEntry?.bm25Score ?? 0,
      hybridScore: rerankedEntry?.hybridScore ?? 0,
      matchedSkillArea: rerankedEntry?.matchedSkillArea ?? [],
      rerankRank: rerankedEntry?.rerankRank ?? null,
      finalSelectionRank,
      filterReason,
    };
  });
}

function buildFinalSelectedQuestions(selectedEntries: readonly RerankedCandidateEntry[]): RagRecallTraceSelection[] {
  return selectedEntries.map((entry, index) => ({
    id: entry.result.id,
    questionText: (entry.result.metadata?.['question'] as string) ?? (entry.result.metadata?.['text'] as string) ?? '',
    vectorScore: entry.vectorScore,
    bm25Score: entry.bm25Score,
    hybridScore: entry.hybridScore,
    matchedSkillArea: entry.matchedSkillArea,
    rerankRank: entry.rerankRank,
    finalSelectionRank: index + 1,
  }));
}

export async function queryInterviewQuestions(
  options: QueryInterviewQuestionsOptions,
): Promise<QueryInterviewQuestionsResult> {
  const logContext = options.logContext ?? 'interview-question-query';
  const embeddingQueryText = buildEmbeddingQueryText(options.queryText);

  ragLogger.info('RAG recall started', {
    event: 'rag.recall.start',
    context: logContext,
    requestedTopK: options.topK ?? 10,
    retrievalTopK: RETRIEVAL_TOP_K,
    queryPreview: buildQueryPreview(embeddingQueryText),
  });

  try {
    const { embedding } = await embed({ model: fastembed, value: embeddingQueryText });

    const results = (await vectorStore.query({
      indexName: INTERVIEW_INDEX_NAME,
      queryVector: embedding,
      topK: RETRIEVAL_TOP_K,
      includeVector: false,
    })) as VectorSearchResult[];

    const rerankedEntries = buildRerankedEntries(options.queryText, results).slice(0, HYBRID_TOP_K);
    const selectedEntries = shuffle(rerankedEntries).slice(0, options.topK ?? 10);
    const selected = selectedEntries.map((entry) => entry.result);
    const recallCandidates = buildRecallCandidates({
      results,
      rerankedEntries,
      selectedEntries,
    });
    const finalSelectedQuestions = buildFinalSelectedQuestions(selectedEntries);

    if (options.onRecallTrace) {
      await options.onRecallTrace(
        createRagRecallTrace({
          timestamp: new Date().toISOString(),
          roundType: options.roundType ?? null,
          skill: options.skill ?? 'unknown-skill',
          queryText: embeddingQueryText,
          logContext,
          candidates: recallCandidates,
          finalSelectedQuestions,
        }),
      );
    }

    if (results.length === 0 || selected.length === 0) {
      ragLogger.warn('RAG recall returned no usable candidates', {
        event: 'rag.recall.empty',
        context: logContext,
        queryPreview: buildQueryPreview(embeddingQueryText),
        vectorHitCount: results.length,
        rerankedCount: rerankedEntries.length,
        selectedCount: selected.length,
      });
    } else {
      ragLogger.info('RAG recall completed', {
        event: 'rag.recall.done',
        context: logContext,
        queryPreview: buildQueryPreview(embeddingQueryText),
        vectorHitCount: results.length,
        rerankedCount: rerankedEntries.length,
        selectedCount: selected.length,
        selectedPreview: selected.slice(0, 3).map(buildCandidatePreview),
      });
    }

    return {
      count: selected.length,
      questions: selected.map((result) =>
        interviewQuestionCandidateSchema.parse({
          id: result.id,
          score: result.score,
          text: (result.metadata?.['question'] as string) ?? (result.metadata?.['text'] as string) ?? '',
          questionType: (result.metadata?.['questionType'] as string) ?? undefined,
          difficulty: (result.metadata?.['difficulty'] as string) ?? undefined,
          role: (result.metadata?.['role'] as string) ?? undefined,
          company: (result.metadata?.['company'] as string) ?? undefined,
          skillArea: formatSkillArea(result.metadata?.['skillArea']),
          tags: formatTags(result.metadata?.['tags']),
        }),
      ),
    };
  } catch (error: unknown) {
    ragLogger.error('RAG recall failed', {
      event: 'rag.recall.error',
      context: logContext,
      queryPreview: buildQueryPreview(embeddingQueryText),
      err: error,
    });
    throw error;
  }
}

export const interviewQuestionTool = createTool({
  id: 'interview-question-query',
  description:
    'Search the interview question knowledge base and return a RANDOMIZED set of relevant questions. ' +
    'Each call returns questions in a different random order so that consecutive interviews never repeat the same set.',
  inputSchema: z.object({
    queryText: z.string().describe('The search query, e.g. "Software Engineer interview questions"'),
    topK: z.number().optional().default(10).describe('How many questions to return (default 10)'),
  }),
  outputSchema: z.object({
    count: z.number(),
    questions: z.array(interviewQuestionCandidateSchema),
  }),
  execute: async ({ queryText, topK }) => queryInterviewQuestions({ queryText, topK }),
});
