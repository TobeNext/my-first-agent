import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface InterviewFeedbackInput {
  readonly threadId: string;
  readonly overallExperienceScore: number;
  readonly questionFitScore: number;
  readonly difficultyScore: number;
  readonly comment: string;
}

interface InterviewOutcomeIndexRecord {
  readonly threadId: string;
  readonly outcomeFilePath: string;
}

interface InterviewOutcomeRecord {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly candidateImprovement?: {
    readonly feedback?: {
      readonly status: 'pending' | 'submitted';
      readonly submittedAt: string | null;
      readonly overallExperienceScore: number | null;
      readonly questionFitScore: number | null;
      readonly difficultyScore: number | null;
      readonly comment: string | null;
    };
  };
  readonly userFeedback?: {
    readonly status: 'pending' | 'submitted';
    readonly submittedAt: string | null;
    readonly overallExperienceScore: number | null;
    readonly questionFitScore: number | null;
    readonly difficultyScore: number | null;
    readonly comment: string | null;
  };
}

function getWorkspaceRootPath(): string {
  return resolve(__dirname, '../../../..');
}

function getInterviewOutcomeRootPath(): string {
  return resolve(getWorkspaceRootPath(), 'Interview outcome');
}

function getInterviewOutcomeIndexFilePath(threadId: string): string {
  return resolve(getInterviewOutcomeRootPath(), 'index', `${threadId}.json`);
}

export async function saveInterviewFeedback(input: InterviewFeedbackInput): Promise<{ readonly savedAt: string }> {
  const indexFilePath = getInterviewOutcomeIndexFilePath(input.threadId);
  if (!existsSync(indexFilePath)) {
    throw new Error(`Interview outcome index not found for thread ${input.threadId}.`);
  }

  const rawIndex = await readFile(indexFilePath, 'utf-8');
  const indexRecord = JSON.parse(rawIndex) as InterviewOutcomeIndexRecord;
  if (!existsSync(indexRecord.outcomeFilePath)) {
    throw new Error(`Interview outcome file not found for thread ${input.threadId}.`);
  }

  const rawOutcome = await readFile(indexRecord.outcomeFilePath, 'utf-8');
  const outcomeRecord = JSON.parse(rawOutcome) as InterviewOutcomeRecord;
  const savedAt = new Date().toISOString();
  const updatedOutcomeRecord: InterviewOutcomeRecord = {
    ...outcomeRecord,
    updatedAt: savedAt,
    candidateImprovement: {
      ...outcomeRecord.candidateImprovement,
      feedback: {
        status: 'submitted',
        submittedAt: savedAt,
        overallExperienceScore: input.overallExperienceScore,
        questionFitScore: input.questionFitScore,
        difficultyScore: input.difficultyScore,
        comment: input.comment || null,
      },
    },
    userFeedback: undefined,
  };

  await mkdir(resolve(getInterviewOutcomeRootPath(), 'index'), { recursive: true });
  await writeFile(indexRecord.outcomeFilePath, `${JSON.stringify(updatedOutcomeRecord, null, 2)}\n`, 'utf-8');
  await writeFile(
    indexFilePath,
    `${JSON.stringify({ ...indexRecord, updatedAt: savedAt }, null, 2)}\n`,
    'utf-8',
  );

  return { savedAt };
}