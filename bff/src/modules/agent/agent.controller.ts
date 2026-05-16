import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AgentService } from './agent.service';
import { chatRequestSchema, feedbackRequestSchema, parseRequestBody } from './agent.schemas';

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
}