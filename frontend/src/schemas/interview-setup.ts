import { z } from 'zod';

import {
  interviewSystemSettingsSchema,
  MAX_INTERVIEW_TOTAL_QUESTION_COUNT as CANONICAL_MAX_INTERVIEW_TOTAL_QUESTION_COUNT,
} from '../../../bff/src/modules/agent/interview-start-contract';

import type {
  ProfessionalQuestionMode,
  InterviewRoundPreference,
  InterviewSystemSettings,
} from '@/types/agent';

export const DEFAULT_PROFESSIONAL_QUESTION_COUNT = 6;
export const DEFAULT_PROJECT_QUESTION_COUNT = 2;
export const DEFAULT_PROFESSIONAL_QUESTION_MODE: ProfessionalQuestionMode = 'per-skill-default';
export const MIN_INTERVIEW_QUESTION_COUNT = 1;
export const MAX_INTERVIEW_TOTAL_QUESTION_COUNT = CANONICAL_MAX_INTERVIEW_TOTAL_QUESTION_COUNT;
export const INTERVIEW_QUESTION_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

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
    enableHistoricalMemory: true,
    professionalQuestionMode: options.professionalQuestionMode,
    professionalQuestionCount: skipProfessionalSkillsRound ? 0 : options.professionalQuestionCount,
    projectQuestionCount: skipProjectExperienceRound ? 0 : options.projectQuestionCount,
  });

  return parsed;
}
