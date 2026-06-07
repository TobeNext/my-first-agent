export interface InterviewE2eFixture {
  readonly label: string;
  readonly resumeMarkdown: string;
  readonly jobDescriptionMarkdown: string;
  readonly candidateAnswers: readonly string[];
}

export const STANDARD_INTERVIEW_FIXTURE: InterviewE2eFixture = {
  label: 'standard-resume',
  resumeMarkdown: [
    '# 候选人简历',
    '### 专业技能',
    '- TypeScript / Node.js / NestJS / Vue 3',
    '- AI Agent 工程化、RAG、向量检索、Prompt 设计',
    '- 监控、测试自动化、故障排查与性能优化',
    '',
    '### 项目经历',
    '- 负责一个 AI Interview 平台，从前端、BFF 到 Mastra runtime 设计并落地全链路。',
    '- 为 RAG 召回增加 trace、fallback 和质量观测能力。',
  ].join('\n'),
  jobDescriptionMarkdown: [
    '### 岗位职责',
    '- 负责 AI 面试系统的端到端交付与性能优化。',
    '- 与产品和算法协作，持续改进召回与评分链路。',
    '',
    '### 技术要求',
    '- 熟悉 TypeScript、Node.js、NestJS、Vue 3。',
    '- 具备 Agent、RAG、观测与测试自动化经验。',
  ].join('\n'),
  candidateAnswers: [
    '我会先把问题拆成系统边界、状态管理、检索质量和异常恢复四层，然后给每层定义清晰 owner，避免逻辑继续堆回状态机。',
    '在 AI Interview 平台里，我负责过从 Vue 页面到 BFF 再到 Mastra runtime 的链路设计，重点做了结构化启动协议、RAG trace 和质量 fallback。',
    '如果要收尾，我会先总结当前风险、确认缺口能力，再输出最终报告和后续补强建议。',
  ],
};

export const NON_STANDARD_RESUME_FIXTURE: InterviewE2eFixture = {
  label: 'non-standard-resume',
  resumeMarkdown: [
    '# Resume',
    'Professional Skills',
    'TypeScript',
    'NestJS',
    'Vue 3',
    '',
    'Project Experience',
    'Built an AI interview workflow with BFF + Mastra runtime',
    'Added retrieval tracing and fallback rules',
  ].join('\n'),
  jobDescriptionMarkdown: '',
  candidateAnswers: [
    '我会先解释当前系统如何兼容非标准简历格式，再说明为什么要做 warnings 和 fallback。',
  ],
};

export const FLOW_TEST_SKIP_MARKER = '[FLOW_TEST_SKIP]';