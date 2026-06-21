import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildPersistedInterviewSession,
  savePersistedInterviewSession,
} from '@/services/interview-session-storage';
import { useResumeUploadStore } from '@/stores/upload';

import { createAppRouter } from './index';

describe('app router', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
  });

  it('redirects the agent route back to upload when the interview is not ready', async () => {
    const router = createAppRouter(createMemoryHistory());

    await router.push('/agent');

    expect(router.currentRoute.value.name).toBe('resume-upload');
  });

  it('allows the agent route when the resume upload is ready', async () => {
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
      markdown: '### 专业技能\n- TypeScript',
      professionalSkillGroupCount: 2,
      jobDescriptionFileName: null,
      jobDescriptionMarkdown: '',
    };

    const router = createAppRouter(createMemoryHistory());

    await router.push('/agent');

    expect(router.currentRoute.value.name).toBe('agent-chat');
  });

  it('allows the agent route when there is a restorable local interview session', async () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-restore',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
        enableHistoricalMemory: true,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 2,
        },
        interviewState: {
          assistantReply: '请继续说明你如何排查线上问题。',
          flowTestMockUserReply: null,
          phase: 'professional-skills-round',
          activeRoundType: 'professional-skills',
          activeNodeTopic: 'Troubleshooting',
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
            currentQuestionText: '请继续说明你如何排查线上问题。',
            currentNodeTopic: 'Troubleshooting',
          },
        },
      }),
    );

    const router = createAppRouter(createMemoryHistory());

    await router.push('/agent');

    expect(router.currentRoute.value.name).toBe('agent-chat');
  });
});