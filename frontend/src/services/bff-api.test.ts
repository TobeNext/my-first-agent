import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadInterviewReportMarkdown,
  fetchInterviewReportStatus,
  markInterviewReportRead,
  submitInterviewFeedbackViaBff,
  validateResumeViaBff,
} from './bff-api';

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

  it('fetches interview report status through the BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          threadId: 'thread-1',
          reportState: 'ready',
          sealed: true,
          expectedCount: 6,
          completedCount: 6,
          failedCount: 0,
          unreadCount: 1,
          markdownAvailable: true,
          reportId: 'report-1',
          updatedAt: '2026-06-19T00:00:00Z',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchInterviewReportStatus('thread 1')).resolves.toMatchObject({
      reportState: 'ready',
      unreadCount: 1,
      markdownAvailable: true,
      reportId: 'report-1',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/interviews/thread%201/report/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });

  it('throws the first report status detail when the BFF rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: ['runtime unavailable'] }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchInterviewReportStatus('thread-1')).rejects.toThrow('runtime unavailable');
  });

  it('downloads interview report markdown as a blob', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('## Report', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const download = await downloadInterviewReportMarkdown('thread-1');

    expect(download.fileName).toBe('interview-report-thread-1.md');
    expect(download.blob).toBeInstanceOf(Blob);
    expect(download.blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/interviews/thread-1/report/markdown', {
      method: 'GET',
      headers: { Accept: 'text/markdown' },
    });
  });

  it('throws the markdown download error returned by the BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'report not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadInterviewReportMarkdown('thread-missing')).rejects.toThrow('report not found');
  });

  it('marks an interview report as read through the BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ threadId: 'thread-1', readAt: '2026-06-19T00:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', fetchMock);

    await expect(markInterviewReportRead('thread-1')).resolves.toEqual({
      threadId: 'thread-1',
      readAt: '2026-06-19T00:00:00Z',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/interviews/thread-1/report/read', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  });
});
