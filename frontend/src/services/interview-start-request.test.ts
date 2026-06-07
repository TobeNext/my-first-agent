import { describe, expect, it } from 'vitest';

import { createStartInterviewRequest } from './interview-start-request';

describe('createStartInterviewRequest', () => {
  it('builds a canonical structured interview-start payload', () => {
    const request = createStartInterviewRequest({
      threadId: 'thread-1',
      resumeMarkdown: '### 专业技能\n- TypeScript',
      jobDescriptionMarkdown: '',
      settings: {
        reviewIncorrectOrMissingPoints: true,
        skipProfessionalSkillsRound: false,
        skipProjectExperienceRound: false,
        enableFlowTestMode: false,
        professionalQuestionMode: 'per-skill-default',
        professionalQuestionCount: 1,
        projectQuestionCount: 2,
      },
    });

    expect(request).toEqual({
      requestKind: 'interview-start',
      protocolVersion: '2026-05-structured-start-v1',
      startInterview: true,
      threadId: 'thread-1',
      resumeMarkdown: '### 专业技能\n- TypeScript',
      jobDescriptionMarkdown: '',
      settings: {
        reviewIncorrectOrMissingPoints: true,
        skipProfessionalSkillsRound: false,
        skipProjectExperienceRound: false,
        enableFlowTestMode: false,
        professionalQuestionMode: 'per-skill-default',
        professionalQuestionCount: 1,
        projectQuestionCount: 2,
      },
    });
  });
});