import { streamChatWithAgent } from '../../frontend/src/services/agent-stream';
import { createStartInterviewRequest } from '../../frontend/src/services/interview-start-request';
import type {
  InterviewSystemSettings,
  StreamCompletionResult,
} from '../../frontend/src/types/agent';

import type { InterviewE2eFixture } from './interview-e2e-fixtures';
import { withBffRelativeApiBase } from './interview-e2e-client';

export async function completeInterviewToFinalReport(options: {
  readonly threadId: string;
  readonly fixture: InterviewE2eFixture;
  readonly settings: InterviewSystemSettings;
}): Promise<StreamCompletionResult> {
  let latestResult = await startInterviewSession(options);

  const followUpMessages = [
    ...options.fixture.candidateAnswers,
    '如果这一题可以结束，请进入下一题。',
    '如果还有剩余题目请继续，否则请直接输出最终报告。',
    '请继续推进到下一题；如果面试已足够，请直接给出最终评估报告。',
  ];
  const maxTurns = 16;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    if (latestResult.interviewState?.finalReportReady) {
      break;
    }

    const message =
      followUpMessages[turnIndex] ??
      '如果没有更多关键追问，请结束本次面试并直接输出最终评估报告。';

    latestResult = await withBffRelativeApiBase(() =>
      streamChatWithAgent({
        request: {
          threadId: options.threadId,
          message,
        },
      }),
    );
  }

  if (!latestResult.interviewState?.finalReportReady) {
    throw new Error(`Interview thread ${options.threadId} did not reach the final report stage within ${maxTurns} turns.`);
  }

  return latestResult;
}

export async function startInterviewSession(options: {
  readonly threadId: string;
  readonly fixture: InterviewE2eFixture;
  readonly settings: InterviewSystemSettings;
}): Promise<StreamCompletionResult> {
  return await withBffRelativeApiBase(() =>
    streamChatWithAgent({
      request: createStartInterviewRequest({
        threadId: options.threadId,
        resumeMarkdown: options.fixture.resumeMarkdown,
        jobDescriptionMarkdown: options.fixture.jobDescriptionMarkdown,
        settings: options.settings,
      }),
    }),
  );
}