<template>
  <main class="page-shell">
    <div class="page-shell__background"></div>

    <div
      class="agent-layout"
      :class="showInterviewSidebar ? 'agent-layout--with-sidebar' : 'agent-layout--without-sidebar'"
    >
      <aside v-if="showInterviewSidebar" class="interview-sidebar">
        <p class="interview-sidebar__eyebrow">面试进度</p>
        <h2 class="interview-sidebar__title">面试进度</h2>

        <div class="interview-sidebar__metric">
          <strong class="interview-sidebar__metric-label">剩余问题</strong>
          <strong class="interview-sidebar__metric-value">{{ remainingQuestionsDisplay }}</strong>
        </div>

        <section class="interview-sidebar__panel">
          <strong class="interview-sidebar__panel-title">当前状态</strong>
          <strong class="interview-sidebar__panel-content">{{ currentStageDisplay }}</strong>
        </section>

        <section class="interview-sidebar__panel">
          <strong class="interview-sidebar__panel-title">当前题目</strong>
          <strong class="interview-sidebar__panel-content">{{ currentQuestionDisplay }}</strong>
        </section>

        <div class="interview-sidebar__meta">
          <span>已完成 {{ interviewProgress?.completedQuestionCount ?? 0 }}/{{ interviewProgress?.totalQuestionCount ?? 0 }}</span>
          <span v-if="interviewState?.finalReportReady">已生成面试报告</span>
        </div>
      </aside>

      <section class="agent-card">
      <div class="agent-card__header">
        <div>
          <p class="upload-card__eyebrow">AI 面试</p>
          <h1>模拟面试</h1>
        </div>
        <InterviewReportBell
          v-if="hasInterviewStarted"
          :status="reportStatus"
          :loading="isReportStatusLoading"
          :error-message="reportStatusError"
          @opened="handleReportBellOpened"
          @refresh="refreshReportStatus"
          @download="downloadReportMarkdown"
        />
      </div>

      <p v-if="!hasInterviewStarted" class="agent-card__status-text">
        {{ startStatusText }}
      </p>

      <section v-if="showSessionRecoveryPanel" class="agent-card__summary">
        <p class="agent-card__summary-title">{{ sessionRecoveryTitle }}</p>
        <p>{{ sessionRecoverySummary }}</p>

        <div class="upload-card__actions">
          <button
            v-if="canRestoreRecentSession"
            data-test="restore-interview-session"
            class="upload-card__button upload-card__button--primary"
            type="button"
            :disabled="isLoading"
            @click="restoreRecentInterviewSession"
          >
            恢复上次面试
          </button>
          <button
            data-test="discard-interview-session"
            class="upload-card__button upload-card__button--secondary"
            type="button"
            :disabled="isLoading"
            @click="discardRecentInterviewSession"
          >
            {{ canRestoreRecentSession ? '放弃并重新开始' : '清除本地会话记录' }}
          </button>
        </div>
      </section>

      <section v-if="showSetupPanel" class="agent-card__setup">
        <div class="agent-card__setup-header">
          <div>
            <p class="agent-card__setup-eyebrow">面试配置</p>
            <h2 class="agent-card__setup-title">确认系统设置</h2>
          </div>
          <p class="agent-card__setup-description">
            {{ INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION }}
          </p>
        </div>

        <div class="agent-card__settings-grid">
          <section class="agent-card__settings-card">
            <p class="agent-card__settings-title">题目数量设置</p>
            <label>
              <span class="agent-card__settings-helper">专业技能轮</span>
              <select v-model="professionalQuestionMode" class="agent-card__custom-input" :disabled="isProfessionalRoundSkipped">
                <option value="per-skill-default">
                  按简历技能组自动生成（{{ automaticProfessionalQuestionCount }} 道）
                </option>
                <option value="custom-count">自定义题数</option>
              </select>
            </label>
            <label v-if="professionalQuestionMode === 'custom-count'">
              <span class="agent-card__settings-helper">专业技能轮自定义题数</span>
              <select v-model.number="professionalQuestionCount" class="agent-card__custom-input" :disabled="isProfessionalRoundSkipped">
                <option v-for="count in INTERVIEW_QUESTION_COUNT_OPTIONS" :key="`professional-${count}`" :value="count">
                  {{ count }} 道主问题
                </option>
              </select>
            </label>
            <label>
              <span class="agent-card__settings-helper">项目经历轮</span>
              <select v-model.number="projectQuestionCount" class="agent-card__custom-input" :disabled="isProjectRoundSkipped">
                <option v-for="count in INTERVIEW_QUESTION_COUNT_OPTIONS" :key="`project-${count}`" :value="count">
                  {{ count }} 道主问题
                </option>
              </select>
            </label>
            <p class="agent-card__settings-helper">
              已选择 {{ configuredQuestionCount }} 道主问题。跳过某一轮时，该轮会自动记为 0 道。
              专业技能轮当前将按 {{ configuredProfessionalQuestionCount }} 道题执行召回。
            </p>
            <p v-if="interviewSettingsValidationError" class="agent-card__settings-helper">
              {{ interviewSettingsValidationError }}
            </p>
          </section>

          <section class="agent-card__settings-card">
            <p class="agent-card__settings-title">回答纠错设置</p>
            <label class="agent-card__settings-option">
              <input v-model="reviewIncorrectOrMissingPoints" type="checkbox" />
              <span>每道题结束后，指出漏答点和明显错误，再继续下一题。</span>
            </label>
          </section>

          <section class="agent-card__settings-card">
            <p class="agent-card__settings-title">轮次跳过设置</p>
            <label class="agent-card__settings-option">
              <input v-model="roundPreference" type="radio" name="round-preference" value="no-skip" />
              <span>完整进行两轮面试</span>
            </label>
            <label class="agent-card__settings-option">
              <input v-model="roundPreference" type="radio" name="round-preference" value="skip-professional-skills" />
              <span>默认跳过第一轮专业技能面试</span>
            </label>
            <label class="agent-card__settings-option">
              <input v-model="roundPreference" type="radio" name="round-preference" value="skip-project-experience" />
              <span>默认跳过第二轮项目经历面试</span>
            </label>
          </section>

          <section class="agent-card__settings-card">
            <p class="agent-card__settings-title">流程测试功能</p>
            <label class="agent-card__settings-option">
              <input v-model="enableFlowTestMode" type="checkbox" />
              <span>开启后可在面试中跳过用户回答，由系统自动 mock 评分、追问和流程推进。</span>
            </label>
            <p class="agent-card__settings-helper">
              仅用于流程联调，不影响正常面试模式。
            </p>
          </section>
        </div>
      </section>

      <section v-if="setupSummary" class="agent-card__summary">
        <p class="agent-card__summary-title">本次面试配置</p>
        <p>{{ setupSummary }}</p>
      </section>

      <div v-if="conversation.length" ref="historyContainer" class="agent-card__history">
        <article
          v-for="entry in conversation"
          :key="entry.id"
          class="agent-card__message"
          :class="entry.role === 'user' ? 'agent-card__message--user' : 'agent-card__message--assistant'"
        >
          <p class="agent-card__message-role">{{ entry.role === 'user' ? '你' : '面试官' }}</p>
          <p class="agent-card__message-text">
            <span v-if="entry.content">{{ entry.content }}</span>
            <span v-if="isStreamingEntry(entry.id)" class="agent-card__typing" aria-label="面试官正在思考">
              <span class="agent-card__typing-dot">.</span>
              <span class="agent-card__typing-dot">.</span>
              <span class="agent-card__typing-dot">.</span>
            </span>
          </p>
        </article>
      </div>

      <section v-if="showFeedbackPanel" class="agent-card__feedback">
        <div class="agent-card__feedback-header">
          <div>
            <p class="agent-card__summary-title">面试反馈闭环</p>
            <p class="agent-card__feedback-description">
              这份反馈会写入结构化 outcome 数据，用于后续分析题目召回质量、用户表现和选题策略。
            </p>
          </div>
          <span v-if="feedbackSubmitState === 'submitted'" class="agent-card__feedback-badge">反馈已保存</span>
        </div>

        <div class="agent-card__feedback-grid">
          <label>
            <span class="agent-card__settings-helper">整体体验</span>
            <select v-model.number="overallExperienceScore" class="agent-card__custom-input" :disabled="isFeedbackLocked">
              <option v-for="score in INTERVIEW_FEEDBACK_SCORE_OPTIONS" :key="`overall-${score}`" :value="score">
                {{ score }} 分
              </option>
            </select>
          </label>
          <label>
            <span class="agent-card__settings-helper">题目贴合度</span>
            <select v-model.number="questionFitScore" class="agent-card__custom-input" :disabled="isFeedbackLocked">
              <option v-for="score in INTERVIEW_FEEDBACK_SCORE_OPTIONS" :key="`question-fit-${score}`" :value="score">
                {{ score }} 分
              </option>
            </select>
          </label>
          <label>
            <span class="agent-card__settings-helper">难度匹配度</span>
            <select v-model.number="difficultyScore" class="agent-card__custom-input" :disabled="isFeedbackLocked">
              <option v-for="score in INTERVIEW_FEEDBACK_SCORE_OPTIONS" :key="`difficulty-${score}`" :value="score">
                {{ score }} 分
              </option>
            </select>
          </label>
        </div>

        <label class="agent-card__feedback-comment">
          <span class="agent-card__settings-helper">补充反馈</span>
          <textarea
            v-model="feedbackComment"
            class="agent-card__textarea agent-card__textarea--feedback"
            :disabled="isFeedbackLocked"
            placeholder="例如：哪些题目特别贴合、哪些题偏难或偏离预期、最终总结是否有帮助。"
            rows="4"
          ></textarea>
        </label>

        <div class="agent-card__feedback-actions">
          <button
            class="upload-card__button upload-card__button--primary"
            type="button"
            :disabled="isFeedbackLocked || isLoading"
            @click="submitInterviewFeedback"
          >
            {{ feedbackSubmitButtonLabel }}
          </button>
          <p v-if="feedbackErrorMessage" class="agent-card__feedback-status agent-card__feedback-status--error">
            {{ feedbackErrorMessage }}
          </p>
          <p v-else-if="feedbackSubmitState === 'submitted'" class="agent-card__feedback-status">
            反馈已写入本次面试 outcome 记录。
          </p>
        </div>
      </section>

      <div v-if="hasInterviewStarted && !isInterviewEnded" class="agent-card__composer">
        <textarea
          v-model="message"
          class="agent-card__textarea"
          :disabled="isSpeechRecognitionListening"
          placeholder="输入你的回答，或按住语音按钮继续面试。"
          rows="4"
        ></textarea>

        <div class="agent-card__composer-footer">
          <div class="agent-card__composer-actions">
            <button
              class="upload-card__button upload-card__button--secondary agent-card__voice-button"
              :class="{ 'agent-card__voice-button--listening': isSpeechRecognitionListening }"
              type="button"
              :disabled="!supportsSpeechRecognition || isLoading"
              @pointerdown.prevent="handleSpeechRecognitionPress"
              @pointerup.prevent="handleSpeechRecognitionRelease"
              @pointercancel.prevent="handleSpeechRecognitionRelease"
              @lostpointercapture="handleSpeechRecognitionRelease"
            >
              {{ speechRecognitionButtonLabel }}
            </button>
            <button
              v-if="showFlowTestSkipButton"
              class="upload-card__button upload-card__button--secondary agent-card__skip-button"
              type="button"
              :disabled="isLoading || isSpeechRecognitionListening"
              @click="skipAnswerInFlowTestMode"
            >
              跳过本次回答
            </button>
          </div>
          <p
            class="agent-card__voice-status"
            :class="{
              'agent-card__voice-status--listening': isSpeechRecognitionListening,
              'agent-card__voice-status--error': speechRecognitionError,
            }"
          >
            {{ speechRecognitionStatusText }}
          </p>
        </div>
      </div>

      <div class="upload-card__actions">
        <button
          class="upload-card__button upload-card__button--primary"
          type="button"
          :disabled="isPrimaryButtonDisabled"
          @click="onPrimaryAction"
        >
          {{ primaryButtonLabel }}
        </button>
        <button
          class="upload-card__button upload-card__button--secondary"
          type="button"
          :disabled="isLoading || conversation.length === 0"
          @click="clearConversation"
        >
          清空对话
        </button>
      </div>

      <div v-if="errorMessage" class="upload-card__result is-error">
        <p class="upload-card__result-title">请求失败</p>
        <p>{{ errorMessage }}</p>
      </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  buildInterviewSystemSettings,
  DEFAULT_PROFESSIONAL_QUESTION_COUNT,
  DEFAULT_PROFESSIONAL_QUESTION_MODE,
  DEFAULT_PROJECT_QUESTION_COUNT,
  INTERVIEW_QUESTION_COUNT_OPTIONS,
  MAX_INTERVIEW_TOTAL_QUESTION_COUNT,
} from '@/schemas/interview-setup';
import {
  buildInterviewFeedbackPayload,
  INTERVIEW_FEEDBACK_SCORE_OPTIONS,
} from '@/schemas/interview-feedback';
import { FLOW_TEST_SKIP_MARKER, streamChatWithAgent } from '@/services/agent-stream';
import {
  downloadInterviewReportMarkdown,
  fetchInterviewReportStatus,
  markInterviewReportRead,
  submitInterviewFeedbackViaBff,
} from '@/services/bff-api';
import { sanitizeAssistantContent } from '@/services/assistant-content';
import {
  buildPersistedInterviewSession,
  clearPersistedInterviewSession,
  readPersistedInterviewSession,
  savePersistedInterviewSession,
  type PersistedInterviewSession,
} from '@/services/interview-session-storage';
import {
  buildRestoredInterviewState,
  canRestorePersistedInterviewSession,
  formatInterviewSessionRecoverySummary,
  getInterviewSessionRecoveryTitle,
  isInvalidRecoveredSessionError,
} from '@/services/interview-session-recovery';
import {
  formatCurrentQuestion,
  formatCurrentStage,
  formatRemainingQuestions,
} from '@/services/interview-progress-display';
import {
  formatInterviewJobDescriptionSummary,
  formatInterviewStartStatus,
  INTERVIEW_JOB_DESCRIPTION_SETUP_DESCRIPTION,
} from '@/services/interview-job-description-display';
import {
  createSpeechRecognitionSession,
  getInterviewSpeechRecognitionProfile,
  isSpeechRecognitionSupported as detectSpeechRecognitionSupport,
  type SpeechRecognitionSession,
  type SpeechRecognitionTranscript,
} from '@/services/speech-recognition';
import { createStartInterviewRequest } from '@/services/interview-start-request';
import InterviewReportBell from '@/components/InterviewReportBell.vue';
import { useResumeUploadStore } from '@/stores/upload';
import type {
  AgentChatMessage,
  ProfessionalQuestionMode,
  InterviewRoundPreference,
  InterviewSystemSettings,
  InterviewReportStatus,
  InterviewStateSnapshot,
} from '@/types/agent';

