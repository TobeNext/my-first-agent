import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InterviewReportBell from './InterviewReportBell.vue';

describe('InterviewReportBell', () => {
  it('shows generating progress', async () => {
    const wrapper = mount(InterviewReportBell, {
      props: {
        loading: false,
        errorMessage: '',
        status: {
          threadId: 'thread-1',
          reportState: 'generating',
          sealed: true,
          expectedCount: 6,
          completedCount: 3,
          failedCount: 0,
          unreadCount: 0,
          markdownAvailable: false,
          reportId: null,
          updatedAt: '2026-06-19T00:00:00Z',
          blockingReason: 'pending',
        },
      },
    });

    await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');

    expect(wrapper.text()).toContain('报告生成中');
    expect(wrapper.text()).toContain('已完成 3/6');
  });

  it('shows unread badge for ready unread report', async () => {
    const wrapper = mount(InterviewReportBell, {
      props: {
        loading: false,
        errorMessage: '',
        status: {
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
        },
      },
    });

    expect(wrapper.get('[data-test="report-unread-badge"]').text()).toBe('1');

    await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');

    expect(wrapper.text()).toContain('报告已生成');
    expect(wrapper.text()).toContain('下载报告');
  });

  it('does not show unread badge for read report and emits download', async () => {
    const wrapper = mount(InterviewReportBell, {
      props: {
        loading: false,
        errorMessage: '',
        status: {
          threadId: 'thread-1',
          reportState: 'ready',
          sealed: true,
          expectedCount: 6,
          completedCount: 6,
          failedCount: 0,
          unreadCount: 0,
          markdownAvailable: true,
          reportId: 'report-1',
          updatedAt: '2026-06-19T00:00:00Z',
        },
      },
    });

    expect(wrapper.find('[data-test="report-unread-badge"]').exists()).toBe(false);

    await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');
    await wrapper.get('.report-bell__action--primary').trigger('click');

    expect(wrapper.emitted('download')).toHaveLength(1);
  });

  it('shows failed status and refresh action', async () => {
    const wrapper = mount(InterviewReportBell, {
      props: {
        loading: false,
        errorMessage: '网络异常',
        status: {
          threadId: 'thread-1',
          reportState: 'failed',
          sealed: true,
          expectedCount: 6,
          completedCount: 5,
          failedCount: 1,
          unreadCount: 0,
          markdownAvailable: false,
          reportId: null,
          updatedAt: '2026-06-19T00:00:00Z',
          blockingReason: 'failed',
        },
      },
    });

    await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');
    await wrapper.get('.report-bell__action').trigger('click');

    expect(wrapper.text()).toContain('报告生成失败');
    expect(wrapper.text()).toContain('网络异常');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });
});
