import { initializeInterviewSession } from './interview-state-machine';
import type {
  InterviewQuestionCandidate,
  InterviewSessionState,
} from './interview-state-machine-schema';

const RESUME_MARKDOWN_MARKER = 'Resume Markdown:';
const JOB_DESCRIPTION_MARKDOWN_MARKER = 'Job Description Markdown:';

function normalizeSectionContent(content: string): string {
  return content.trim();
}

function isSectionHeading(line: string): boolean {
  return line.trimStart().startsWith('### ');
}

function getHeadingName(line: string): string {
  return line.trim().replace(/^###\s*/, '');
}

export function extractResumeMarkdownFromKickoffMessage(rawKickoffMessage: string): string {
  const markerIndex = rawKickoffMessage.indexOf(RESUME_MARKDOWN_MARKER);
  if (markerIndex === -1) {
    return '';
  }

  const jobDescriptionMarkerIndex = rawKickoffMessage.indexOf(JOB_DESCRIPTION_MARKDOWN_MARKER, markerIndex);
  const endIndex = jobDescriptionMarkerIndex === -1 ? rawKickoffMessage.length : jobDescriptionMarkerIndex;

  return rawKickoffMessage.slice(markerIndex + RESUME_MARKDOWN_MARKER.length, endIndex).trim();
}

export function extractJobDescriptionMarkdownFromKickoffMessage(rawKickoffMessage: string): string {
  const markerIndex = rawKickoffMessage.indexOf(JOB_DESCRIPTION_MARKDOWN_MARKER);
  if (markerIndex === -1) {
    return '';
  }

  return rawKickoffMessage.slice(markerIndex + JOB_DESCRIPTION_MARKDOWN_MARKER.length).trim();
}

export function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const contentLines: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (isSectionHeading(line)) {
      const currentHeading = getHeadingName(line);
      if (collecting) {
        break;
      }

      if (currentHeading === heading) {
        collecting = true;
      }

      continue;
    }

    if (collecting) {
      contentLines.push(line);
    }
  }

  return normalizeSectionContent(contentLines.join('\n'));
}

export function extractResumeSectionsFromKickoffMessage(rawKickoffMessage: string): {
  readonly professionalSkills: string;
  readonly projectExperience: string;
} {
  const resumeMarkdown = extractResumeMarkdownFromKickoffMessage(rawKickoffMessage);

  return {
    professionalSkills: extractMarkdownSection(resumeMarkdown, '专业技能'),
    projectExperience: extractMarkdownSection(resumeMarkdown, '项目经历'),
  };
}

export function recoverMissingInterviewSession(options: {
  readonly threadId: string;
  readonly rawKickoffMessage: string;
  readonly professionalSkills?: string;
  readonly projectExperience?: string;
  readonly jobDescription?: string;
  readonly professionalQuestions?: readonly InterviewQuestionCandidate[];
  readonly projectQuestions?: readonly InterviewQuestionCandidate[];
}): InterviewSessionState {
  const extractedResumeSections = extractResumeSectionsFromKickoffMessage(options.rawKickoffMessage);
  const resumeSections = {
    professionalSkills: options.professionalSkills ?? extractedResumeSections.professionalSkills,
    projectExperience: options.projectExperience ?? extractedResumeSections.projectExperience,
    jobDescription:
      options.jobDescription ?? extractJobDescriptionMarkdownFromKickoffMessage(options.rawKickoffMessage),
  };

  return initializeInterviewSession({
    threadId: options.threadId,
    rawKickoffMessage: options.rawKickoffMessage,
    professionalSkills: resumeSections.professionalSkills,
    projectExperience: resumeSections.projectExperience,
    jobDescription: resumeSections.jobDescription,
    professionalQuestions: options.professionalQuestions ?? [],
    projectQuestions: options.projectQuestions ?? [],
  });
}