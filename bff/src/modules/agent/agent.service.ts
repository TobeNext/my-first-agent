import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

import { appConfig } from '../../config';
import { parseResumeMarkdown } from '../resume/resume-parser';
import { saveInterviewFeedback, type InterviewFeedbackInput } from './agent-outcome';
import type { StreamInterviewInput } from './agent.schemas';
import { buildInterviewStartRequest, serializeInterviewStartRequest } from './interview-start-contract';

export type InterviewReportState = 'not-started' | 'generating' | 'ready' | 'failed';

export interface InterviewReportStatus {
  readonly threadId: string;
  readonly reportState: InterviewReportState;
  readonly sealed: boolean;
  readonly expectedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly unreadCount: number;
  readonly markdownAvailable: boolean;
  readonly reportId: string | null;
  readonly updatedAt: string | null;
  readonly blockingReason?: 'manifest-missing' | 'not-sealed' | 'pending' | 'failed' | 'timeout' | null;
}

export interface InterviewReportMarkdownDownload {
  readonly content: string;
  readonly contentType: string;
  readonly contentDisposition: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  private isStartInterviewInput(input: StreamInterviewInput): input is Extract<StreamInterviewInput, { startInterview: true }> {
    return input.startInterview === true;
  }

  private resolveProfessionalQuestionCount(input: StreamInterviewInput): number {
    if (!this.isStartInterviewInput(input) || input.settings.skipProfessionalSkillsRound) {
      return 0;
    }

    if (input.settings.professionalQuestionMode !== 'per-skill-default') {
      return input.settings.professionalQuestionCount;
    }

    const skillGroupCount = parseResumeMarkdown(input.resumeMarkdown ?? '').normalizedSkills.length;
    return skillGroupCount > 0 ? skillGroupCount : input.settings.professionalQuestionCount;
  }

  private createChatBody(input: StreamInterviewInput): {
    readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
    readonly memory: { readonly thread: string; readonly resource: string };
    readonly maxSteps: 5;
  } {
    const parsedResume = input.startInterview ? parseResumeMarkdown(input.resumeMarkdown) : null;
    const messageContent = input.startInterview
      ? serializeInterviewStartRequest(
          buildInterviewStartRequest({
            threadId: input.threadId,
            resumeMarkdown: input.resumeMarkdown,
            jobDescriptionMarkdown: input.jobDescriptionMarkdown,
            settings: {
              ...input.settings,
              professionalQuestionCount: this.resolveProfessionalQuestionCount(input),
            },
            resumeSections: {
              professionalSkills: parsedResume?.professionalSkillsSection ?? '',
              projectExperience: parsedResume?.projectExperienceSection ?? '',
            },
          }),
        )
      : input.message;

    return {
      messages: [
        {
          role: 'user',
          content: messageContent ?? '',
        },
      ],
      memory: {
        thread: input.threadId,
        resource: `frontend-interview-${input.threadId}`,
      },
      maxSteps: 5,
    };
  }

  private resolveRuntime(): { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string } {
    if (appConfig.agentRuntimeProvider === 'python') {
      return {
        provider: 'python',
        baseUrl: appConfig.pyAgentBaseUrl,
        label: 'Python agent runtime',
      };
    }

    return {
      provider: 'mastra',
      baseUrl: appConfig.mastraBaseUrl,
      label: 'Mastra runtime',
    };
  }

