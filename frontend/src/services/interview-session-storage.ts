import { z } from 'zod';

import { interviewSystemSettingsSchema } from '../../../bff/src/modules/agent/interview-start-contract';

import type { InterviewStateSnapshot, InterviewSystemSettings } from '@/types/agent';

const INTERVIEW_SESSION_STORAGE_KEY = 'frontend.recent-interview-session';

const interviewSessionSummarySchema = z.object({
  phase: z.string().min(1),
  activeRoundType: z.string().nullable(),
  finalReportReady: z.boolean(),
  totalQuestionCount: z.number().int().nonnegative(),
  completedQuestionCount: z.number().int().nonnegative(),
  currentStage: z.enum(['main-question', 'follow-up', 'completed']),
  currentQuestionIndex: z.number().int().positive().nullable(),
  currentRoundType: z.enum(['professional-skills', 'project-experience']).nullable(),
  currentFollowUpIndex: z.number().int().positive().nullable(),
  remainingQuestionCount: z.number().int().nonnegative(),
  currentQuestionText: z.string().nullable(),
  assistantReply: z.string(),
});

export const persistedInterviewSessionSchema = z.object({
  threadId: z.string().min(1),
  settings: interviewSystemSettingsSchema,
  summary: interviewSessionSummarySchema,
  updatedAt: z.string().datetime(),
});

export type PersistedInterviewSession = z.infer<typeof persistedInterviewSessionSchema>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function buildPersistedInterviewSession(options: {
  readonly threadId: string;
  readonly settings: InterviewSystemSettings;
  readonly interviewState: InterviewStateSnapshot;
  readonly updatedAt?: string;
}): PersistedInterviewSession {
  return persistedInterviewSessionSchema.parse({
    threadId: options.threadId,
    settings: options.settings,
    summary: {
      phase: options.interviewState.phase,
      activeRoundType: options.interviewState.activeRoundType,
      finalReportReady: options.interviewState.finalReportReady,
      totalQuestionCount: options.interviewState.progress.totalQuestionCount,
      completedQuestionCount: options.interviewState.progress.completedQuestionCount,
      currentStage: options.interviewState.progress.currentStage,
      currentQuestionIndex: options.interviewState.progress.currentQuestionIndex,
      currentRoundType: options.interviewState.progress.currentRoundType,
      currentFollowUpIndex: options.interviewState.progress.currentFollowUpIndex,
      remainingQuestionCount: options.interviewState.progress.remainingQuestionCount,
      currentQuestionText: options.interviewState.progress.currentQuestionText,
      assistantReply: options.interviewState.assistantReply,
    },
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  });
}

export function savePersistedInterviewSession(
  session: PersistedInterviewSession,
  storage?: StorageLike,
): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  const parsedSession = persistedInterviewSessionSchema.parse(session);
  try {
    resolvedStorage.setItem(INTERVIEW_SESSION_STORAGE_KEY, JSON.stringify(parsedSession));
  } catch {
    return;
  }
}

export function readPersistedInterviewSession(storage?: StorageLike): PersistedInterviewSession | null {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return null;
  }

  let rawValue: string | null;

  try {
    rawValue = resolvedStorage.getItem(INTERVIEW_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = persistedInterviewSessionSchema.safeParse(JSON.parse(rawValue));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
  }

  try {
    resolvedStorage.removeItem(INTERVIEW_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  return null;
}

export function clearPersistedInterviewSession(storage?: StorageLike): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.removeItem(INTERVIEW_SESSION_STORAGE_KEY);
  } catch {
    return;
  }
}

export function hasRestorableInterviewSession(storage?: StorageLike): boolean {
  const session = readPersistedInterviewSession(storage);
  if (!session) {
    return false;
  }

  return !session.summary.finalReportReady;
}
