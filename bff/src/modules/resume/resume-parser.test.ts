import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractNormalizedResumeTopics,
  parseResumeMarkdown,
  parseResumeSections,
} from './resume-parser';

test('parseResumeMarkdown returns canonical section content and normalized skills', () => {
  const markdown = [
    '### 个人简介',
    '- 忽略这一段',
    '### 专业技能',
    '- TypeScript',
    '* RAG',
    '- TypeScript',
    '',
    '### 项目经历',
    '- 搭建 BFF',
    '- 交付 Vue 前端',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(markdown), {
    professionalSkillsSection: '- TypeScript\n* RAG\n- TypeScript',
    projectExperienceSection: '- 搭建 BFF\n- 交付 Vue 前端',
    normalizedSkills: ['TypeScript', 'RAG'],
    normalizedProjectTopics: ['搭建 BFF', '交付 Vue 前端'],
    warnings: [],
    validationErrors: [],
  });
});

test('parseResumeMarkdown reports validation errors for empty markdown and malformed sections', () => {
  assert.deepEqual(parseResumeMarkdown('   '), {
    professionalSkillsSection: '',
    projectExperienceSection: '',
    normalizedSkills: [],
    normalizedProjectTopics: [],
    warnings: [],
    validationErrors: ['简历内容不能为空。'],
  });

  const malformedMarkdown = [
    '### 专业技能',
    'TypeScript',
    '### 专业技能',
    '- RAG',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(malformedMarkdown), {
    professionalSkillsSection: '- RAG',
    projectExperienceSection: '- 搭建 BFF',
    normalizedSkills: ['RAG'],
    normalizedProjectTopics: ['搭建 BFF'],
    warnings: [],
    validationErrors: ['第 3 行：章节“### 专业技能”重复出现。'],
  });

  const emptyBulletMarkdown = [
    '### 专业技能',
    '- ',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(emptyBulletMarkdown), {
    professionalSkillsSection: '-',
    projectExperienceSection: '- 搭建 BFF',
    normalizedSkills: [],
    normalizedProjectTopics: ['搭建 BFF'],
    warnings: [],
    validationErrors: ['第 2 行（专业技能）："- " 后必须填写具体内容。'],
  });
});

test('parseResumeSections keeps the same normalized output as the raw markdown parser', () => {
  const rawMarkdown = [
    '### 专业技能',
    '- TypeScript',
    '- Mastra',
    '',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');
  const parsedFromMarkdown = parseResumeMarkdown(rawMarkdown);

  assert.deepEqual(
    parseResumeSections({
      professionalSkills: parsedFromMarkdown.professionalSkillsSection,
      projectExperience: parsedFromMarkdown.projectExperienceSection,
    }),
    parsedFromMarkdown,
  );
});

test('parseResumeMarkdown reports empty-section validation when a required section only contains placeholders', () => {
  const markdown = [
    '### 专业技能',
    '...',
    '',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(markdown), {
    professionalSkillsSection: '...',
    projectExperienceSection: '- 搭建 BFF',
    normalizedSkills: [],
    normalizedProjectTopics: ['搭建 BFF'],
    warnings: [],
    validationErrors: ['第 1 行：章节“### 专业技能”不能为空，且至少包含一条以 "- " 开头的内容。'],
  });
});

test('extractNormalizedResumeTopics falls back to non-bullet lines when needed', () => {
  assert.deepEqual(extractNormalizedResumeTopics('TypeScript\nRAG\nTypeScript'), ['TypeScript', 'RAG']);
});

test('parseResumeMarkdown supports heading aliases, mixed heading styles, and numbered or nested list items', () => {
  const markdown = [
    '## Technical Skills:',
    '1. TypeScript',
    '2. Mastra',
    '   covers workflow orchestration and memory recovery',
    '',
    '**Project Experience**',
    '+ 搭建 NestJS BFF',
    '  - 对接前端与 Mastra',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(markdown), {
    professionalSkillsSection: '1. TypeScript\n2. Mastra\n   covers workflow orchestration and memory recovery',
    projectExperienceSection: '+ 搭建 NestJS BFF\n  - 对接前端与 Mastra',
    normalizedSkills: ['TypeScript', 'Mastra covers workflow orchestration and memory recovery'],
    normalizedProjectTopics: ['搭建 NestJS BFF', '对接前端与 Mastra'],
    warnings: [
      '第 1 行：已将标题“## Technical Skills:”兼容识别为“### 专业技能”。',
      '第 6 行：已将标题“**Project Experience**”兼容识别为“### 项目经历”。',
    ],
    validationErrors: [],
  });
});

test('parseResumeMarkdown tolerates plain-text headings and unbulleted fallback lines with warnings', () => {
  const markdown = [
    'Skills:',
    'TypeScript',
    'RAG',
    '',
    '项目经验：',
    'AI 面试 Agent 状态机改造',
    'BFF 流式代理联调',
  ].join('\n');

  assert.deepEqual(parseResumeMarkdown(markdown), {
    professionalSkillsSection: 'TypeScript\nRAG',
    projectExperienceSection: 'AI 面试 Agent 状态机改造\nBFF 流式代理联调',
    normalizedSkills: ['TypeScript', 'RAG'],
    normalizedProjectTopics: ['AI 面试 Agent 状态机改造', 'BFF 流式代理联调'],
    warnings: [
      '第 1 行：已将标题“Skills:”兼容识别为“### 专业技能”。',
      '第 5 行：已将标题“项目经验：”兼容识别为“### 项目经历”。',
      '第 1 行（专业技能）：未使用标准列表标记，已按逐行条目兼容解析。',
      '第 5 行（项目经历）：未使用标准列表标记，已按逐行条目兼容解析。',
    ],
    validationErrors: [],
  });
});