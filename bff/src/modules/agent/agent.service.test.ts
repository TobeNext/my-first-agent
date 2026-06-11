import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadGatewayException } from '@nestjs/common';

import { AgentService } from './agent.service';
import { parseInterviewStartRequest } from './interview-start-contract';

interface StreamInterviewInput {
  readonly requestKind?: 'interview-start';
  readonly protocolVersion?: '2026-05-structured-start-v1';
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
    requestKind: 'interview-start',
    protocolVersion: '2026-05-structured-start-v1',
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

  const parsed = parseInterviewStartRequest(body.messages[0]?.content ?? '');

  assert.ok(parsed, 'Expected the startup message to be a structured interview-start payload.');
  assert.equal(parsed?.jobDescriptionMarkdown, '');
  assert.equal(parsed?.settings.professionalQuestionCount, 2);
  assert.equal(parsed?.resumeSections?.professionalSkills, '- TypeScript\n- RAG');
  assert.equal(parsed?.resumeSections?.projectExperience, '- 搭建 BFF');
  assert.doesNotMatch(body.messages[0]?.content ?? '', /Resume Markdown:/);
});

test('AgentService.createChatBody includes uploaded JD as extension context', () => {
  const body = createChatBody({
    threadId: 'thread-2',
    requestKind: 'interview-start',
    protocolVersion: '2026-05-structured-start-v1',
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

  const parsed = parseInterviewStartRequest(body.messages[0]?.content ?? '');

  assert.ok(parsed, 'Expected the startup message to stay parseable as a structured interview-start payload.');
  assert.equal(parsed?.jobDescriptionMarkdown, '### 岗位职责\n- 负责 AI 面试系统');
  assert.equal(parsed?.resumeSections?.professionalSkills, '- TypeScript');
  assert.equal(parsed?.settings.projectQuestionCount, 2);
});

test('AgentService.streamChat returns a Bad Gateway error when Mastra is unreachable', async () => {
  const service = new AgentService();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:4111');
  }) as typeof fetch;

  try {
    await assert.rejects(
      service.streamChat(
        {
          threadId: 'thread-unreachable',
          message: '你好',
          startInterview: false,
        },
        {} as Parameters<AgentService['streamChat']>[1],
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadGatewayException);
        assert.match(error.message, /Unable to connect to Mastra runtime/);
        assert.match(error.message, /ECONNREFUSED/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
