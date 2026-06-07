import { extractNormalizedResumeTopics } from '../../../bff/src/modules/resume/resume-parser';

export type QuestionDriver = 'resume' | 'job-description' | 'resume-and-job-description';

interface SignalBuckets {
  readonly responsibilities: readonly string[];
  readonly technicalRequirements: readonly string[];
  readonly preferredSkills: readonly string[];
  readonly uncategorized: readonly string[];
}

export interface JobDescriptionSignalSet {
  readonly responsibilities: readonly string[];
  readonly technicalRequirements: readonly string[];
  readonly preferredSkills: readonly string[];
  readonly domainTerms: readonly string[];
  readonly topSignals: readonly string[];
  readonly alignedSignals: readonly string[];
  readonly gapSignals: readonly string[];
  readonly priorityKeywords: readonly string[];
}

type SignalBucketKey = keyof SignalBuckets;

const RESPONSIBILITY_HEADING_PATTERN = /(岗位职责|工作职责|职责|responsibilit|what you(?:'|’)ll do|what you will do|you will|job duties)/i;
const TECHNICAL_REQUIREMENT_HEADING_PATTERN = /(任职要求|岗位要求|要求|资格|must have|requirement|qualification|technical requirement|技能要求)/i;
const PREFERRED_SKILL_HEADING_PATTERN = /(加分|优先|preferred|nice to have|bonus|plus|preferred skill)/i;
const ENGLISH_STOP_WORDS = new Set([
  'and',
  'the',
  'with',
  'for',
  'from',
  'into',
  'will',
  'your',
  'have',
  'that',
  'this',
  'using',
  'build',
  'work',
  'team',
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLine(value: string): string {
  return normalizeWhitespace(
    value
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+•]\s+/, '')
      .replace(/^\d+[.)]\s+/, ''),
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function detectBucketFromHeading(line: string): SignalBucketKey | null {
  if (RESPONSIBILITY_HEADING_PATTERN.test(line)) {
    return 'responsibilities';
  }

  if (TECHNICAL_REQUIREMENT_HEADING_PATTERN.test(line)) {
    return 'technicalRequirements';
  }

  if (PREFERRED_SKILL_HEADING_PATTERN.test(line)) {
    return 'preferredSkills';
  }

  return null;
}

function collectSignalBuckets(jobDescription: string | undefined): SignalBuckets {
  if (!jobDescription?.trim()) {
    return {
      responsibilities: [],
      technicalRequirements: [],
      preferredSkills: [],
      uncategorized: [],
    };
  }

  const responsibilities: string[] = [];
  const technicalRequirements: string[] = [];
  const preferredSkills: string[] = [];
  const uncategorized: string[] = [];
  let activeBucket: SignalBucketKey | null = null;

  for (const rawLine of jobDescription.split(/\r?\n/)) {
    const normalizedLine = normalizeLine(rawLine);
    if (!normalizedLine) {
      continue;
    }

    const bucketFromHeading = detectBucketFromHeading(normalizedLine);
    if (rawLine.trimStart().startsWith('#') && bucketFromHeading) {
      activeBucket = bucketFromHeading;
      continue;
    }

    if (rawLine.trimStart().startsWith('#')) {
      activeBucket = null;
      continue;
    }

    if (activeBucket === 'responsibilities') {
      responsibilities.push(normalizedLine);
      continue;
    }

    if (activeBucket === 'technicalRequirements') {
      technicalRequirements.push(normalizedLine);
      continue;
    }

    if (activeBucket === 'preferredSkills') {
      preferredSkills.push(normalizedLine);
      continue;
    }

    uncategorized.push(normalizedLine);
  }

  return {
    responsibilities: dedupeStrings(responsibilities),
    technicalRequirements: dedupeStrings(technicalRequirements),
    preferredSkills: dedupeStrings(preferredSkills),
    uncategorized: dedupeStrings(uncategorized),
  };
}

function extractKeywords(signal: string): string[] {
  const normalized = normalizeWhitespace(signal).toLowerCase();
  const tokens = normalized
    .split(/[^a-z0-9\u3400-\u9fff+#.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 || /[\u3400-\u9fff]/u.test(token))
    .filter((token) => !ENGLISH_STOP_WORDS.has(token));

  return dedupeStrings([normalized, ...tokens]);
}

function overlapsWithContext(signal: string, contextTopics: readonly string[]): boolean {
  const normalizedContextTopics = contextTopics
    .map((topic) => normalizeWhitespace(topic).toLowerCase())
    .filter((topic) => topic.length > 0);
  const signalKeywords = extractKeywords(signal);

  return normalizedContextTopics.some((topic) => {
    if (signalKeywords.some((keyword) => topic.includes(keyword) || keyword.includes(topic))) {
      return true;
    }

    return extractKeywords(topic).some((keyword) => signalKeywords.includes(keyword));
  });
}

export function resolveQuestionDriver(options: {
  readonly hasResumeSignals: boolean;
  readonly hasJobDescriptionSignals: boolean;
}): QuestionDriver {
  if (options.hasResumeSignals && options.hasJobDescriptionSignals) {
    return 'resume-and-job-description';
  }

  if (options.hasJobDescriptionSignals) {
    return 'job-description';
  }

  return 'resume';
}

export function extractJobDescriptionSignalSet(options: {
  readonly jobDescription: string | undefined;
  readonly resumeTopics?: readonly string[];
  readonly projectTopics?: readonly string[];
}): JobDescriptionSignalSet {
  const buckets = collectSignalBuckets(options.jobDescription);
  const responsibilities = dedupeStrings([
    ...buckets.responsibilities,
    ...buckets.uncategorized.filter((line) => !TECHNICAL_REQUIREMENT_HEADING_PATTERN.test(line)),
  ]).slice(0, 4);
  const technicalRequirements = dedupeStrings(buckets.technicalRequirements).slice(0, 4);
  const preferredSkills = dedupeStrings(buckets.preferredSkills).slice(0, 3);
  const domainTerms = extractNormalizedResumeTopics(
    dedupeStrings([
      ...responsibilities,
      ...technicalRequirements,
      ...preferredSkills,
      ...buckets.uncategorized,
    ]).join('\n'),
  ).slice(0, 4);
  const topSignals = dedupeStrings([
    ...technicalRequirements,
    ...responsibilities,
    ...preferredSkills,
    ...domainTerms,
  ]).slice(0, 6);
  const contextTopics = dedupeStrings([...(options.resumeTopics ?? []), ...(options.projectTopics ?? [])]);
  const alignedSignals = topSignals.filter((signal) => overlapsWithContext(signal, contextTopics));
  const gapSignals = topSignals.filter((signal) => !overlapsWithContext(signal, contextTopics));
  const priorityKeywords = dedupeStrings(topSignals.flatMap((signal) => extractKeywords(signal))).slice(0, 8);

  return {
    responsibilities,
    technicalRequirements,
    preferredSkills,
    domainTerms,
    topSignals,
    alignedSignals,
    gapSignals,
    priorityKeywords,
  };
}