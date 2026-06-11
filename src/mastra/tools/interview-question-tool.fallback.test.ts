import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedMock = vi.fn();

vi.mock('ai', () => ({
  embed: embedMock,
}));

describe('queryInterviewQuestions fallback behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    embedMock.mockReset();
  });

  it('returns an empty result instead of throwing when recall dependencies fail', async () => {
    embedMock.mockRejectedValue(new Error('Milvus unavailable'));

    const { queryInterviewQuestions } = await import('./interview-question-tool');
    const traces: unknown[] = [];

    const result = await queryInterviewQuestions({
      queryText: 'Target role: AI Agent Engineer',
      roundType: 'professional-skills',
      skill: 'mastra',
      logContext: 'test:milvus-unavailable',
      onRecallTrace: (trace) => {
        traces.push(trace);
      },
    });

    expect(result).toEqual({
      count: 0,
      questions: [],
    });
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      roundType: 'professional-skills',
      skill: 'mastra',
      logContext: 'test:milvus-unavailable',
      candidates: [],
      finalSelectedQuestions: [],
    });
  });
});
