import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import assert from 'node:assert/strict';
import test from 'node:test';

import { ResumeService } from './resume.service';
import type { UploadedResumeFile } from './resume.types';

function createResumeFile(markdown: string, fileName = 'resume.md'): UploadedResumeFile {
  return {
    originalname: fileName,
    size: Buffer.byteLength(markdown, 'utf8'),
    buffer: Buffer.from(markdown, 'utf8'),
  };
}

function getBadRequestMessage(callback: () => unknown): string | readonly string[] {
  try {
    callback();
    assert.fail('Expected ResumeService.validate() to throw BadRequestException.');
  } catch (error) {
    assert.ok(error instanceof BadRequestException);

    const response = error.getResponse();
    if (typeof response === 'string' || Array.isArray(response)) {
      return response;
    }

    assert.ok(typeof response === 'object' && response !== null);
    assert.ok('message' in response);

    const { message } = response as { message?: string | string[] };
    assert.ok(typeof message === 'string' || Array.isArray(message));
    return message;
  }
}

test('ResumeService.validate still rejects truly malformed list items after enabling parser tolerance', () => {
  const service = new ResumeService();
  const message = getBadRequestMessage(() =>
    service.validate(
      createResumeFile([
        '### 专业技能',
        'TypeScript',
        '### 项目经历',
        '- ',
        '负责搭建 BFF',
      ].join('\n')),
    ),
  );

  assert.deepEqual(message, ['第 4 行（项目经历）："- " 后必须填写具体内容。']);
});

test('ResumeService.validate rejects a missing file before checking metadata', () => {
  const service = new ResumeService();
  const message = getBadRequestMessage(() => service.validate(undefined));

  assert.equal(message, '请先上传简历文件。');
});

test('ResumeService.validate rejects non-markdown files', () => {
  const service = new ResumeService();
  const message = getBadRequestMessage(() =>
    service.validate({
      originalname: 'resume.txt',
      size: 20,
      buffer: Buffer.from('resume', 'utf8'),
    }),
  );

  assert.equal(message, '仅支持上传 .md 格式的简历文件。');
});

test('ResumeService.validate reports duplicate and missing required sections', () => {
  const service = new ResumeService();
  const message = getBadRequestMessage(() =>
    service.validate(
      createResumeFile([
        '### 专业技能',
        '- TypeScript',
        '### 专业技能',
        '- Node.js',
      ].join('\n')),
    ),
  );

  assert.deepEqual(message, ['第 3 行：章节“### 专业技能”重复出现。', '缺少章节：### 项目经历。']);
});

test('ResumeService.validate accepts placeholder ellipsis and returns the professional skill group count', () => {
  const service = new ResumeService();
  const markdown = [
    '### 专业技能',
    '- 熟练掌握 TypeScript / C# ，具备 Java 工程开发能力，能够独立完成 AI Agent 系统开发。',
    '- 熟悉 LangChain、Mastra 等框架，具备 Agent 编排与状态管理经验。',
    '...',
    '### 项目经历',
    '- 使用 TypeScript 和 Node.js 构建 NestJS BFF',
    '...',
  ].join('\n');

  const result = service.validate(createResumeFile(markdown));

  assert.deepEqual(result, {
    success: true,
    fileName: 'resume.md',
    fileSize: Buffer.byteLength(markdown, 'utf8'),
    message: '文件已通过 BFF 大小、类型、结构校验，并完成技能组计数。',
    professionalSkillGroupCount: 2,
  });
});

test('ResumeService.validate rejects unreadable file buffers', () => {
  const service = new ResumeService();
  const message = getBadRequestMessage(() =>
    service.validate({
      originalname: 'resume.md',
      size: 0,
      buffer: undefined,
    }),
  );

  assert.equal(message, '无法读取上传的简历内容。');
});

test('ResumeService.validate accepts heading aliases and non-standard markdown that the canonical parser can normalize', () => {
  const service = new ResumeService();
  const markdown = [
    '## Skills:',
    '1. TypeScript',
    '2. RAG',
    '',
    'Project Experience:',
    'AI 面试 Agent 状态机改造',
    'BFF 流式代理联调',
  ].join('\n');

  const result = service.validate(createResumeFile(markdown));

  assert.deepEqual(result, {
    success: true,
    fileName: 'resume.md',
    fileSize: Buffer.byteLength(markdown, 'utf8'),
    message: '文件已通过 BFF 大小、类型、结构校验，并完成技能组计数。',
    professionalSkillGroupCount: 2,
  });
});