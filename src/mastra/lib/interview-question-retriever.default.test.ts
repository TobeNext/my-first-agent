import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryInterviewQuestionsMock = vi.fn();

vi.mock('../tools/interview-question-tool', () => ({
  queryInterviewQuestions: queryInterviewQuestionsMock,
}));

describe('retrieveInitializationQuestions default dependency', () => {
  beforeEach(() => {
    queryInterviewQuestionsMock.mockReset();
  });

  it('uses the default question-query tool when no custom query dependency is provided', async () => {
    const { planProfessionalQuestionQueries } = await import('./interview-question-planner');
    const { retrieveInitializationQuestions } = await import('./interview-question-retriever');
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'per-skill-default',
      professionalSkills: ['TypeScript'],
      desiredQuestionCount: 1,
      jobDescription: '',
    });

    queryInterviewQuestionsMock.mockImplementation(async (options) => {
      await options.onRecallTrace?.({
        timestamp: '2026-05-16T00:00:00.000Z',
        roundType: options.roundType ?? null,
        skill: options.skill ?? 'unknown-skill',
        queryText: options.queryText,
        logContext: options.logContext ?? 'unknown',
        candidateQuestionIds: [],
        selectedQuestionIds: [],
        candidates: [],
        finalSelectedQuestions: [],
      });

      return {
        count: 1,
        questions: [
          {
            id: options.logContext ?? 'question-id',
            text: options.queryText,
          },
        ],
      };
    });

    const result = await retrieveInitializationQuestions({
      selectedDirection: 'AI Agent Engineer',
      rawKickoffMessage: 'kickoff payload',
      professionalSkills: 'TypeScript',
      normalizedProfessionalSkills: ['TypeScript'],
      projectExperience: '- Built an interview system',
      professionalQuestionPlan,
    });

    expect(queryInterviewQuestionsMock).toHaveBeenCalled();
    expect(result.recallTraces).toHaveLength(2);
  });
});