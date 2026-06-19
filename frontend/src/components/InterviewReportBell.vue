<template>
  <div class="report-bell" data-test="interview-report-bell">
    <button
      class="report-bell__button"
      type="button"
      aria-label="查看报告生成状态"
      :aria-expanded="isOpen"
      @click="toggleOpen"
    >
      <span class="report-bell__icon" aria-hidden="true"></span>
      <span v-if="unreadCount > 0" class="report-bell__badge" data-test="report-unread-badge">
        {{ unreadCount }}
      </span>
    </button>

    <section v-if="isOpen" class="report-bell__popup" data-test="report-bell-popup">
      <div class="report-bell__header">
        <strong>报告通知</strong>
        <button class="report-bell__close" type="button" aria-label="关闭报告通知" @click="isOpen = false">
          ×
        </button>
      </div>

      <p class="report-bell__status">{{ statusText }}</p>
      <p v-if="progressText" class="report-bell__meta">{{ progressText }}</p>
      <p v-if="errorMessage" class="report-bell__error">{{ errorMessage }}</p>

      <div class="report-bell__actions">
        <button class="report-bell__action" type="button" :disabled="loading" @click="$emit('refresh')">
          刷新
        </button>
        <button
          v-if="status?.reportState === 'ready' && status.markdownAvailable"
          class="report-bell__action report-bell__action--primary"
          type="button"
          @click="$emit('download')"
        >
          下载报告
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { InterviewReportStatus } from '@/types/agent';

const props = defineProps<{
  readonly status: InterviewReportStatus | null;
  readonly loading: boolean;
  readonly errorMessage: string;
}>();

const emit = defineEmits<{
  opened: [];
  refresh: [];
  download: [];
}>();

const isOpen = ref(false);

const unreadCount = computed(() => props.status?.unreadCount ?? 0);
const progressText = computed(() => {
  if (!props.status || props.status.expectedCount === 0) {
    return '';
  }

  return `已完成 ${props.status.completedCount}/${props.status.expectedCount}`;
});
const statusText = computed(() => {
  if (props.loading && !props.status) {
    return '正在获取报告状态。';
  }

  if (!props.status) {
    return '报告状态暂不可用。';
  }

  if (props.status.reportState === 'ready') {
    return '报告已生成。';
  }

  if (props.status.reportState === 'failed') {
    return `报告生成失败${props.status.failedCount > 0 ? `，失败任务 ${props.status.failedCount} 个` : ''}。`;
  }

  if (props.status.reportState === 'generating') {
    return '报告生成中。';
  }

  return '报告任务尚未开始。';
});

function toggleOpen(): void {
  isOpen.value = !isOpen.value;
}

watch(isOpen, (nextIsOpen) => {
  if (nextIsOpen) {
    emit('opened');
  }
});
</script>
