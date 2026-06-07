import { parseResumeMarkdown } from './resume-parser';

export function validateResumeMarkdown(markdown: string): readonly string[] {
  return parseResumeMarkdown(markdown).validationErrors;
}

export function countProfessionalSkillGroups(markdown: string): number {
  return parseResumeMarkdown(markdown).normalizedSkills.length;
}

export function extractResumeSectionMarkdowns(markdown: string): {
  readonly professionalSkills: string;
  readonly projectExperience: string;
} {
  const parsedResume = parseResumeMarkdown(markdown);

  return {
    professionalSkills: parsedResume.professionalSkillsSection,
    projectExperience: parsedResume.projectExperienceSection,
  };
}