import { z } from 'zod';

import type {
  ProfessionalQuestionMode,
  InterviewRoundPreference,
  InterviewSystemSettings,
} from '@/types/agent';

export const DEFAULT_PROFESSIONAL_QUESTION_COUNT = 6;
export const DEFAULT_PROJECT_QUESTION_COUNT = 2;
export const DEFAULT_PROFESSIONAL_QUESTION_MODE: ProfessionalQuestionMode = 'per-skill-default';
export const MIN_INTERVIEW_QUESTION_COUNT = 1;
export const MAX_INTERVIEW_TOTAL_QUESTION_COUNT = 10;
export const INTERVIEW_QUESTION_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const professionalQuestionModeSchema = z.enum(['per-skill-default', 'custom-count']);

const interviewSystemSettingsSchema = z
  .object({
    reviewIncorrectOrMissingPoints: z.boolean(),
    skipProfessionalSkillsRound: z.boolean(),
    skipProjectExperienceRound: z.boolean(),
    enableFlowTestMode: z.boolean(),
    professionalQuestionMode: professionalQuestionModeSchema,
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

    if (value.skipProfessionalSkillsRound && value.professionalQuestionCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Professional skills question count must be 0 when that round is skipped.',
        path: ['professionalQuestionCount'],
      });
    }

    if (!value.skipProfessionalSkillsRound && value.professionalQuestionCount < MIN_INTERVIEW_QUESTION_COUNT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Professional skills question count must be at least 1 when that round is enabled.',
        path: ['professionalQuestionCount'],
      });
    }

    if (!value.skipProjectExperienceRound && value.projectQuestionCount < MIN_INTERVIEW_QUESTION_COUNT) {
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

    const totalQuestionCount = value.professionalQuestionCount + value.projectQuestionCount;
    if (totalQuestionCount > MAX_INTERVIEW_TOTAL_QUESTION_COUNT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The total number of interview questions cannot exceed 10.',
        path: ['professionalQuestionCount'],
      });
    }
  });

export function buildInterviewSystemSettings(options: {
  reviewIncorrectOrMissingPoints: boolean;
  roundPreference: InterviewRoundPreference;
  enableFlowTestMode: boolean;
  professionalQuestionMode: ProfessionalQuestionMode;
  professionalQuestionCount: number;
  projectQuestionCount: number;
}): InterviewSystemSettings {
  const skipProfessionalSkillsRound = options.roundPreference === 'skip-professional-skills';
  const skipProjectExperienceRound = options.roundPreference === 'skip-project-experience';

  const parsed = interviewSystemSettingsSchema.parse({
    reviewIncorrectOrMissingPoints: options.reviewIncorrectOrMissingPoints,
    skipProfessionalSkillsRound,
    skipProjectExperienceRound,
    enableFlowTestMode: options.enableFlowTestMode,
    professionalQuestionMode: options.professionalQuestionMode,
    professionalQuestionCount: skipProfessionalSkillsRound ? 0 : options.professionalQuestionCount,
    projectQuestionCount: skipProjectExperienceRound ? 0 : options.projectQuestionCount,
  });

  return parsed;
}