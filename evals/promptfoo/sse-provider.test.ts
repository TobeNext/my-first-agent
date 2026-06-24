import { describe, expect, it, vi } from 'vitest';

import {
  default as InterviewSseProvider,
  callInterviewSseProvider,
  callInterviewSseSequence,
  extractInterviewSnapshotFromSse,
  parseSseDataLines,
} from './sse-provider.js';

const snapshot = {
  assistantReply: '权威回复',
  flowTestMockUserReply: null,
  phase: 'professional-skills-round',
  activeRoundType: 'professional-skills',
  activeNodeTopic: 'RAG',
  finalReportReady: false,
  progress: {
    totalQuestionCount: 1,
    completedQuestionCount: 0,
    remainingQuestionCount: 1,
    currentQuestionIndex: 1,
    currentRoundType: 'professional-skills',
    currentRoundLabel: '专业技能面试',
    currentStage: 'main-question',
    currentFollowUpIndex: null,
    currentQuestionText: '请解释你的 RAG 链路。',
    currentNodeTopic: 'RAG',
  },
};

function event(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

describe('promptfoo SSE provider utilities', () => {
  it('extracts data lines from SSE event blocks', () => {
    const lines = parseSseDataLines(
      [
        event({ type: 'text-delta', payload: { text: 'hello' } }),
        ': comment\n',
        event('[DONE]'),
      ].join(''),
    );

    expect(lines).toEqual([
      '{"type":"text-delta","payload":{"text":"hello"}}',
      '[DONE]',
    ]);
  });

  it('extracts the final interview snapshot and streamed fallback text', () => {
    const result = extractInterviewSnapshotFromSse(
      [
        event({ type: 'text-delta', payload: { text: '流式' } }),
        event({
          type: 'tool-result',
          payload: {
            toolName: 'interviewStateManagerTool',
            result: snapshot,
          },
        }),
        event('[DONE]'),
      ].join(''),
    );

    expect(result.done).toBe(true);
    expect(result.streamedText).toBe('流式');
    expect(result.finalSnapshot).toEqual(snapshot);
    expect(result.assistantReply).toBe('权威回复');
    expect(result.errors).toEqual([]);
  });

  it('keeps malformed JSON errors visible for Promptfoo assertions', () => {
    const result = extractInterviewSnapshotFromSse(
      [event('{"type":"text-delta"'), event('[DONE]')].join(''),
    );

    expect(result.done).toBe(true);
    expect(result.finalSnapshot).toBeNull();
    expect(result.errors[0]).toContain('Invalid SSE JSON data line');
  });

  it('calls an SSE endpoint and parses the response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        [
          event({
            type: 'tool-result',
            payload: {
              toolName: 'interviewStateManagerTool',
              result: snapshot,
            },
          }),
          event('[DONE]'),
        ].join(''),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const result = await callInterviewSseProvider({
      endpoint: 'http://localhost:3000/api/agents/chat/stream',
      fetchImpl,
      request: { threadId: 'thread-1', message: 'start' },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/chat/stream',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ threadId: 'thread-1', message: 'start' }),
      }),
    );
    expect(result.finalSnapshot).toEqual(snapshot);
  });

  it('throws with upstream body text on non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }));

    await expect(
      callInterviewSseProvider({
        endpoint: 'http://localhost:3000/api/agents/chat/stream',
        fetchImpl,
        request: { threadId: 'thread-1', message: 'start' },
      }),
    ).rejects.toThrow('HTTP 502: bad gateway');
  });

  it('can run a start request followed by a continuation request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(event({ type: 'text-delta', payload: { text: 'start' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            event({
              type: 'tool-result',
              payload: {
                toolName: 'interviewStateManagerTool',
                result: snapshot,
              },
            }),
            event('[DONE]'),
          ].join(''),
          { status: 200 },
        ),
      );

    const result = await callInterviewSseSequence({
      endpoint: 'http://localhost:3000/api/agents/chat/stream',
      fetchImpl,
      requests: [
        { threadId: 'thread-1', startInterview: true },
        { threadId: 'thread-1', message: '[FLOW_TEST_SKIP]' },
      ],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.finalSnapshot).toEqual(snapshot);
  });


  it('implements the Promptfoo provider class interface', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        [
          event({
            type: 'tool-result',
            payload: {
              toolName: 'interviewStateManagerTool',
              result: snapshot,
            },
          }),
          event('[DONE]'),
        ].join(''),
        { status: 200 },
      ),
    );
    const provider = new InterviewSseProvider({
      id: 'test-provider',
      config: {
        endpoint: 'http://localhost:3000/api/agents/chat/stream',
      },
    });
    vi.stubGlobal('fetch', fetchImpl);

    const response = await provider.callApi('', {
      vars: {
        request: {
          threadId: 'thread-1',
          message: 'start',
        },
      },
    });

    expect(provider.id()).toBe('test-provider');
    expect(JSON.parse(response.output)).toEqual(snapshot);
    expect(response.metadata).toEqual({
      done: true,
      hasFinalSnapshot: true,
      errors: [],
    });
  });
});
