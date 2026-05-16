import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/bff-api', () => ({
  validateResumeViaBff: vi.fn(),
}));

import { validateResumeViaBff } from '@/services/bff-api';

import { useResumeUploadStore } from './upload';

function withFileText(file: File, text: string): File {
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue(text),
  });

  return file;
}

describe('useResumeUploadStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(validateResumeViaBff).mockReset();
  });

  it('allows interview start when only the required resume is uploaded', async () => {
    const store = useResumeUploadStore();
    const resumeFile = withFileText(
      new File(['### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF'], 'resume.md', {
        type: 'text/markdown',
      }),
      '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
    );

    vi.mocked(validateResumeViaBff).mockResolvedValue({
      success: true,
      fileName: 'resume.md',
      fileSize: resumeFile.size,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    });

    await store.validateSelectedFile(resumeFile);

    expect(store.canStartInterview).toBe(true);
    expect(store.interviewResume?.jobDescriptionFileName).toBeNull();
    expect(store.interviewResume?.jobDescriptionMarkdown).toBe('');
  });

  it('keeps optional job description in the interview context when uploaded', async () => {
    const store = useResumeUploadStore();
    const resumeFile = withFileText(
      new File(['### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF'], 'resume.md', {
        type: 'text/markdown',
      }),
      '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
    );
    const jobDescriptionFile = withFileText(
      new File(['### 岗位职责\n- 负责 AI 面试系统'], 'job-description.md', {
        type: 'text/markdown',
      }),
      '### 岗位职责\n- 负责 AI 面试系统',
    );

    vi.mocked(validateResumeViaBff).mockResolvedValue({
      success: true,
      fileName: 'resume.md',
      fileSize: resumeFile.size,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    });

    await store.validateSelectedFile(resumeFile);
    await store.setJobDescriptionFile(jobDescriptionFile);

    expect(store.canStartInterview).toBe(true);
    expect(store.interviewResume?.jobDescriptionFileName).toBe('job-description.md');
    expect(store.interviewResume?.jobDescriptionMarkdown).toContain('岗位职责');
  });
});