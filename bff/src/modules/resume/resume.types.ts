export interface UploadedResumeFile {
  readonly originalname: string;
  readonly size: number;
  readonly buffer?: Buffer;
}

export interface ResumeValidationSuccessPayload {
  readonly success: true;
  readonly fileName: string;
  readonly fileSize: number;
  readonly message: string;
  readonly professionalSkillGroupCount: number;
}