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

  it('keeps the interview disabled when the resume fails frontend validation', async () => {
    const store = useResumeUploadStore();
    const invalidResumeFile = withFileText(new File(['resume'], 'resume.txt', { type: 'text/plain' }), 'resume');

    await store.validateSelectedFile(invalidResumeFile);

    expect(store.canStartInterview).toBe(false);
    expect(store.localResult?.success).toBe(false);
    expect(store.bffResult).toBeNull();
    expect(validateResumeViaBff).not.toHaveBeenCalled();
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
    expect(store.interviewEntryState).toEqual({
      canStartInterview: true,
      hasJobDescriptionValidationError: false,
      resumeFileName: 'resume.md',
      jobDescriptionFileName: 'job-description.md',
      professionalSkillGroupCount: 1,
    });
  });

  it('exposes the minimal interview entry state when the optional JD blocks interview start', async () => {
    const store = useResumeUploadStore();
    const resumeFile = withFileText(
      new File(['### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF'], 'resume.md', {
        type: 'text/markdown',
      }),
      '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
    );
    const invalidJobDescriptionFile = withFileText(
      new File(['not markdown'], 'job-description.txt', {
        type: 'text/plain',
      }),
      'not markdown',
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
    await store.setJobDescriptionFile(invalidJobDescriptionFile);

    expect(store.interviewEntryState).toEqual({
      canStartInterview: false,
      hasJobDescriptionValidationError: true,
      resumeFileName: 'resume.md',
      jobDescriptionFileName: null,
      professionalSkillGroupCount: 1,
    });
  });

  it('resets all upload state', async () => {
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
    store.reset();

    expect(store.canStartInterview).toBe(false);
    expect(store.localResult).toBeNull();
    expect(store.bffResult).toBeNull();
    expect(store.interviewEntryState).toEqual({
      canStartInterview: false,
      hasJobDescriptionValidationError: false,
      resumeFileName: null,
      jobDescriptionFileName: null,
      professionalSkillGroupCount: 0,
    });
    expect(store.interviewResume).toBeNull();
    expect(store.selectedResumeFileName).toBe('');
    expect(store.selectedJobDescriptionFileName).toBe('');
  });
});