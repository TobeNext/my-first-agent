import { buildInterviewStartRequest } from '../../../bff/src/modules/agent/interview-start-contract';

import type { InterviewSystemSettings, StartInterviewRequest } from '@/types/agent';

export function createStartInterviewRequest(options: {
  readonly threadId: string;
  readonly resumeMarkdown: string;
  readonly jobDescriptionMarkdown: string;
  readonly settings: InterviewSystemSettings;
}): StartInterviewRequest {
  return buildInterviewStartRequest({
    threadId: options.threadId,
    resumeMarkdown: options.resumeMarkdown,
    jobDescriptionMarkdown: options.jobDescriptionMarkdown,
    settings: options.settings,
  });
}