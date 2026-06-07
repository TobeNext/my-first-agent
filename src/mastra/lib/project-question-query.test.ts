import { describe, expect, it } from 'vitest';

import { buildProjectExperienceQuery } from './project-question-query';

describe('buildProjectExperienceQuery', () => {
  it('injects JD cross-check evidence and capability gaps into the project query', () => {
    const query = buildProjectExperienceQuery({
      selectedDirection: 'AI Agent Engineer',
      projectExperience: [
        '- 负责 AI Agent 面试系统的架构设计',
        '- 用 TypeScript 和 Node.js 落地 SSE 流式交互',
      ].join('\n'),
      rawKickoffMessage: 'kickoff payload',
      jobDescription: [
        '### 岗位职责',
        '- 负责 AI Agent 平台能力建设',
        '### 任职要求',
        '- 熟悉 TypeScript 与 Node.js 服务设计',
        '- 能够处理线上故障与恢复',
      ].join('\n'),
      normalizedProjectTopics: ['AI Agent 面试系统', 'TypeScript 和 Node.js'],
    });

    expect(query).toContain('Cross-check these JD requirements against the project evidence:');
    expect(query).toContain('Project evidence candidates:');
    expect(query).toContain('Capability gaps to validate when the resume evidence is thin:');
    expect(query).toContain('Ask for concrete project decisions, trade-offs, ownership, or execution evidence instead of accepting resume claims at face value.');
  });

  it('falls back to plain project context when no JD is uploaded', () => {
    const query = buildProjectExperienceQuery({
      selectedDirection: 'AI Agent Engineer',
      projectExperience: '- 主导 BFF 设计',
      rawKickoffMessage: 'kickoff payload',
      jobDescription: '',
      normalizedProjectTopics: ['BFF 设计'],
    });

    expect(query).toContain('Project experience context:');
    expect(query).not.toContain('Cross-check these JD requirements against the project evidence:');
  });

  it('omits project evidence lines when no project statement matches the JD signals', () => {
    const query = buildProjectExperienceQuery({
      selectedDirection: 'AI Agent Engineer',
      projectExperience: '- 负责团队周会组织',
      rawKickoffMessage: 'kickoff payload',
      jobDescription: '### 任职要求\n- 熟悉 TypeScript 服务设计',
      normalizedProjectTopics: ['团队协作'],
    });

    expect(query).toContain('Cross-check these JD requirements against the project evidence:');
    expect(query).not.toContain('Project evidence candidates:');
  });
  
    it('omits capability gaps when every JD signal is already supported by project evidence', () => {
      const query = buildProjectExperienceQuery({
        selectedDirection: 'AI Agent Engineer',
        projectExperience: [
          '- 负责 AI Agent 平台能力建设',
          '- 熟悉 TypeScript 服务设计并落地到线上系统',
        ].join('\n'),
        rawKickoffMessage: 'kickoff payload',
        jobDescription: ['### 岗位职责', '- 负责 AI Agent 平台能力建设', '### 任职要求', '- 熟悉 TypeScript 服务设计'].join('\n'),
        normalizedProjectTopics: ['AI Agent 平台能力建设', 'TypeScript 服务设计'],
      });
  
      expect(query).toContain('Project evidence candidates:');
      expect(query).not.toContain('Capability gaps to validate when the resume evidence is thin:');
    });
});