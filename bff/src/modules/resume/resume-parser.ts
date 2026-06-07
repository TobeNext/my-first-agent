const RESUME_SECTION_DEFINITIONS = {
  professionalSkills: {
    canonicalHeading: '专业技能',
    compatibleHeadings: [
      '专业技能',
      '核心技能',
      '技术栈',
      '技能清单',
      '技能栈',
      '技术能力',
      'skills',
      'skill set',
      'core skills',
      'technical skills',
      'professional skills',
    ],
  },
  projectExperience: {
    canonicalHeading: '项目经历',
    compatibleHeadings: [
      '项目经历',
      '项目经验',
      '项目实践',
      '项目案例',
      '代表项目',
      'projects',
      'project experience',
      'project experiences',
      'selected projects',
      'project highlights',
    ],
  },
} satisfies Record<
  string,
  {
    readonly canonicalHeading: string;
    readonly compatibleHeadings: readonly string[];
  }
>;

type ResumeSectionKey = keyof typeof RESUME_SECTION_DEFINITIONS;

interface MarkdownLine {
  readonly lineNumber: number;
  readonly value: string;
}

interface ResumeSection {
  readonly key: ResumeSectionKey;
  readonly headingLineNumber: number;
  readonly headingRawValue: string;
  readonly contentLines: readonly MarkdownLine[];
}

export interface ResumeSectionMarkdowns {
  readonly professionalSkills: string;
  readonly projectExperience: string;
}

export interface ParsedResumeMarkdown {
  readonly professionalSkillsSection: string;
  readonly projectExperienceSection: string;
  readonly normalizedSkills: readonly string[];
  readonly normalizedProjectTopics: readonly string[];
  readonly warnings: readonly string[];
  readonly validationErrors: readonly string[];
}

function normalizeSectionContent(content: string): string {
  return content.trim();
}

function normalizeHeadingName(value: string): string {
  return value
    .trim()
    .replace(/^[:：\-\s]+|[:：\-\s]+$/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractHeadingName(line: string): string | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return null;
  }

  const markdownHeadingMatch = trimmedLine.match(/^#{1,6}\s*(.+?)\s*#*\s*$/);
  if (markdownHeadingMatch) {
    /* c8 ignore next -- the regex requires at least one captured heading character when the match succeeds. */
    return markdownHeadingMatch[1]?.trim() ?? null;
  }

  const boldHeadingMatch = trimmedLine.match(/^\*\*(.+?)\*\*$/);
  if (boldHeadingMatch) {
    /* c8 ignore next -- the regex requires at least one captured heading character when the match succeeds. */
    return boldHeadingMatch[1]?.trim() ?? null;
  }

  const normalizedLine = normalizeHeadingName(trimmedLine);
  return normalizedLine.length > 0 ? trimmedLine : null;
}

function isCanonicalHeadingLine(line: string, sectionKey: ResumeSectionKey): boolean {
  return line.trim() === `### ${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}`;
}

function isListItemLine(value: string): boolean {
  return /^(?:[-*+•]\s+|\d+[.)]\s+)/.test(value.trimStart());
}

function getListItemContent(value: string): string {
  return value.trimStart().replace(/^(?:[-*+•]\s+|\d+[.)]\s+)/, '').trim();
}

function resolveSectionKey(heading: string): ResumeSectionKey | null {
  const normalizedHeading = normalizeHeadingName(heading);
  for (const [sectionKey, definition] of Object.entries(RESUME_SECTION_DEFINITIONS) as [
    ResumeSectionKey,
    (typeof RESUME_SECTION_DEFINITIONS)[ResumeSectionKey],
  ][]) {
    if (definition.compatibleHeadings.some((candidateHeading) => normalizeHeadingName(candidateHeading) === normalizedHeading)) {
      return sectionKey;
    }
  }

  return null;
}

function collectResumeSections(markdown: string): {
  readonly sections: Partial<Record<ResumeSectionKey, ResumeSection>>;
  readonly validationErrors: readonly string[];
  readonly warnings: readonly string[];
} {
  const sections: Partial<Record<ResumeSectionKey, ResumeSection>> = {};
  const validationErrors: string[] = [];
  const warnings: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentSectionKey: ResumeSectionKey | null = null;

  for (const [index, line] of lines.entries()) {
    const headingName = extractHeadingName(line);
    const sectionKey = headingName ? resolveSectionKey(headingName) : null;
    if (sectionKey) {
      if (sections[sectionKey]) {
        validationErrors.push(
          `第 ${index + 1} 行：章节“### ${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}”重复出现。`,
        );
      }

      if (!isCanonicalHeadingLine(line, sectionKey)) {
        warnings.push(
          `第 ${index + 1} 行：已将标题“${line.trim()}”兼容识别为“### ${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}”。`,
        );
      }

      sections[sectionKey] = {
        key: sectionKey,
        headingLineNumber: index + 1,
        headingRawValue: line,
        contentLines: [],
      };
      currentSectionKey = sectionKey;
      continue;
    }

    if (headingName && line.trimStart().startsWith('#')) {
      currentSectionKey = null;
      continue;
    }

    if (!currentSectionKey) {
      continue;
    }

    const currentSection = sections[currentSectionKey];
    sections[currentSectionKey] = {
      key: currentSectionKey,
      /* c8 ignore next 3 -- the section entry is created as soon as a recognized heading is seen. */
      headingLineNumber: currentSection?.headingLineNumber ?? index + 1,
      headingRawValue: currentSection?.headingRawValue ?? '',
      contentLines: [
        ...(currentSection?.contentLines ?? []),
        {
          lineNumber: index + 1,
          value: line,
        },
      ],
    };
  }

  return {
    sections,
    validationErrors,
    warnings,
  };
}

