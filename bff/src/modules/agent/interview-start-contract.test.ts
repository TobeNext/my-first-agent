import assert from 'node:assert/strict';
import test from 'node:test';

import { ZodError } from 'zod';

import {
  buildInterviewStartRequest,
  interviewSystemSettingsSchema,
  parseInterviewStartRequest,
  serializeInterviewStartRequest,
} from './interview-start-contract';

const validSettings = {
  reviewIncorrectOrMissingPoints: true,
  skipProfessionalSkillsRound: false,
  skipProjectExperienceRound: false,
  enableFlowTestMode: false,
  professionalQuestionMode: 'per-skill-default' as const,
  professionalQuestionCount: 2,
  projectQuestionCount: 2,
};

test('buildInterviewStartRequest fills the structured defaults and parses back from JSON', () => {
  const request = buildInterviewStartRequest({
    threadId: 'thread-1',
    resumeMarkdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
    settings: validSettings,
    resumeSections: {
      professionalSkills: '- TypeScript',
      projectExperience: '- 搭建 BFF',
    },
  });

  assert.equal(request.jobDescriptionMarkdown, '');
  assert.deepEqual(parseInterviewStartRequest(serializeInterviewStartRequest(request)), request);
});

test('parseInterviewStartRequest returns null for invalid payloads', () => {
  assert.equal(parseInterviewStartRequest('not-json'), null);
  assert.equal(parseInterviewStartRequest(JSON.stringify({ threadId: 'thread-1' })), null);
});

test('interviewSystemSettingsSchema rejects skipping both rounds', () => {
  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        skipProfessionalSkillsRound: true,
        skipProjectExperienceRound: true,
        professionalQuestionCount: 0,
        projectQuestionCount: 0,
      }),
    ZodError,
  );
});

test('interviewSystemSettingsSchema rejects enabled rounds without at least one question', () => {
  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        professionalQuestionCount: 0,
      }),
    ZodError,
  );

  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        projectQuestionCount: 0,
      }),
    ZodError,
  );
});

test('interviewSystemSettingsSchema rejects skipped rounds that still carry question counts', () => {
  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        skipProfessionalSkillsRound: true,
        professionalQuestionCount: 1,
      }),
    ZodError,
  );

  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        skipProjectExperienceRound: true,
        projectQuestionCount: 1,
      }),
    ZodError,
  );
});

test('interviewSystemSettingsSchema rejects totals above the global question limit', () => {
  assert.throws(
    () =>
      interviewSystemSettingsSchema.parse({
        ...validSettings,
        professionalQuestionCount: 9,
        projectQuestionCount: 2,
      }),
    ZodError,
  );
});