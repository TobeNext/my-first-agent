import { describe, expect, it } from 'vitest';

import { resolveInterviewInitializationResources } from './interview-initialization-pipeline';

describe('resolveInterviewInitializationResources legacy parsing', () => {
  it('parses legacy kickoff settings and falls back to a generic direction label when missing', async () => {
    const rawKickoffMessage = [
      'Professional question mode: custom-count',
      'Professional question count: 3',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统',
    ].join('\n');

    const result = await resolveInterviewInitializationResources(rawKickoffMessage, {
      retrieveQuestions: async (options) => {
        expect(options.selectedDirection).toBe('通用技术岗位');
        expect(options.professionalQuestionPlan).toHaveLength(3);

        return {
          professionalQuestions: options.professionalQuestionPlan.map((plan, index) => ({
            id: `legacy-${index + 1}`,
            text: `请说明 ${plan.targetAbility} 的实践经验。`,
          })),
          projectQuestions: [
            {
              id: 'legacy-project',
              text: '请介绍一个你负责过的项目。',
            },
          ],
          recallTraces: [],
        };
      },
    });

    expect(result.normalizedProfessionalSkills).toEqual(['TypeScript']);
    expect(result.professionalQuestions).toHaveLength(3);
    expect(result.projectQuestions[0]?.text).toContain('项目');
  });

  it('falls back to the english generic direction label for freeform non-chinese kickoff text', async () => {
    const rawKickoffMessage = [
      'Professional question count: 2',
      'Resume Markdown:',
      '### Professional Skills',
      '- TypeScript',
      '',
      '### Project Experience',
      '- Built an interview system',
    ].join('\n');

    await resolveInterviewInitializationResources(rawKickoffMessage, {
      retrieveQuestions: async (options) => {
        expect(options.selectedDirection).toBe('General Technical Role');
        expect(options.professionalQuestionPlan).toHaveLength(1);

        return {
          professionalQuestions: [
            {
              id: 'freeform-1',
              text: 'Tell me about your TypeScript experience.',
            },
          ],
          projectQuestions: [
            {
              id: 'freeform-project',
              text: 'Tell me about a project you owned.',
            },
          ],
          recallTraces: [],
        };
      },
    });
  });

  it('treats an explicit unknown direction like a missing direction', async () => {
    const rawKickoffMessage = [
      'Selected interview direction: unknown',
      'Professional question mode: custom-count',
      'Professional question count: 2',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统',
    ].join('\n');

    await resolveInterviewInitializationResources(rawKickoffMessage, {
      retrieveQuestions: async (options) => {
        expect(options.selectedDirection).toBe('通用技术岗位');
        expect(options.professionalQuestionPlan).toHaveLength(2);

        return {
          professionalQuestions: options.professionalQuestionPlan.map((plan, index) => ({
            id: `unknown-${index + 1}`,
            text: `请说明 ${plan.targetAbility} 的实践经验。`,
          })),
          projectQuestions: [
            {
              id: 'unknown-project',
              text: '请介绍一个你负责过的项目。',
            },
          ],
          recallTraces: [],
        };
      },
    });
  });

  it('uses the explicit selected direction when it is present and leaves missing count at the default', async () => {
    const rawKickoffMessage = [
      'Selected interview direction: AI Agent Engineer',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统',
    ].join('\n');

    await resolveInterviewInitializationResources(rawKickoffMessage, {
      retrieveQuestions: async (options) => {
        expect(options.selectedDirection).toBe('AI Agent Engineer');
        expect(options.professionalQuestionPlan).toHaveLength(1);

        return {
          professionalQuestions: [
            {
              id: 'explicit-direction',
              text: '请说明 TypeScript 的实践经验。',
            },
          ],
          projectQuestions: [
            {
              id: 'explicit-direction-project',
              text: '请介绍一个你负责过的项目。',
            },
          ],
          recallTraces: [],
        };
      },
    });
  });
});