const FLOW_TEST_SKIP_DISPLAY_TEXT = '流程测试已跳过手动作答，系统正在生成示例回答...';
const REPORT_STATUS_POLL_INTERVAL_MS = 2000;

type PendingAction = 'start-interview' | 'send-answer' | null;
type FeedbackSubmitState = 'idle' | 'submitting' | 'submitted';

const router = useRouter();
const uploadStore = useResumeUploadStore();
const conversation = ref<AgentChatMessage[]>([]);
const errorMessage = ref('');
const interviewThreadId = ref<string | null>(null);
const historyContainer = ref<HTMLDivElement | null>(null);
const message = ref('');
const interviewState = ref<InterviewStateSnapshot | null>(null);
const recentInterviewSession = ref<PersistedInterviewSession | null>(readPersistedInterviewSession());
const activeInterviewSettings = ref<InterviewSystemSettings | null>(null);
const isRecoveredInterviewSession = ref(false);
const pendingAction = ref<PendingAction>(null);
const reviewIncorrectOrMissingPoints = ref(true);
const roundPreference = ref<InterviewRoundPreference>('no-skip');
const enableFlowTestMode = ref(false);
const professionalQuestionMode = ref<ProfessionalQuestionMode>(DEFAULT_PROFESSIONAL_QUESTION_MODE);
const professionalQuestionCount = ref(DEFAULT_PROFESSIONAL_QUESTION_COUNT);
const projectQuestionCount = ref(DEFAULT_PROJECT_QUESTION_COUNT);
const streamingAssistantId = ref<string | null>(null);
const speechRecognitionSession = ref<SpeechRecognitionSession | null>(null);
const speechRecognitionError = ref('');
const dictatedMessageBase = ref('');
const isSpeechRecognitionListening = ref(false);
const activeSpeechPointerId = ref<number | null>(null);
const overallExperienceScore = ref(4);
const questionFitScore = ref(4);
const difficultyScore = ref(4);
const feedbackComment = ref('');
const feedbackErrorMessage = ref('');
const feedbackSubmitState = ref<FeedbackSubmitState>('idle');
const reportStatus = ref<InterviewReportStatus | null>(null);
const reportStatusError = ref('');
const reportStatusPollTimer = ref<number | null>(null);
const isReportStatusLoading = ref(false);
const supportsSpeechRecognition = detectSpeechRecognitionSupport();
const speechRecognitionProfile = getInterviewSpeechRecognitionProfile();

