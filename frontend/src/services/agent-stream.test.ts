import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLOW_TEST_SKIP_MARKER, streamChatWithAgent } from './agent-stream';

function createSseResponse(blocks: readonly string[]): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) {
        controller.enqueue(encoder.encode(block));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  });
}

describe('streamChatWithAgent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws the upstream raw text when the stream request fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream exploded', { status: 502 })));

    await expect(
      streamChatWithAgent({
        request: {
          threadId: 'thread-1',
          message: FLOW_TEST_SKIP_MARKER,
        },
      }),
    ).rejects.toThrow('upstream exploded');
  });

  it('prefers the authoritative tool-result reply and emits callbacks', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createSseResponse([
          'data: {"type":"text-delta","payload":{"text":"流式"}}\n\n',
          'data: {"type":"tool-result","payload":{"toolName":"interviewStateManagerTool","result":{"assistantReply":"权威回复","flowTestMockUserReply":"Mock Candidate Reply","phase":"professional-skills-round","activeRoundType":"professional-skills","activeNodeTopic":"RAG","finalReportReady":false,"progress":{"totalQuestionCount":6,"completedQuestionCount":1,"remainingQuestionCount":5,"currentQuestionIndex":2,"currentRoundType":"professional-skills","currentRoundLabel":"专业技能面试","currentStage":"follow-up","currentFollowUpIndex":1,"currentQuestionText":"请解释你的 RAG 链路。","currentNodeTopic":"RAG"}}}}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );

    const textDeltas: string[] = [];
    const states: unknown[] = [];
    const result = await streamChatWithAgent({
      request: {
        threadId: 'thread-2',
        message: '继续追问。',
      },
      onTextDelta: (text) => {
        textDeltas.push(text);
      },
      onInterviewState: (state) => {
        states.push(state);
      },
    });

    expect(textDeltas).toEqual(['流式']);
    expect(states).toHaveLength(1);
    expect(result).toEqual({
      authoritativeAssistantReply: '权威回复',
      flowTestMockUserReply: 'Mock Candidate Reply',
      interviewState: {
        assistantReply: '权威回复',
        flowTestMockUserReply: 'Mock Candidate Reply',
        phase: 'professional-skills-round',
        activeRoundType: 'professional-skills',
        activeNodeTopic: 'RAG',
        finalReportReady: false,
        progress: {
          totalQuestionCount: 6,
          completedQuestionCount: 1,
          remainingQuestionCount: 5,
          currentQuestionIndex: 2,
          currentRoundType: 'professional-skills',
          currentRoundLabel: '专业技能面试',
          currentStage: 'follow-up',
          currentFollowUpIndex: 1,
          currentQuestionText: '请解释你的 RAG 链路。',
          currentNodeTopic: 'RAG',
        },
      },
    });
  });

  it('falls back to the streamed text when no interview state is returned', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createSseResponse(['data: {"type":"text-delta","payload":{"text":"第一段"}}\n\n', 'data: {"type":"text-delta","payload":{"text":"第二段"}}\n\n']),
      ),
    );

    await expect(
      streamChatWithAgent({
        request: {
          threadId: 'thread-3',
          message: '继续。',
        },
      }),
    ).resolves.toEqual({
      authoritativeAssistantReply: '第一段第二段',
      flowTestMockUserReply: null,
      interviewState: null,
    });
  });
});