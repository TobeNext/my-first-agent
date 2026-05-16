import { BadRequestException } from '@nestjs/common';
import { z, type ZodType } from 'zod';

export const interviewSettingsSchema = z
  .object({
    reviewIncorrectOrMissingPoints: z.boolean(),
    skipProfessionalSkillsRound: z.boolean(),
    skipProjectExperienceRound: z.boolean(),
    enableFlowTestMode: z.boolean(),
    professionalQuestionMode: z.enum(['per-skill-default', 'custom-count']),
    professionalQuestionCount: z.number().int().min(0).max(10),
    projectQuestionCount: z.number().int().min(0).max(10),
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

    if (value.professionalQuestionCount + value.projectQuestionCount > 10) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The total number of interview questions cannot exceed 10.',
        path: ['professionalQuestionCount'],
      });
    }
  });

export const chatRequestSchema = z
  .object({
    threadId: z.string().min(1, 'Thread ID is required.'),
    message: z.string().trim().optional(),
    resumeMarkdown: z.string().trim().optional(),
    jobDescriptionMarkdown: z.string().trim().optional().default(''),
    settings: interviewSettingsSchema.optional(),
    startInterview: z.boolean().optional().default(false),
  })
  .refine((value) => value.startInterview || Boolean(value.message), {
    message: 'Message is required after the interview has started.',
    path: ['message'],
  })
  .refine((value) => !value.startInterview || Boolean(value.resumeMarkdown), {
    message: 'Resume markdown is required to start the interview.',
    path: ['resumeMarkdown'],
  })
  .refine((value) => !value.startInterview || value.settings !== undefined, {
    message: 'Interview settings are required to start the interview.',
    path: ['settings'],
  });

export const feedbackRequestSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required.'),
  overallExperienceScore: z.number().int().min(1).max(5),
  questionFitScore: z.number().int().min(1).max(5),
  difficultyScore: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().default(''),
});

export type InterviewSystemSettings = z.infer<typeof interviewSettingsSchema>;
export type StreamInterviewInput = z.infer<typeof chatRequestSchema>;

export function parseRequestBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Request validation failed.');
  }

  return parsed.data;
}