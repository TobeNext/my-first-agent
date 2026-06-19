import 'reflect-metadata';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentController } from './agent.controller';

test('AgentController.downloadInterviewReportMarkdown sets markdown download headers', async () => {
  const controller = new AgentController({
    downloadInterviewReportMarkdown: async () => ({
      content: '## Report',
      contentType: 'text/markdown; charset=utf-8',
      contentDisposition: 'attachment; filename="interview-report-thread-1.md"',
    }),
  } as never);
  const headers = new Map<string, string>();
  let sent = '';

  await controller.downloadInterviewReportMarkdown(
    { threadId: 'thread-1' },
    {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      send(value: string) {
        sent = value;
      },
    } as never,
  );

  assert.equal(headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.equal(headers.get('Content-Disposition'), 'attachment; filename="interview-report-thread-1.md"');
  assert.equal(sent, '## Report');
});

test('AgentController report status delegates validated thread id', async () => {
  const seen: string[] = [];
  const controller = new AgentController({
    fetchInterviewReportStatus: async (threadId: string) => {
      seen.push(threadId);
      return { threadId, reportState: 'not-started' };
    },
  } as never);

  const status = await controller.fetchInterviewReportStatus({ threadId: 'thread-1' });

  assert.equal(seen[0], 'thread-1');
  assert.deepEqual(status, { threadId: 'thread-1', reportState: 'not-started' });
});