const hasInterviewStarted = computed(() => interviewThreadId.value !== null);
const isInterviewCompleted = computed(() => interviewState.value?.finalReportReady ?? false);
const isInterviewEnded = computed(
  () =>
    isInterviewCompleted.value ||
    interviewState.value?.phase === 'wrap-up' ||
    interviewState.value?.phase === 'completed' ||
    interviewState.value?.progress.currentStage === 'completed',
);
const isLoading = computed(() => pendingAction.value !== null);
const interviewEntryState = computed(() => uploadStore.interviewEntryState);
const canRestoreRecentSession = computed(() => canRestorePersistedInterviewSession(recentInterviewSession.value));
const showSessionRecoveryPanel = computed(
  () => !hasInterviewStarted.value && recentInterviewSession.value !== null,
);
const showSetupPanel = computed(() => !hasInterviewStarted.value && interviewEntryState.value.canStartInterview);
const interviewProgress = computed(() => interviewState.value?.progress ?? null);
const showInterviewSidebar = computed(() => hasInterviewStarted.value || interviewState.value !== null);
const showFlowTestSkipButton = computed(() => hasInterviewStarted.value && enableFlowTestMode.value);
const showFeedbackPanel = computed(() => hasInterviewStarted.value && isInterviewCompleted.value);
const isFeedbackLocked = computed(() => feedbackSubmitState.value !== 'idle');
const isProfessionalRoundSkipped = computed(() => roundPreference.value === 'skip-professional-skills');
const isProjectRoundSkipped = computed(() => roundPreference.value === 'skip-project-experience');
const automaticProfessionalQuestionCount = computed(() => {
  if (isProfessionalRoundSkipped.value) {
    return 0;
  }

  const extractedSkillCount = interviewEntryState.value.professionalSkillGroupCount;
  if (extractedSkillCount > 0) {
    return Math.min(MAX_INTERVIEW_TOTAL_QUESTION_COUNT, extractedSkillCount);
  }

  return DEFAULT_PROFESSIONAL_QUESTION_COUNT;
});
const configuredProfessionalQuestionCount = computed(() =>
  isProfessionalRoundSkipped.value
    ? 0
    : professionalQuestionMode.value === 'per-skill-default'
      ? automaticProfessionalQuestionCount.value
      : professionalQuestionCount.value,
);
const configuredProjectQuestionCount = computed(() =>
  isProjectRoundSkipped.value ? 0 : projectQuestionCount.value,
);
const configuredQuestionCount = computed(() =>
  configuredProfessionalQuestionCount.value + configuredProjectQuestionCount.value,
);
const interviewSettingsValidationError = computed(() => {
  if (configuredQuestionCount.value > MAX_INTERVIEW_TOTAL_QUESTION_COUNT) {
    return `两轮主问题总数不能超过 ${MAX_INTERVIEW_TOTAL_QUESTION_COUNT} 道。`;
  }

  return null;
});
const startStatusText = computed(() => {
  return formatInterviewStartStatus({
    hasJobDescriptionValidationError: interviewEntryState.value.hasJobDescriptionValidationError,
    canStartInterview: interviewEntryState.value.canStartInterview,
    resumeFileName: interviewEntryState.value.resumeFileName,
    jobDescriptionFileName: interviewEntryState.value.jobDescriptionFileName,
  });
});
const primaryButtonLabel = computed(() => {
  if (!hasInterviewStarted.value) {
    if (pendingAction.value === 'start-interview') {
      return '正在开始面试...';
    }

    return '开始面试';
  }

  if (isInterviewEnded.value) {
    return '面试已完成';
  }

  return pendingAction.value === 'send-answer' ? '发送中...' : '发送回答';
});
const feedbackSubmitButtonLabel = computed(() => {
  if (feedbackSubmitState.value === 'submitting') {
    return '正在保存反馈...';
  }

  if (feedbackSubmitState.value === 'submitted') {
    return '反馈已保存';
  }

  return '保存反馈';
});
const isPrimaryButtonDisabled = computed(() => {
  if (isLoading.value || isSpeechRecognitionListening.value) {
    return true;
  }

  if (!hasInterviewStarted.value) {
    return !interviewEntryState.value.canStartInterview || interviewSettingsValidationError.value !== null;
  }

  if (isInterviewEnded.value) {
    return true;
  }

  return false;
});
const setupSummary = computed(() => {
  if (!interviewEntryState.value.canStartInterview) {
    return null;
  }

  const roundText =
    roundPreference.value === 'skip-professional-skills'
      ? '默认跳过第一轮专业技能面试'
      : roundPreference.value === 'skip-project-experience'
        ? '默认跳过第二轮项目经历面试'
        : '完整进行两轮面试';
  const questionCountText = `专业技能轮 ${configuredProfessionalQuestionCount.value} 题，项目经历轮 ${configuredProjectQuestionCount.value} 题，共 ${configuredQuestionCount.value} 道主问题`;
  const professionalModeText =
    professionalQuestionMode.value === 'per-skill-default'
      ? `专业技能轮按简历中的 ${automaticProfessionalQuestionCount.value} 个技能组逐条召回`
      : '专业技能轮按自定义题数优先覆盖不同技能，超出后补充综合场景题';
  const reviewText = reviewIncorrectOrMissingPoints.value ? '每题结束后给出纠错与漏答提醒' : '不在单题后给出纠错提醒';
  const flowTestText = enableFlowTestMode.value ? '流程测试模式已开启，可跳过用户回答' : '流程测试模式关闭';
  const jobDescriptionText = formatInterviewJobDescriptionSummary(interviewEntryState.value.jobDescriptionFileName);

  return `${professionalModeText}｜${questionCountText}｜${roundText}｜${reviewText}｜${flowTestText}｜${jobDescriptionText}`;
});
const remainingQuestionsDisplay = computed(() => {
  return formatRemainingQuestions(interviewProgress.value);
});
const currentStageDisplay = computed(() => {
  return formatCurrentStage({
    progress: interviewProgress.value,
    interviewState: interviewState.value,
  });
});
const currentQuestionDisplay = computed(() => {
  return formatCurrentQuestion(interviewProgress.value);
});
const speechRecognitionButtonLabel = computed(() =>
  isSpeechRecognitionListening.value ? '松开结束' : '按住说话',
);
const speechRecognitionStatusText = computed(() => {
  if (!supportsSpeechRecognition) {
    return '当前浏览器不支持语音输入，建议使用最新版 Chrome 或 Edge。';
  }

  if (speechRecognitionError.value) {
    return speechRecognitionError.value;
  }

  if (isSpeechRecognitionListening.value) {
    return `正在听写，按住继续说话，松开后自动停止。${speechRecognitionProfile.description}`;
  }

  return `按住“按住说话”开始语音输入，松开后自动结束。${speechRecognitionProfile.description}`;
});
const sessionRecoveryTitle = computed(() => getInterviewSessionRecoveryTitle(recentInterviewSession.value));
const sessionRecoverySummary = computed(() => {
  const session = recentInterviewSession.value;
  if (!session) {
    return '';
  }

  return formatInterviewSessionRecoverySummary(session);
});

