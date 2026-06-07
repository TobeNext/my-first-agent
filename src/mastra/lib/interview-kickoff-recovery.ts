import { initializeInterviewSession } from './interview-state-machine';
import type {
  InterviewQuestionCandidate,
  InterviewSessionState,
} from './interview-state-machine-schema';
import {
  parseInterviewStartRequest,
  type InterviewStartRequest,
} from '../../../bff/src/modules/agent/interview-start-contract';
import {
  parseResumeMarkdown,
  parseResumeSections,
  type ParsedResumeMarkdown,
} from '../../../bff/src/modules/resume/resume-parser';

const RESUME_MARKDOWN_MARKER = 'Resume Markdown:';
const JOB_DESCRIPTION_MARKDOWN_MARKER = 'Job Description Markdown:';

export function extractStructuredInterviewStartRequest(rawKickoffMessage: string): InterviewStartRequest | null {
  return parseInterviewStartRequest(rawKickoffMessage);
}

export function detectKickoffPayloadFormat(rawKickoffMessage: string): 'structured-start-v1' | 'legacy-kickoff' | 'freeform' {
  if (extractStructuredInterviewStartRequest(rawKickoffMessage)) {
    return 'structured-start-v1';
  }

  if (
    rawKickoffMessage.includes(RESUME_MARKDOWN_MARKER) ||
    rawKickoffMessage.includes(JOB_DESCRIPTION_MARKDOWN_MARKER) ||
    /Selected interview direction:/i.test(rawKickoffMessage)
  ) {
    return 'legacy-kickoff';
  }

  return 'freeform';
}

export function extractResumeMarkdownFromKickoffMessage(rawKickoffMessage: string): string {
  const structuredStartRequest = extractStructuredInterviewStartRequest(rawKickoffMessage);
  if (structuredStartRequest) {
    return structuredStartRequest.resumeMarkdown;
  }

  const markerIndex = rawKickoffMessage.indexOf(RESUME_MARKDOWN_MARKER);
  if (markerIndex === -1) {
    return '';
  }

  const jobDescriptionMarkerIndex = rawKickoffMessage.indexOf(JOB_DESCRIPTION_MARKDOWN_MARKER, markerIndex);
  const endIndex = jobDescriptionMarkerIndex === -1 ? rawKickoffMessage.length : jobDescriptionMarkerIndex;

  return rawKickoffMessage.slice(markerIndex + RESUME_MARKDOWN_MARKER.length, endIndex).trim();
}

export function extractJobDescriptionMarkdownFromKickoffMessage(rawKickoffMessage: string): string {
  const structuredStartRequest = extractStructuredInterviewStartRequest(rawKickoffMessage);
  if (structuredStartRequest) {
    return structuredStartRequest.jobDescriptionMarkdown;
  }

  const markerIndex = rawKickoffMessage.indexOf(JOB_DESCRIPTION_MARKDOWN_MARKER);
  if (markerIndex === -1) {
    return '';
  }

  return rawKickoffMessage.slice(markerIndex + JOB_DESCRIPTION_MARKDOWN_MARKER.length).trim();
}

export function extractMarkdownSection(markdown: string, heading: string): string {
  const parsedResume = parseResumeMarkdown(markdown);
  if (heading === '专业技能') {
    return parsedResume.professionalSkillsSection;
  }

  if (heading === '项目经历') {
    return parsedResume.projectExperienceSection;
  }

  return '';
}

export function extractParsedResumeFromKickoffMessage(rawKickoffMessage: string): ParsedResumeMarkdown {
  const structuredStartRequest = extractStructuredInterviewStartRequest(rawKickoffMessage);
  if (structuredStartRequest?.resumeSections) {
    return parseResumeSections(structuredStartRequest.resumeSections);
  }

  return parseResumeMarkdown(extractResumeMarkdownFromKickoffMessage(rawKickoffMessage));
}

export function extractResumeSectionsFromKickoffMessage(rawKickoffMessage: string): {
  readonly professionalSkills: string;
  readonly projectExperience: string;
} {
  const parsedResume = extractParsedResumeFromKickoffMessage(rawKickoffMessage);

  return {
    professionalSkills: parsedResume.professionalSkillsSection,
    projectExperience: parsedResume.projectExperienceSection,
  };
}

export function recoverMissingInterviewSession(options: {
  readonly threadId: string;
  readonly rawKickoffMessage: string;
  readonly professionalSkills?: string;
  readonly projectExperience?: string;
  readonly normalizedProfessionalSkills?: readonly string[];
  readonly normalizedProjectTopics?: readonly string[];
  readonly jobDescription?: string;
  readonly professionalQuestions?: readonly InterviewQuestionCandidate[];
  readonly projectQuestions?: readonly InterviewQuestionCandidate[];
}): InterviewSessionState {
  const extractedResumeSections = extractResumeSectionsFromKickoffMessage(options.rawKickoffMessage);
  const parsedResume =
    options.professionalSkills !== undefined || options.projectExperience !== undefined
      ? parseResumeSections({
          professionalSkills: options.professionalSkills ?? extractedResumeSections.professionalSkills,
          projectExperience: options.projectExperience ?? extractedResumeSections.projectExperience,
        })
      : extractParsedResumeFromKickoffMessage(options.rawKickoffMessage);
  const resumeSections = {
    professionalSkills: parsedResume.professionalSkillsSection,
    projectExperience: parsedResume.projectExperienceSection,
    jobDescription:
      options.jobDescription ?? extractJobDescriptionMarkdownFromKickoffMessage(options.rawKickoffMessage),
  };

  return initializeInterviewSession({
    threadId: options.threadId,
    rawKickoffMessage: options.rawKickoffMessage,
    professionalSkills: resumeSections.professionalSkills,
    projectExperience: resumeSections.projectExperience,
    normalizedProfessionalSkills: options.normalizedProfessionalSkills ?? parsedResume.normalizedSkills,
    normalizedProjectTopics: options.normalizedProjectTopics ?? parsedResume.normalizedProjectTopics,
    jobDescription: resumeSections.jobDescription,
    professionalQuestions: options.professionalQuestions ?? [],
    projectQuestions: options.projectQuestions ?? [],
  });
}