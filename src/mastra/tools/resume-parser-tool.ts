import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { parseResumeMarkdown } from '../../../bff/src/modules/resume/resume-parser';

export const resumeParserTool = createTool({
  id: 'resume-parser',
  description: 'Parse a markdown resume into two interview reference sections: 专业技能 and 项目经历.',
  inputSchema: z.object({
    resumeMarkdown: z.string().min(1).describe('The full markdown resume uploaded by the candidate.'),
  }),
  outputSchema: z.object({
    professionalSkills: z.string(),
    projectExperience: z.string(),
    normalizedSkills: z.array(z.string()),
    normalizedProjectTopics: z.array(z.string()),
    warnings: z.array(z.string()),
    validationErrors: z.array(z.string()),
    hasProfessionalSkills: z.boolean(),
    hasProjectExperience: z.boolean(),
  }),
  execute: async ({ resumeMarkdown }) => {
    const parsedResume = parseResumeMarkdown(resumeMarkdown);
    const professionalSkills = parsedResume.professionalSkillsSection;
    const projectExperience = parsedResume.projectExperienceSection;

    return {
      professionalSkills,
      projectExperience,
      normalizedSkills: [...parsedResume.normalizedSkills],
      normalizedProjectTopics: [...parsedResume.normalizedProjectTopics],
      warnings: [...parsedResume.warnings],
      validationErrors: [...parsedResume.validationErrors],
      hasProfessionalSkills: professionalSkills.length > 0,
      hasProjectExperience: projectExperience.length > 0,
    };
  },
});