function logInterviewEvent(event: string, details?: Record<string, unknown>): void {
  if (details) {
    console.info(`[agent-chat] ${event}`, details);
    return;
  }

  console.info(`[agent-chat] ${event}`);
}

function createMessage(role: AgentChatMessage['role'], content: string): AgentChatMessage {
  return {
    id: `${role}-${crypto.randomUUID()}`,
    role,
    content,
  };
}

function isStreamingEntry(messageId: string): boolean {
  return streamingAssistantId.value === messageId;
}

function joinComposedAnswer(baseText: string, dictatedText: string): string {
  const trimmedDictatedText = dictatedText.trim();
  if (!trimmedDictatedText) {
    return baseText;
  }

  if (!baseText.trim()) {
    return trimmedDictatedText;
  }

  if (baseText.endsWith(' ') || baseText.endsWith('\n')) {
    return `${baseText}${trimmedDictatedText}`;
  }

  return `${baseText} ${trimmedDictatedText}`;
}

function syncMessageWithSpeechTranscript(transcript: SpeechRecognitionTranscript): void {
  const combinedTranscript = [transcript.finalTranscript, transcript.interimTranscript]
    .filter((text) => text.length > 0)
    .join(' ')
    .trim();

  message.value = joinComposedAnswer(dictatedMessageBase.value, combinedTranscript);
}

