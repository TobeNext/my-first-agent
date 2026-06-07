<template>
  <main class="page-shell">
    <div class="page-shell__background"></div>
    <ResumeUploadCard @continue="enterInterviewSetup" />
  </main>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

import ResumeUploadCard from '@/components/ResumeUploadCard.vue';

const router = useRouter();

async function enterInterviewSetup(): Promise<void> {
  await router.push({ name: 'agent-chat' });
}
</script>