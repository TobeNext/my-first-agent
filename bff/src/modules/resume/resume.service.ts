import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { appConfig } from '../../config';
import { parseResumeMarkdown } from './resume-parser';
import type { ResumeValidationSuccessPayload, UploadedResumeFile } from './resume.types';

const resumeMetadataSchema = z.object({
  originalName: z
    .string()
    .min(1, '简历文件名不能为空。')
    .refine((fileName) => fileName.toLowerCase().endsWith('.md'), {
      message: '仅支持上传 .md 格式的简历文件。',
    }),
  size: z
    .number()
    .nonnegative()
    .max(appConfig.resumeMaxFileSizeBytes, `简历文件过大，请上传不超过 ${Math.round(appConfig.resumeMaxFileSizeBytes / 1024 / 1024)} MB 的 .md 文件。`),
});

@Injectable()
export class ResumeService {
  validate(file: UploadedResumeFile | undefined): ResumeValidationSuccessPayload {
    if (!file) {
      throw new BadRequestException('请先上传简历文件。');
    }

    const parsed = resumeMetadataSchema.safeParse({
      originalName: file.originalname,
      size: file.size,
    });

    if (!parsed.success) {
      const errorMessage =
        /* c8 ignore next -- Zod metadata validation failures always expose at least one issue. */
        parsed.error.issues[0]?.message ?? '简历文件校验失败。';
      throw new BadRequestException(errorMessage);
    }

    const markdown = file.buffer?.toString('utf8');
    if (!markdown) {
      throw new BadRequestException('无法读取上传的简历内容。');
    }

    const parsedResume = parseResumeMarkdown(markdown);
    if (parsedResume.validationErrors.length > 0) {
      throw new BadRequestException(parsedResume.validationErrors);
    }

    const professionalSkillGroupCount = parsedResume.normalizedSkills.length;

    return {
      success: true,
      fileName: file.originalname,
      fileSize: file.size,
      message: '文件已通过 BFF 大小、类型、结构校验，并完成技能组计数。',
      professionalSkillGroupCount,
    };
  }
}