function setAssistantText(messageId: string, text: string): void {
  conversation.value = conversation.value.map((entry) => {
    if (entry.id !== messageId) {
      return entry;
    }

    return {
      ...entry,
      content: sanitizeAssistantContent(text),
    };
  });
}

function syncAssistantMessageWithInterviewState(messageId: string, state: InterviewStateSnapshot): void {
  interviewState.value = state;

  if (interviewThreadId.value && activeInterviewSettings.value) {
    const persistedSession = buildPersistedInterviewSession({
      threadId: interviewThreadId.value,
      settings: activeInterviewSettings.value,
      interviewState: state,
    });

    savePersistedInterviewSession(persistedSession);
    recentInterviewSession.value = persistedSession;
  }

  if (state.assistantReply.trim()) {
    setAssistantText(messageId, state.assistantReply);
  }
}

function setUserText(messageId: string, text: string): void {
  conversation.value = conversation.value.map((entry) => {
    if (entry.id !== messageId) {
      return entry;
    }

    return {
      ...entry,
      content: text.trim(),
    };
  });
}

async function scrollConversationToBottom(): Promise<void> {
  await nextTick();
  const container = historyContainer.value;
  if (!container) {
    return;
  }

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
    return;
  }

  container.scrollTop = container.scrollHeight;
}

