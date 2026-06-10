import { z } from 'zod';

export const INTERVIEW_STATE_VERSION = 1;
export const PROFESSIONAL_NODE_COUNT = 6;
export const PROJECT_NODE_COUNT = 2;
export const DEFAULT_PROFESSIONAL_QUESTION_COUNT = PROFESSIONAL_NODE_COUNT;
export const DEFAULT_PROJECT_QUESTION_COUNT = PROJECT_NODE_COUNT;
export const MAX_TOTAL_QUESTION_COUNT = 10;
export const PROFESSIONAL_MAX_FOLLOW_UPS = 3;
export const PROJECT_MAX_FOLLOW_UPS = 2;
export const MAX_DETOUR_RESPONSES = 2;

export const responseLanguageSchema = z.enum(['zh', 'en']);
export const sessionPhaseSchema = z.enum([
  'intro',
  'professional-skills-round',
  'project-experience-round',
  'wrap-up',
  'completed',
]);
export const roundTypeSchema = z.enum(['professional-skills', 'project-experience']);
export const roundStatusSchema = z.enum(['pending', 'in-progress', 'completed', 'skipped']);
export const topicNodeStatusSchema = z.enum([
  'pending',
  'asking-main-question',
  'awaiting-main-answer',
  'asking-follow-up',
  'awaiting-follow-up-answer',
  'detour-handling',
  'evaluating',
  'completed',
  'skipped',
]);
export const followUpIntentSchema = z.enum(['breadth', 'depth', 'accuracy', 'experience']);
export const followUpStatusSchema = z.enum(['pending', 'asked', 'answered', 'abandoned']);
export const answerTargetTypeSchema = z.enum(['main-question', 'follow-up']);
export const answerClassificationSchema = z.enum([
  'direct-answer',
  'partial-answer',
  'deep-answer',
  'off-topic',
  'clarification-request',
  'skip-request',
  'stop-request',
  'meta-question',
]);
export const topicSourceSchema = z.enum(['resume', 'knowledge-base', 'setup', 'generated']);

export const interviewQuestionCandidateSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  score: z.number().optional().default(0),
  role: z.string().optional(),
  company: z.string().optional(),
  questionType: z.string().optional(),
  difficulty: z.string().optional(),
  skillArea: z.array(z.string()).optional(),
  answer: z.string().optional(),
  tags: z.string().optional(),
});

export const professionalQuestionModeSchema = z.enum(['per-skill-default', 'custom-count']);

export const interviewSystemSettingsSchema = z.object({
  reviewIncorrectOrMissingPoints: z.boolean(),
  skipProfessionalSkillsRound: z.boolean(),
  skipProjectExperienceRound: z.boolean(),
  enableFlowTestMode: z.boolean(),
  professionalQuestionMode: professionalQuestionModeSchema,
  professionalQuestionCount: z.number().int().min(0).max(MAX_TOTAL_QUESTION_COUNT),
  projectQuestionCount: z.number().int().min(0).max(MAX_TOTAL_QUESTION_COUNT),
});

export const answerScoreSchema = z.object({
  relevance: z.number().min(0).max(10),
  accuracy: z.number().min(0).max(10),
  depth: z.number().min(0).max(10),
  specificity: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  weightedTotal: z.number().min(0).max(10),
});

export const answerAttemptStateSchema = z.object({
  id: z.string(),
  targetType: answerTargetTypeSchema,
  targetId: z.string(),
  userMessage: z.string(),
  classification: answerClassificationSchema,
  score: answerScoreSchema.nullable(),
  strengths: z.array(z.string()),
  missingPoints: z.array(z.string()),
  incorrectPoints: z.array(z.string()),
  isDetour: z.boolean(),
  createdAt: z.string(),
});

export const followUpStateSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  intent: followUpIntentSchema,
  question: z.string(),
  status: followUpStatusSchema,
  linkedAnswerId: z.string().nullable(),
});

export const topicSummarySchema = z.object({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  missingPoints: z.array(z.string()),
  improvementAdvice: z.array(z.string()),
  evidence: z.array(z.string()),
});

export const interviewTopicNodeStateSchema = z.object({
  id: z.string(),
  topic: z.string(),
  source: topicSourceSchema,
  mainQuestion: z.string(),
  referenceAnswer: z.string().optional(),
  evaluationPoints: z.array(z.string()).optional(),
  status: topicNodeStatusSchema,
  currentTargetType: answerTargetTypeSchema,
  currentFollowUpId: z.string().nullable(),
  followUpCount: z.number().int().nonnegative(),
  maxFollowUps: z.number().int().positive(),
  detourResponseCount: z.number().int().nonnegative(),
  earlyCompletionReason: z.string().nullable(),
  followUps: z.array(followUpStateSchema),
  answerAttempts: z.array(answerAttemptStateSchema),
  aggregatedScore: z.number().min(0).max(10).nullable(),
  summary: topicSummarySchema.nullable(),
});

export const interviewRoundStateSchema = z.object({
  id: z.string(),
  type: roundTypeSchema,
  status: roundStatusSchema,
  plannedNodeCount: z.number().int().nonnegative(),
  completedNodeCount: z.number().int().nonnegative(),
  activeNodeId: z.string().nullable(),
  nodeOrder: z.array(z.string()),
  nodes: z.array(interviewTopicNodeStateSchema),
});

export const interviewSessionStateSchema = z.object({
  version: z.literal(INTERVIEW_STATE_VERSION),
  threadId: z.string(),
  targetRole: z.string(),
  company: z.string().nullable(),
  responseLanguage: responseLanguageSchema,
  phase: sessionPhaseSchema,
  activeRoundId: z.string().nullable(),
  finalReportReady: z.boolean(),
  finalReport: z.string().nullable(),
  setup: z.object({
    selectedDirection: z.string(),
    directionSource: z.enum(['preset', 'custom', 'derived']),
    settings: interviewSystemSettingsSchema,
  }),
  resumeContext: z.object({
    professionalSkills: z.string(),
    projectExperience: z.string(),
    jobDescription: z.string(),
    resumeParsed: z.boolean(),
  }),
  lastCorrectionSummary: z.string().nullable(),
  rounds: z.array(interviewRoundStateSchema),
});

export const interviewWorkingMemorySchema = interviewSessionStateSchema;

export type InterviewQuestionCandidate = z.infer<typeof interviewQuestionCandidateSchema>;
export type InterviewSystemSettings = z.infer<typeof interviewSystemSettingsSchema>;
export type AnswerScore = z.infer<typeof answerScoreSchema>;
export type AnswerAttemptState = z.infer<typeof answerAttemptStateSchema>;
export type FollowUpState = z.infer<typeof followUpStateSchema>;
export type TopicSummary = z.infer<typeof topicSummarySchema>;
export type InterviewTopicNodeState = z.infer<typeof interviewTopicNodeStateSchema>;
export type InterviewRoundState = z.infer<typeof interviewRoundStateSchema>;
export type InterviewSessionState = z.infer<typeof interviewSessionStateSchema>;
export type AnswerClassification = z.infer<typeof answerClassificationSchema>;
export type AnswerTargetType = z.infer<typeof answerTargetTypeSchema>;
export type FollowUpIntent = z.infer<typeof followUpIntentSchema>;
export type RoundType = z.infer<typeof roundTypeSchema>;
export type ResponseLanguage = z.infer<typeof responseLanguageSchema>;
