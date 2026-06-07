import { describe, expect, it } from 'vitest';

import {
  extractJobDescriptionSignalSet,
  resolveQuestionDriver,
} from './job-description-signals';

describe('extractJobDescriptionSignalSet', () => {
  it('extracts responsibilities, requirements, preferred skills, and gap signals from JD markdown', () => {
    const signalSet = extractJobDescriptionSignalSet({
      jobDescription: [
        '### 岗位职责',
        '- 负责设计 AI Agent 平台能力',
        '- 推动生产稳定性治理',
        '### 任职要求',
        '- 熟悉 TypeScript 与 Node.js 服务设计',
        '- 能够处理线上故障与恢复',
        '### 加分项',
        '- 具备 RAG 或向量检索经验',
      ].join('\n'),
      resumeTopics: ['TypeScript', 'Node.js'],
      projectTopics: ['搭建 AI Agent 面试系统'],
    });

    expect(signalSet.responsibilities).toContain('负责设计 AI Agent 平台能力');
    expect(signalSet.technicalRequirements).toContain('熟悉 TypeScript 与 Node.js 服务设计');
    expect(signalSet.preferredSkills).toContain('具备 RAG 或向量检索经验');
    expect(signalSet.alignedSignals).toContain('熟悉 TypeScript 与 Node.js 服务设计');
    expect(signalSet.gapSignals).toContain('推动生产稳定性治理');
    expect(signalSet.domainTerms.length).toBeGreaterThan(0);
  });
});

describe('resolveQuestionDriver', () => {
  it('classifies resume-only, JD-only, and cross-driven questions', () => {
    expect(resolveQuestionDriver({ hasResumeSignals: true, hasJobDescriptionSignals: false })).toBe('resume');
    expect(resolveQuestionDriver({ hasResumeSignals: false, hasJobDescriptionSignals: true })).toBe('job-description');
    expect(resolveQuestionDriver({ hasResumeSignals: true, hasJobDescriptionSignals: true })).toBe('resume-and-job-description');
  });
});