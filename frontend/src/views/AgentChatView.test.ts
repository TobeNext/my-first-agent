import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  downloadInterviewReportMarkdownMock,
  fetchInterviewReportStatusMock,
  markInterviewReportReadMock,
  pushMock,
  streamChatWithAgentMock,
} = vi.hoisted(() => ({
  downloadInterviewReportMarkdownMock: vi.fn(),
  fetchInterviewReportStatusMock: vi.fn(),
  markInterviewReportReadMock: vi.fn(),
  pushMock: vi.fn(),
  streamChatWithAgentMock: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock('@/services/agent-stream', () => ({
  FLOW_TEST_SKIP_MARKER: '[FLOW_TEST_SKIP]',
  streamChatWithAgent: streamChatWithAgentMock,
}));

vi.mock('@/services/bff-api', () => ({
  downloadInterviewReportMarkdown: downloadInterviewReportMarkdownMock,
  fetchInterviewReportStatus: fetchInterviewReportStatusMock,
  markInterviewReportRead: markInterviewReportReadMock,
  submitInterviewFeedbackViaBff: vi.fn(),
}));

vi.mock('@/services/speech-recognition', () => ({
  createSpeechRecognitionSession: vi.fn(),
  getInterviewSpeechRecognitionProfile: () => ({
    lang: 'zh-CN',
    description: '语音输入已关闭。',
  }),
  isSpeechRecognitionSupported: () => false,
}));

import { readPersistedInterviewSession } from '@/services/interview-session-storage';
import { buildPersistedInterviewSession, savePersistedInterviewSession } from '@/services/interview-session-storage';
import { useResumeUploadStore } from '@/stores/upload';

import AgentChatView from './AgentChatView.vue';

describe('AgentChatView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    pushMock.mockReset();
    pushMock.mockResolvedValue(undefined);
    streamChatWithAgentMock.mockReset();
    fetchInterviewReportStatusMock.mockReset();
    fetchInterviewReportStatusMock.mockResolvedValue({
      threadId: 'thread-1',
      reportState: 'generating',
      sealed: true,
      expectedCount: 1,
      completedCount: 0,
      failedCount: 0,
      unreadCount: 0,
      markdownAvailable: false,
      reportId: null,
      updatedAt: '2026-06-19T00:00:00Z',
      blockingReason: 'pending',
    });
    markInterviewReportReadMock.mockReset();
    markInterviewReportReadMock.mockResolvedValue({
      threadId: 'thread-1',
      readAt: '2026-06-19T00:00:00Z',
    });
    downloadInterviewReportMarkdownMock.mockReset();
    downloadInterviewReportMarkdownMock.mockResolvedValue({
      blob: new Blob(['## Report'], { type: 'text/markdown' }),
      fileName: 'interview-report-thread-1.md',
    });
    window.localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('persists the latest interview session snapshot after the interview starts', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 2,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 2,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };

    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '请先介绍一下你最近的项目。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '请先介绍一下你最近的项目。',
        flowTestMockUserReply: null,
        phase: 'professional-skills-round',
        activeRoundType: 'professional-skills',
        activeNodeTopic: 'TypeScript',
        finalReportReady: false,
        progress: {
          totalQuestionCount: 4,
          completedQuestionCount: 0,
          remainingQuestionCount: 4,
          currentQuestionIndex: 1,
          currentRoundType: 'professional-skills',
          currentRoundLabel: '专业技能轮',
          currentStage: 'main-question',
          currentFollowUpIndex: null,
          currentQuestionText: '请先介绍一下你最近的项目。',
          currentNodeTopic: 'TypeScript',
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();

    expect(streamChatWithAgentMock).toHaveBeenCalledTimes(1);

    const persistedSession = readPersistedInterviewSession();
    expect(persistedSession).not.toBeNull();
    expect(persistedSession?.threadId).toMatch(/[0-9a-f-]{36}/i);
    expect(persistedSession?.summary).toEqual({
      phase: 'professional-skills-round',
      activeRoundType: 'professional-skills',
      finalReportReady: false,
      totalQuestionCount: 4,
      completedQuestionCount: 0,
      currentStage: 'main-question',
      currentQuestionIndex: 1,
      currentRoundType: 'professional-skills',
      currentFollowUpIndex: null,
      remainingQuestionCount: 4,
      currentQuestionText: '请先介绍一下你最近的项目。',
      assistantReply: '请先介绍一下你最近的项目。',
    });
    expect(persistedSession?.settings).toEqual({
      reviewIncorrectOrMissingPoints: true,
      skipProfessionalSkillsRound: false,
      skipProjectExperienceRound: false,
      enableFlowTestMode: false,
      professionalQuestionMode: 'per-skill-default',
      professionalQuestionCount: 2,
      projectQuestionCount: 2,
    });
  });

  it('restores the latest persisted interview session from local storage', async () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-restore',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 2,
        },
        interviewState: {
          assistantReply: '请继续说明你如何做性能排查。',
          flowTestMockUserReply: null,
          phase: 'professional-skills-round',
          activeRoundType: 'professional-skills',
          activeNodeTopic: 'Performance',
          finalReportReady: false,
          progress: {
            totalQuestionCount: 4,
            completedQuestionCount: 1,
            remainingQuestionCount: 3,
            currentQuestionIndex: 2,
            currentRoundType: 'professional-skills',
            currentRoundLabel: '专业技能轮',
            currentStage: 'follow-up',
            currentFollowUpIndex: 1,
            currentQuestionText: '请继续说明你如何做性能排查。',
            currentNodeTopic: 'Performance',
          },
        },
        updatedAt: '2026-05-17T10:30:00.000Z',
      }),
    );

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.text()).toContain('恢复上次面试');
    expect(wrapper.text()).toContain('请继续说明你如何做性能排查。');

    await wrapper.get('[data-test="restore-interview-session"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('当前在专业技能面试的第2题第1轮追问环节。');
    expect(wrapper.text()).toContain('请继续说明你如何做性能排查。');
    expect(wrapper.find('.agent-card__composer').exists()).toBe(true);
  });

  it('clears the persisted session and returns to upload when discarded', async () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-discard',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 2,
        },
        interviewState: {
          assistantReply: '请继续说明你如何处理线上告警。',
          flowTestMockUserReply: null,
          phase: 'professional-skills-round',
          activeRoundType: 'professional-skills',
          activeNodeTopic: 'Operations',
          finalReportReady: false,
          progress: {
            totalQuestionCount: 4,
            completedQuestionCount: 1,
            remainingQuestionCount: 3,
            currentQuestionIndex: 2,
            currentRoundType: 'professional-skills',
            currentRoundLabel: '专业技能轮',
            currentStage: 'main-question',
            currentFollowUpIndex: null,
            currentQuestionText: '请继续说明你如何处理线上告警。',
            currentNodeTopic: 'Operations',
          },
        },
      }),
    );

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [createPinia()],
      },
    });

    await wrapper.get('[data-test="discard-interview-session"]').trigger('click');
    await flushPromises();

    expect(readPersistedInterviewSession()).toBeNull();
    expect(pushMock).toHaveBeenCalledWith({ name: 'resume-upload' });
  });

  it('clears stale local recovery state when the backend can no longer restore the thread', async () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-stale',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 2,
        },
        interviewState: {
          assistantReply: '请继续说明你如何处理线上告警。',
          flowTestMockUserReply: null,
          phase: 'professional-skills-round',
          activeRoundType: 'professional-skills',
          activeNodeTopic: 'Operations',
          finalReportReady: false,
          progress: {
            totalQuestionCount: 4,
            completedQuestionCount: 1,
            remainingQuestionCount: 3,
            currentQuestionIndex: 2,
            currentRoundType: 'professional-skills',
            currentRoundLabel: '专业技能轮',
            currentStage: 'main-question',
            currentFollowUpIndex: null,
            currentQuestionText: '请继续说明你如何处理线上告警。',
            currentNodeTopic: 'Operations',
          },
        },
      }),
    );
    streamChatWithAgentMock.mockRejectedValue(new Error('thread not found'));

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [createPinia()],
      },
    });

    await wrapper.get('[data-test="restore-interview-session"]').trigger('click');
    await wrapper.get('.agent-card__composer .agent-card__textarea').setValue('继续说明具体步骤。');
    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();

    expect(readPersistedInterviewSession()).toBeNull();
    expect(pushMock).toHaveBeenCalledWith({ name: 'resume-upload' });
    expect(wrapper.text()).toContain('未能恢复上次面试，会话可能已在后端失效。');
  });

  it('starts report status polling when the interview reaches completed stage', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();

    expect(fetchInterviewReportStatusMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.agent-card__composer').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchInterviewReportStatusMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('stops polling after report status is ready', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    fetchInterviewReportStatusMock.mockResolvedValue({
      threadId: 'thread-1',
      reportState: 'ready',
      sealed: true,
      expectedCount: 1,
      completedCount: 1,
      failedCount: 0,
      unreadCount: 1,
      markdownAvailable: true,
      reportId: 'report-1',
      updatedAt: '2026-06-19T00:00:00Z',
    });
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);

    expect(fetchInterviewReportStatusMock).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="report-unread-badge"]').text()).toBe('1');
    vi.useRealTimers();
  });

  it('marks ready report as read when the bell opens', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    fetchInterviewReportStatusMock
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        reportState: 'ready',
        sealed: true,
        expectedCount: 1,
        completedCount: 1,
        failedCount: 0,
        unreadCount: 1,
        markdownAvailable: true,
        reportId: 'report-1',
        updatedAt: '2026-06-19T00:00:00Z',
      })
      .mockResolvedValue({
        threadId: 'thread-1',
        reportState: 'ready',
        sealed: true,
        expectedCount: 1,
        completedCount: 1,
        failedCount: 0,
        unreadCount: 0,
        markdownAvailable: true,
        reportId: 'report-1',
        updatedAt: '2026-06-19T00:00:00Z',
      });
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');
    await flushPromises();

    expect(markInterviewReportReadMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="report-unread-badge"]').exists()).toBe(false);
  });

  it('downloads markdown report from the bell and marks it as read', async () => {
    const createObjectUrlMock = vi.fn(() => 'blob:report');
    const revokeObjectUrlMock = vi.fn();
    const anchorClickMock = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalCreateElement = document.createElement.bind(document);
    URL.createObjectURL = createObjectUrlMock;
    URL.revokeObjectURL = revokeObjectUrlMock;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        element.click = anchorClickMock;
      }
      return element;
    }) as typeof document.createElement);
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    fetchInterviewReportStatusMock.mockResolvedValue({
      threadId: 'thread-1',
      reportState: 'ready',
      sealed: true,
      expectedCount: 1,
      completedCount: 1,
      failedCount: 0,
      unreadCount: 0,
      markdownAvailable: true,
      reportId: 'report-1',
      updatedAt: '2026-06-19T00:00:00Z',
    });
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    try {
      const wrapper = mount(AgentChatView, {
        global: {
          plugins: [pinia],
        },
      });

      await wrapper.get('.upload-card__button--primary').trigger('click');
      await flushPromises();
      await wrapper.get('[data-test="interview-report-bell"] button').trigger('click');
      await flushPromises();
      await wrapper.get('.report-bell__action--primary').trigger('click');
      await flushPromises();

      expect(downloadInterviewReportMarkdownMock).toHaveBeenCalledTimes(1);
      expect(anchorClickMock).toHaveBeenCalledTimes(1);
      expect(markInterviewReportReadMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:report');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('stops report polling and resets bell status when conversation is cleared', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply: '面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();
    const secondaryButtons = wrapper.findAll('.upload-card__button--secondary');
    await secondaryButtons[secondaryButtons.length - 1]?.trigger('click');
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetchInterviewReportStatusMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="interview-report-bell"]').exists()).toBe(false);
    vi.useRealTimers();
  });

  it('hides legacy async report waiting text from assistant messages', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 1,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      professionalSkillGroupCount: 1,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };
    streamChatWithAgentMock.mockResolvedValue({
      authoritativeAssistantReply:
        '面试题目已经完成，我正在等待异步评分完成后生成最终报告。当前进度：0/6。请稍后再发送一条消息获取报告。',
      flowTestMockUserReply: null,
      interviewState: {
        assistantReply:
          '面试题目已经完成，我正在等待异步评分完成后生成最终报告。当前进度：0/6。请稍后再发送一条消息获取报告。',
        flowTestMockUserReply: null,
        phase: 'wrap-up',
        activeRoundType: null,
        activeNodeTopic: null,
        finalReportReady: false,
        progress: {
          totalQuestionCount: 1,
          completedQuestionCount: 1,
          remainingQuestionCount: 0,
          currentQuestionIndex: null,
          currentRoundType: null,
          currentRoundLabel: null,
          currentStage: 'completed',
          currentFollowUpIndex: null,
          currentQuestionText: null,
          currentNodeTopic: null,
        },
      },
    });

    const wrapper = mount(AgentChatView, {
      global: {
        plugins: [pinia],
      },
    });

    await wrapper.get('.upload-card__button--primary').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('等待异步评分完成');
    expect(wrapper.text()).not.toContain('当前进度');
    expect(wrapper.text()).not.toContain('稍后再发送一条消息');
  });
});
