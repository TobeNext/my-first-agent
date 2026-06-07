export const INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION =
  '未上传职位 JD 时，系统按纯简历信号规划与召回；上传 JD 后，会额外提取岗位职责、技术要求、优先技能与领域词，用于专业技能轮加权、项目经历交叉验证和缺口能力检查。';

export function formatInterviewStartStatus(options: {
  readonly hasJobDescriptionValidationError: boolean;
  readonly canStartInterview: boolean;
  readonly resumeFileName: string | null | undefined;
  readonly jobDescriptionFileName: string | null | undefined;
}): string {
  if (options.hasJobDescriptionValidationError) {
    return '职位 JD 为选填项，但当前上传文件未通过校验。请修正或清空该文件后再开始面试。';
  }

  if (!options.canStartInterview) {
    return '请先上传并校验简历，然后再开始面试。';
  }

  if (options.jobDescriptionFileName) {
    return `简历已就绪：${options.resumeFileName ?? ''}；职位 JD 已就绪：${options.jobDescriptionFileName}。JD 会参与专业技能轮权重、项目经历交叉验证与缺口能力检查。`;
  }

  return `简历已就绪：${options.resumeFileName ?? ''}。未上传职位 JD 时，将继续沿用纯简历驱动的规划与召回方式。`;
}

export function formatInterviewJobDescriptionSummary(jobDescriptionFileName: string | null | undefined): string {
  if (jobDescriptionFileName) {
    return `职位 JD：${jobDescriptionFileName}（将参与专业技能权重、项目交叉验证与缺口能力检查）`;
  }

  return '职位 JD：未上传，当前按纯简历驱动规划与召回';
}