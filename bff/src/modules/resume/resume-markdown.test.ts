import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countProfessionalSkillGroups,
  extractResumeSectionMarkdowns,
  validateResumeMarkdown,
} from './resume-markdown';

test('validateResumeMarkdown rejects empty markdown', () => {
  assert.deepEqual(validateResumeMarkdown('   '), ['简历内容不能为空。']);
});

test('countProfessionalSkillGroups only counts meaningful professional skill bullets', () => {
  const markdown = [
    '### 个人信息',
    '- 忽略这一段',
    '### 专业技能',
    '- TypeScript',
    '- RAG',
    '...',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');

  assert.equal(countProfessionalSkillGroups(markdown), 2);
});

test('extractResumeSectionMarkdowns returns the required section content only', () => {
  const markdown = [
    '### 专业技能',
    '- TypeScript',
    '- Mastra',
    '',
    '### 项目经历',
    '- 搭建 BFF',
    '- 交付 Vue 前端',
    '',
    '### 其他信息',
    '- 这部分不应被返回',
  ].join('\n');

  assert.deepEqual(extractResumeSectionMarkdowns(markdown), {
    professionalSkills: '- TypeScript\n- Mastra',
    projectExperience: '- 搭建 BFF\n- 交付 Vue 前端',
  });
});

test('countProfessionalSkillGroups returns zero when the professional section is missing', () => {
  const markdown = ['### 项目经历', '- 搭建 BFF'].join('\n');

  assert.equal(countProfessionalSkillGroups(markdown), 0);
});

test('extractResumeSectionMarkdowns returns empty strings for missing sections', () => {
  const markdown = ['### 个人简介', '- Hello'].join('\n');

  assert.deepEqual(extractResumeSectionMarkdowns(markdown), {
    professionalSkills: '',
    projectExperience: '',
  });
});

test('validateResumeMarkdown ignores unrelated headings but still requires the mandatory sections', () => {
  const markdown = [
    '### 个人简介',
    '- Hello',
    '### 项目经历',
    '- 搭建 BFF',
  ].join('\n');

  assert.deepEqual(validateResumeMarkdown(markdown), ['缺少章节：### 专业技能。']);
});