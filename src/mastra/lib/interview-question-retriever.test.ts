import { describe, expect, it } from 'vitest';

import { planProfessionalQuestionQueries } from './interview-question-planner';
import { retrieveInitializationQuestions } from './interview-question-retriever';
import type { RagRecallTrace } from './rag-recall-sample';

describe('retrieveInitializationQuestions', () => {
  it('uses one retriever query per professional plan plus one project query and aggregates trace output', async () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript', 'Mastra'],
      desiredQuestionCount: 3,
      jobDescription: ['- Build TypeScript systems', '- Handle production incidents'].join('\n'),
    });
    const queryCalls: string[] = [];

    const result = await retrieveInitializationQuestions(
      {
        selectedDirection: 'AI Agent Engineer',
        rawKickoffMessage: 'kickoff payload',
        professionalSkills: 'TypeScript\nMastra',
        normalizedProfessionalSkills: ['TypeScript', 'Mastra'],
        projectExperience: '- Built an interview state machine',
        professionalQuestionPlan,
      },
      {
        queryQuestions: async (options) => {
          queryCalls.push(options.logContext ?? 'unknown');
          await options.onRecallTrace?.({
            timestamp: '2026-05-16T00:00:00.000Z',
            roundType: options.roundType ?? null,
            skill: options.skill ?? 'unknown-skill',
            queryText: options.queryText,
            logContext: options.logContext ?? 'unknown',
            candidateQuestionIds: ['candidate-1'],
            selectedQuestionIds: ['selected-1'],
            candidates: [],
            finalSelectedQuestions: [],
          } satisfies RagRecallTrace);

          return {
            count: 1,
            questions: [
              {
                id: options.logContext ?? 'question-id',
                text: options.queryText,
                score: 0.9,
              },
            ],
          };
        },
      },
    );

    expect(queryCalls).toHaveLength(professionalQuestionPlan.length + 1);
    expect(queryCalls.at(-1)).toBe('initialization:project-experience:context');
    expect(result.professionalQuestions).toHaveLength(professionalQuestionPlan.length);
    expect(result.projectQuestions).toHaveLength(1);
    expect(result.recallTraces).toHaveLength(professionalQuestionPlan.length + 1);
    expect(result.professionalQuestions[0]?.text).toContain('Target role: AI Agent Engineer');
    expect(result.professionalQuestions.some((question) => question.text.includes('Job description signals:'))).toBe(true);
  });

  it('falls back to the round context query when no professional plan is available', async () => {
    const queryTexts: string[] = [];

    const result = await retrieveInitializationQuestions(
      {
        selectedDirection: 'Backend Engineer',
        rawKickoffMessage: 'legacy kickoff payload',
        professionalSkills: '',
        normalizedProfessionalSkills: [],
        projectExperience: '- Improved an API gateway',
        professionalQuestionPlan: [],
      },
      {
        queryQuestions: async (options) => {
          queryTexts.push(options.queryText);

          return {
            count: 1,
            questions: [
              {
                id: `${options.roundType}-question`,
                text: options.queryText,
              },
            ],
          };
        },
      },
    );

    expect(queryTexts[0]).toContain('Professional skills context:');
    expect(queryTexts[0]).toContain('legacy kickoff payload');
    expect(queryTexts[1]).toContain('Project experience context:');
    expect(result.professionalQuestions[0]?.text).toContain('legacy kickoff payload');
    expect(result.projectQuestions[0]?.text).toContain('Improved an API gateway');
    expect(result.recallTraces).toEqual([]);
  });
});