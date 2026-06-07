import { describe, expect, it } from 'vitest';

import { judgeInitializationQuestionSet } from './interview-question-critic';
import { generateInitializationQuestionSet } from './interview-question-generator';
import { planProfessionalQuestionQueries } from './interview-question-planner';

describe('judgeInitializationQuestionSet', () => {
  it('replaces duplicate professional questions with deterministic fallbacks', () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'per-skill-default',
      professionalSkills: ['TypeScript', 'Mastra'],
      desiredQuestionCount: 2,
      jobDescription: '- Build production agent systems',
    });
    const generatedQuestionSet = generateInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: [
        {
          id: 'p-1',
          score: 0.9,
          text: '请说明 TypeScript 在大型项目中的类型边界设计。',
        },
        {
          id: 'p-2',
          score: 0.8,
          text: '请说明 TypeScript 在大型项目中的类型边界设计。',
        },
      ],
      projectQuestions: [],
    });

    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: generatedQuestionSet.professionalQuestions,
      projectQuestions: generatedQuestionSet.projectQuestions,
      generationTrace: generatedQuestionSet.generationTrace,
      normalizedProjectTopics: [],
    });

    expect(result.professionalQuestions[0]?.text).toBe('请说明 TypeScript 在大型项目中的类型边界设计。');
    expect(result.professionalQuestions[1]?.id).toContain(':critic-fallback');
    expect(result.professionalQuestions[1]?.text).toContain('Mastra');
    expect(result.judgeTrace[1]).toEqual(
      expect.objectContaining({
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['duplicate-question']),
      }),
    );
  });

  it('falls back to a project-oriented question when the generated project question misses the round shape', () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'per-skill-default',
      professionalSkills: ['TypeScript'],
      desiredQuestionCount: 1,
      jobDescription: '',
    });
    const generatedQuestionSet = generateInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: [],
      projectQuestions: [
        {
          id: 'proj-1',
          score: 0.8,
          text: '请解释你最熟悉的技术栈。',
        },
      ],
    });

    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: generatedQuestionSet.professionalQuestions,
      projectQuestions: generatedQuestionSet.projectQuestions,
      generationTrace: generatedQuestionSet.generationTrace,
      normalizedProjectTopics: ['AI 面试系统'],
    });

    expect(result.projectQuestions[0]?.id).toContain(':critic-fallback');
    expect(result.projectQuestions[0]?.text).toContain('AI 面试系统');
    expect(result.judgeTrace[0]).toEqual(
      expect.objectContaining({
        roundType: 'project-experience',
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['project-shape-mismatch']),
      }),
    );
  });

  it('keeps the first valid project question and replaces later duplicates with the project fallback', () => {
    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan: [],
      professionalQuestions: [],
      projectQuestions: [
        {
          id: 'project-1',
          score: 0.9,
          text: '请结合项目经历说明你负责的核心模块、关键决策与最终结果。',
        },
        {
          id: 'project-2',
          score: 0.8,
          text: '请结合项目经历说明你负责的核心模块、关键决策与最终结果。',
        },
      ],
      generationTrace: [],
      normalizedProjectTopics: ['AI 面试系统'],
    });

    expect(result.projectQuestions[0]).toEqual(
      expect.objectContaining({
        id: 'project-1',
        text: '请结合项目经历说明你负责的核心模块、关键决策与最终结果。',
      }),
    );
    expect(result.projectQuestions[1]?.id).toContain(':critic-fallback');
    expect(result.projectQuestions[1]?.text).toContain('AI 面试系统');
    expect(result.judgeTrace[1]).toEqual(
      expect.objectContaining({
        roundType: 'project-experience',
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['duplicate-question']),
      }),
    );
  });

  it('uses the generic professional fallback when no plan metadata is available', () => {
    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan: [],
      professionalQuestions: [
        {
          id: 'orphan-question',
          score: 0.5,
          text: '短题',
        },
      ],
      projectQuestions: [],
      generationTrace: [],
      normalizedProjectTopics: [],
    });

    expect(result.professionalQuestions[0]?.text).toContain('最熟悉的一项专业能力');
    expect(result.judgeTrace[0]).toEqual(
      expect.objectContaining({
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['question-too-short']),
      }),
    );
  });

  it('falls back for scenario questions that do not match the requested scenario shape', () => {
    const professionalQuestionPlan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript'],
      desiredQuestionCount: 2,
      jobDescription: '',
    });

    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan,
      professionalQuestions: [
        {
          id: 'skill-question',
          score: 0.9,
          text: '请说明 TypeScript 的基础类型系统。',
        },
        {
          id: 'scenario-question',
          score: 0.8,
          text: '请解释 TypeScript 是什么。',
        },
      ],
      projectQuestions: [],
      generationTrace: [],
      normalizedProjectTopics: [],
    });

    expect(result.professionalQuestions[1]?.id).toContain(':critic-fallback');
    expect(result.judgeTrace[1]).toEqual(
      expect.objectContaining({
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['scenario-shape-mismatch']),
      }),
    );
  });

  it('uses the generic project fallback when no normalized project topic is available', () => {
    const result = judgeInitializationQuestionSet({
      professionalQuestionPlan: [],
      professionalQuestions: [],
      projectQuestions: [
        {
          id: 'generic-project',
          score: 0.5,
          text: '短题',
        },
      ],
      generationTrace: [],
      normalizedProjectTopics: [],
    });

    expect(result.projectQuestions[0]?.text).toContain('你负责过的项目');
    expect(result.judgeTrace[0]).toEqual(
      expect.objectContaining({
        verdict: 'fallback',
        failureReasons: expect.arrayContaining(['question-too-short', 'project-shape-mismatch']),
      }),
    );
  });
});