function clearConversation(): void {
  stopReportStatusPolling();
  stopSpeechRecognition();
  clearPersistedInterviewSession();
  recentInterviewSession.value = null;
  conversation.value = [];
  errorMessage.value = '';
  interviewThreadId.value = null;
  interviewState.value = null;
  activeInterviewSettings.value = null;
  isRecoveredInterviewSession.value = false;
  message.value = '';
  streamingAssistantId.value = null;
  speechRecognitionError.value = '';
  overallExperienceScore.value = 4;
  questionFitScore.value = 4;
  difficultyScore.value = 4;
  feedbackComment.value = '';
  feedbackErrorMessage.value = '';
  feedbackSubmitState.value = 'idle';
  reportStatus.value = null;
  reportStatusError.value = '';
  isReportStatusLoading.value = false;
}

function restoreRecentInterviewSession(): void {
  const session = recentInterviewSession.value;
  if (!session || session.summary.finalReportReady) {
    return;
  }

  interviewThreadId.value = session.threadId;
  activeInterviewSettings.value = session.settings;
  isRecoveredInterviewSession.value = true;
  interviewState.value = buildRestoredInterviewState(session);
  conversation.value = session.summary.assistantReply.trim()
    ? [createMessage('assistant', session.summary.assistantReply)]
    : [];
  errorMessage.value = '';
  feedbackErrorMessage.value = '';
  feedbackSubmitState.value = 'idle';
  reportStatus.value = null;
  reportStatusError.value = '';
  logInterviewEvent('interview:restore', {
    threadId: session.threadId,
    updatedAt: session.updatedAt,
  });
}

async function refreshReportStatus(): Promise<void> {
  if (!interviewThreadId.value || isReportStatusLoading.value) {
    return;
  }

  isReportStatusLoading.value = true;
  reportStatusError.value = '';

  try {
    const status = await fetchInterviewReportStatus(interviewThreadId.value);
    reportStatus.value = status;

    if (status.reportState === 'ready' || status.reportState === 'failed') {
      stopReportStatusPolling();
    }
  } catch (error: unknown) {
    reportStatusError.value = error instanceof Error ? error.message : '报告状态获取失败。';
  } finally {
    isReportStatusLoading.value = false;
  }
}

function startReportStatusPolling(): void {
  if (!interviewThreadId.value || reportStatusPollTimer.value !== null) {
    return;
  }

  void refreshReportStatus();
  reportStatusPollTimer.value = window.setInterval(() => {
    void refreshReportStatus();
  }, REPORT_STATUS_POLL_INTERVAL_MS);
}

function stopReportStatusPolling(): void {
  if (reportStatusPollTimer.value === null) {
    return;
  }

  window.clearInterval(reportStatusPollTimer.value);
  reportStatusPollTimer.value = null;
}

async function handleReportBellOpened(): Promise<void> {
  if (!interviewThreadId.value) {
    return;
  }

  if (reportStatus.value?.reportState === 'ready' && reportStatus.value.unreadCount > 0) {
    await markInterviewReportRead(interviewThreadId.value);
    await refreshReportStatus();
    return;
  }

  await refreshReportStatus();
}

