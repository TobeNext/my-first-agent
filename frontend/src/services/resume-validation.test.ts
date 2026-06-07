import { describe, expect, it } from 'vitest';

import {
  formatFileSize,
  getMarkdownUploadConstraints,
  validateJobDescriptionFile,
  validateResumeFile,
} from './resume-validation';

describe('resume-validation', () => {
  it('formats file sizes in bytes, kilobytes, and megabytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
  });

  it('accepts markdown resumes within the configured size limit', () => {
    const file = new File(['resume'], 'resume.md', { type: 'text/markdown' });

    expect(validateResumeFile(file)).toEqual({
      success: true,
      fileName: 'resume.md',
      fileSize: file.size,
      message: '文件格式与大小校验通过，resume.md 可以继续用于后续流程。',
      source: 'frontend',
    });
  });

  it('rejects job descriptions with an invalid extension', () => {
    const file = new File(['job'], 'job.txt', { type: 'text/plain' });

    expect(validateJobDescriptionFile(file)).toEqual({
      success: false,
      fileName: 'job.txt',
      fileSize: file.size,
      message: '仅支持上传 .md 格式的职位 JD文件。',
      source: 'frontend',
    });
  });

  it('rejects markdown files that exceed the upload size limit', () => {
    const oversizedFile = new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'resume.md', {
      type: 'text/markdown',
    });

    expect(validateResumeFile(oversizedFile)).toEqual({
      success: false,
      fileName: 'resume.md',
      fileSize: oversizedFile.size,
      message: '简历文件过大，请上传不超过 2 MB 的 .md 文件。',
      source: 'frontend',
    });
  });

  it('returns the markdown upload constraints', () => {
    expect(getMarkdownUploadConstraints()).toEqual({
      maxFileSizeBytes: 2 * 1024 * 1024,
    });
  });
});