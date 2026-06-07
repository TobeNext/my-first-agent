import { describe, expect, it } from 'vitest';

import {
  formatInterviewJobDescriptionSummary,
  formatInterviewStartStatus,
  INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION,
} from './interview-job-description-display';

describe('interview-job-description-display', () => {
  it('describes the current JD setup behavior', () => {
    expect(INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION).toContain('岗位职责、技术要求、优先技能与领域词');
    expect(INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION).toContain('项目经历交叉验证');
  });

  it('formats the start status for JD-ready and resume-only flows', () => {
    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: false,
        canStartInterview: true,
        resumeFileName: 'resume.md',
        jobDescriptionFileName: 'job-description.md',
      }),
    ).toContain('JD 会参与专业技能轮权重、项目经历交叉验证与缺口能力检查');

    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: false,
        canStartInterview: true,
        resumeFileName: 'resume.md',
        jobDescriptionFileName: null,
      }),
    ).toContain('纯简历驱动的规划与召回方式');
  });

  it('formats the setup summary for uploaded and missing JD files', () => {
    expect(formatInterviewJobDescriptionSummary('job-description.md')).toContain('项目交叉验证');
    expect(formatInterviewJobDescriptionSummary(null)).toBe('职位 JD：未上传，当前按纯简历驱动规划与召回');
  });

  it('formats validation-error and not-ready start states', () => {
    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: true,
        canStartInterview: false,
        resumeFileName: null,
        jobDescriptionFileName: 'job-description.md',
      }),
    ).toContain('当前上传文件未通过校验');

    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: false,
        canStartInterview: false,
        resumeFileName: null,
        jobDescriptionFileName: null,
      }),
    ).toBe('请先上传并校验简历，然后再开始面试。');
  });

  it('falls back gracefully when the resume filename is still unavailable', () => {
    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: false,
        canStartInterview: true,
        resumeFileName: undefined,
        jobDescriptionFileName: 'job-description.md',
      }),
    ).toContain('简历已就绪：；职位 JD 已就绪：job-description.md');

    expect(
      formatInterviewStartStatus({
        hasJobDescriptionValidationError: false,
        canStartInterview: true,
        resumeFileName: undefined,
        jobDescriptionFileName: null,
      }),
    ).toContain('简历已就绪：。未上传职位 JD 时，将继续沿用纯简历驱动的规划与召回方式。');
  });
});