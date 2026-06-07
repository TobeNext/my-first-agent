<template>
  <section class="upload-card">
    <div class="upload-card__header">
      <p class="upload-card__eyebrow">信息上传</p>
      <h1>上传简历与职位 JD</h1>
      <p class="upload-card__description">
        简历为必填项，前端校验通过后会自动触发 BFF 二次校验。职位 JD 为选填项，未上传时默认为空。
        两类文件均支持 <strong>.md</strong>，大小上限为 <strong>{{ maxFileSizeLabel }}</strong>。
      </p>
      <a class="upload-card__template-link" href="/resume-template.md" download="resume-template.md">
        下载简历模板
      </a>
    </div>

    <div class="upload-card__section">
      <div class="upload-card__section-header">
        <h2 class="upload-card__section-title">简历文件</h2>
        <span class="upload-card__section-tag">必填</span>
      </div>

      <label class="upload-card__dropzone" for="resume-file-input">
        <span class="upload-card__dropzone-title">上传 Markdown 简历</span>
        <span class="upload-card__dropzone-text">
          从本地选择 Markdown 简历文件。前端校验通过后会自动触发 BFF 校验。
        </span>
        <input
          id="resume-file-input"
          ref="resumeFileInput"
          class="upload-card__input"
          type="file"
          accept=".md,text/markdown"
          @change="onResumeFileChange"
        />
      </label>

      <div v-if="selectedResumeFileName" class="upload-card__meta">
        <span>已选简历</span>
        <strong>{{ selectedResumeFileName }}</strong>
      </div>

      <div v-if="resumeValidationSummary" :class="['upload-card__result', resumeValidationSummary.success ? 'is-success' : 'is-error']">
        <p class="upload-card__result-title">{{ resumeValidationSummary.title }}</p>
        <p v-for="detail in resumeValidationSummary.details" :key="detail">{{ detail }}</p>
        <p v-if="resumeValidationSummary.fileName" class="upload-card__result-meta">
          {{ resumeValidationSummary.fileName }} · {{ formatFileSize(resumeValidationSummary.fileSize) }}
        </p>
      </div>
    </div>

    <div class="upload-card__section">
      <div class="upload-card__section-header">
        <h2 class="upload-card__section-title">职位 JD 文件</h2>
        <span class="upload-card__section-tag upload-card__section-tag--optional">选填</span>
      </div>

      <label class="upload-card__dropzone" for="job-description-file-input">
        <span class="upload-card__dropzone-title">上传 Markdown 职位 JD</span>
        <span class="upload-card__dropzone-text">
          不上传时默认为空，并继续沿用现有简历 RAG 方式；上传后会作为后续扩展流程的预留上下文。
        </span>
        <input
          id="job-description-file-input"
          ref="jobDescriptionFileInput"
          class="upload-card__input"
          type="file"
          accept=".md,text/markdown"
          @change="onJobDescriptionFileChange"
        />
      </label>

      <div v-if="selectedJobDescriptionFileName" class="upload-card__meta">
        <span>已选职位 JD</span>
        <strong>{{ selectedJobDescriptionFileName }}</strong>
      </div>

      <div
        v-if="jobDescriptionValidationSummary"
        :class="['upload-card__result', jobDescriptionValidationSummary.success ? 'is-success' : 'is-error']"
      >
        <p class="upload-card__result-title">{{ jobDescriptionValidationSummary.title }}</p>
        <p v-for="detail in jobDescriptionValidationSummary.details" :key="detail">{{ detail }}</p>
        <p v-if="jobDescriptionValidationSummary.fileName" class="upload-card__result-meta">
          {{ jobDescriptionValidationSummary.fileName }} · {{ formatFileSize(jobDescriptionValidationSummary.fileSize) }}
        </p>
      </div>
    </div>

    <div class="upload-card__note">
      未上传职位 JD 时，系统仅使用简历内容维持当前流程；上传职位 JD 后，文件内容会随面试启动请求一并透传，供后续扩展方式接入。
    </div>

    <div :class="['upload-card__ready', canEnterInterview ? 'is-ready' : 'is-pending']">
      <p class="upload-card__ready-title">{{ nextStepTitle }}</p>
      <p class="upload-card__ready-text">{{ nextStepDescription }}</p>
      <p v-if="canEnterInterview" class="upload-card__ready-meta">
        简历：{{ readyResumeFileName }}
        <span v-if="readyJobDescriptionFileName"> · 职位 JD：{{ readyJobDescriptionFileName }}</span>
      </p>
    </div>

    <div class="upload-card__actions">
      <button
        class="upload-card__button upload-card__button--primary"
        type="button"
        :disabled="!canEnterInterview"
        @click="onContinue"
      >
        {{ primaryActionLabel }}
      </button>
      <button class="upload-card__button upload-card__button--secondary" type="button" @click="onReset">
        重置
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatFileSize } from '@/services/resume-validation';
import { useResumeUploadStore } from '@/stores/upload';
import type { ResumeValidationResult } from '@/types/resume';

const emit = defineEmits<{
  continue: [];
}>();

const uploadStore = useResumeUploadStore();
const resumeFileInput = ref<HTMLInputElement | null>(null);
const jobDescriptionFileInput = ref<HTMLInputElement | null>(null);