async function downloadReportMarkdown(): Promise<void> {
  if (!interviewThreadId.value) {
    return;
  }

  try {
    const download = await downloadInterviewReportMarkdown(interviewThreadId.value);
    const url = URL.createObjectURL(download.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = download.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    await markInterviewReportRead(interviewThreadId.value);
    await refreshReportStatus();
  } catch (error: unknown) {
    reportStatusError.value = error instanceof Error ? error.message : '报告下载失败。';
  }
}

async function discardRecentInterviewSession(): Promise<void> {
  clearPersistedInterviewSession();
  recentInterviewSession.value = null;

  if (hasInterviewStarted.value) {
    clearConversation();
    return;
  }

  errorMessage.value = '已清除最近一次面试记录，请重新上传简历后开始新的面试。';
  await router.push({ name: 'resume-upload' });
}

function stopSpeechRecognition(): void {
  activeSpeechPointerId.value = null;
  speechRecognitionSession.value?.stop();
}

function startSpeechRecognition(): boolean {
  if (!supportsSpeechRecognition) {
    speechRecognitionError.value = '当前浏览器不支持语音输入，建议使用最新版 Chrome 或 Edge。';
    return false;
  }

  speechRecognitionError.value = '';
  dictatedMessageBase.value = message.value;

  const session = createSpeechRecognitionSession({
    lang: speechRecognitionProfile.lang,
    onStart: () => {
      isSpeechRecognitionListening.value = true;
    },
    onEnd: () => {
      isSpeechRecognitionListening.value = false;
      activeSpeechPointerId.value = null;
      speechRecognitionSession.value = null;
    },
    onError: (messageText) => {
      speechRecognitionError.value = messageText;
    },
    onTranscript: (transcript) => {
      speechRecognitionError.value = '';
      syncMessageWithSpeechTranscript(transcript);
    },
  });

  if (!session) {
    speechRecognitionError.value = '当前浏览器不支持语音输入，建议使用最新版 Chrome 或 Edge。';
    return false;
  }

  speechRecognitionSession.value = session;
  if (!session.start()) {
    speechRecognitionSession.value = null;
    return false;
  }

  return true;
}

function handleSpeechRecognitionPress(event: PointerEvent): void {
  if (activeSpeechPointerId.value !== null || isLoading.value || isSpeechRecognitionListening.value) {
    return;
  }

  if (!startSpeechRecognition()) {
    return;
  }

  activeSpeechPointerId.value = event.pointerId;
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    target.setPointerCapture(event.pointerId);
  }
}

function handleSpeechRecognitionRelease(event: PointerEvent): void {
  if (activeSpeechPointerId.value === null || event.pointerId !== activeSpeechPointerId.value) {
    return;
  }

  stopSpeechRecognition();
}

async function startInterview(): Promise<void> {
  if (!uploadStore.interviewResume) {
    errorMessage.value = '请先上传并校验简历，然后再开始面试。';
    return;
  }

  const threadId = crypto.randomUUID();
  const assistantMessage = createMessage('assistant', '');
  let settings;

  try {
    settings = buildInterviewSystemSettings({
      reviewIncorrectOrMissingPoints: reviewIncorrectOrMissingPoints.value,
      roundPreference: roundPreference.value,
      enableFlowTestMode: enableFlowTestMode.value,
      professionalQuestionMode: professionalQuestionMode.value,
      professionalQuestionCount: configuredProfessionalQuestionCount.value,
      projectQuestionCount: projectQuestionCount.value,
    });
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '面试设置无效，请检查题目数量配置。';
    return;
  }

  pendingAction.value = 'start-interview';
  errorMessage.value = '';
  interviewThreadId.value = threadId;
  interviewState.value = null;
  activeInterviewSettings.value = settings;
  isRecoveredInterviewSession.value = false;
  streamingAssistantId.value = assistantMessage.id;
  conversation.value = [assistantMessage];
  logInterviewEvent('interview:start', {
    threadId,
    settings,
  });

  try {
    const streamResult = await streamChatWithAgent({
      request: createStartInterviewRequest({
        threadId,
        resumeMarkdown: uploadStore.interviewResume.markdown,
        jobDescriptionMarkdown: uploadStore.interviewResume.jobDescriptionMarkdown,
        settings,
      }),
      onInterviewState: (state) => {
        syncAssistantMessageWithInterviewState(assistantMessage.id, state);
      },
    });

    if (streamResult.interviewState) {
      syncAssistantMessageWithInterviewState(assistantMessage.id, streamResult.interviewState);
    }

    if (streamResult.authoritativeAssistantReply) {
      setAssistantText(assistantMessage.id, streamResult.authoritativeAssistantReply);
    }
    isRecoveredInterviewSession.value = false;
    logInterviewEvent('interview:start:complete', {
      threadId,
      finalReportReady: streamResult.interviewState?.finalReportReady ?? false,
    });
  } catch (error: unknown) {
    clearConversation();
    errorMessage.value = error instanceof Error ? error.message : '面试启动失败。';
    console.error('[agent-chat] interview:start:error', error);
  } finally {
    pendingAction.value = null;
    streamingAssistantId.value = null;
  }
}

