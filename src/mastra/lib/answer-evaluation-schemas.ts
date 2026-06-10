import { z } from 'zod';

export const answerEvaluationTaskSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  interviewId: z.string().min(1),
  threadId: z.string().min(1),
  resourceId: z.string().optional(),
  nodeId: z.string().min(1),
  roundId: z.string().min(1),
  roundType: z.enum(['professional-skills', 'project-experience']),
  attemptId: z.string().min(1),
  targetType: z.enum(['main-question', 'follow-up']),
  targetId: z.string().min(1),
  targetRole: z.string().min(1),
  responseLanguage: z.enum(['zh', 'en']),
  question: z.string().min(1),
  mainQuestion: z.string().min(1),
  followUpQuestion: z.string().optional(),
  referenceAnswer: z.string().optional(),
  evaluationPoints: z.array(z.string()).default([]),
  candidateAnswer: z.string().min(1),
  nodeConversation: z
    .array(
      z.object({
        role: z.enum(['interviewer', 'candidate']),
        targetType: z.enum(['main-question', 'follow-up']),
        text: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  createdAt: z.string(),
});

export const answerEvaluationTaskStatusSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  interviewId: z.string().min(1),
  attemptId: z.string().min(1),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  lastError: z.string().optional(),
});

export const llmAnswerEvaluationResultSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  interviewId: z.string().min(1),
  threadId: z.string().min(1),
  nodeId: z.string().min(1),
  roundId: z.string().min(1),
  roundType: z.enum(['professional-skills', 'project-experience']),
  attemptId: z.string().min(1),
  classification: z.enum([
    'direct-answer',
    'partial-answer',
    'deep-answer',
    'off-topic',
    'clarification-request',
    'skip-request',
    'stop-request',
    'meta-question',
  ]),
  score: z.object({
    relevance: z.number().min(0).max(10),
    accuracy: z.number().min(0).max(10),
    depth: z.number().min(0).max(10),
    specificity: z.number().min(0).max(10),
    clarity: z.number().min(0).max(10),
    weightedTotal: z.number().min(0).max(10),
  }),
  strengths: z.array(z.string()),
  missingPoints: z.array(z.string()),
  incorrectPoints: z.array(z.string()),
  shouldAskFollowUp: z.boolean(),
  followUpFocus: z.array(z.string()),
  evaluatorModel: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: z.string(),
});

export const interviewEvaluationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  interviewId: z.string().min(1),
  threadId: z.string().min(1),
  expectedTaskIds: z.array(z.string()),
  completedTaskIds: z.array(z.string()),
  failedTaskIds: z.array(z.string()),
  sealed: z.boolean(),
  sealedAt: z.string().optional(),
  updatedAt: z.string(),
});

export type AnswerEvaluationTask = z.infer<typeof answerEvaluationTaskSchema>;
export type AnswerEvaluationTaskStatus = z.infer<typeof answerEvaluationTaskStatusSchema>;
export type LlmAnswerEvaluationResult = z.infer<typeof llmAnswerEvaluationResultSchema>;
export type InterviewEvaluationManifest = z.infer<typeof interviewEvaluationManifestSchema>;