function toSectionMarkdown(section: ResumeSection | undefined): string {
  if (!section) {
    return '';
  }

  return normalizeSectionContent(
    section.contentLines
      .map((line) => line.value)
      .join('\n'),
  );
}

function validateSectionContent(sectionKey: ResumeSectionKey, section: ResumeSection): {
  readonly validationErrors: readonly string[];
  readonly warnings: readonly string[];
} {
  const meaningfulLines = section.contentLines.filter((line) => {
    const trimmedLine = line.value.trim();
    return trimmedLine.length > 0 && trimmedLine !== '...';
  });

  if (meaningfulLines.length === 0) {
    return {
      validationErrors: [
        `第 ${section.headingLineNumber} 行：章节“### ${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}”不能为空，且至少包含一条以 "- " 开头的内容。`,
      ],
      warnings: [],
    };
  }

  const validationErrors: string[] = [];
  const warnings: string[] = [];
  const listItemLines = meaningfulLines.filter((line) => isListItemLine(line.value));
  if (listItemLines.length === 0) {
    warnings.push(
      `第 ${section.headingLineNumber} 行（${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}）：未使用标准列表标记，已按逐行条目兼容解析。`,
    );
    return {
      validationErrors,
      warnings,
    };
  }

  for (const line of listItemLines) {
    if (getListItemContent(line.value).length === 0) {
      validationErrors.push(
        `第 ${line.lineNumber} 行（${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}）："- " 后必须填写具体内容。`,
      );
    }
  }

  return {
    validationErrors,
    warnings,
  };
}

export function extractNormalizedResumeTopics(sectionMarkdown: string): readonly string[] {
  const lines = sectionMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line !== '...');
  const groupedLines: string[] = [];
  let currentGroupedLine: string[] = [];
  let hasStructuredItems = false;

  for (const line of lines) {
    if (isListItemLine(line)) {
      hasStructuredItems = true;
      if (currentGroupedLine.length > 0) {
        groupedLines.push(currentGroupedLine.join(' '));
      }

      const content = getListItemContent(line);
      /* c8 ignore next -- list markers are only recognized when they already carry non-empty content after trimming. */
      currentGroupedLine = content.length > 0 ? [content] : [];
      continue;
    }

    if (hasStructuredItems) {
      if (currentGroupedLine.length > 0) {
        currentGroupedLine.push(line.replace(/\s+/g, ' ').trim());
      }
      continue;
    }

    groupedLines.push(line.replace(/\s+/g, ' ').trim());
  }

  if (currentGroupedLine.length > 0) {
    groupedLines.push(currentGroupedLine.join(' '));
  }

  const normalizedGroupedLines = groupedLines.filter((line) => line.length > 1);
  const seen = new Set<string>();
  const normalizedTopics: string[] = [];

  for (const groupedLine of normalizedGroupedLines) {
    const dedupeKey = groupedLine.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedTopics.push(groupedLine);
  }

  return normalizedTopics.slice(0, 8);
}

function buildParsedResumeResult(options: {
  readonly professionalSkillsSection: string;
  readonly projectExperienceSection: string;
  readonly warnings: readonly string[];
  readonly validationErrors: readonly string[];
}): ParsedResumeMarkdown {
  const professionalSkillsSection = normalizeSectionContent(options.professionalSkillsSection);
  const projectExperienceSection = normalizeSectionContent(options.projectExperienceSection);

  return {
    professionalSkillsSection,
    projectExperienceSection,
    normalizedSkills: extractNormalizedResumeTopics(professionalSkillsSection),
    normalizedProjectTopics: extractNormalizedResumeTopics(projectExperienceSection),
    warnings: [...options.warnings],
    validationErrors: [...options.validationErrors],
  };
}

export function parseResumeMarkdown(markdown: string): ParsedResumeMarkdown {
  if (markdown.trim().length === 0) {
    return buildParsedResumeResult({
      professionalSkillsSection: '',
      projectExperienceSection: '',
      warnings: [],
      validationErrors: ['简历内容不能为空。'],
    });
  }

  const { sections, validationErrors, warnings } = collectResumeSections(markdown);
  const collectedErrors = [...validationErrors];
  const collectedWarnings = [...warnings];

  for (const sectionKey of Object.keys(RESUME_SECTION_DEFINITIONS) as ResumeSectionKey[]) {
    const section = sections[sectionKey];
    if (!section) {
      collectedErrors.push(`缺少章节：### ${RESUME_SECTION_DEFINITIONS[sectionKey].canonicalHeading}。`);
      continue;
    }

    const sectionValidation = validateSectionContent(sectionKey, section);
    collectedErrors.push(...sectionValidation.validationErrors);
    collectedWarnings.push(...sectionValidation.warnings);
  }

  return buildParsedResumeResult({
    professionalSkillsSection: toSectionMarkdown(sections.professionalSkills),
    projectExperienceSection: toSectionMarkdown(sections.projectExperience),
    warnings: collectedWarnings,
    validationErrors: collectedErrors,
  });
}

export function parseResumeSections(sectionMarkdowns: ResumeSectionMarkdowns): ParsedResumeMarkdown {
  return buildParsedResumeResult({
    professionalSkillsSection: sectionMarkdowns.professionalSkills,
    projectExperienceSection: sectionMarkdowns.projectExperience,
    warnings: [],
    validationErrors: [],
  });
}