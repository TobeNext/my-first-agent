import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pushMock, streamChatWithAgentMock } = vi.hoisted(() => ({
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
    window.localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
});