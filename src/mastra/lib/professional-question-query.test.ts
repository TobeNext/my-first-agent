import { describe, expect, it } from 'vitest';

import {
  buildProfessionalSkillQuery,
  describeProfessionalPlanSkill,
  describeProfessionalQuestionLens,
} from './professional-question-query';

function createPlan(overrides: Record<string, unknown>) {
  return {
    targetAbility: 'TypeScript',
    questionType: 'knowledge-check',
    coverageIntent: 'implementation-depth',
    resumeSignals: ['TypeScript'],
    jobDescriptionSignals: [],
    expectedDifficulty: 'medium',
    selectionReason: 'test selection reason',
    ...overrides,
  };
}

describe('describeProfessionalQuestionLens', () => {
  it('maps every supported lens to a human-readable description', () => {
    expect(describeProfessionalQuestionLens('implementation-depth')).toBe('implementation depth and reasoning');
    expect(describeProfessionalQuestionLens('trade-off-analysis')).toBe('trade-offs and architecture decisions');
    expect(describeProfessionalQuestionLens('failure-recovery')).toBe('failure handling, debugging, and recovery');
    expect(describeProfessionalQuestionLens('scalability')).toBe('performance, scalability, and production constraints');
    expect(describeProfessionalQuestionLens('cross-skill-integration')).toBe('cross-skill integration and end-to-end design');
    expect(describeProfessionalQuestionLens('delivery-prioritization')).toBe('delivery prioritization, collaboration, and execution');
  });
});

describe('describeProfessionalPlanSkill', () => {
  it('formats skill-focus, cross-skill, and broad professional plans', () => {
    expect(
      describeProfessionalPlanSkill({
        ...createPlan({
          kind: 'skill-focus',
          primarySkill: 'TypeScript',
          relatedSkills: [],
          lens: 'implementation-depth',
        }),
      }),
    ).toBe('TypeScript');

    expect(
      describeProfessionalPlanSkill({
        ...createPlan({
          kind: 'cross-skill-scenario',
          primarySkill: null,
          relatedSkills: ['TypeScript', 'RAG'],
          lens: 'trade-off-analysis',
          questionType: 'scenario',
          coverageIntent: 'trade-off-analysis',
          expectedDifficulty: 'hard',
          targetAbility: 'TypeScript + RAG',
          resumeSignals: ['TypeScript', 'RAG'],
        }),
      }),
    ).toBe('cross-skill:TypeScript + RAG');

    expect(
      describeProfessionalPlanSkill({
        ...createPlan({
          kind: 'broad-professional-scenario',
          primarySkill: null,
          relatedSkills: [],
          lens: 'failure-recovery',
          questionType: 'scenario',
          coverageIntent: 'failure-recovery',
          expectedDifficulty: 'hard',
          targetAbility: 'broader context',
          resumeSignals: [],
        }),
      }),
    ).toBe('broad-professional-context');

    expect(
      describeProfessionalPlanSkill({
        ...createPlan({
          kind: 'jd-gap-scenario',
          primarySkill: null,
          relatedSkills: ['TypeScript'],
          lens: 'failure-recovery',
          questionType: 'scenario',
          coverageIntent: 'failure-recovery',
          expectedDifficulty: 'hard',
          targetAbility: 'Production incident recovery',
          resumeSignals: ['TypeScript'],
          jobDescriptionSignals: ['Production incident recovery'],
          questionDriver: 'job-description',
        }),
      }),
    ).toBe('jd-gap:Production incident recovery');
  });
});

