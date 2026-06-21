import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
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
  private readonly tracer = trace.getTracer('interview-bff');

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
            userId: appConfig.interviewMemoryUserId,
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
    const protocol = isStartInterview ? 'structured-start-v1' : 'reply';
    const flowTestMode = isStartInterview ? input.settings.enableFlowTestMode : false;
    const hasJobDescription = isStartInterview ? Boolean((input.jobDescriptionMarkdown ?? '').trim()) : false;
    const professionalQuestionCount = this.resolveProfessionalQuestionCount(input);

    return this.tracer.startActiveSpan(
      'bff.agent.stream_chat',
      {
        attributes: {
          'interview.thread_id': input.threadId,
          'interview.runtime_provider': runtime.provider,
          'interview.protocol': protocol,
          'interview.start_interview': isStartInterview,
          'interview.flow_test_mode': flowTestMode,
          'interview.has_job_description': hasJobDescription,
          'interview.professional_question_count': professionalQuestionCount,
        },
      },
      async (span) => {
        try {
          await this.proxyStreamChat(input, response, runtime, {
            isStartInterview,
            protocol,
            flowTestMode,
            hasJobDescription,
            professionalQuestionCount,
          });
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown streamChat error',
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async proxyStreamChat(
    input: StreamInterviewInput,
    response: Response,
    runtime: { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string },
    metadata: {
      readonly isStartInterview: boolean;
      readonly protocol: 'structured-start-v1' | 'reply';
      readonly flowTestMode: boolean;
      readonly hasJobDescription: boolean;
      readonly professionalQuestionCount: number;
    },
  ): Promise<void> {
    this.logger.log(
      `Proxying ${metadata.isStartInterview ? 'startup' : 'reply'} stream for thread ${input.threadId} ` +
        `(` +
        `provider=${runtime.provider}, ` +
        `protocol=${metadata.protocol}, ` +
        `flowTestMode=${metadata.flowTestMode}, ` +
        `hasJobDescription=${metadata.hasJobDescription}, ` +
        `professionalQuestionCount=${metadata.professionalQuestionCount}` +
        `).`,
    );

    const runtimePath = '/api/agents/interview-agent/stream';
    const upstreamResponse = await this.fetchRuntimeStream(runtime, input, runtimePath);

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

  private async fetchRuntimeStream(
    runtime: { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string },
    input: StreamInterviewInput,
    runtimePath: string,
  ): Promise<globalThis.Response> {
    const runtimeUrl = `${runtime.baseUrl}${runtimePath}`;
    const serverAddress = this.resolveServerAddress(runtime.baseUrl);

    return this.tracer.startActiveSpan(
      'bff.agent.runtime_stream_request',
      {
        attributes: {
          'http.request.method': 'POST',
          'server.address': serverAddress,
          'url.path': runtimePath,
          'interview.runtime_provider': runtime.provider,
        },
      },
      async (span) => {
        try {
          const upstreamResponse = await fetch(runtimeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify(this.createChatBody(input)),
          });

          span.setAttribute('http.response.status_code', upstreamResponse.status);
          if (!upstreamResponse.ok || !upstreamResponse.body) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `${runtime.label} stream request failed with status ${upstreamResponse.status}`,
            });
          }

          return upstreamResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown network error';
          span.recordException(error instanceof Error ? error : new Error(message));
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          this.logger.error(`${runtime.label} stream request failed for thread ${input.threadId}: ${message}`);
          throw new BadGatewayException(`Unable to connect to ${runtime.label} at ${runtime.baseUrl}: ${message}`);
        } finally {
          span.end();
        }
      },
    );
  }

  private resolveServerAddress(baseUrl: string): string {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
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
    return this.withReportOperationSpan('bff.agent.report_status', threadId, runtime, 'status', async () => {
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
        'status',
      );

      return (await upstreamResponse.json()) as InterviewReportStatus;
    });
  }

  async downloadInterviewReportMarkdown(threadId: string): Promise<InterviewReportMarkdownDownload> {
    const runtime = this.resolveRuntime();
    return this.withReportOperationSpan('bff.agent.report_markdown', threadId, runtime, 'markdown', async () => {
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
        'markdown',
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
    });
  }

  async markInterviewReportRead(threadId: string): Promise<{ readonly threadId: string; readonly readAt: string }> {
    const runtime = this.resolveRuntime();
    return this.withReportOperationSpan('bff.agent.report_mark_read', threadId, runtime, 'mark_read', async () => {
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
        'mark_read',
      );

      return (await upstreamResponse.json()) as { readonly threadId: string; readonly readAt: string };
    });
  }

  private async withReportOperationSpan<T>(
    spanName: string,
    threadId: string,
    runtime: { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string },
    operation: 'status' | 'markdown' | 'mark_read',
    run: () => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      spanName,
      {
        attributes: {
          'interview.thread_id': threadId,
          'interview.runtime_provider': runtime.provider,
          'report.operation': operation,
        },
      },
      async (span) => {
        try {
          return await run();
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Unknown report operation error',
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async fetchReportRuntime(
    url: string,
    init: RequestInit,
    runtime: { readonly provider: 'mastra' | 'python'; readonly baseUrl: string; readonly label: string },
    threadId: string,
    operation: string,
    passthroughStatuses: readonly number[] = [],
  ): Promise<globalThis.Response> {
    const method = init.method ?? 'GET';
    const requestUrl = new URL(url);

    return this.tracer.startActiveSpan(
      'bff.agent.report_runtime_request',
      {
        attributes: {
          'http.request.method': method,
          'server.address': requestUrl.host,
          'url.path': requestUrl.pathname,
          'interview.thread_id': threadId,
          'interview.runtime_provider': runtime.provider,
          'report.operation': operation,
        },
      },
      async (span) => {
        try {
          let upstreamResponse: globalThis.Response;

          try {
            upstreamResponse = await fetch(url, init);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown network error';
            span.recordException(error instanceof Error ? error : new Error(message));
            span.setStatus({ code: SpanStatusCode.ERROR, message });
            this.logger.error(`${runtime.label} ${operation} request failed for thread ${threadId}: ${message}`);
            throw new BadGatewayException(`Unable to connect to ${runtime.label} at ${runtime.baseUrl}: ${message}`);
          }

          span.setAttribute('http.response.status_code', upstreamResponse.status);
          if (!upstreamResponse.ok && !passthroughStatuses.includes(upstreamResponse.status)) {
            const errorText = await upstreamResponse.text();
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `${runtime.label} ${operation} request failed with status ${upstreamResponse.status}`,
            });
            this.logger.error(
              `${runtime.label} ${operation} request failed for thread ${threadId} with status ${upstreamResponse.status}: ${errorText}`,
            );
            throw new BadGatewayException(
              `${runtime.label} ${operation} request failed with status ${upstreamResponse.status}: ${errorText}`,
            );
          }

          return upstreamResponse;
        } finally {
          span.end();
        }
      },
    );
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
