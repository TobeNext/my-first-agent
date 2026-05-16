import { createRouter, createWebHistory } from 'vue-router';

import AgentChatView from '@/views/AgentChatView.vue';
import ResumeUploadView from '@/views/ResumeUploadView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
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
  ],
});