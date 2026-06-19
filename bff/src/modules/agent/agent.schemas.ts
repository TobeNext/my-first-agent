import { BadRequestException } from '@nestjs/common';
import { z, type ZodType } from 'zod';

import {
  interviewStartRequestSchema,
  interviewSystemSettingsSchema,
  type InterviewStartRequest,
  type InterviewSystemSettings,
} from './interview-start-contract';

export const interviewSettingsSchema = interviewSystemSettingsSchema;

const continueInterviewRequestSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required.'),
  message: z.string().trim().min(1, 'Message is required after the interview has started.'),
  startInterview: z.literal(false).optional().default(false),
});

export const chatRequestSchema = z.union([interviewStartRequestSchema, continueInterviewRequestSchema]);

export const feedbackRequestSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required.'),
  overallExperienceScore: z.number().int().min(1).max(5),
  questionFitScore: z.number().int().min(1).max(5),
  difficultyScore: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional().default(''),
});

export const reportThreadParamsSchema = z.object({
  threadId: z.string().min(1, 'Thread ID is required.'),
});

export type StreamInterviewInput = InterviewStartRequest | z.infer<typeof continueInterviewRequestSchema>;
export type ReportThreadParams = z.infer<typeof reportThreadParamsSchema>;

export function parseRequestBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const errorMessage =
      /* c8 ignore next -- Zod validation failures always include at least one issue. */
      parsed.error.issues[0]?.message ?? 'Request validation failed.';
    throw new BadRequestException(errorMessage);
  }

  return parsed.data;
}
