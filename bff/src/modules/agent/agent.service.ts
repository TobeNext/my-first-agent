import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

import { appConfig } from '../../config';
import { parseResumeMarkdown } from '../resume/resume-parser';
import { saveInterviewFeedback, type InterviewFeedbackInput } from './agent-outcome';
import type { StreamInterviewInput } from './agent.schemas';
import { buildInterviewStartRequest, serializeInterviewStartRequest } from './interview-start-contract';

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

  async streamChat(input: StreamInterviewInput, response: Response): Promise<void> {
    const isStartInterview = this.isStartInterviewInput(input);

    this.logger.log(
      `Proxying ${isStartInterview ? 'startup' : 'reply'} stream for thread ${input.threadId} ` +
        `(` +
        `protocol=${isStartInterview ? 'structured-start-v1' : 'reply'}, ` +
        `flowTestMode=${isStartInterview ? input.settings.enableFlowTestMode : false}, ` +
        `hasJobDescription=${isStartInterview ? Boolean(input.jobDescriptionMarkdown.trim()) : false}, ` +
        `professionalQuestionCount=${this.resolveProfessionalQuestionCount(input)}` +
        `).`,
    );

    const upstreamResponse = await fetch(`${appConfig.mastraBaseUrl}/api/agents/interview-agent/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(this.createChatBody(input)),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await upstreamResponse.text();
      this.logger.error(
        `Mastra stream request failed for thread ${input.threadId} with status ${upstreamResponse.status}: ${errorText}`,
      );
      throw new BadGatewayException(`Mastra stream request failed with status ${upstreamResponse.status}: ${errorText}`);
    }

    this.logger.log(`Mastra stream connected for thread ${input.threadId}.`);

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
      this.logger.log(`Mastra stream finished for thread ${input.threadId}.`);
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
}