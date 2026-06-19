import type {
  InterviewStartRequest as CanonicalInterviewStartRequest,
  InterviewSystemSettings as CanonicalInterviewSystemSettings,
} from '../../../bff/src/modules/agent/interview-start-contract';

export type ChatRole = 'user' | 'assistant';

export interface AgentChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
}

export type InterviewRoundPreference = 'no-skip' | 'skip-professional-skills' | 'skip-project-experience';
export type ProfessionalQuestionMode = CanonicalInterviewSystemSettings['professionalQuestionMode'];
export type InterviewSystemSettings = CanonicalInterviewSystemSettings;

export type InterviewProgressStage = 'main-question' | 'follow-up' | 'completed';

export interface InterviewProgressSummary {
  readonly totalQuestionCount: number;
  readonly completedQuestionCount: number;
  readonly remainingQuestionCount: number;
  readonly currentQuestionIndex: number | null;
  readonly currentRoundType: 'professional-skills' | 'project-experience' | null;
  readonly currentRoundLabel: string | null;
  readonly currentStage: InterviewProgressStage;
  readonly currentFollowUpIndex: number | null;
  readonly currentQuestionText: string | null;
  readonly currentNodeTopic: string | null;
}

export interface InterviewStateSnapshot {
  readonly assistantReply: string;
  readonly flowTestMockUserReply: string | null;
  readonly phase: string;
  readonly activeRoundType: string | null;
  readonly activeNodeTopic: string | null;
  readonly finalReportReady: boolean;
  readonly progress: InterviewProgressSummary;
}

export type StartInterviewRequest = CanonicalInterviewStartRequest;

export interface ContinueInterviewRequest {
  readonly threadId: string;
  readonly message: string;
}

export type InterviewStreamRequest = StartInterviewRequest | ContinueInterviewRequest;

export interface StreamState {
  readonly isStarted: boolean;
  readonly streamingAssistantId: string | null;
}

export interface StreamCompletionResult {
  readonly authoritativeAssistantReply: string | null;
  readonly flowTestMockUserReply: string | null;
  readonly interviewState: InterviewStateSnapshot | null;
}

export interface InterviewFeedbackRequest {
  readonly threadId: string;
  readonly overallExperienceScore: number;
  readonly questionFitScore: number;
  readonly difficultyScore: number;
  readonly comment: string;
}

export interface InterviewFeedbackResponse {
  readonly success: true;
  readonly savedAt: string;
}

export type InterviewReportState = 'not-started' | 'generating' | 'ready' | 'failed';
export type InterviewReportBlockingReason = 'manifest-missing' | 'not-sealed' | 'pending' | 'failed' | 'timeout';

export interface InterviewReportStatus {
  readonly threadId: string;
  readonly reportState: InterviewReportState;
  readonly sealed: boolean;
  readonly expectedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly unreadCount: number;
  readonly markdownAvailable: boolean;
  readonly reportId: string | null;
  readonly updatedAt: string | null;
  readonly blockingReason?: InterviewReportBlockingReason | null;
}

export interface InterviewReportMarkdownDownload {
  readonly blob: Blob;
  readonly fileName: string;
}
