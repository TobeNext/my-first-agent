import { z } from 'zod';

export const INTERVIEW_START_REQUEST_KIND = 'interview-start';
export const INTERVIEW_START_PROTOCOL_VERSION = '2026-05-structured-start-v1';
export const MAX_INTERVIEW_TOTAL_QUESTION_COUNT = 10;

export const interviewResumeSectionsSchema = z.object({
  professionalSkills: z.string(),
  projectExperience: z.string(),
});

export const interviewSystemSettingsSchema = z
  .object({
    reviewIncorrectOrMissingPoints: z.boolean(),
    skipProfessionalSkillsRound: z.boolean(),
    skipProjectExperienceRound: z.boolean(),
    enableFlowTestMode: z.boolean(),
    professionalQuestionMode: z.enum(['per-skill-default', 'custom-count']),
    professionalQuestionCount: z.number().int().min(0).max(MAX_INTERVIEW_TOTAL_QUESTION_COUNT),
    projectQuestionCount: z.number().int().min(0).max(MAX_INTERVIEW_TOTAL_QUESTION_COUNT),
  })
  .superRefine((value, context) => {
    if (value.skipProfessionalSkillsRound && value.skipProjectExperienceRound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Professional skills and project experience rounds cannot both be skipped.',
        path: ['skipProjectExperienceRound'],
      });
    }

    if (!value.skipProfessionalSkillsRound && value.professionalQuestionCount < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Professional skills question count must be at least 1 when that round is enabled.',
        path: ['professionalQuestionCount'],
      });
    }

    if (value.skipProfessionalSkillsRound && value.professionalQuestionCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Professional skills question count must be 0 when that round is skipped.',
        path: ['professionalQuestionCount'],
      });
    }

    if (!value.skipProjectExperienceRound && value.projectQuestionCount < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Project experience question count must be at least 1 when that round is enabled.',
        path: ['projectQuestionCount'],
      });
    }

    if (value.skipProjectExperienceRound && value.projectQuestionCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Project experience question count must be 0 when that round is skipped.',
        path: ['projectQuestionCount'],
      });
    }

    if (value.professionalQuestionCount + value.projectQuestionCount > MAX_INTERVIEW_TOTAL_QUESTION_COUNT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The total number of interview questions cannot exceed 10.',
        path: ['professionalQuestionCount'],
      });
    }
  });

export const interviewStartRequestSchema = z.object({
  requestKind: z.literal(INTERVIEW_START_REQUEST_KIND),
  protocolVersion: z.literal(INTERVIEW_START_PROTOCOL_VERSION),
  startInterview: z.literal(true),
  threadId: z.string().min(1, 'Thread ID is required.'),
  resumeMarkdown: z.string().trim().min(1, 'Resume markdown is required to start the interview.'),
  jobDescriptionMarkdown: z.string().trim().default(''),
  settings: interviewSystemSettingsSchema,
  resumeSections: interviewResumeSectionsSchema.optional(),
});

export type InterviewSystemSettings = z.infer<typeof interviewSystemSettingsSchema>;
export type InterviewResumeSections = z.infer<typeof interviewResumeSectionsSchema>;
export type InterviewStartRequest = z.infer<typeof interviewStartRequestSchema>;

export function buildInterviewStartRequest(input: {
  readonly threadId: string;
  readonly resumeMarkdown: string;
  readonly jobDescriptionMarkdown?: string;
  readonly settings: InterviewSystemSettings;
  readonly resumeSections?: InterviewResumeSections;
}): InterviewStartRequest {
  return interviewStartRequestSchema.parse({
    requestKind: INTERVIEW_START_REQUEST_KIND,
    protocolVersion: INTERVIEW_START_PROTOCOL_VERSION,
    startInterview: true,
    threadId: input.threadId,
    resumeMarkdown: input.resumeMarkdown,
    jobDescriptionMarkdown: input.jobDescriptionMarkdown ?? '',
    settings: input.settings,
    resumeSections: input.resumeSections,
  });
}

export function serializeInterviewStartRequest(request: InterviewStartRequest): string {
  return JSON.stringify(request);
}

export function parseInterviewStartRequest(rawValue: string): InterviewStartRequest | null {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    const result = interviewStartRequestSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}