async function sendAnswer(options?: {
  readonly requestMessage?: string;
  readonly displayMessage?: string;
  readonly isFlowTestSkip?: boolean;
}): Promise<void> {
  const requestMessage = options?.requestMessage ?? message.value.trim();
  const displayMessage = options?.displayMessage ?? requestMessage;

  if (!requestMessage) {
    errorMessage.value = '请输入回答内容后再继续面试。';
    return;
  }

  if (!interviewThreadId.value) {
    errorMessage.value = '请先开始面试，再发送回答。';
    return;
  }

  pendingAction.value = 'send-answer';
  errorMessage.value = '';

  const userMessage = createMessage('user', displayMessage);
  const assistantMessage = createMessage('assistant', '');

  conversation.value = [...conversation.value, userMessage, assistantMessage];
  message.value = '';
  streamingAssistantId.value = assistantMessage.id;
  logInterviewEvent(options?.isFlowTestSkip ? 'answer:skip' : 'answer:send', {
    threadId: interviewThreadId.value,
    requestMessage,
    displayMessage,
  });

  try {
    const streamResult = await streamChatWithAgent({
      request: {
        threadId: interviewThreadId.value,
        message: requestMessage,
      },
      onInterviewState: (state) => {
        syncAssistantMessageWithInterviewState(assistantMessage.id, state);
      },
    });

    if (streamResult.interviewState) {
      syncAssistantMessageWithInterviewState(assistantMessage.id, streamResult.interviewState);
    }

    if (options?.isFlowTestSkip && streamResult.flowTestMockUserReply) {
      setUserText(userMessage.id, streamResult.flowTestMockUserReply);
    }

    if (streamResult.authoritativeAssistantReply) {
      setAssistantText(assistantMessage.id, streamResult.authoritativeAssistantReply);
    }
    isRecoveredInterviewSession.value = false;
    logInterviewEvent(options?.isFlowTestSkip ? 'answer:skip:complete' : 'answer:send:complete', {
      threadId: interviewThreadId.value,
      finalReportReady: streamResult.interviewState?.finalReportReady ?? false,
    });
  } catch (error: unknown) {
    conversation.value = conversation.value.filter((entry) => entry.id !== assistantMessage.id);
    const resolvedErrorMessage = error instanceof Error ? error.message : '面试请求失败。';

    if (isRecoveredInterviewSession.value && isInvalidRecoveredSessionError(resolvedErrorMessage)) {
      clearConversation();
      errorMessage.value = '未能恢复上次面试，会话可能已在后端失效。本地记录已清理，请重新上传简历后重新开始。';

      if (!uploadStore.interviewEntryState.canStartInterview) {
        await router.push({ name: 'resume-upload' });
      }

      return;
    }

    errorMessage.value = resolvedErrorMessage;
    message.value = options?.isFlowTestSkip ? '' : requestMessage;
    console.error(options?.isFlowTestSkip ? '[agent-chat] answer:skip:error' : '[agent-chat] answer:send:error', error);
  } finally {
    pendingAction.value = null;
    streamingAssistantId.value = null;
  }
}

async function skipAnswerInFlowTestMode(): Promise<void> {
  await sendAnswer({
    requestMessage: FLOW_TEST_SKIP_MARKER,
    displayMessage: FLOW_TEST_SKIP_DISPLAY_TEXT,
    isFlowTestSkip: true,
  });
}

async function submitInterviewFeedback(): Promise<void> {
  if (!interviewThreadId.value) {
    feedbackErrorMessage.value = '缺少面试线程信息，暂时无法提交反馈。';
    return;
  }

  feedbackErrorMessage.value = '';
  feedbackSubmitState.value = 'submitting';

  try {
    const payload = buildInterviewFeedbackPayload({
      threadId: interviewThreadId.value,
      overallExperienceScore: overallExperienceScore.value,
      questionFitScore: questionFitScore.value,
      difficultyScore: difficultyScore.value,
      comment: feedbackComment.value,
    });
    const result = await submitInterviewFeedbackViaBff(payload);

    feedbackSubmitState.value = 'submitted';
    logInterviewEvent('interview:feedback:submitted', {
      threadId: interviewThreadId.value,
      savedAt: result.savedAt,
    });
  } catch (error: unknown) {
    feedbackSubmitState.value = 'idle';
    feedbackErrorMessage.value = error instanceof Error ? error.message : '反馈提交失败。';
    console.error('[agent-chat] interview:feedback:error', error);
  }
}

async function onPrimaryAction(): Promise<void> {
  if (!hasInterviewStarted.value) {
    await startInterview();
    return;
  }

  await sendAnswer();
}

watch(
  () => uploadStore.interviewResume,
  (resume) => {
    if (!resume) {
      reviewIncorrectOrMissingPoints.value = true;
      roundPreference.value = 'no-skip';
      enableFlowTestMode.value = false;
      professionalQuestionMode.value = DEFAULT_PROFESSIONAL_QUESTION_MODE;
      professionalQuestionCount.value = DEFAULT_PROFESSIONAL_QUESTION_COUNT;
      projectQuestionCount.value = DEFAULT_PROJECT_QUESTION_COUNT;
      return;
    }

    reviewIncorrectOrMissingPoints.value = true;
    roundPreference.value = 'no-skip';
    enableFlowTestMode.value = false;
    professionalQuestionMode.value = DEFAULT_PROFESSIONAL_QUESTION_MODE;
    professionalQuestionCount.value = DEFAULT_PROFESSIONAL_QUESTION_COUNT;
    projectQuestionCount.value = DEFAULT_PROJECT_QUESTION_COUNT;
  },
  { immediate: true },
);

watch(
  conversation,
  async () => {
    await scrollConversationToBottom();
  },
  { deep: true },
);

watch(
  () => [interviewThreadId.value, isInterviewEnded.value, reportStatus.value?.reportState] as const,
  ([threadId, ended, state]) => {
    if (!threadId || !ended || state === 'ready' || state === 'failed') {
      stopReportStatusPolling();
      return;
    }

    startReportStatusPolling();
  },
);

onBeforeUnmount(() => {
  stopReportStatusPolling();
  speechRecognitionSession.value?.abort();
});
</script>
