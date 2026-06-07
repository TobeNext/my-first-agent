import { extractJobDescriptionSignalSet } from './job-description-signals';

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractKeywords(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/[^a-z0-9\u3400-\u9fff+#.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 || /[\u3400-\u9fff]/u.test(token));
}

function splitContextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*+•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function extractRelevantProjectEvidence(projectExperience: string, signals: readonly string[]): string[] {
  const normalizedSignals = signals.map((signal) => normalizeWhitespace(signal));
  const signalKeywords = [...new Set(signals.flatMap((signal) => extractKeywords(signal)))];

  return splitContextLines(projectExperience).filter((line) => {
    const normalizedLine = normalizeWhitespace(line);

    if (normalizedSignals.some((signal) => normalizedLine.includes(signal) || signal.includes(normalizedLine))) {
      return true;
    }

    return signalKeywords.some((keyword) => normalizedLine.includes(keyword));
  });
}

export function buildProjectExperienceQuery(options: {
  readonly selectedDirection: string;
  readonly projectExperience: string;
  readonly rawKickoffMessage: string;
  readonly jobDescription?: string;
  readonly normalizedProjectTopics?: readonly string[];
}): string {
  const fallbackContext = options.projectExperience.trim() || options.rawKickoffMessage;
  const signalSet = extractJobDescriptionSignalSet({
    jobDescription: options.jobDescription,
    projectTopics: options.normalizedProjectTopics,
  });
  const evidenceSignals = signalSet.alignedSignals.length > 0 ? signalSet.alignedSignals : signalSet.topSignals;
  const relevantProjectEvidence = extractRelevantProjectEvidence(options.projectExperience, evidenceSignals).slice(0, 3);
  const gapSignals = signalSet.gapSignals.slice(0, 2);
  const queryParts = [
    `Target role: ${options.selectedDirection}`,
    'Round type: project-experience',
    'Project experience context:',
    fallbackContext,
  ];

  if (signalSet.topSignals.length === 0) {
    return queryParts.join('\n');
  }

  queryParts.push('Cross-check these JD requirements against the project evidence:');
  queryParts.push(...evidenceSignals.slice(0, 3).map((signal) => `- ${signal}`));

  if (relevantProjectEvidence.length > 0) {
    queryParts.push('Project evidence candidates:');
    queryParts.push(...relevantProjectEvidence.map((line) => `- ${line}`));
  }

  if (gapSignals.length > 0) {
    queryParts.push('Capability gaps to validate when the resume evidence is thin:');
    queryParts.push(...gapSignals.map((signal) => `- ${signal}`));
  }

  queryParts.push('Ask for concrete project decisions, trade-offs, ownership, or execution evidence instead of accepting resume claims at face value.');

  return queryParts.join('\n');
}