import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface InterviewOutcomeIndexArtifact {
  readonly threadId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly outcomeFilePath: string;
}

export interface InterviewOutcomeArtifact {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly threadId: string;
  readonly session: {
    readonly phase: string;
    readonly finalReportReady: boolean;
  };
  readonly candidateImprovement?: {
    readonly completedQuestionCount: number;
    readonly totalQuestionCount: number;
    readonly rounds?: readonly {
      readonly type: string;
      readonly status: string;
    }[];
    readonly report?: {
      readonly finalReport?: string;
    };
    readonly feedback?: {
      readonly status: 'pending' | 'submitted';
      readonly submittedAt?: string | null;
      readonly overallExperienceScore?: number | null;
      readonly questionFitScore?: number | null;
      readonly difficultyScore?: number | null;
      readonly comment?: string | null;
    };
  };
}

function getWorkspaceRootPath(): string {
  return resolve(import.meta.dirname, '../..');
}

function getInterviewOutcomeRootPath(): string {
  return resolve(getWorkspaceRootPath(), 'Interview outcome');
}

export function getInterviewOutcomeIndexPath(threadId: string): string {
  return resolve(getInterviewOutcomeRootPath(), 'index', `${threadId}.json`);
}

export async function readInterviewOutcomeArtifacts(threadId: string): Promise<{
  readonly indexRecord: InterviewOutcomeIndexArtifact;
  readonly outcomeRecord: InterviewOutcomeArtifact;
}> {
  const indexRecord = JSON.parse(
    await readFile(getInterviewOutcomeIndexPath(threadId), 'utf-8'),
  ) as InterviewOutcomeIndexArtifact;
  const outcomeRecord = JSON.parse(
    await readFile(indexRecord.outcomeFilePath, 'utf-8'),
  ) as InterviewOutcomeArtifact;

  return {
    indexRecord,
    outcomeRecord,
  };
}