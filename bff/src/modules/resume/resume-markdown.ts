const REQUIRED_SECTION_HEADINGS = ['专业技能', '项目经历'] as const;

type RequiredSectionHeading = (typeof REQUIRED_SECTION_HEADINGS)[number];

interface MarkdownLine {
  readonly lineNumber: number;
  readonly value: string;
}

interface ResumeSection {
  readonly heading: RequiredSectionHeading;
  readonly headingLineNumber: number;
  readonly contentLines: readonly MarkdownLine[];
}

function isRequiredSectionHeading(value: string): value is RequiredSectionHeading {
  return REQUIRED_SECTION_HEADINGS.includes(value as RequiredSectionHeading);
}

function extractResumeSections(markdown: string): {
  readonly sections: Partial<Record<RequiredSectionHeading, ResumeSection>>;
  readonly errors: readonly string[];
} {
  const sections: Partial<Record<RequiredSectionHeading, ResumeSection>> = {};
  const errors: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentSection: RequiredSectionHeading | null = null;

  for (const [index, line] of lines.entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('### ')) {
      const heading = trimmedLine.replace(/^###\s*/, '');
      if (!isRequiredSectionHeading(heading)) {
        currentSection = null;
        continue;
      }

      if (sections[heading]) {
        errors.push(`第 ${index + 1} 行：章节“### ${heading}”重复出现。`);
      }

      sections[heading] = {
        heading,
        headingLineNumber: index + 1,
        contentLines: [],
      };
      currentSection = heading;
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const currentContentLines = sections[currentSection]?.contentLines ?? [];
    sections[currentSection] = {
      heading: currentSection,
      headingLineNumber: sections[currentSection]?.headingLineNumber ?? index + 1,
      contentLines: [
        ...currentContentLines,
        {
          lineNumber: index + 1,
          value: line,
        },
      ],
    };
  }

  return {
    sections,
    errors,
  };
}

function validateSectionContent(section: ResumeSection): readonly string[] {
  const meaningfulLines = section.contentLines.filter((line) => {
    const trimmedLine = line.value.trim();
    return trimmedLine.length > 0 && trimmedLine !== '...';
  });

  if (meaningfulLines.length === 0) {
    return [`第 ${section.headingLineNumber} 行：章节“### ${section.heading}”不能为空，且至少包含一条以 "- " 开头的内容。`];
  }

  const errors: string[] = [];
  for (const line of meaningfulLines) {
    const trimmedLine = line.value.trimStart();
    if (!trimmedLine.startsWith('- ')) {
      errors.push(`第 ${line.lineNumber} 行（${section.heading}）：内容项必须以 "- " 开头。`);
      continue;
    }

    if (trimmedLine.slice(2).trim().length === 0) {
      errors.push(`第 ${line.lineNumber} 行（${section.heading}）："- " 后必须填写具体内容。`);
    }
  }

  return errors;
}

function extractSectionBulletGroups(section: ResumeSection | undefined): string[] {
  if (!section) {
    return [];
  }

  return section.contentLines
    .map((line) => line.value.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line !== '...')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

export function validateResumeMarkdown(markdown: string): readonly string[] {
  if (markdown.trim().length === 0) {
    return ['简历内容不能为空。'];
  }

  const { sections, errors } = extractResumeSections(markdown);
  const validationErrors = [...errors];

  for (const heading of REQUIRED_SECTION_HEADINGS) {
    const section = sections[heading];
    if (!section) {
      validationErrors.push(`缺少章节：### ${heading}。`);
      continue;
    }

    validationErrors.push(...validateSectionContent(section));
  }

  return validationErrors;
}

export function countProfessionalSkillGroups(markdown: string): number {
  const { sections } = extractResumeSections(markdown);
  return extractSectionBulletGroups(sections['专业技能']).length;
}