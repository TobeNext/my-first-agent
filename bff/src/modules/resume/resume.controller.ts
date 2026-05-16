import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { appConfig } from '../../config';
import { ResumeService } from './resume.service';
import type { ResumeValidationSuccessPayload, UploadedResumeFile } from './resume.types';

@Controller('resume')
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Post('validate')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: appConfig.resumeMaxFileSizeBytes,
      },
      storage: undefined,
    }),
  )
  validate(@UploadedFile() file: UploadedResumeFile | undefined): ResumeValidationSuccessPayload {
    return this.resumeService.validate(file);
  }
}