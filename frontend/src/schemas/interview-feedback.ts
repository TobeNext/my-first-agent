import { z } from 'zod';

export const INTERVIEW_FEEDBACK_SCORE_OPTIONS = [1, 2, 3, 4, 5] as const;

export const interviewFeedbackSchema = z.object({
  threadId: z.string().min(1, '缺少面试线程信息，暂时无法提交反馈。'),
  overallExperienceScore: z.number().int().min(1).max(5),
  questionFitScore: z.number().int().min(1).max(5),
  difficultyScore: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000, '反馈内容请控制在 2000 个字符以内。').default(''),
});

export type InterviewFeedbackPayload = z.infer<typeof interviewFeedbackSchema>;

export function buildInterviewFeedbackPayload(input: InterviewFeedbackPayload): InterviewFeedbackPayload {
  return interviewFeedbackSchema.parse(input);
}