const bffResult = computed(() => uploadStore.bffResult);
const canEnterInterview = computed(() => uploadStore.canStartInterview);
const isSubmitting = computed(() => uploadStore.isSubmitting);
const jobDescriptionResult = computed(() => uploadStore.jobDescriptionResult);
const localResult = computed(() => uploadStore.localResult);
const maxFileSizeLabel = computed(() => formatFileSize(uploadStore.maxFileSizeBytes));
const selectedResumeFileName = computed(() => uploadStore.selectedResumeFileName);
const selectedJobDescriptionFileName = computed(() => uploadStore.selectedJobDescriptionFileName);
const readyResumeFileName = computed(() => uploadStore.interviewResume?.fileName ?? selectedResumeFileName.value);
const readyJobDescriptionFileName = computed(
  () => uploadStore.interviewResume?.jobDescriptionFileName ?? selectedJobDescriptionFileName.value,
);
const nextStepTitle = computed(() =>
  canEnterInterview.value ? '已可进入面试配置' : '上传完成后可继续进入面试配置',
);
const nextStepDescription = computed(() => {
  if (isSubmitting.value) {
    return '简历正在经过 BFF 二次校验，完成后会自动解锁下一步。';
  }

  if (jobDescriptionResult.value && !jobDescriptionResult.value.success) {
    return '职位 JD 为选填项，但当前文件未通过校验。修正或清空后即可继续。';
  }

  if (canEnterInterview.value) {
    return readyJobDescriptionFileName.value
      ? '简历与职位 JD 已就绪。你现在可以继续进入面试配置。'
      : '简历已就绪。你现在可以继续进入面试配置；职位 JD 仍可保持为空。';
  }

  if (localResult.value?.success === false || bffResult.value?.success === false) {
    return '请先修正当前校验问题；只有简历通过校验后才会解锁下一步。';
  }

  return '请先上传并校验简历。职位 JD 为选填项，未上传不会阻止进入下一步。';
});
const primaryActionLabel = computed(() =>
  canEnterInterview.value ? '进入面试配置' : '请先完成简历校验',
);
const resumeValidationSummary = computed<{
  readonly success: boolean;
  readonly title: string;
  readonly details: readonly string[];
  readonly fileName: string;
  readonly fileSize: number;
} | null>(() => {
  const localValidation = localResult.value;
  if (!localValidation) {
    return null;
  }

  if (!localValidation.success) {
    return buildValidationSummary({
      success: false,
      title: '校验失败',
      details: [`前端校验：${localValidation.message}`],
      result: localValidation,
    });
  }

  if (isSubmitting.value) {
    return buildValidationSummary({
      success: true,
      title: '正在校验简历',
      details: [`前端校验：${localValidation.message}`, 'BFF 校验：正在校验简历元数据...'],
      result: localValidation,
    });
  }

  const bffValidation = bffResult.value;
  if (!bffValidation) {
    return buildValidationSummary({
      success: true,
      title: '正在等待校验结果',
      details: [`前端校验：${localValidation.message}`, 'BFF 校验：等待开始...'],
      result: localValidation,
    });
  }

  return buildValidationSummary({
    success: localValidation.success && bffValidation.success,
    title: bffValidation.success ? '前端与 BFF 校验通过' : '校验失败',
    details: bffValidation.success
      ? [`前端校验：${localValidation.message}`, `BFF 校验：${bffValidation.message}`]
      : [
          `前端校验：${localValidation.message}`,
          ...(bffValidation.details?.length
            ? bffValidation.details.map((detail) => `BFF 校验：${detail}`)
            : [`BFF 校验：${bffValidation.message}`]),
        ],
    result: bffValidation,
  });
});
const jobDescriptionValidationSummary = computed<{
  readonly success: boolean;
  readonly title: string;
  readonly details: readonly string[];
  readonly fileName: string;
  readonly fileSize: number;
} | null>(() => {
  const validation = jobDescriptionResult.value;
  if (!validation) {
    return null;
  }

  return buildValidationSummary({
    success: validation.success,
    title: validation.success ? '职位 JD 已就绪' : '职位 JD 校验失败',
    details: validation.success
      ? [validation.message, '该文件会作为面试启动时的扩展上下文预留，不会替代当前简历校验流程。']
      : [validation.message],
    result: validation,
  });
});

function buildValidationSummary(options: {
  readonly success: boolean;
  readonly title: string;
  readonly details: readonly string[];
  readonly result: ResumeValidationResult;
}): {
  readonly success: boolean;
  readonly title: string;
  readonly details: readonly string[];
  readonly fileName: string;
  readonly fileSize: number;
} {
  return {
    success: options.success,
    title: options.title,
    details: options.details,
    fileName: options.result.fileName,
    fileSize: options.result.fileSize,
  };
}

async function onResumeFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;

  await uploadStore.validateSelectedFile(file);
}

async function onJobDescriptionFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;

  await uploadStore.setJobDescriptionFile(file);
}

function onReset(): void {
  if (resumeFileInput.value) {
    resumeFileInput.value.value = '';
  }

  if (jobDescriptionFileInput.value) {
    jobDescriptionFileInput.value.value = '';
  }

  uploadStore.reset();
}

function onContinue(): void {
  if (!canEnterInterview.value) {
    return;
  }

  emit('continue');
}
</script>