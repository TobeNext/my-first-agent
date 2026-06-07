import { describe, expect, it, vi } from 'vitest';

import {
  ensureGeneratedFollowUpQuestion,
  generateInitializationQuestionSet,
} from './interview-question-generator';
import { planProfessionalQuestionQueries } from './interview-question-planner';
import {
  answerScoreSchema,
  interviewSessionStateSchema,
} from './interview-state-machine-schema';

function createSessionState() {
  return interviewSessionStateSchema.parse({
    version: 1,
    threadId: 'thread-1',
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
            followUpCount: 0,
            maxFollowUps: 3,
            detourResponseCount: 0,
            earlyCompletionReason: null,
            followUps: [],
            answerAttempts: [],
            aggregatedScore: null,
            summary: null,
          },
        ],
      },
    ],
  });
}

describe('generateInitializationQuestionSet', () => {
  it('adapts retrieved questions into a dedicated generation result and trace', () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript', 'Mastra'],
      desiredQuestionCount: 2,
      jobDescription: '- Build agent systems',
    });

    const result = generateInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: [
        {
          id: 'p-1',
          text: '  请说明 TypeScript 在大型项目中的类型边界设计。  ',
        },
      ],
      projectQuestions: [
        {
          id: 'proj-1',
          text: '  请介绍一个你主导的 Agent 项目。 ',
        },
      ],
    });

    expect(result.professionalQuestions[0]?.text).toBe('请说明 TypeScript 在大型项目中的类型边界设计。');
    expect(result.projectQuestions[0]?.text).toBe('请介绍一个你主导的 Agent 项目。');
    expect(result.generationTrace).toEqual([
      expect.objectContaining({
        roundType: 'professional-skills',
        questionId: 'p-1',
        targetAbility: professionalQuestionPlan[0]?.targetAbility,
      }),
      expect.objectContaining({
        roundType: 'project-experience',
        questionId: 'proj-1',
        questionType: 'project-deep-dive',
      }),
    ]);
  });

  it('filters blank questions and falls back to generic trace metadata when no plan entry exists', () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'per-skill-default',
      professionalSkills: ['TypeScript'],
      desiredQuestionCount: 1,
      jobDescription: '',
    });

    const result = generateInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: [
        {
          id: 'blank-question',
          text: '   ',
        },
        {
          id: 'extra-question',
          text: '请说明一次你处理复杂线上问题的经历。',
        },
      ],
      projectQuestions: [],
    });

    expect(result.professionalQuestions).toEqual([
      {
        id: 'extra-question',
        text: '请说明一次你处理复杂线上问题的经历。',
      },
    ]);
    expect(result.generationTrace[0]).toEqual(
      expect.objectContaining({
        targetAbility: professionalQuestionPlan[0]?.targetAbility,
      }),
    );
  });

  it('uses generic professional trace metadata when no plan exists at all', () => {
    const result = generateInitializationQuestionSet({
      professionalQuestionPlan: [],
      professionalQuestions: [
        {
          id: 'no-plan-question',
          text: '请说明一次你处理复杂线上问题的经历。',
        },
      ],
      projectQuestions: [],
    });

    expect(result.generationTrace[0]).toEqual(
      expect.objectContaining({
        targetAbility: null,
        coverageIntent: 'professional-skills-context',
        selectionReason: 'Adapted a retrieved professional-skills candidate into the final main-question set.',
      }),
    );
  });
});

describe('ensureGeneratedFollowUpQuestion', () => {
  it('fills the follow-up question through the generator stage when the analysis needs deepening', async () => {
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    const generateFollowUpQuestion = vi.fn().mockResolvedValue('你刚才提到类型边界，能具体说说如何划分 DTO 和领域对象吗？');

    const result = await ensureGeneratedFollowUpQuestion(
      {
        state,
        activeRound,
        activeNode,
        currentQuestion: activeNode.mainQuestion,
        userMessage: '我会先拆分接口层和领域层的类型。',
        analysis: {
          classification: 'partial-answer',
          score: answerScoreSchema.parse({
            relevance: 7,
            accuracy: 7,
            depth: 6,
            specificity: 6,
            clarity: 7,
            weightedTotal: 6.65,
          }),
          strengths: ['回答覆盖了分层思路'],
          missingPoints: ['没有展开边界如何约束'],
          incorrectPoints: [],
          recommendedIntent: 'depth',
          followUpFocus: ['类型边界'],
          followUpQuestion: null,
          detourReply: null,
          clarificationReply: null,
          shouldCompleteNode: false,
          earlyCompletionReason: null,
        },
      },
      {
        generateFollowUpQuestion,
      },
    );

    expect(generateFollowUpQuestion).toHaveBeenCalledTimes(1);
    expect(result.followUpQuestion).toBe('你刚才提到类型边界，能具体说说如何划分 DTO 和领域对象吗？');
  });

  it('skips generator execution when a dedicated follow-up already exists', async () => {
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    const generateFollowUpQuestion = vi.fn().mockResolvedValue('should not be used');

    const result = await ensureGeneratedFollowUpQuestion(
      {
        state,
        activeRound,
        activeNode,
        currentQuestion: activeNode.mainQuestion,
        userMessage: '我会先拆分接口层和领域层的类型。',
        analysis: {
          classification: 'partial-answer',
          recommendedIntent: 'depth',
          followUpFocus: ['类型边界'],
          followUpQuestion: '你能展开谈谈类型隔离策略吗？',
          missingPoints: [],
          incorrectPoints: [],
        },
      },
      {
        generateFollowUpQuestion,
      },
    );

    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(result.followUpQuestion).toBe('你能展开谈谈类型隔离策略吗？');
  });

  it('skips generator execution when the node has exhausted follow-up attempts', async () => {
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = {
      ...activeRound.nodes[0],
      followUpCount: 3,
      maxFollowUps: 3,
    };
    const generateFollowUpQuestion = vi.fn().mockResolvedValue('should not be used');

    const result = await ensureGeneratedFollowUpQuestion(
      {
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
      },
      {
        generateFollowUpQuestion,
      },
    );

    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(result.followUpQuestion).toBeNull();
  });

  it('skips generator execution for non-answer classifications', async () => {
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];
    const generateFollowUpQuestion = vi.fn().mockResolvedValue('should not be used');

    const result = await ensureGeneratedFollowUpQuestion(
      {
        state,
        activeRound,
        activeNode,
        currentQuestion: activeNode.mainQuestion,
        userMessage: '为什么要问这个问题？',
        analysis: {
          classification: 'meta-question',
          recommendedIntent: 'depth',
          followUpFocus: [],
          followUpQuestion: null,
          missingPoints: [],
          incorrectPoints: [],
        },
      },
      {
        generateFollowUpQuestion,
      },
    );

    expect(generateFollowUpQuestion).not.toHaveBeenCalled();
    expect(result.followUpQuestion).toBeNull();
  });

  it('keeps the original analysis when the injected generator returns null', async () => {
    const state = createSessionState();
    const activeRound = state.rounds[0];
    const activeNode = activeRound.nodes[0];

    const result = await ensureGeneratedFollowUpQuestion(
      {
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
      },
      {
        generateFollowUpQuestion: async () => null,
      },
    );

    expect(result.followUpQuestion).toBeNull();
  });
});