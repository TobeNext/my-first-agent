import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadGatewayException } from '@nestjs/common';

import { appConfig } from '../../config';
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
  const originalConfig = {
    agentRuntimeProvider: appConfig.agentRuntimeProvider,
    mastraBaseUrl: appConfig.mastraBaseUrl,
  };

  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; mastraBaseUrl: string }).agentRuntimeProvider = 'mastra';
  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; mastraBaseUrl: string }).mastraBaseUrl =
    'http://localhost:4111';

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
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; mastraBaseUrl: string }).agentRuntimeProvider =
      originalConfig.agentRuntimeProvider;
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; mastraBaseUrl: string }).mastraBaseUrl =
      originalConfig.mastraBaseUrl;
  }
});

test('AgentService defaults to the Python runtime provider', async () => {
  const service = new AgentService();
  const originalFetch = globalThis.fetch;
  const originalConfig = {
    agentRuntimeProvider: appConfig.agentRuntimeProvider,
    pyAgentBaseUrl: appConfig.pyAgentBaseUrl,
  };
  const requested: string[] = [];
  const encoded = new TextEncoder().encode('data: [DONE]\n\n');

  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).agentRuntimeProvider =
    'python';
  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).pyAgentBaseUrl =
    'http://localhost:8011';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested.push(String(input));

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    );
  }) as typeof fetch;

  try {
    await service.streamChat(
      {
        threadId: 'thread-python-default',
        message: '继续',
        startInterview: false,
      },
      {
        setHeader() {},
        flushHeaders() {},
        write() {},
        end() {},
      } as unknown as Parameters<AgentService['streamChat']>[1],
    );

    assert.equal(requested[0], 'http://localhost:8011/api/agents/interview-agent/stream');
  } finally {
    globalThis.fetch = originalFetch;
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).agentRuntimeProvider =
      originalConfig.agentRuntimeProvider;
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).pyAgentBaseUrl =
      originalConfig.pyAgentBaseUrl;
  }
});

test('AgentService.streamChat uses the Python runtime URL when provider is python', async () => {
  const service = new AgentService();
  const originalFetch = globalThis.fetch;
  const originalConfig = {
    agentRuntimeProvider: appConfig.agentRuntimeProvider,
    pyAgentBaseUrl: appConfig.pyAgentBaseUrl,
  };
  const requested: Array<{ readonly url: string; readonly body: unknown }> = [];
  const encoded = new TextEncoder().encode('data: [DONE]\n\n');

  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).agentRuntimeProvider = 'python';
  (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).pyAgentBaseUrl =
    'http://localhost:8011';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requested.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as unknown,
    });

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    );
  }) as typeof fetch;

  try {
    await service.streamChat(
      {
        threadId: 'thread-python',
        message: '你好',
        startInterview: false,
      },
      {
        setHeader() {},
        flushHeaders() {},
        write() {},
        end() {},
      } as unknown as Parameters<AgentService['streamChat']>[1],
    );

    assert.equal(requested[0]?.url, 'http://localhost:8011/api/agents/interview-agent/stream');
    assert.deepEqual(requested[0]?.body, {
      messages: [{ role: 'user', content: '你好' }],
      memory: {
        thread: 'thread-python',
        resource: 'frontend-interview-thread-python',
      },
      maxSteps: 5,
    });
  } finally {
    globalThis.fetch = originalFetch;
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).agentRuntimeProvider =
      originalConfig.agentRuntimeProvider;
    (appConfig as { agentRuntimeProvider: 'mastra' | 'python'; pyAgentBaseUrl: string }).pyAgentBaseUrl =
      originalConfig.pyAgentBaseUrl;
  }
});
