import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

import { appConfig } from '../../config';
import { countProfessionalSkillGroups } from '../resume/resume-markdown';
import { saveInterviewFeedback, type InterviewFeedbackInput } from './agent-outcome';
import type { StreamInterviewInput } from './agent.schemas';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  private resolveProfessionalQuestionCount(input: StreamInterviewInput): number {
    if (!input.settings || input.settings.skipProfessionalSkillsRound) {
      return 0;
    }

    if (input.settings.professionalQuestionMode !== 'per-skill-default') {
      return input.settings.professionalQuestionCount;
    }

    const skillGroupCount = countProfessionalSkillGroups(input.resumeMarkdown ?? '');
    return skillGroupCount > 0 ? skillGroupCount : input.settings.professionalQuestionCount;
  }

  private createChatBody(input: StreamInterviewInput): {
    readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
    readonly memory: { readonly thread: string; readonly resource: string };
    readonly maxSteps: 5;
  } {
    const hasJobDescription = Boolean(input.jobDescriptionMarkdown?.trim());
    const professionalQuestionCount = this.resolveProfessionalQuestionCount(input);
    const kickoffMessage = [
      'The candidate has uploaded the following markdown resume.',
      'You must parse it with resumeParserTool before starting the interview.',
      'The interview must have two stages in order: 专业技能阶段 first, 项目经验阶段 second.',
      'Treat each "- " bullet under ### 专业技能 as one professional skill group.',
      'Do not draft or pass main interview questions yourself during initialization.',
      'Let interviewStateManagerTool generate the initialization questions internally from the resume context via retrieval.',
      'After initialization, do not use the model for main-question planning or answer scoring.',
      'Model usage is reserved for producing follow-up questions from the current question dialogue and the candidate\'s job context.',
      'System settings:',
      `- Review incorrect or missing points after each completed question: ${input.settings?.reviewIncorrectOrMissingPoints ? 'enabled' : 'disabled'}`,
      `- Skip professional-skills round: ${input.settings?.skipProfessionalSkillsRound ? 'yes' : 'no'}`,
      `- Skip project-experience round: ${input.settings?.skipProjectExperienceRound ? 'yes' : 'no'}`,
      `- Flow test mode: ${input.settings?.enableFlowTestMode ? 'enabled' : 'disabled'}`,
      `- Professional question mode: ${input.settings?.professionalQuestionMode ?? 'per-skill-default'}`,
      `- Professional question count: ${professionalQuestionCount}`,
      `- Project question count: ${input.settings?.projectQuestionCount ?? 2}`,
      `- Job description provided: ${hasJobDescription ? 'yes' : 'no'}`,
      'Use clear round headers so the first round and second round are visually distinct.',
      'If a round is skipped by settings, explicitly announce the skip and continue to the next valid stage.',
      hasJobDescription
        ? 'A markdown job description is provided below as an extension input. The extended retrieval strategy is still pending, so preserve this context without replacing the current resume-based interview flow.'
        : 'No job description markdown was uploaded. Keep the existing resume-based retrieval flow.',
      '',
      'Resume Markdown:',
      input.resumeMarkdown ?? '',
      '',
      'Job Description Markdown:',
      input.jobDescriptionMarkdown ?? '',
    ].join('\n');

    return {
      messages: [
        {
          role: 'user',
          content: input.startInterview ? kickoffMessage : input.message ?? '',
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
    this.logger.log(
      `Proxying ${input.startInterview ? 'startup' : 'reply'} stream for thread ${input.threadId} ` +
        `(` +
        `flowTestMode=${input.settings?.enableFlowTestMode ?? false}, ` +
        `hasJobDescription=${Boolean(input.jobDescriptionMarkdown?.trim())}, ` +
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