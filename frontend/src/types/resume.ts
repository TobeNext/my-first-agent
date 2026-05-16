export interface ResumeValidationSuccess {
  readonly success: true;
  readonly fileName: string;
  readonly fileSize: number;
  readonly message: string;
  readonly source?: 'frontend' | 'bff';
}

export interface BffResumeValidationSuccess extends ResumeValidationSuccess {
  readonly professionalSkillGroupCount: number;
}

export interface ResumeValidationFailure {
  readonly success: false;
  readonly fileName: string;
  readonly fileSize: number;
  readonly message: string;
  readonly details?: readonly string[];
  readonly source?: 'frontend' | 'bff';
}

export type ResumeValidationResult = ResumeValidationSuccess | ResumeValidationFailure;
export type BffResumeValidationResult = BffResumeValidationSuccess | ResumeValidationFailure;

export interface ResumeUploadState {
  readonly maxFileSizeBytes: number;
  readonly localResult: ResumeValidationResult | null;
  readonly bffResult: BffResumeValidationResult | null;
}

export interface InterviewResumeContext {
  readonly fileName: string;
  readonly markdown: string;
  readonly professionalSkillGroupCount: number;
  readonly jobDescriptionFileName: string | null;
  readonly jobDescriptionMarkdown: string;
}