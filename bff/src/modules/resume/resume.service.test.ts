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

test('ResumeService.validate returns detailed section errors for malformed markdown bullets', () => {
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

  assert.deepEqual(message, [
    '第 2 行（专业技能）：内容项必须以 "- " 开头。',
    '第 4 行（项目经历）："- " 后必须填写具体内容。',
    '第 5 行（项目经历）：内容项必须以 "- " 开头。',
  ]);
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