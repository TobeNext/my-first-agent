import { describe, expect, it } from 'vitest';

import { sanitizeAssistantContent } from './assistant-content';

describe('sanitizeAssistantContent', () => {
  it('removes legacy async report waiting text', () => {
    expect(
      sanitizeAssistantContent(
        '面试题目已经完成，我正在等待异步评分完成后生成最终报告。当前进度：0/6。请稍后再发送一条消息获取报告。',
      ),
    ).toBe('');
  });

  it('keeps the new report generating prompt', () => {
    expect(
      sanitizeAssistantContent('面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。'),
    ).toBe('面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。');
  });

  it('does not affect normal interview questions and follow-ups', () => {
    expect(sanitizeAssistantContent('请继续说明你如何处理线上告警。')).toBe(
      '请继续说明你如何处理线上告警。',
    );
  });
});