  async streamChat(input: StreamInterviewInput, response: Response): Promise<void> {
    const isStartInterview = this.isStartInterviewInput(input);
    const runtime = this.resolveRuntime();

    this.logger.log(
      `Proxying ${isStartInterview ? 'startup' : 'reply'} stream for thread ${input.threadId} ` +
        `(` +
        `provider=${runtime.provider}, ` +
        `protocol=${isStartInterview ? 'structured-start-v1' : 'reply'}, ` +
        `flowTestMode=${isStartInterview ? input.settings.enableFlowTestMode : false}, ` +
        `hasJobDescription=${isStartInterview ? Boolean(input.jobDescriptionMarkdown.trim()) : false}, ` +
        `professionalQuestionCount=${this.resolveProfessionalQuestionCount(input)}` +
        `).`,
    );

    let upstreamResponse: globalThis.Response;

    try {
      upstreamResponse = await fetch(`${runtime.baseUrl}/api/agents/interview-agent/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(this.createChatBody(input)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      this.logger.error(`${runtime.label} stream request failed for thread ${input.threadId}: ${message}`);
      throw new BadGatewayException(`Unable to connect to ${runtime.label} at ${runtime.baseUrl}: ${message}`);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await upstreamResponse.text();
      this.logger.error(
        `${runtime.label} stream request failed for thread ${input.threadId} with status ${upstreamResponse.status}: ${errorText}`,
      );
      throw new BadGatewayException(`${runtime.label} stream request failed with status ${upstreamResponse.status}: ${errorText}`);
    }

    this.logger.log(`${runtime.label} stream connected for thread ${input.threadId}.`);

    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const reader = upstreamResponse.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        response.write(Buffer.from(value));
      }
    } finally {
      this.logger.log(`${runtime.label} stream finished for thread ${input.threadId}.`);
      response.end();
      reader.releaseLock();
    }
  }

  async submitInterviewFeedback(input: InterviewFeedbackInput): Promise<{ readonly success: true; readonly savedAt: string }> {
    this.logger.log(`Persisting interview feedback for thread ${input.threadId}.`);

    try {
      const result = await saveInterviewFeedback(input);
      return {
        success: true,
        savedAt: result.savedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to persist interview feedback.';
      this.logger.error(`Interview feedback persistence failed for thread ${input.threadId}: ${message}`);
      throw new NotFoundException(message);
    }
  }

  async fetchInterviewReportStatus(threadId: string): Promise<InterviewReportStatus> {
    const runtime = this.resolveRuntime();
    if (runtime.provider === 'mastra') {
      return this.createMastraFallbackReportStatus(threadId);
    }

    const upstreamResponse = await this.fetchReportRuntime(
      `${runtime.baseUrl}/api/interviews/${encodeURIComponent(threadId)}/report/status`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      runtime,
      threadId,
      'report status',
    );

    return (await upstreamResponse.json()) as InterviewReportStatus;
  }

  async downloadInterviewReportMarkdown(threadId: string): Promise<InterviewReportMarkdownDownload> {
    const runtime = this.resolveRuntime();
    if (runtime.provider === 'mastra') {
      throw new NotFoundException('Interview report markdown is not available from the Mastra rollback provider.');
    }

    const upstreamResponse = await this.fetchReportRuntime(
      `${runtime.baseUrl}/api/interviews/${encodeURIComponent(threadId)}/report/markdown`,
      {
        method: 'GET',
        headers: { Accept: 'text/markdown' },
      },
      runtime,
      threadId,
      'report markdown',
      [404],
    );

    if (upstreamResponse.status === 404) {
      throw new NotFoundException('Interview report markdown was not found.');
    }

    return {
      content: await upstreamResponse.text(),
      contentType: upstreamResponse.headers.get('content-type') ?? 'text/markdown; charset=utf-8',
      contentDisposition: `attachment; filename="interview-report-${threadId}.md"`,
    };
  }

  async markInterviewReportRead(threadId: string): Promise<{ readonly threadId: string; readonly readAt: string }> {
    const runtime = this.resolveRuntime();
    if (runtime.provider === 'mastra') {
      return { threadId, readAt: new Date().toISOString() };
    }

    const upstreamResponse = await this.fetchReportRuntime(
      `${runtime.baseUrl}/api/interviews/${encodeURIComponent(threadId)}/report/read`,
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
      },
      runtime,
      threadId,
      'report read receipt',
    );

    return (await upstreamResponse.json()) as { readonly threadId: string; readonly readAt: string };
  }

  private async fetchReportRuntime(
    url: string,
    init: RequestInit,
    runtime: { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string },
    threadId: string,
    operation: string,
    passthroughStatuses: readonly number[] = [],
  ): Promise<globalThis.Response> {
    let upstreamResponse: globalThis.Response;

    try {
      upstreamResponse = await fetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      this.logger.error(`${runtime.label} ${operation} request failed for thread ${threadId}: ${message}`);
      throw new BadGatewayException(`Unable to connect to ${runtime.label} at ${runtime.baseUrl}: ${message}`);
    }

    if (!upstreamResponse.ok && !passthroughStatuses.includes(upstreamResponse.status)) {
      const errorText = await upstreamResponse.text();
      this.logger.error(
        `${runtime.label} ${operation} request failed for thread ${threadId} with status ${upstreamResponse.status}: ${errorText}`,
      );
      throw new BadGatewayException(`${runtime.label} ${operation} request failed with status ${upstreamResponse.status}: ${errorText}`);
    }

    return upstreamResponse;
  }

  private createMastraFallbackReportStatus(threadId: string): InterviewReportStatus {
    return {
      threadId,
      reportState: 'not-started',
      sealed: false,
      expectedCount: 0,
      completedCount: 0,
      failedCount: 0,
      unreadCount: 0,
      markdownAvailable: false,
      reportId: null,
      updatedAt: null,
      blockingReason: 'manifest-missing',
    };
  }
}
