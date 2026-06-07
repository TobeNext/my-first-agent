import { describe, expect, it } from 'vitest';

import { buildInterviewStartRequest } from '../../../bff/src/modules/agent/interview-start-contract';

import { generateInitializationQuestionSet } from './interview-question-generator';
import { resolveInterviewInitializationResources } from './interview-initialization-pipeline';
import { judgeInitializationQuestionSet } from './interview-question-critic';
import { planProfessionalQuestionQueries } from './interview-question-planner';

describe('resolveInterviewInitializationResources', () => {
  it('orchestrates plan, retrieve, generate, and judge stages outside the state manager', async () => {
    const rawKickoffMessage = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-init',
        resumeMarkdown: ['### 专业技能', '- TypeScript', '- Mastra', '', '### 项目经历', '- 搭建 AI 面试系统'].join('\n'),
        jobDescriptionMarkdown: ['### 岗位职责', '- Build reliable agent systems'].join('\n'),
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
    const calls: string[] = [];

    const result = await resolveInterviewInitializationResources(rawKickoffMessage, {
      planQuestions: (options) => {
        calls.push('plan');
        return planProfessionalQuestionQueries(options);
      },
      retrieveQuestions: async (options) => {
        calls.push('retrieve');

        return {
          professionalQuestions: options.professionalQuestionPlan.map((plan, index) => ({
            id: `p-${index + 1}`,
            text: `请说明 ${plan.targetAbility} 的实际实现经验。`,
          })),
          projectQuestions: [
            {
              id: 'proj-1',
              text: '请介绍一个你负责过的项目。',
            },
          ],
          recallTraces: [],
        };
      },
      generateQuestions: (options) => {
        calls.push('generate');
        return generateInitializationQuestionSet(options);
      },
      judgeQuestions: (options) => {
        calls.push('judge');
        return judgeInitializationQuestionSet(options);
      },
    });

    expect(calls).toEqual(['plan', 'retrieve', 'generate', 'judge']);
    expect(result.normalizedProfessionalSkills).toEqual(['TypeScript', 'Mastra']);
    expect(result.professionalQuestions).toHaveLength(2);
    expect(result.projectQuestions).toHaveLength(1);
    expect(result.generationTrace).toHaveLength(3);
    expect(result.judgeTrace.every((record) => record.verdict === 'accepted')).toBe(true);
  });
});