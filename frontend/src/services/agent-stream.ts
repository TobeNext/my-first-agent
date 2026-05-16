import { z } from 'zod';

import type {
  InterviewStateSnapshot,
  InterviewStreamRequest,
  StreamCompletionResult,
} from '@/types/agent';

import { parseHttpErrorPayload } from './http-error';

export const FLOW_TEST_SKIP_MARKER = '[FLOW_TEST_SKIP]';

export interface MastraStreamEvent {
  readonly type?: string;
  readonly payload?: {
    readonly text?: string;
    readonly toolName?: string;
    readonly result?: unknown;
  };
}

const interviewProgressSchema = z.object({
  totalQuestionCount: z.number().int().nonnegative(),
  completedQuestionCount: z.number().int().nonnegative(),
  remainingQuestionCount: z.number().int().nonnegative(),
  currentQuestionIndex: z.number().int().positive().nullable(),
  currentRoundType: z.enum(['professional-skills', 'project-experience']).nullable(),
  currentRoundLabel: z.string().nullable(),
  currentStage: z.enum(['main-question', 'follow-up', 'completed']),
  currentFollowUpIndex: z.number().int().positive().nullable(),
  currentQuestionText: z.string().nullable(),
  currentNodeTopic: z.string().nullable(),
});

const interviewStateSnapshotSchema = z.object({
  assistantReply: z.string(),
  flowTestMockUserReply: z.string().nullable(),
  phase: z.string(),
  activeRoundType: z.string().nullable(),
  activeNodeTopic: z.string().nullable(),
  finalReportReady: z.boolean(),
  progress: interviewProgressSchema,
});

function parseSseEventBlock(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .filter((line) => line.length > 0);
}

function resolveFallbackAssistantReply(streamedText: string): string | null {
  const normalizedText = streamedText.trim();
  return normalizedText.length > 0 ? normalizedText : null;
}

function logStreamEvent(event: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`[agent-stream] ${event}`, details);
    return;
  }

  console.info(`[agent-stream] ${event}`);
}

export async function streamChatWithAgent(options: {
  request: InterviewStreamRequest;
  onTextDelta?: (text: string) => void;
  onInterviewState?: (state: InterviewStateSnapshot) => void;
}): Promise<StreamCompletionResult> {
  logStreamEvent('request:start', {
    threadId: options.request.threadId,
    startInterview: 'startInterview' in options.request,
    isFlowTestSkip:
      'message' in options.request ? options.request.message === FLOW_TEST_SKIP_MARKER : false,
  });

  const response = await fetch('/api/agents/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(options.request),
  });

  if (!response.ok || !response.body) {
    const errorPayload = await parseHttpErrorPayload(response, {
      includeRawTextFallback: true,
    });
    const errorMessage = errorPayload.details?.[0] ?? errorPayload.message;

    logStreamEvent('request:error', {
      threadId: options.request.threadId,
      status: response.status,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const streamState: {
    latestInterviewState: InterviewStateSnapshot | null;
    streamedText: string;
  } = {
    latestInterviewState: null,
    streamedText: '',
  };

  const handleDataLine = (dataLine: string): void => {
    if (dataLine === '[DONE]') {
      return;
    }

    let parsed: MastraStreamEvent;

    try {
      parsed = JSON.parse(dataLine) as MastraStreamEvent;
    } catch {
      return;
    }

    if (parsed.type === 'text-delta' && parsed.payload?.text) {
      streamState.streamedText += parsed.payload.text;
      options.onTextDelta?.(parsed.payload.text);
      return;
    }

    if (parsed.type === 'tool-result' && parsed.payload?.toolName === 'interviewStateManagerTool') {
      const stateResult = interviewStateSnapshotSchema.safeParse(parsed.payload.result);
      if (stateResult.success) {
        streamState.latestInterviewState = stateResult.data;
        logStreamEvent('state:update', {
          threadId: options.request.threadId,
          phase: stateResult.data.phase,
          currentStage: stateResult.data.progress.currentStage,
          currentQuestionIndex: stateResult.data.progress.currentQuestionIndex,
          remainingQuestionCount: stateResult.data.progress.remainingQuestionCount,
          finalReportReady: stateResult.data.finalReportReady,
        });
        options.onInterviewState?.(stateResult.data);
      }
    }
  };

  const processEventBlock = (block: string): void => {
    for (const dataLine of parseSseEventBlock(block)) {
      handleDataLine(dataLine);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const eventBlocks = buffer.split('\n\n');
      buffer = eventBlocks.pop() ?? '';

      for (const block of eventBlocks) {
        processEventBlock(block);
      }
    }

    if (buffer.trim()) {
      processEventBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  const result = {
    authoritativeAssistantReply:
      streamState.latestInterviewState?.assistantReply ?? resolveFallbackAssistantReply(streamState.streamedText),
    flowTestMockUserReply: streamState.latestInterviewState?.flowTestMockUserReply ?? null,
    interviewState: streamState.latestInterviewState,
  };

  logStreamEvent('request:complete', {
    threadId: options.request.threadId,
    hasInterviewState: result.interviewState !== null,
    hasAssistantReply: result.authoritativeAssistantReply !== null,
  });

  return result;
}