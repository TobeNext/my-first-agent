import {
  jobDescriptionUploadSchema,
  MAX_MARKDOWN_UPLOAD_FILE_SIZE_BYTES,
  resumeUploadSchema,
} from '@/schemas/resume-upload';
import type { ResumeValidationResult } from '@/types/resume';

export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const sizeInKilobytes = sizeInBytes / 1024;
  if (sizeInKilobytes < 1024) {
    return `${sizeInKilobytes.toFixed(1)} KB`;
  }

  return `${(sizeInKilobytes / 1024).toFixed(2)} MB`;
}

function validateMarkdownFile(options: {
  readonly file: File;
  readonly schema: typeof resumeUploadSchema;
  readonly fallbackMessage: string;
}): ResumeValidationResult {
  const validation = options.schema.safeParse({
    fileName: options.file.name,
    fileSize: options.file.size,
  });

  if (!validation.success) {
    return {
      success: false,
      fileName: options.file.name,
      fileSize: options.file.size,
      message: validation.error.issues[0]?.message ?? options.fallbackMessage,
      source: 'frontend',
    };
  }

  return {
    success: true,
    fileName: options.file.name,
    fileSize: options.file.size,
    message: `文件格式与大小校验通过，${options.file.name} 可以继续用于后续流程。`,
    source: 'frontend',
  };
}

export function validateResumeFile(file: File): ResumeValidationResult {
  return validateMarkdownFile({
    file,
    schema: resumeUploadSchema,
    fallbackMessage: '简历文件校验失败。',
  });
}

export function validateJobDescriptionFile(file: File): ResumeValidationResult {
  return validateMarkdownFile({
    file,
    schema: jobDescriptionUploadSchema,
    fallbackMessage: '职位 JD 文件校验失败。',
  });
}

export function getMarkdownUploadConstraints(): { readonly maxFileSizeBytes: number } {
  return {
    maxFileSizeBytes: MAX_MARKDOWN_UPLOAD_FILE_SIZE_BYTES,
  };
}
