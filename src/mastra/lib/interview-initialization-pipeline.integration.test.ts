import { describe, expect, it } from 'vitest';

import { buildInterviewStartRequest } from '../../../bff/src/modules/agent/interview-start-contract';

import { resolveInterviewInitializationResources } from './interview-initialization-pipeline';
import { recoverMissingInterviewSession } from './interview-kickoff-recovery';

describe('initialization pipeline integration', () => {
  it('covers planning through judged questions into the first interview state transition', async () => {
    const rawKickoffMessage = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-integration',
        resumeMarkdown: ['### 专业技能', '- TypeScript', '- Mastra', '', '### 项目经历', '- AI 面试系统'].join('\n'),
        jobDescriptionMarkdown: ['### 岗位职责', '- Build production agent systems'].join('\n'),
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 1,
        },
      }),
    );

    const initializationResources = await resolveInterviewInitializationResources(rawKickoffMessage, {
      retrieveQuestions: async (options) => ({
        professionalQuestions: options.professionalQuestionPlan.map((plan, index) => ({
          id: `p-${index + 1}`,
          score: 0.9 - index * 0.1,
          text:
            index === 0
              ? `请说明 ${plan.targetAbility} 在大型项目里的实现经验。`
              : '请说明 TypeScript 在大型项目里的实现经验。',
        })),
        projectQuestions: [
          {
            id: 'proj-1',
            score: 0.8,
            text: '请解释你最熟悉的技术栈。',
          },
        ],
        recallTraces: [
          {
            timestamp: '2026-05-24T00:00:00.000Z',
            roundType: 'professional-skills',
            skill: 'Mastra',
            queryText: 'Mastra implementation experience',
            logContext: 'initialization-professional',
            candidateQuestionIds: ['p-2'],
            selectedQuestionIds: ['p-2'],
            candidates: [
              {
                id: 'p-2',
                questionText: '请说明 TypeScript 在大型项目里的实现经验。',
                vectorScore: 0.92,
                bm25Score: 0.74,
                hybridScore: 0.88,
                rerankRank: 1,
                finalSelectionRank: 1,
                filterReason: 'selected',
              },
            ],
            finalSelectedQuestions: [
              {
                id: 'p-2',
                questionText: '请说明 TypeScript 在大型项目里的实现经验。',
                vectorScore: 0.92,
                bm25Score: 0.74,
                hybridScore: 0.88,
                rerankRank: 1,
                finalSelectionRank: 1,
              },
            ],
          },
          {
            timestamp: '2026-05-24T00:00:01.000Z',
            roundType: 'project-experience',
            skill: 'AI 面试系统',
            queryText: 'Project deep dive',
            logContext: 'initialization-project',
            candidateQuestionIds: ['proj-1'],
            selectedQuestionIds: ['proj-1'],
            candidates: [
              {
                id: 'proj-1',
                questionText: '请解释你最熟悉的技术栈。',
                vectorScore: 0.86,
                bm25Score: 0.65,
                hybridScore: 0.81,
                rerankRank: 1,
                finalSelectionRank: 1,
                filterReason: 'selected',
              },
            ],
            finalSelectedQuestions: [
              {
                id: 'proj-1',
                questionText: '请解释你最熟悉的技术栈。',
                vectorScore: 0.86,
                bm25Score: 0.65,
                hybridScore: 0.81,
                rerankRank: 1,
                finalSelectionRank: 1,
              },
            ],
          },
        ],
      }),
    });
    const state = recoverMissingInterviewSession({
      threadId: 'thread-integration',
      rawKickoffMessage,
      professionalSkills: initializationResources.professionalSkills,
      projectExperience: initializationResources.projectExperience,
      normalizedProfessionalSkills: initializationResources.normalizedProfessionalSkills,
      normalizedProjectTopics: initializationResources.normalizedProjectTopics,
      jobDescription: initializationResources.jobDescription,
      professionalQuestions: initializationResources.professionalQuestions,
      projectQuestions: initializationResources.projectQuestions,
    });

    expect(initializationResources.generationTrace).toHaveLength(3);
    expect(initializationResources.judgeTrace.filter((record) => record.verdict === 'fallback')).toHaveLength(2);
    expect(initializationResources.professionalQuestions[1]?.text).toContain('Mastra');
    expect(initializationResources.projectQuestions[0]?.text).toContain('AI 面试系统');
    expect(initializationResources.generationTrace[1]).toEqual(
      expect.objectContaining({
        questionId: initializationResources.professionalQuestions[1]?.id,
        questionText: initializationResources.professionalQuestions[1]?.text,
      }),
    );
    expect(initializationResources.generationTrace[2]).toEqual(
      expect.objectContaining({
        questionId: initializationResources.projectQuestions[0]?.id,
        questionText: initializationResources.projectQuestions[0]?.text,
      }),
    );
    expect(initializationResources.recallTraces[0]).toEqual(
      expect.objectContaining({
        candidateQuestionIds: [initializationResources.professionalQuestions[1]?.id],
        selectedQuestionIds: [initializationResources.professionalQuestions[1]?.id],
        candidates: [
          expect.objectContaining({
            id: initializationResources.professionalQuestions[1]?.id,
            questionText: initializationResources.professionalQuestions[1]?.text,
          }),
        ],
        finalSelectedQuestions: [
          expect.objectContaining({
            id: initializationResources.professionalQuestions[1]?.id,
            questionText: initializationResources.professionalQuestions[1]?.text,
          }),
        ],
      }),
    );
    expect(initializationResources.recallTraces[1]).toEqual(
      expect.objectContaining({
        candidateQuestionIds: [initializationResources.projectQuestions[0]?.id],
        selectedQuestionIds: [initializationResources.projectQuestions[0]?.id],
        candidates: [
          expect.objectContaining({
            id: initializationResources.projectQuestions[0]?.id,
            questionText: initializationResources.projectQuestions[0]?.text,
          }),
        ],
        finalSelectedQuestions: [
          expect.objectContaining({
            id: initializationResources.projectQuestions[0]?.id,
            questionText: initializationResources.projectQuestions[0]?.text,
          }),
        ],
      }),
    );
    expect(state.phase).toBe('professional-skills-round');
    expect(state.rounds[0]?.nodes[0]?.mainQuestion).toContain('TypeScript');
    expect(state.rounds[0]?.nodes[1]?.mainQuestion).toContain('Mastra');
    expect(state.rounds[1]?.nodes[0]?.mainQuestion).toContain('AI 面试系统');
  });
});