import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AgentService } from './agent.service';
import { chatRequestSchema, feedbackRequestSchema, parseRequestBody, reportThreadParamsSchema } from './agent.schemas';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat/stream')
  async streamChat(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const parsed = parseRequestBody(chatRequestSchema, body);
    await this.agentService.streamChat(parsed, response);
  }

  @Post('interview-feedback')
  async submitInterviewFeedback(@Body() body: unknown): Promise<{ readonly success: true; readonly savedAt: string }> {
    const parsed = parseRequestBody(feedbackRequestSchema, body);
    return this.agentService.submitInterviewFeedback(parsed);
  }

  @Get('interviews/:threadId/report/status')
  async fetchInterviewReportStatus(@Param() params: unknown) {
    const parsed = parseRequestBody(reportThreadParamsSchema, params);
    return this.agentService.fetchInterviewReportStatus(parsed.threadId);
  }

  @Get('interviews/:threadId/report/markdown')
  async downloadInterviewReportMarkdown(@Param() params: unknown, @Res() response: Response): Promise<void> {
    const parsed = parseRequestBody(reportThreadParamsSchema, params);
    const download = await this.agentService.downloadInterviewReportMarkdown(parsed.threadId);
    response.setHeader('Content-Type', download.contentType);
    response.setHeader('Content-Disposition', download.contentDisposition);
    response.send(download.content);
  }

  @Post('interviews/:threadId/report/read')
  async markInterviewReportRead(@Param() params: unknown): Promise<{ readonly threadId: string; readonly readAt: string }> {
    const parsed = parseRequestBody(reportThreadParamsSchema, params);
    return this.agentService.markInterviewReportRead(parsed.threadId);
  }
}
