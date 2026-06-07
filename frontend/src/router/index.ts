import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';

import { hasRestorableInterviewSession } from '@/services/interview-session-storage';
import { useResumeUploadStore } from '@/stores/upload';
import AgentChatView from '@/views/AgentChatView.vue';
import ResumeUploadView from '@/views/ResumeUploadView.vue';

const routes = [
  {
    path: '/',
    name: 'resume-upload',
    component: ResumeUploadView,
  },
  {
    path: '/agent',
    name: 'agent-chat',
    component: AgentChatView,
  },
] as const;

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [...routes],
  });

  router.beforeEach((to) => {
    if (to.name !== 'agent-chat') {
      return true;
    }

    const uploadStore = useResumeUploadStore();
    if (uploadStore.interviewEntryState.canStartInterview || hasRestorableInterviewSession()) {
      return true;
    }

    return { name: 'resume-upload' };
  });

  return router;
}

export const router = createAppRouter();