describe('buildProfessionalSkillQuery', () => {
  it('builds a skill-focused query with related resume skills and project highlights', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'skill-focus',
        primarySkill: 'TypeScript',
        relatedSkills: [],
        lens: 'implementation-depth',
      }),
      professionalSkills: '- TypeScript\n- RAG\n- Mastra',
      projectExperience: ['- 用 TypeScript 和 Mastra 搭建面试系统', '- 维护 Vue 前端'].join('\n'),
      normalizedSkills: ['TypeScript', 'RAG', 'Mastra'],
    });

    expect(query).toContain('Target role: AI Agent Engineer');
    expect(query).toContain('Primary skill: TypeScript');
    expect(query).toContain('Related resume skills: RAG, Mastra');
    expect(query).toContain('Relevant project highlights:');
    expect(query).toContain('- 用 TypeScript 和 Mastra 搭建面试系统');
  });

  it('builds a cross-skill scenario query', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'cross-skill-scenario',
        primarySkill: null,
        relatedSkills: ['TypeScript', 'RAG'],
        lens: 'trade-off-analysis',
        questionType: 'scenario',
        coverageIntent: 'trade-off-analysis',
        expectedDifficulty: 'hard',
        targetAbility: 'TypeScript + RAG',
        resumeSignals: ['TypeScript', 'RAG'],
      }),
      professionalSkills: '- TypeScript\n- RAG\n- Node.js',
      projectExperience: '- 用 TypeScript 设计 RAG 服务',
      normalizedSkills: ['TypeScript', 'RAG', 'Node.js'],
    });

    expect(query).toContain('Scenario skills: TypeScript, RAG');
    expect(query).toContain('Ask a harder scenario-based question that forces the candidate to connect these skills in one answer.');
    expect(query).toContain('Related resume skills: Node.js');
  });

  it('builds a broad scenario query without related skills or highlights when none match', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'broad-professional-scenario',
        primarySkill: null,
        relatedSkills: [],
        lens: 'delivery-prioritization',
        questionType: 'scenario',
        coverageIntent: 'delivery-prioritization',
        expectedDifficulty: 'hard',
        targetAbility: 'broader context',
        resumeSignals: [],
      }),
      professionalSkills: '',
      projectExperience: '- 负责团队协作',
      normalizedSkills: [],
    });

    expect(query).toContain('Use the broader professional skills context to ask a harder scenario-based question without repeating a single-skill explanation.');
    expect(query).not.toContain('Related resume skills:');
    expect(query).not.toContain('Relevant project highlights:');
  });

  it('keeps the driver text even when no JD signals are provided', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'skill-focus',
        primarySkill: 'TypeScript',
        relatedSkills: [],
        lens: 'implementation-depth',
        questionDriver: 'resume',
      }),
      professionalSkills: '- TypeScript',
      projectExperience: '',
      normalizedSkills: ['TypeScript'],
    });

    expect(query).toContain('Question driver: resume');
    expect(query).not.toContain('Job description signals:');
  });
  
    it('renders the resume-and-job-description driver for cross-skill scenarios', () => {
      const query = buildProfessionalSkillQuery({
        selectedDirection: 'AI Agent Engineer',
        plan: createPlan({
          kind: 'cross-skill-scenario',
          primarySkill: null,
          relatedSkills: ['TypeScript', 'RAG'],
          lens: 'cross-skill-integration',
          questionType: 'scenario',
          coverageIntent: 'cross-skill-integration',
          expectedDifficulty: 'hard',
          targetAbility: 'TypeScript + RAG',
          resumeSignals: ['TypeScript', 'RAG'],
          jobDescriptionSignals: ['Build production RAG systems'],
          questionDriver: 'resume-and-job-description',
        }),
        professionalSkills: '- TypeScript\n- RAG\n- Node.js',
        projectExperience: '- 用 TypeScript 和 RAG 构建线上系统',
        normalizedSkills: ['TypeScript', 'RAG', 'Node.js'],
      });
  
      expect(query).toContain('Question driver: resume-and-job-description');
    });

  it('prefers parser-normalized skills over recalculating from raw section text', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'skill-focus',
        primarySkill: 'TypeScript',
        relatedSkills: [],
        lens: 'implementation-depth',
      }),
      professionalSkills: 'This raw section should not contribute legacy parsing noise.',
      projectExperience: '- 用 TypeScript 和 RAG 构建面试系统',
      normalizedSkills: ['TypeScript', 'RAG', 'Mastra'],
    });

    expect(query).toContain('Related resume skills: RAG, Mastra');
    expect(query).not.toContain('This raw section should not contribute legacy parsing noise.');
  });

  it('builds a JD gap validation query with keyword weighting', () => {
    const query = buildProfessionalSkillQuery({
      selectedDirection: 'AI Agent Engineer',
      plan: createPlan({
        kind: 'jd-gap-scenario',
        primarySkill: null,
        relatedSkills: ['TypeScript', 'RAG'],
        lens: 'failure-recovery',
        questionType: 'scenario',
        coverageIntent: 'failure-recovery',
        expectedDifficulty: 'hard',
        targetAbility: 'Production incident recovery',
        resumeSignals: ['TypeScript', 'RAG'],
        jobDescriptionSignals: ['Production incident recovery'],
        questionDriver: 'job-description',
      }),
      professionalSkills: '- TypeScript\n- RAG\n- Node.js',
      projectExperience: '- 用 TypeScript 构建 RAG 服务',
      normalizedSkills: ['TypeScript', 'RAG', 'Node.js'],
    });

    expect(query).toContain('JD capability gap to validate: Production incident recovery');
    expect(query).toContain('Bridge from adjacent resume skills: TypeScript, RAG');
    expect(query).toContain('Weight these JD keywords heavily during retrieval:');
  });
});