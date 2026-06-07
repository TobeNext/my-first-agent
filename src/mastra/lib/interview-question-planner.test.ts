import { describe, expect, it } from 'vitest';

import { planProfessionalQuestionQueries } from './interview-question-planner';

describe('planProfessionalQuestionQueries', () => {
  it('returns an empty plan when no usable skill or desired count is provided', () => {
    expect(
      planProfessionalQuestionQueries({
        mode: 'per-skill-default',
        professionalSkills: ['  ', ''],
        desiredQuestionCount: 2,
        jobDescription: '',
      }),
    ).toEqual([]);

    expect(
      planProfessionalQuestionQueries({
        mode: 'custom-count',
        professionalSkills: ['TypeScript'],
        desiredQuestionCount: 0,
        jobDescription: '',
      }),
    ).toEqual([]);
  });

  it('deduplicates normalized skills in per-skill mode and emits an explicit planning contract', () => {
    expect(
      planProfessionalQuestionQueries({
        mode: 'per-skill-default',
        professionalSkills: [' TypeScript ', 'typescript', 'RAG', 'Mastra'],
        desiredQuestionCount: 2,
        jobDescription: ['- Build TypeScript services', '- Own reliability improvements'].join('\n'),
      }),
    ).toEqual([
      {
        kind: 'skill-focus',
        primarySkill: 'TypeScript',
        relatedSkills: [],
        lens: 'implementation-depth',
        targetAbility: 'TypeScript',
        questionType: 'knowledge-check',
        coverageIntent: 'implementation-depth',
        resumeSignals: ['TypeScript'],
        jobDescriptionSignals: ['Build TypeScript services'],
        questionDriver: 'resume-and-job-description',
        expectedDifficulty: 'medium',
        selectionReason:
          'Selected TypeScript as the canonical resume skill owner and cross-checked it against JD signals: Build TypeScript services.',
      },
      {
        kind: 'skill-focus',
        primarySkill: 'RAG',
        relatedSkills: [],
        lens: 'implementation-depth',
        targetAbility: 'RAG',
        questionType: 'knowledge-check',
        coverageIntent: 'implementation-depth',
        resumeSignals: ['RAG'],
        jobDescriptionSignals: [],
        questionDriver: 'resume',
        expectedDifficulty: 'medium',
        selectionReason: 'Selected RAG as the canonical resume skill owner for one dedicated implementation-depth question.',
      },
    ]);
  });

  it('uses unique skill plans before generating overflow cross-skill scenarios', () => {
    const plan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript', 'AI Agent', 'RAG'],
      desiredQuestionCount: 5,
      jobDescription: '- Ship production AI systems',
    });

    expect(plan).toHaveLength(5);
    expect(plan.slice(0, 3).every((item) => item.kind === 'skill-focus')).toBe(true);
    expect(new Set(plan.slice(0, 3).map((item) => item.kind === 'skill-focus' ? item.primarySkill : null)).size).toBe(3);
    expect(plan[3]).toMatchObject({
      kind: 'jd-gap-scenario',
      questionType: 'scenario',
      expectedDifficulty: 'hard',
      relatedSkills: expect.any(Array),
    });
    expect(plan[4]).toMatchObject({
      kind: 'cross-skill-scenario',
      questionType: 'scenario',
      expectedDifficulty: 'hard',
      relatedSkills: expect.any(Array),
    });
    expect(plan[3]?.kind === 'jd-gap-scenario' && plan[3].questionDriver).toBe('job-description');
    expect(plan[4]?.kind === 'cross-skill-scenario' && plan[4].relatedSkills.length).toBe(2);
    expect(plan.every((item) => item.selectionReason.length > 0)).toBe(true);
    expect(plan.some((item) => item.questionDriver === 'job-description')).toBe(true);
    expect(plan.some((item) => item.questionDriver === 'resume')).toBe(true);
  });

  it('records a JD-cross selection reason for custom-count skill-focus plans when the skill matches JD signals', () => {
    const matchingPlan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript', 'RAG'],
      desiredQuestionCount: 2,
      jobDescription: '- TypeScript platform engineering',
    }).find((plan) => plan.kind === 'skill-focus' && plan.primarySkill === 'TypeScript');

    expect(matchingPlan).toMatchObject({
      kind: 'skill-focus',
      questionDriver: 'resume-and-job-description',
      jobDescriptionSignals: ['TypeScript platform engineering'],
    });
    expect(matchingPlan?.selectionReason).toContain('intersects JD signals');
  });

  it('falls back to broad professional scenarios when only one skill is available', () => {
    const plan = planProfessionalQuestionQueries({
      mode: 'custom-count',
      professionalSkills: ['TypeScript'],
      desiredQuestionCount: 3,
      jobDescription: '',
    });

    expect(plan).toEqual([
      {
        kind: 'skill-focus',
        primarySkill: 'TypeScript',
        relatedSkills: [],
        lens: 'implementation-depth',
        targetAbility: 'TypeScript',
        questionType: 'knowledge-check',
        coverageIntent: 'implementation-depth',
        resumeSignals: ['TypeScript'],
        jobDescriptionSignals: [],
        questionDriver: 'resume',
        expectedDifficulty: 'medium',
        selectionReason: 'Selected TypeScript as a unique primary skill before allocating overflow slots to harder scenario coverage.',
      },
      {
        kind: 'broad-professional-scenario',
        primarySkill: null,
        relatedSkills: ['TypeScript'],
        lens: 'trade-off-analysis',
        targetAbility: 'TypeScript',
        questionType: 'scenario',
        coverageIntent: 'trade-off-analysis',
        resumeSignals: ['TypeScript'],
        jobDescriptionSignals: [],
        questionDriver: 'resume',
        expectedDifficulty: 'hard',
        selectionReason:
          'Selected a broader trade-off-analysis scenario to stretch beyond the single available skill signal and keep coverage diverse.',
      },
      {
        kind: 'broad-professional-scenario',
        primarySkill: null,
        relatedSkills: ['TypeScript'],
        lens: 'failure-recovery',
        targetAbility: 'TypeScript',
        questionType: 'scenario',
        coverageIntent: 'failure-recovery',
        resumeSignals: ['TypeScript'],
        jobDescriptionSignals: [],
        questionDriver: 'resume',
        expectedDifficulty: 'hard',
        selectionReason:
          'Selected a broader failure-recovery scenario to stretch beyond the single available skill signal and keep coverage diverse.',
      },
    ]);
  });
});