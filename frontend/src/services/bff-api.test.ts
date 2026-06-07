import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitInterviewFeedbackViaBff, validateResumeViaBff } from './bff-api';

describe('validateResumeViaBff', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns detailed validation issues when the BFF responds with a message array', async () => {
    const file = new File(['resume'], 'resume.md', { type: 'text/markdown' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: ['缺少章节：### 专业技能。', '第 2 行（项目经历）：内容项必须以 "- " 开头。'] }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateResumeViaBff(file)).resolves.toEqual({
      success: false,
      fileName: 'resume.md',
      fileSize: file.size,
      message: 'BFF 校验失败，请根据以下问题修改简历。',
      details: ['缺少章节：### 专业技能。', '第 2 行（项目经历）：内容项必须以 "- " 开头。'],
      source: 'bff',
    });
  });

  it('returns the success payload and marks the source as bff', async () => {
    const file = new File(['resume'], 'resume.md', { type: 'text/markdown' });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          fileName: 'resume.md',
          fileSize: file.size,
          message: '文件已通过 BFF 校验。',
          professionalSkillGroupCount: 2,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateResumeViaBff(file)).resolves.toEqual({
      success: true,
      fileName: 'resume.md',
      fileSize: file.size,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 2,
      source: 'bff',
    });
  });

  it('falls back to the HTTP status when the error payload is not JSON', async () => {
    const file = new File(['resume'], 'resume.md', { type: 'text/markdown' });
    const fetchMock = vi.fn().mockResolvedValue(new Response('not-json', { status: 502 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(validateResumeViaBff(file)).resolves.toEqual({
      success: false,
      fileName: 'resume.md',
      fileSize: file.size,
      message: 'Request failed with status 502.',
      details: undefined,
      source: 'bff',
    });
  });

  it('submits interview feedback through the BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          savedAt: '2026-05-03T12:00:00.000Z',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitInterviewFeedbackViaBff({
        threadId: 'thread-1',
        overallExperienceScore: 5,
        questionFitScore: 4,
        difficultyScore: 4,
        comment: '题目整体比较贴近目标岗位。',
      }),
    ).resolves.toEqual({
      success: true,
      savedAt: '2026-05-03T12:00:00.000Z',
    });
  });

  it('throws the first detailed BFF feedback error when submission fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: ['thread not found'] }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitInterviewFeedbackViaBff({
        threadId: 'missing-thread',
        overallExperienceScore: 5,
        questionFitScore: 4,
        difficultyScore: 4,
        comment: '',
      }),
    ).rejects.toThrow('thread not found');
  });

  it('throws the top-level BFF feedback error message when there are no details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'feedback rejected' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      submitInterviewFeedbackViaBff({
        threadId: 'thread-1',
        overallExperienceScore: 1,
        questionFitScore: 1,
        difficultyScore: 1,
        comment: 'too short',
      }),
    ).rejects.toThrow('feedback rejected');
  });
});