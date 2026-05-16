import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentService } from './agent.service';

interface StreamInterviewInput {
  readonly threadId: string;
  readonly message?: string;
  readonly resumeMarkdown?: string;
  readonly jobDescriptionMarkdown?: string;
  readonly settings?: {
    readonly reviewIncorrectOrMissingPoints: boolean;
    readonly skipProfessionalSkillsRound: boolean;
    readonly skipProjectExperienceRound: boolean;
    readonly enableFlowTestMode: boolean;
    readonly professionalQuestionMode: 'per-skill-default' | 'custom-count';
    readonly professionalQuestionCount: number;
    readonly projectQuestionCount: number;
  };
  readonly startInterview?: boolean;
}

function createChatBody(input: StreamInterviewInput): {
  readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
} {
  const service = new AgentService();
  return (service as unknown as {
    createChatBody: (value: StreamInterviewInput) => {
      readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
    };
  }).createChatBody(input);
}

test('AgentService.createChatBody keeps the existing resume flow when no JD is uploaded', () => {
  const body = createChatBody({
    threadId: 'thread-1',
    startInterview: true,
    resumeMarkdown: '### 专业技能\n- TypeScript\n- RAG\n\n### 项目经历\n- 搭建 BFF',
    settings: {
      reviewIncorrectOrMissingPoints: true,
      skipProfessionalSkillsRound: false,
      skipProjectExperienceRound: false,
      enableFlowTestMode: false,
      professionalQuestionMode: 'per-skill-default',
      professionalQuestionCount: 6,
      projectQuestionCount: 2,
    },
  });

  assert.match(body.messages[0]?.content ?? '', /Job description provided: no/);
  assert.match(body.messages[0]?.content ?? '', /Keep the existing resume-based retrieval flow/);
  assert.match(body.messages[0]?.content ?? '', /Treat each "- " bullet under ### 专业技能 as one professional skill group/);
  assert.match(body.messages[0]?.content ?? '', /Do not draft or pass main interview questions yourself during initialization/);
  assert.match(body.messages[0]?.content ?? '', /generate the initialization questions internally from the resume context via retrieval/);
  assert.match(body.messages[0]?.content ?? '', /do not use the model for main-question planning or answer scoring/i);
  assert.match(body.messages[0]?.content ?? '', /follow-up questions from the current question dialogue and the candidate's job context/i);
  assert.match(body.messages[0]?.content ?? '', /Professional question count: 2/);
});

test('AgentService.createChatBody includes uploaded JD as extension context', () => {
  const body = createChatBody({
    threadId: 'thread-2',
    startInterview: true,
    resumeMarkdown: '### 专业技能\n- TypeScript',
    jobDescriptionMarkdown: '### 岗位职责\n- 负责 AI 面试系统',
    settings: {
      reviewIncorrectOrMissingPoints: true,
      skipProfessionalSkillsRound: false,
      skipProjectExperienceRound: false,
      enableFlowTestMode: false,
      professionalQuestionMode: 'per-skill-default',
      professionalQuestionCount: 6,
      projectQuestionCount: 2,
    },
  });

  assert.match(body.messages[0]?.content ?? '', /Job description provided: yes/);
  assert.match(body.messages[0]?.content ?? '', /extended retrieval strategy is still pending/);
  assert.match(body.messages[0]?.content ?? '', /Job Description Markdown:/);
  assert.match(body.messages[0]?.content ?? '', /岗位职责/);
});