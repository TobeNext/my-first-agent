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
        <p class="upload-card__eyebrow">AI 面试</p>
        <h1>模拟面试</h1>
      </div>

      <p v-if="!hasInterviewStarted" class="agent-card__status-text">
        {{ startStatusText }}
      </p>

      <section v-if="showSetupPanel" class="agent-card__setup">
        <div class="agent-card__setup-header">
          <div>
            <p class="agent-card__setup-eyebrow">面试配置</p>
            <h2 class="agent-card__setup-title">确认系统设置</h2>
          </div>
          <p class="agent-card__setup-description">
            未上传职位 JD 时，专业技能轮默认按简历中的技能组逐条触发 RAG 召回；若上传 JD，则该内容会作为扩展上下文预留给后续流程。
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

      <div v-if="hasInterviewStarted && !isInterviewCompleted" class="agent-card__composer">
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
import { submitInterviewFeedbackViaBff } from '@/services/bff-api';
import {
  formatCurrentQuestion,
  formatCurrentStage,
  formatRemainingQuestions,
} from '@/services/interview-progress-display';
import {
  createSpeechRecognitionSession,
  getInterviewSpeechRecognitionProfile,
  isSpeechRecognitionSupported as detectSpeechRecognitionSupport,
  type SpeechRecognitionSession,
  type SpeechRecognitionTranscript,
} from '@/services/speech-recognition';
import { useResumeUploadStore } from '@/stores/upload';
import type {
  AgentChatMessage,
  ProfessionalQuestionMode,
  InterviewRoundPreference,
  InterviewStateSnapshot,
} from '@/types/agent';

const HIDDEN_ASSISTANT_TEXT = "I'll parse your resume first to understand your professional skills and project experience before starting the interview.";
const FLOW_TEST_SKIP_DISPLAY_TEXT = '流程测试已跳过手动作答，系统正在生成示例回答...';

type PendingAction = 'start-interview' | 'send-answer' | null;
type FeedbackSubmitState = 'idle' | 'submitting' | 'submitted';

const uploadStore = useResumeUploadStore();
const conversation = ref<AgentChatMessage[]>([]);
const errorMessage = ref('');
const interviewThreadId = ref<string | null>(null);
const historyContainer = ref<HTMLDivElement | null>(null);
const message = ref('');
const interviewState = ref<InterviewStateSnapshot | null>(null);
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
const supportsSpeechRecognition = detectSpeechRecognitionSupport();
const speechRecognitionProfile = getInterviewSpeechRecognitionProfile();

const hasInterviewStarted = computed(() => interviewThreadId.value !== null);
const isInterviewCompleted = computed(() => interviewState.value?.finalReportReady ?? false);
const isLoading = computed(() => pendingAction.value !== null);
const showSetupPanel = computed(() => !hasInterviewStarted.value && uploadStore.canStartInterview);
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

  const extractedSkillCount = uploadStore.professionalSkillCount;
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
  if (uploadStore.jobDescriptionResult && !uploadStore.jobDescriptionResult.success) {
    return '职位 JD 为选填项，但当前上传文件未通过校验。请修正或清空该文件后再开始面试。';
  }

  if (uploadStore.canStartInterview) {
    if (uploadStore.interviewResume?.jobDescriptionFileName) {
      return `简历已就绪：${uploadStore.interviewResume.fileName}；职位 JD 已就绪：${uploadStore.interviewResume.jobDescriptionFileName}。JD 会随启动请求一并透传，具体扩展方式后续补充。`;
    }

    return `简历已就绪：${uploadStore.interviewResume?.fileName ?? ''}。未上传职位 JD 时，将继续沿用现有 RAG 方式。`;
  }

  return '请先上传并校验简历，然后再开始面试。';
});
const primaryButtonLabel = computed(() => {
  if (!hasInterviewStarted.value) {
    if (pendingAction.value === 'start-interview') {
      return '正在开始面试...';
    }

    return '开始面试';
  }

  if (isInterviewCompleted.value) {
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
    return !uploadStore.canStartInterview || interviewSettingsValidationError.value !== null;
  }

  if (isInterviewCompleted.value) {
    return true;
  }

  return false;
});
const setupSummary = computed(() => {
  if (!uploadStore.canStartInterview) {
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
  const jobDescriptionText = uploadStore.interviewResume?.jobDescriptionFileName
    ? `职位 JD：${uploadStore.interviewResume.jobDescriptionFileName}（扩展上下文预留）`
    : '职位 JD：未上传，沿用当前简历 RAG 方式';

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

function sanitizeAssistantContent(content: string): string {
  return content
    .replaceAll(HIDDEN_ASSISTANT_TEXT, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  historyContainer.value?.scrollTo({
    top: historyContainer.value.scrollHeight,
    behavior: 'smooth',
  });
}

function clearConversation(): void {
  stopSpeechRecognition();
  conversation.value = [];
  errorMessage.value = '';
  interviewThreadId.value = null;
  interviewState.value = null;
  message.value = '';
  streamingAssistantId.value = null;
  speechRecognitionError.value = '';
  overallExperienceScore.value = 4;
  questionFitScore.value = 4;
  difficultyScore.value = 4;
  feedbackComment.value = '';
  feedbackErrorMessage.value = '';
  feedbackSubmitState.value = 'idle';
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
  streamingAssistantId.value = assistantMessage.id;
  conversation.value = [assistantMessage];
  logInterviewEvent('interview:start', {
    threadId,
    settings,
  });

  try {
    const streamResult = await streamChatWithAgent({
      request: {
        threadId,
        startInterview: true,
        resumeMarkdown: uploadStore.interviewResume.markdown,
        jobDescriptionMarkdown: uploadStore.interviewResume.jobDescriptionMarkdown,
        settings,
      },
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
    logInterviewEvent(options?.isFlowTestSkip ? 'answer:skip:complete' : 'answer:send:complete', {
      threadId: interviewThreadId.value,
      finalReportReady: streamResult.interviewState?.finalReportReady ?? false,
    });
  } catch (error: unknown) {
    conversation.value = conversation.value.filter((entry) => entry.id !== assistantMessage.id);
    errorMessage.value = error instanceof Error ? error.message : '面试请求失败。';
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

onBeforeUnmount(() => {
  speechRecognitionSession.value?.abort();
});
</script>