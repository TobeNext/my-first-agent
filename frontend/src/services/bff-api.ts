import type { InterviewFeedbackRequest, InterviewFeedbackResponse } from '@/types/agent';
import type { BffResumeValidationResult } from '@/types/resume';

import { parseHttpErrorPayload } from './http-error';

export async function validateResumeViaBff(file: File): Promise<BffResumeValidationResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/resume/validate', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorPayload = await parseHttpErrorPayload(response, {
      arrayMessageFallback: 'BFF 校验失败，请根据以下问题修改简历。',
    });
    return {
      success: false,
      fileName: file.name,
      fileSize: file.size,
      message: errorPayload.message,
      details: errorPayload.details,
      source: 'bff',
    };
  }

  const payload = (await response.json()) as {
    readonly success: true;
    readonly fileName: string;
    readonly fileSize: number;
    readonly message: string;
    readonly professionalSkillGroupCount: number;
  };

  return {
    ...payload,
    source: 'bff',
  };
}

export async function submitInterviewFeedbackViaBff(
  payload: InterviewFeedbackRequest,
): Promise<InterviewFeedbackResponse> {
  const response = await fetch('/api/agents/interview-feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await parseHttpErrorPayload(response);
    throw new Error(errorPayload.details?.[0] ?? errorPayload.message);
  }

  return (await response.json()) as InterviewFeedbackResponse;
}
