import { describe, expect, it } from 'vitest';

import { buildInterviewSystemSettings } from '../frontend/src/schemas/interview-setup';

import { STANDARD_INTERVIEW_FIXTURE } from './support/interview-e2e-fixtures';
import { assertInterviewE2eEnvironmentReady } from './support/interview-e2e-environment';
import { completeInterviewToReportGeneration } from './support/interview-e2e-flow';
import { readInterviewOutcomeArtifacts } from './support/interview-outcome-artifacts';
import {
  downloadReportMarkdown,
  markReportRead,
  readReportDbSummary,
  waitForReportStatus,
} from './support/interview-report-e2e';

describe('interview E2E completion flow', () => {
  it('covers background report generation, markdown download, read receipt, and DB persistence', async () => {
    await assertInterviewE2eEnvironmentReady();

    const threadId = `e2e-complete-${Date.now()}`;
    const settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: true,
      roundPreference: 'skip-professional-skills',
      enableFlowTestMode: false,
      professionalQuestionMode: 'custom-count',
      professionalQuestionCount: 1,
      projectQuestionCount: 1,
    });

    const latestResult = await completeInterviewToReportGeneration({
      threadId,
      fixture: STANDARD_INTERVIEW_FIXTURE,
      settings,
    });

    expect(latestResult.interviewState).not.toBeNull();
    expect(latestResult.interviewState?.phase).toBe('wrap-up');
    expect(latestResult.interviewState?.finalReportReady).toBe(false);
    expect(latestResult.interviewState?.progress.currentStage).toBe('completed');
    expect(latestResult.authoritativeAssistantReply).toBe(
      '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
    );
    expect(latestResult.authoritativeAssistantReply).not.toContain('等待异步评分完成');
    expect(latestResult.authoritativeAssistantReply).not.toContain('当前进度');

    const readyStatus = await waitForReportStatus(
      threadId,
      (status) => status.reportState === 'ready' && status.markdownAvailable && status.unreadCount === 1,
    );
    expect(readyStatus.completedCount).toBe(readyStatus.expectedCount);
    expect(readyStatus.reportId).toBeTruthy();

    const markdown = await downloadReportMarkdown(threadId);
    expect(markdown).toMatch(/模拟面试报告|Interview/i);
    expect(markdown).not.toContain('referenceAnswer');

    const readStatus = await markReportRead(threadId);
    expect(readStatus.reportState).toBe('ready');
    expect(readStatus.unreadCount).toBe(0);

    const dbSummary = await readReportDbSummary(threadId);
    expect(dbSummary.reportCount).toBe(1);
    expect(dbSummary.itemCount).toBeGreaterThanOrEqual(1);
    expect(dbSummary.markdown).toContain(markdown.slice(0, 20));

    const { indexRecord, outcomeRecord } = await readInterviewOutcomeArtifacts(threadId);

    expect(indexRecord.threadId).toBe(threadId);
    expect(indexRecord.outcomeFilePath).toContain(threadId);
    expect(outcomeRecord.threadId).toBe(threadId);
  });
});
