import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { extractMarkdownSection } from '../lib/interview-kickoff-recovery';

export const resumeParserTool = createTool({
  id: 'resume-parser',
  description: 'Parse a markdown resume into two interview reference sections: 专业技能 and 项目经历.',
  inputSchema: z.object({
    resumeMarkdown: z.string().min(1).describe('The full markdown resume uploaded by the candidate.'),
  }),
  outputSchema: z.object({
    professionalSkills: z.string(),
    projectExperience: z.string(),
    hasProfessionalSkills: z.boolean(),
    hasProjectExperience: z.boolean(),
  }),
  execute: async ({ resumeMarkdown }) => {
    const professionalSkills = extractMarkdownSection(resumeMarkdown, '专业技能');
    const projectExperience = extractMarkdownSection(resumeMarkdown, '项目经历');

    return {
      professionalSkills,
      projectExperience,
      hasProfessionalSkills: professionalSkills.length > 0,
      hasProjectExperience: projectExperience.length > 0,
    };
  },
});