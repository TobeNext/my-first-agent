import { Module } from '@nestjs/common';

import { AgentModule } from './modules/agent/agent.module';
import { AuthModule } from './modules/auth/auth.module';
import { ResumeModule } from './modules/resume/resume.module';

@Module({
  imports: [AuthModule, ResumeModule, AgentModule],
})
export class AppModule {}