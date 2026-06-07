import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('./zhipu-model', () => ({
  glmAirModel: { id: 'mock-model' },
}));

function createSessionState() {
  return {
    version: 1,
    threadId: 'thread-model',
    targetRole: 'AI Agent Engineer',
    company: null,
    responseLanguage: 'zh',
    phase: 'professional-skills-round',
    activeRoundId: 'round-1',
    finalReportReady: false,
    finalReport: null,
    setup: {
      selectedDirection: 'AI Agent Engineer',
      directionSource: 'preset',
      settings: {
        reviewIncorrectOrMissingPoints: true,
        skipProfessionalSkillsRound: false,
        skipProjectExperienceRound: false,
        enableFlowTestMode: false,
        professionalQuestionMode: 'custom-count',
        professionalQuestionCount: 2,
        projectQuestionCount: 1,
      },
    },
    resumeContext: {
      professionalSkills: 'TypeScript\nMastra',
      projectExperience: '- Built interview workflows',
      jobDescription: 'Build agent systems',
      resumeParsed: true,
    },
    lastCorrectionSummary: null,
    rounds: [
      {
        id: 'round-1',
        type: 'professional-skills',
        status: 'in-progress',
        plannedNodeCount: 1,
        completedNodeCount: 0,
        activeNodeId: 'node-1',
        nodeOrder: ['node-1'],
        nodes: [
          {
            id: 'node-1',
            topic: 'TypeScript',
            source: 'resume',
            mainQuestion: '请解释 TypeScript 在大型项目中的边界设计。',
            status: 'awaiting-main-answer',
            currentTargetType: 'main-question',
            currentFollowUpId: null,
            followUpCount: 1,
            maxFollowUps: 3,
            detourResponseCount: 0,
            earlyCompletionReason: null,
            followUps: [
              {
                id: 'follow-1',
                index: 1,
                intent: 'depth',
                question: '你刚才提到类型边界，能展开说说吗？',
                status: 'answered',
                linkedAnswerId: 'answer-1',
              },
            ],
            answerAttempts: [
              {
                id: 'answer-1',
                targetType: 'main-question',
                targetId: 'node-1',
                userMessage: '我会先拆分接口层和领域层的类型。',
                classification: 'partial-answer',
                score: null,
                strengths: [],
                missingPoints: [],
                incorrectPoints: [],
                isDetour: false,
                createdAt: '2026-05-16T00:00:00.000Z',
              },
            ],
            aggregatedScore: null,
            summary: null,
          },
        ],
      },
    ],
  };
}

describe('ensureGeneratedFollowUpQuestion default model path', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it('builds the model prompt and parses fenced JSON output', async () => {
    const { ensureGeneratedFollowUpQuestion } = await import('./interview-question-generator');
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    generateTextMock.mockResolvedValue({
      text: '```json\n{"followUpQuestion":"你能具体说说 DTO 和领域对象如何隔离吗？"}\n```',
    });

    const result = await ensureGeneratedFollowUpQuestion({
      state,
      activeRound,
      activeNode,
      currentQuestion: activeNode.followUps[0].question,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis: {
        classification: 'partial-answer',
        recommendedIntent: 'depth',
        followUpFocus: ['类型边界'],
        followUpQuestion: null,
        missingPoints: ['没有展开 DTO 与领域对象边界'],
        incorrectPoints: [],
      },
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const prompt = generateTextMock.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('Interviewer follow-up #1: 你刚才提到类型边界，能展开说说吗？');
    expect(prompt).toContain('Candidate answer #2: 我会先拆分接口层和领域层的类型。');
    expect(prompt).not.toContain('Candidate latest answer: 我会先拆分接口层和领域层的类型。');
    expect(result.followUpQuestion).toBe('你能具体说说 DTO 和领域对象如何隔离吗？');
  });

  it('keeps the original analysis when the model returns invalid JSON or throws', async () => {
    const { ensureGeneratedFollowUpQuestion } = await import('./interview-question-generator');
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    const analysis = {
      classification: 'direct-answer' as const,
      recommendedIntent: 'depth' as const,
      followUpFocus: ['类型边界'],
      followUpQuestion: null,
      missingPoints: [],
      incorrectPoints: [],
    };

    generateTextMock.mockResolvedValueOnce({ text: 'not-json' });
    const invalidJsonResult = await ensureGeneratedFollowUpQuestion({
      state,
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis,
    });

    generateTextMock.mockRejectedValueOnce(new Error('generator failed'));
    const errorResult = await ensureGeneratedFollowUpQuestion({
      state,
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis,
    });

    expect(invalidJsonResult.followUpQuestion).toBeNull();
    expect(errorResult.followUpQuestion).toBeNull();
  });

  it('keeps the original analysis when the model returns an empty or null follow-up payload', async () => {
    const { ensureGeneratedFollowUpQuestion } = await import('./interview-question-generator');
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = {
      ...activeRound.nodes[0],
      answerAttempts: [],
      followUps: [],
    };
    const analysis = {
      classification: 'direct-answer' as const,
      recommendedIntent: 'depth' as const,
      followUpFocus: [],
      followUpQuestion: null,
      missingPoints: [],
      incorrectPoints: [],
    };

    generateTextMock.mockResolvedValueOnce({ text: '{"followUpQuestion":"   "}' });
    const emptyResult = await ensureGeneratedFollowUpQuestion({
      state: {
        ...state,
        resumeContext: {
          ...state.resumeContext,
          jobDescription: '',
        },
      },
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis,
    });

    generateTextMock.mockResolvedValueOnce({ text: '{"followUpQuestion":null}' });
    const nullResult = await ensureGeneratedFollowUpQuestion({
      state: {
        ...state,
        resumeContext: {
          ...state.resumeContext,
          jobDescription: '',
        },
      },
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis,
    });

    const emptyPrompt = generateTextMock.mock.calls[0]?.[0]?.prompt as string;
    expect(emptyPrompt).toContain('Job description context: not provided');
    expect(emptyPrompt).toContain('Follow-up focus: TypeScript');
    expect(emptyPrompt).toContain('Candidate latest answer: 我会先拆分接口层和领域层的类型。');
    expect(emptyResult.followUpQuestion).toBeNull();
    expect(nullResult.followUpQuestion).toBeNull();
  });

  it('keeps the original analysis when the model returns a non-string follow-up payload', async () => {
    const { ensureGeneratedFollowUpQuestion } = await import('./interview-question-generator');
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    generateTextMock.mockResolvedValueOnce({ text: '{"followUpQuestion":123}' });

    const result = await ensureGeneratedFollowUpQuestion({
      state,
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis: {
        classification: 'direct-answer',
        recommendedIntent: 'depth',
        followUpFocus: ['类型边界'],
        followUpQuestion: null,
        missingPoints: [],
        incorrectPoints: [],
      },
    });

    expect(result.followUpQuestion).toBeNull();
  });

  it('keeps the original analysis when the model output is only whitespace', async () => {
    const { ensureGeneratedFollowUpQuestion } = await import('./interview-question-generator');
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    generateTextMock.mockResolvedValueOnce({ text: '   ' });

    const result = await ensureGeneratedFollowUpQuestion({
      state,
      activeRound,
      activeNode,
      currentQuestion: activeNode.mainQuestion,
      userMessage: '我会先拆分接口层和领域层的类型。',
      analysis: {
        classification: 'direct-answer',
        recommendedIntent: 'depth',
        followUpFocus: ['类型边界'],
        followUpQuestion: null,
        missingPoints: [],
        incorrectPoints: [],
      },
    });

    expect(result.followUpQuestion).toBeNull();
  });
});