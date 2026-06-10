import { describe, expect, it } from 'vitest';

import { initializeInterviewSession } from './interview-state-machine';

describe('interview state reference answer propagation', () => {
  it('stores referenceAnswer and evaluationPoints on knowledge-base nodes', () => {
    const state = initializeInterviewSession({
      threadId: 'thread-reference-answer',
      rawKickoffMessage: [
        'Selected interview direction: Backend Engineer',
        'Professional question mode: custom-count',
        'Professional question count: 1',
        'Project question count: 0',
        'Skip project-experience round: yes',
      ].join('\n'),
      professionalSkills: 'Spring',
      projectExperience: '',
      normalizedProfessionalSkills: ['Spring'],
      normalizedProjectTopics: [],
      jobDescription: '需要 Spring 和事务经验',
      professionalQuestions: [
        {
          id: 'spring-question-1',
          text: '请说明 Spring 事务传播机制以及异常回滚边界。',
          answer: ['说明 REQUIRED 和 REQUIRES_NEW 等传播行为', '补充 checked/unchecked exception 回滚差异'].join('\n'),
          skillArea: ['spring'],
        },
      ],
      projectQuestions: [],
    });

    const professionalRound = state.rounds.find((round) => round.type === 'professional-skills');
    const firstNode = professionalRound?.nodes[0];

    expect(firstNode?.source).toBe('knowledge-base');
    expect(firstNode?.referenceAnswer).toContain('REQUIRED');
    expect(firstNode?.evaluationPoints).toEqual([
      '说明 REQUIRED 和 REQUIRES_NEW 等传播行为',
      '补充 checked/unchecked exception 回滚差异',
    ]);
  });
});
