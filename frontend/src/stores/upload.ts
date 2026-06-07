import { defineStore } from 'pinia';
import { computed } from 'vue';
import { ref } from 'vue';

import { validateResumeViaBff } from '@/services/bff-api';
import {
  getMarkdownUploadConstraints,
  validateJobDescriptionFile,
  validateResumeFile,
} from '@/services/resume-validation';
import type {
  BffResumeValidationResult,
  InterviewEntryState,
  InterviewResumeContext,
  ResumeValidationResult,
} from '@/types/resume';

export const useResumeUploadStore = defineStore('resumeUpload', () => {
  const constraints = getMarkdownUploadConstraints();
  const selectedFile = ref<File | null>(null);
  const selectedJobDescriptionFile = ref<File | null>(null);
  const localResult = ref<ResumeValidationResult | null>(null);
  const bffResult = ref<BffResumeValidationResult | null>(null);
  const jobDescriptionResult = ref<ResumeValidationResult | null>(null);
  const isSubmitting = ref(false);
  const interviewResume = ref<InterviewResumeContext | null>(null);
  const validationSessionId = ref(0);
  const jobDescriptionSessionId = ref(0);
  const jobDescriptionMarkdown = ref('');
  const canStartInterview = computed(
    () =>
      interviewResume.value !== null &&
      bffResult.value?.success === true &&
      (jobDescriptionResult.value === null || jobDescriptionResult.value.success),
  );
  const professionalSkillCount = computed(() => interviewResume.value?.professionalSkillGroupCount ?? 0);
  const selectedResumeFileName = computed(() => selectedFile.value?.name ?? '');
  const selectedJobDescriptionFileName = computed(() => selectedJobDescriptionFile.value?.name ?? '');
  const interviewEntryState = computed<InterviewEntryState>(() => ({
    canStartInterview: canStartInterview.value,
    hasJobDescriptionValidationError: jobDescriptionResult.value?.success === false,
    resumeFileName: interviewResume.value?.fileName ?? null,
    jobDescriptionFileName: interviewResume.value?.jobDescriptionFileName ?? null,
    professionalSkillGroupCount: professionalSkillCount.value,
  }));

  function syncInterviewResumeContext(): void {
    if (!interviewResume.value) {
      return;
    }

    interviewResume.value = {
      ...interviewResume.value,
      jobDescriptionFileName: jobDescriptionResult.value?.success ? jobDescriptionResult.value.fileName : null,
      jobDescriptionMarkdown: jobDescriptionResult.value?.success ? jobDescriptionMarkdown.value : '',
    };
  }

  async function validateSelectedFile(file: File | null): Promise<void> {
    const currentSessionId = validationSessionId.value + 1;
    validationSessionId.value = currentSessionId;
    selectedFile.value = file;
    bffResult.value = null;
    interviewResume.value = null;
    isSubmitting.value = false;

    if (!file) {
      localResult.value = {
        success: false,
        fileName: '',
        fileSize: 0,
        message: 'Please choose a resume file.',
        source: 'frontend',
      };
      return;
    }

    localResult.value = validateResumeFile(file);
    if (!localResult.value.success) {
      return;
    }

    await validateWithBff({
      file,
      sessionId: currentSessionId,
    });
  }

  async function validateWithBff(options?: {
    readonly file?: File | null;
    readonly sessionId?: number;
  }): Promise<void> {
    const file = options?.file ?? selectedFile.value;
    const sessionId = options?.sessionId ?? validationSessionId.value;

    if (!file) {
      bffResult.value = {
        success: false,
        fileName: '',
        fileSize: 0,
        message: 'Choose a file before sending it to the BFF.',
        source: 'bff',
      };
      return;
    }

    if (!localResult.value?.success) {
      bffResult.value = {
        success: false,
        fileName: file.name,
        fileSize: file.size,
        message: 'Fix the frontend validation errors before sending the file to the BFF.',
        source: 'bff',
      };
      return;
    }

    isSubmitting.value = true;
    try {
      const validationResult = await validateResumeViaBff(file);
      if (sessionId !== validationSessionId.value || selectedFile.value !== file) {
        return;
      }

      bffResult.value = validationResult;

      if (validationResult.success) {
        const markdown = await file.text();
        interviewResume.value = {
          fileName: file.name,
          markdown,
          professionalSkillGroupCount: validationResult.professionalSkillGroupCount,
          jobDescriptionFileName: jobDescriptionResult.value?.success ? jobDescriptionResult.value.fileName : null,
          jobDescriptionMarkdown: jobDescriptionResult.value?.success ? jobDescriptionMarkdown.value : '',
        };
      } else {
        interviewResume.value = null;
      }
    } finally {
      if (sessionId === validationSessionId.value) {
        isSubmitting.value = false;
      }
    }
  }

  async function setJobDescriptionFile(file: File | null): Promise<void> {
    const currentSessionId = jobDescriptionSessionId.value + 1;
    jobDescriptionSessionId.value = currentSessionId;
    selectedJobDescriptionFile.value = file;

    if (!file) {
      jobDescriptionResult.value = null;
      jobDescriptionMarkdown.value = '';
      syncInterviewResumeContext();
      return;
    }

    jobDescriptionResult.value = validateJobDescriptionFile(file);
    if (!jobDescriptionResult.value.success) {
      jobDescriptionMarkdown.value = '';
      syncInterviewResumeContext();
      return;
    }

    const markdown = await file.text();
    if (currentSessionId !== jobDescriptionSessionId.value || selectedJobDescriptionFile.value !== file) {
      return;
    }

    jobDescriptionMarkdown.value = markdown;
    syncInterviewResumeContext();
  }

  function reset(): void {
    validationSessionId.value += 1;
    jobDescriptionSessionId.value += 1;
    selectedFile.value = null;
    selectedJobDescriptionFile.value = null;
    localResult.value = null;
    bffResult.value = null;
    jobDescriptionResult.value = null;
    jobDescriptionMarkdown.value = '';
    interviewResume.value = null;
    isSubmitting.value = false;
  }

  return {
    maxFileSizeBytes: constraints.maxFileSizeBytes,
    bffResult,
    canStartInterview,
    interviewEntryState,
    interviewResume,
    isSubmitting,
    jobDescriptionResult,
    localResult,
    professionalSkillCount,
    reset,
    selectedJobDescriptionFileName,
    selectedResumeFileName,
    setJobDescriptionFile,
    validateSelectedFile,
    validateWithBff,
  };
});