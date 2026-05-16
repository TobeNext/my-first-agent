import { z } from 'zod';

export const MAX_MARKDOWN_UPLOAD_FILE_SIZE_BYTES = 2 * 1024 * 1024;

function createMarkdownUploadSchema(documentLabel: string) {
  return z.object({
    fileName: z
      .string()
      .min(1, `请选择${documentLabel}文件。`)
      .refine((fileName) => fileName.toLowerCase().endsWith('.md'), {
        message: `仅支持上传 .md 格式的${documentLabel}文件。`,
      }),
    fileSize: z
      .number()
      .nonnegative()
      .max(MAX_MARKDOWN_UPLOAD_FILE_SIZE_BYTES, `${documentLabel}文件过大，请上传不超过 2 MB 的 .md 文件。`),
  });
}

export const resumeUploadSchema = createMarkdownUploadSchema('简历');
export const jobDescriptionUploadSchema = createMarkdownUploadSchema('职位 JD');

export type ResumeUploadInput = z.infer<typeof resumeUploadSchema>;
export type JobDescriptionUploadInput = z.infer<typeof jobDescriptionUploadSchema>;